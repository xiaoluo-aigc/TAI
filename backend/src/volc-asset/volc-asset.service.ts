// backend/src/volc-asset/volc-asset.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { signVolcRequest } from './volc-sign.util';
import type { VolcAssetStatus } from './volc-asset.dto';

interface VolcEnv {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  host: string;
  projectName: string;
  version: string;
}

interface CreateAssetGroupResp {
  Id?: string;
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}
interface CreateAssetResp {
  Id?: string;
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}
interface GetAssetResp {
  Status?: 'Processing' | 'Active' | 'Failed';
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}

const VOLC_API_TIMEOUT_MS = 25_000;

type VolcReviewGroupMemoryRecord = {
  date: string;
  groupId: string;
  createdAt: Date;
};

@Injectable()
export class VolcAssetService implements OnModuleInit {
  private readonly logger = new Logger(VolcAssetService.name);
  private env!: VolcEnv;
  // date string (YYYY-MM-DD) → groupId
  private readonly groupCache = new Map<string, string>();
  private readonly memoryGroups = new Map<string, VolcReviewGroupMemoryRecord>();
  private persistenceUnavailable = false;
  private persistenceWarningLogged = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.env = {
      accessKey: (this.config.get<string>('VOLC_ARK_ACCESS_KEY') || '').trim(),
      secretKey: (this.config.get<string>('VOLC_ARK_SECRET_KEY') || '').trim(),
      region: (this.config.get<string>('VOLC_ARK_REGION') || 'cn-beijing').trim(),
      service: 'ark',
      host: (this.config.get<string>('VOLC_ARK_API_HOST') || 'open.volcengineapi.com').trim(),
      projectName: (this.config.get<string>('VOLC_ARK_PROJECT_NAME') || 'default').trim(),
      version: '2024-01-01',
    };
    if (!this.env.accessKey || !this.env.secretKey) {
      this.logger.warn(
        'VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，VolcAsset 能力不可用。',
      );
    }
  }

  private normalizeStatus(s?: string): VolcAssetStatus {
    const u = (s || '').toLowerCase();
    if (u === 'active') return 'active';
    if (u === 'failed') return 'failed';
    return 'processing';
  }

  // 北京时间 YYYY-MM-DD
  private todayDate(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private isPersistenceMissingError(err: any): boolean {
    const code = typeof err?.code === 'string' ? err.code : '';
    const message = String(err?.message || '').toLowerCase();
    return (
      code === 'P2021' ||
      code === 'P2022' ||
      message.includes('volcreviewgroup') ||
      message.includes('volc_review_group') ||
      message.includes('table') && message.includes('does not exist')
    );
  }

  private markPersistenceUnavailable(err: any) {
    this.persistenceUnavailable = true;
    if (this.persistenceWarningLogged) return;
    this.persistenceWarningLogged = true;
    this.logger.warn(
      `volcReviewGroup 表不可用，素材组复用降级为内存模式（重启后缓存会丢失）：${err?.message || err}`,
    );
  }

  private async findPersistedGroup(date: string): Promise<VolcReviewGroupMemoryRecord | null> {
    if (this.persistenceUnavailable) {
      return this.memoryGroups.get(date) || null;
    }
    try {
      return await this.prisma.volcReviewGroup.findUnique({ where: { date } });
    } catch (err: any) {
      if (!this.isPersistenceMissingError(err)) throw err;
      this.markPersistenceUnavailable(err);
      return this.memoryGroups.get(date) || null;
    }
  }

  private async persistGroup(date: string, groupId: string): Promise<void> {
    const record = { date, groupId, createdAt: new Date() };
    this.memoryGroups.set(date, record);
    if (this.persistenceUnavailable) return;
    try {
      await this.prisma.volcReviewGroup.create({ data: { date, groupId } });
    } catch (err: any) {
      if (!this.isPersistenceMissingError(err)) throw err;
      this.markPersistenceUnavailable(err);
    }
  }

  private async call<T>(action: string, body: Record<string, any>): Promise<T> {
    if (!this.env.accessKey || !this.env.secretKey) {
      throw new Error('Volc asset access key not configured');
    }
    const jsonBody = JSON.stringify(body);
    const signed = signVolcRequest({
      accessKey: this.env.accessKey,
      secretKey: this.env.secretKey,
      region: this.env.region,
      service: this.env.service,
      host: this.env.host,
      method: 'POST',
      action,
      version: this.env.version,
      body: jsonBody,
    });
    // Node/undici fetch ignores (and warns about) `Host`; remove before sending.
    const { Host: _host, ...fetchHeaders } = signed.headers;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VOLC_API_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(signed.url, {
        method: 'POST',
        headers: fetchHeaders,
        body: jsonBody,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Volc ${action} timeout after ${VOLC_API_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    const text = await resp.text();
    if (!resp.ok) {
      let detail = text.slice(0, 200);
      try {
        const errParsed = JSON.parse(text);
        const code = errParsed?.ResponseMetadata?.Error?.Code;
        const msg = errParsed?.ResponseMetadata?.Error?.Message;
        if (code) detail = `[${code}] ${msg || 'unknown'}`;
      } catch {
        // non-JSON error body — keep raw text
      }
      throw new Error(`Volc ${action} HTTP ${resp.status}: ${detail}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Volc ${action} bad response: ${text.slice(0, 200)}`);
    }
    const err = parsed?.ResponseMetadata?.Error;
    if (err?.Code) {
      throw new Error(`Volc ${action} error [${err.Code}]: ${err.Message || 'unknown'}`);
    }
    const unwrapped =
      parsed && typeof parsed === 'object' && parsed.Result !== undefined
        ? parsed.Result
        : parsed;
    return unwrapped as T;
  }

  async ensureTodayGroup(): Promise<string> {
    const date = this.todayDate();
    const cached = this.groupCache.get(date);
    if (cached) return cached;

    const existing = await this.findPersistedGroup(date);
    if (existing) {
      this.groupCache.set(date, existing.groupId);
      return existing.groupId;
    }

    const resp = await this.call<CreateAssetGroupResp>('CreateAssetGroup', {
      Name: `tanva-review-${date}`,
      Description: `Review group for ${date}`,
      GroupType: 'AIGC',
      ProjectName: this.env.projectName,
    });
    const groupId = resp?.Id;
    if (!groupId) throw new Error('Volc CreateAssetGroup: empty Id');
    await this.persistGroup(date, groupId);
    this.groupCache.set(date, groupId);
    return groupId;
  }

  invalidateTodayGroup() {
    this.groupCache.delete(this.todayDate());
  }

  async uploadAsset(
    userId: string,
    sourceUrl: string,
    assetType: 'image',
  ): Promise<{ assetId: string; status: VolcAssetStatus; errorMessage?: string }> {
    const groupId = await this.ensureTodayGroup();
    const resp = await this.call<CreateAssetResp>('CreateAsset', {
      GroupId: groupId,
      URL: sourceUrl,
      AssetType: 'Image',
      ProjectName: this.env.projectName,
    });
    if (!resp?.Id) throw new Error('Volc CreateAsset: empty Id');
    const initial = await this.getAssetStatus(resp.Id).catch(() => ({
      status: 'processing' as VolcAssetStatus,
      errorMessage: undefined,
    }));
    return { assetId: resp.Id, status: initial.status, errorMessage: initial.errorMessage };
  }

  async getAssetStatus(
    assetId: string,
  ): Promise<{ status: VolcAssetStatus; errorMessage?: string }> {
    const resp = await this.call<GetAssetResp>('GetAsset', {
      Id: assetId,
      ProjectName: this.env.projectName,
    });
    return {
      status: this.normalizeStatus(resp?.Status),
      errorMessage: undefined,
    };
  }

  async deleteAssetGroup(groupId: string): Promise<void> {
    await this.call<Record<string, unknown>>('DeleteAssetGroup', {
      Id: groupId,
      ProjectName: this.env.projectName,
    });
  }

  async listReviewGroups() {
    if (this.persistenceUnavailable) {
      return Array.from(this.memoryGroups.values()).sort((a, b) => b.date.localeCompare(a.date));
    }
    try {
      return await this.prisma.volcReviewGroup.findMany({
        orderBy: { date: 'desc' },
      });
    } catch (err: any) {
      if (!this.isPersistenceMissingError(err)) throw err;
      this.markPersistenceUnavailable(err);
      return Array.from(this.memoryGroups.values()).sort((a, b) => b.date.localeCompare(a.date));
    }
  }

  // date: YYYY-MM-DD（北京时间）。不传则取 3 天前。
  async cleanupGroupByDate(date?: string): Promise<{ date: string; deleted: boolean }> {
    const targetDate = date ?? (() => {
      const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
      d.setDate(d.getDate() - 3);
      return d.toISOString().slice(0, 10);
    })();

    const record = await this.findPersistedGroup(targetDate);
    if (!record) return { date: targetDate, deleted: false };

    await this.deleteAssetGroup(record.groupId);
    this.memoryGroups.delete(targetDate);
    if (!this.persistenceUnavailable) {
      try {
        await this.prisma.volcReviewGroup.delete({ where: { date: targetDate } });
      } catch (err: any) {
        if (!this.isPersistenceMissingError(err)) throw err;
        this.markPersistenceUnavailable(err);
      }
    }
    this.groupCache.delete(targetDate);
    return { date: targetDate, deleted: true };
  }

  async cleanupExpiredGroup(): Promise<{ date: string; deleted: boolean }> {
    return this.cleanupGroupByDate();
  }
}
