import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';

export interface TencentVodAigcCreateTaskRequest {
  prompt: string;
  modelName: string;
  modelVersion: string;
  fileInfos?: Array<{
    type?: 'File' | 'Url';
    fileId?: string;
    url?: string;
  }>;
  aspectRatio?: string;
  imageSize?: string;
  negativePrompt?: string;
  enhancePrompt?: 'Enabled' | 'Disabled';
  inputRegion?: 'Mainland' | 'Oversea' | 'OverseaUSWest';
  sessionContext?: string;
  sessionId?: string;
}

export interface TencentVodAigcVideoFileInfo {
  type?: 'File' | 'Url';
  category?: 'Image' | 'Video';
  fileId?: string;
  url?: string;
  objectId?: string;
  usage?: 'FirstFrame' | 'Reference';
  referenceType?: 'feature' | 'base' | 'asset' | 'style';
  keepOriginalSound?: 'Enabled' | 'Disabled';
}

export interface TencentVodAigcCreateVideoTaskRequest {
  prompt?: string;
  modelName: string;
  modelVersion: string;
  fileInfos?: TencentVodAigcVideoFileInfo[];
  lastFrameFileId?: string;
  lastFrameUrl?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  audioGeneration?: 'Enabled' | 'Disabled';
  enhancePrompt?: 'Enabled' | 'Disabled';
  mediaName?: string;
  storageMode?: 'Temporary' | 'Permanent';
  sceneType?: string;
  extInfo?: string;
  sessionContext?: string;
  sessionId?: string;
}

export interface TencentVodAigcTaskStatus {
  taskId: string;
  status?: string;
  imageUrl?: string;
  requestId?: string;
  raw?: Record<string, any>;
}

export interface TencentVodAigcVideoTaskStatus {
  taskId: string;
  status?: string;
  videoUrl?: string;
  fileId?: string;
  requestId?: string;
  raw?: Record<string, any>;
}

@Injectable()
export class TencentVodAigcService {
  private readonly logger = new Logger(TencentVodAigcService.name);
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly sessionToken?: string;
  private readonly endpoint: string;
  private readonly region?: string;
  private readonly version: string;
  private readonly service = 'vod';
  private readonly subAppId?: number;
  private readonly timeoutMs: number;
  private readonly initialDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(private readonly configService: ConfigService) {
    this.secretId = this.normalizeEnvValue(this.configService.get<string>('TENCENT_VOD_SECRET_ID'));
    this.secretKey = this.normalizeEnvValue(this.configService.get<string>('TENCENT_VOD_SECRET_KEY'));
    this.sessionToken =
      this.normalizeEnvValue(this.configService.get<string>('TENCENT_VOD_SESSION_TOKEN')) || undefined;
    this.endpoint = this.normalizeEndpoint(
      this.normalizeEnvValue(this.configService.get<string>('TENCENT_VOD_ENDPOINT')) ||
        'vod.tencentcloudapi.com',
    );
    this.region = this.normalizeEnvValue(this.configService.get<string>('TENCENT_VOD_REGION')) || undefined;
    this.version =
      (this.configService.get<string>('TENCENT_VOD_API_VERSION') || '2018-07-17').trim();
    this.subAppId = this.parseOptionalPositiveInt(
      this.configService.get<string>('TENCENT_VOD_SUB_APP_ID'),
    );
    this.timeoutMs = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_VOD_TIMEOUT_MS'),
      30_000,
    );
    this.initialDelayMs = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_VOD_AIGC_INITIAL_DELAY_MS'),
      5_000,
    );
    this.pollIntervalMs = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_VOD_AIGC_POLL_INTERVAL_MS'),
      3_000,
    );
    this.maxPollAttempts = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_VOD_AIGC_MAX_POLL_ATTEMPTS'),
      300,
    );
  }

  private normalizeEnvValue(value?: string | null): string {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  private normalizeEndpoint(endpoint: string): string {
    let value = (endpoint || '').trim();
    if (!value) return 'vod.tencentcloudapi.com';
    value = value.replace(/^https?:\/\//i, '');
    value = value.replace(/\/+.*$/, '');
    return value.toLowerCase();
  }

  isAvailable(): boolean {
    return !!this.secretId && !!this.secretKey;
  }

  async createImageTask(
    request: TencentVodAigcCreateTaskRequest,
  ): Promise<{ taskId: string; requestId?: string }> {
    this.ensureCredentialReady();
    if (typeof this.subAppId !== 'number') {
      throw new ServiceUnavailableException(
        'Tencent VOD SubAppId is required for AIGC image task. Please set TENCENT_VOD_SUB_APP_ID in backend/.env.',
      );
    }

    const prompt = (request.prompt || '').trim();
    const normalizedFileInfos =
      (request.fileInfos || [])
        .map((item) => {
          const typeRaw = String(item?.type || '').trim().toLowerCase();
          const type = typeRaw === 'url' ? 'Url' : 'File';
          const fileId = (item?.fileId || '').trim();
          const url = (item?.url || '').trim();
          return { type, fileId, url };
        })
        .filter((item) => (item.type === 'Url' ? !!item.url : !!item.fileId)) || [];

    if (!prompt && normalizedFileInfos.length === 0) {
      throw new BadRequestException('Tencent AIGC prompt or fileInfos is required');
    }

    const payload: Record<string, any> = {
      ModelName: request.modelName,
      ModelVersion: request.modelVersion,
      EnhancePrompt: request.enhancePrompt || 'Enabled',
      OutputConfig: {
        StorageMode: 'Temporary',
      },
    };

    if (prompt) {
      payload.Prompt = prompt;
    }

    if (normalizedFileInfos.length > 0) {
      payload.FileInfos = normalizedFileInfos.map((item) =>
        item.type === 'Url'
          ? {
              Type: 'Url',
              Url: item.url,
            }
          : {
              Type: 'File',
              FileId: item.fileId,
            },
      );
    }

    payload.SubAppId = this.subAppId;

    if (request.aspectRatio) {
      payload.OutputConfig.AspectRatio = request.aspectRatio;
    }

    const normalizedImageSize =
      typeof request.imageSize === 'string' ? request.imageSize.trim().toUpperCase() : '';
    if (normalizedImageSize) {
      payload.OutputConfig.Resolution = normalizedImageSize;
    }

    if (request.negativePrompt) {
      payload.NegativePrompt = request.negativePrompt;
    }

    if (request.inputRegion) {
      payload.InputRegion = request.inputRegion;
    }

    if (request.sessionContext) {
      payload.SessionContext = request.sessionContext;
    }

    if (request.sessionId) {
      payload.SessionId = request.sessionId;
    }

    const response = await this.callTencentApi('CreateAigcImageTask', payload);
    const taskId = this.pickFirstString(response?.TaskId, response?.taskId);
    if (!taskId) {
      throw new BadGatewayException('Tencent CreateAigcImageTask succeeded but TaskId is missing');
    }

    const requestId = this.pickFirstString(response?.RequestId, response?.requestId);
    return { taskId, requestId };
  }

  async createVideoTask(
    request: TencentVodAigcCreateVideoTaskRequest,
  ): Promise<{ taskId: string; requestId?: string }> {
    this.ensureCredentialReady();
    if (typeof this.subAppId !== 'number') {
      throw new ServiceUnavailableException(
        'Tencent VOD SubAppId is required for AIGC video task. Please set TENCENT_VOD_SUB_APP_ID in backend/.env.',
      );
    }

    const prompt = (request.prompt || '').trim();
    const normalizedFileInfos =
      (request.fileInfos || [])
        .map((item) => {
          const typeRaw = String(item?.type || '').trim().toLowerCase();
          const categoryRaw = String(item?.category || '').trim().toLowerCase();
          const type = typeRaw === 'file' ? 'File' : 'Url';
          const category = categoryRaw === 'video' ? 'Video' : 'Image';
          const fileId = (item?.fileId || '').trim();
          const url = (item?.url || '').trim();
          const objectId = (item?.objectId || '').trim();
          const usage = (item?.usage || '').trim();
          const referenceType = (item?.referenceType || '').trim().toLowerCase();
          const keepOriginalSound = (item?.keepOriginalSound || '').trim();
          return { type, category, fileId, url, objectId, usage, referenceType, keepOriginalSound };
        })
        .filter((item) => (item.type === 'File' ? !!item.fileId : !!item.url)) || [];

    if (!prompt && normalizedFileInfos.length === 0) {
      throw new BadRequestException('Tencent AIGC video requires prompt or fileInfos');
    }

    const payload: Record<string, any> = {
      SubAppId: this.subAppId,
      ModelName: request.modelName,
      ModelVersion: request.modelVersion,
      EnhancePrompt: request.enhancePrompt || 'Enabled',
      OutputConfig: {
        StorageMode: request.storageMode || 'Temporary',
      },
    };

    if (prompt) {
      payload.Prompt = prompt;
    }

    if (normalizedFileInfos.length > 0) {
      payload.FileInfos = normalizedFileInfos.map((item) => {
        const result: Record<string, any> =
          item.type === 'File'
            ? {
                Type: 'File',
                Category: item.category,
                FileId: item.fileId,
              }
            : {
                Type: 'Url',
                Category: item.category,
                Url: item.url,
              };
        if (item.objectId) result.ObjectId = item.objectId;
        if (item.usage) result.Usage = item.usage;
        if (item.referenceType) result.ReferenceType = item.referenceType;
        if (item.keepOriginalSound) result.KeepOriginalSound = item.keepOriginalSound;
        return result;
      });
    }

    const lastFrameFileId = (request.lastFrameFileId || '').trim();
    const lastFrameUrl = (request.lastFrameUrl || '').trim();
    if (lastFrameFileId) {
      payload.LastFrameFileId = lastFrameFileId;
    } else if (lastFrameUrl) {
      payload.LastFrameUrl = lastFrameUrl;
    }

    if (request.aspectRatio) {
      payload.OutputConfig.AspectRatio = request.aspectRatio;
    }
    if (typeof request.duration === 'number' && Number.isFinite(request.duration) && request.duration > 0) {
      payload.OutputConfig.Duration = request.duration;
    }
    if (request.resolution) {
      payload.OutputConfig.Resolution = request.resolution;
    }
    if (request.audioGeneration) {
      payload.OutputConfig.AudioGeneration = request.audioGeneration;
    }
    if (request.mediaName) {
      payload.OutputConfig.MediaName = request.mediaName;
    }
    if (request.sceneType) {
      payload.SceneType = request.sceneType;
    }
    if (request.extInfo) {
      payload.ExtInfo = request.extInfo;
    }
    if (request.sessionContext) {
      payload.SessionContext = request.sessionContext;
    }
    if (request.sessionId) {
      payload.SessionId = request.sessionId;
    }

    this.logger.debug(
      `Tencent VOD CreateAigcVideoTask payload: ${JSON.stringify(this.sanitizeForLog(payload))}`,
    );
    const response = await this.callTencentApi('CreateAigcVideoTask', payload);
    this.logger.debug(
      `Tencent VOD CreateAigcVideoTask response: ${JSON.stringify(this.sanitizeForLog(response))}`,
    );
    const taskId = this.pickFirstString(response?.TaskId, response?.taskId);
    if (!taskId) {
      throw new BadGatewayException('Tencent CreateAigcVideoTask succeeded but TaskId is missing');
    }
    const requestId = this.pickFirstString(response?.RequestId, response?.requestId);
    return { taskId, requestId };
  }

  async queryTask(taskId: string): Promise<TencentVodAigcTaskStatus> {
    this.ensureCredentialReady();

    const normalizedTaskId = (taskId || '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }

    const body: Record<string, any> = { TaskId: normalizedTaskId };
    if (typeof this.subAppId === 'number') {
      body.SubAppId = this.subAppId;
    }

    // 点播 2018-07-17 推荐通过 DescribeTaskDetail 查询 AIGC 任务详情
    const response = await this.callTencentApi('DescribeTaskDetail', body);
    const status = this.extractStatus(response);
    const imageUrl = this.extractBestImageUrl(response);
    const requestId = this.pickFirstString(response?.RequestId, response?.requestId);

    return {
      taskId: normalizedTaskId,
      status,
      imageUrl,
      requestId,
      raw: response,
    };
  }

  async queryVideoTask(taskId: string): Promise<TencentVodAigcVideoTaskStatus> {
    this.ensureCredentialReady();

    const normalizedTaskId = (taskId || '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }

    const body: Record<string, any> = { TaskId: normalizedTaskId };
    if (typeof this.subAppId === 'number') {
      body.SubAppId = this.subAppId;
    }

    const response = await this.callTencentApi('DescribeTaskDetail', body);
    const status = this.extractStatus(response);
    const videoUrl = this.extractBestVideoUrl(response);
    const fileId = this.findFirstStringByKeys(response, ['FileId']);
    const requestId = this.pickFirstString(response?.RequestId, response?.requestId);
    this.logger.debug(
      `Tencent VOD DescribeTaskDetail video response: ${JSON.stringify(
        this.sanitizeForLog({
          taskId: normalizedTaskId,
          status,
          videoUrl,
          fileId,
          response,
        }),
      )}`,
    );

    return {
      taskId: normalizedTaskId,
      status,
      videoUrl,
      fileId,
      requestId,
      raw: response,
    };
  }

  async waitForImageResult(
    taskId: string,
    options?: {
      maxWaitMs?: number;
      maxPollAttempts?: number;
    },
  ): Promise<TencentVodAigcTaskStatus> {
    const maxPollAttempts = options?.maxPollAttempts ?? this.maxPollAttempts;
    const maxWaitMs = options?.maxWaitMs;
    const startedAt = Date.now();

    await this.sleep(this.initialDelayMs);

    let lastResult: TencentVodAigcTaskStatus | null = null;
    let successWithoutUrlAttempts = 0;
    const successWithoutUrlRetryLimit = 8;

    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      if (maxWaitMs !== undefined && Date.now() - startedAt >= maxWaitMs) {
        throw new ServiceUnavailableException(
          `Tencent AIGC task ${taskId} polling timeout after ${maxWaitMs}ms. Last status: ${lastResult?.status || 'UNKNOWN'}`,
        );
      }

      const result = await this.queryTask(taskId);
      lastResult = result;
      const status = this.normalizeStatus(result.status);

      if (status === 'success') {
        if (result.imageUrl) {
          return result;
        }

        successWithoutUrlAttempts += 1;
        if (successWithoutUrlAttempts >= successWithoutUrlRetryLimit) {
          throw new BadGatewayException(
            `Tencent AIGC task ${taskId} completed but image URL is missing after ${successWithoutUrlAttempts} success-state retries`,
          );
        }

        this.logger.warn(
          `Tencent AIGC task ${taskId} reached success without image URL (attempt ${successWithoutUrlAttempts}/${successWithoutUrlRetryLimit}), continue polling...`,
        );
        await this.sleep(this.pollIntervalMs);
        continue;
      }

      if (status === 'failed') {
        throw new BadGatewayException(
          `Tencent AIGC task ${taskId} failed with status: ${result.status || 'FAILED'}`,
        );
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new ServiceUnavailableException(
      `Tencent AIGC task ${taskId} polling timeout after ${maxPollAttempts} attempts. Last status: ${lastResult?.status || 'UNKNOWN'}`,
    );
  }

  private normalizeStatus(status?: string): 'processing' | 'success' | 'failed' {
    const value = (status || '').trim().toLowerCase();
    if (!value) return 'processing';

    if (
      [
        'finish',
        'finished',
        'success',
        'succeed',
        'succeeded',
        'completed',
        'complete',
        'done',
      ].includes(value)
    ) {
      return 'success';
    }

    if (
      ['failed', 'fail', 'error', 'cancel', 'cancelled', 'exception', 'timeout'].includes(value)
    ) {
      return 'failed';
    }

    return 'processing';
  }

  private extractStatus(response: Record<string, any>): string | undefined {
    const direct = this.pickFirstString(
      response?.Status,
      response?.TaskStatus,
      response?.ProcedureTask?.Status,
      response?.TaskDetail?.Status,
      response?.TaskDetail?.TaskStatus,
      response?.TaskInfo?.Status,
      response?.AigcImageTask?.Status,
      response?.AIGCImageTask?.Status,
      response?.AigcVideoTask?.Status,
      response?.AIGCVideoTask?.Status,
    );
    if (direct) return direct;

    return this.findFirstStringByKeys(response, ['Status', 'TaskStatus', 'State']);
  }

  private extractBestImageUrl(response: Record<string, any>): string | undefined {
    const candidates = this.collectUrlCandidates(response);
    if (!candidates.length) {
      return undefined;
    }

    const scored = candidates
      .map((item) => ({
        ...item,
        score: this.scoreUrlCandidate(item.keyPath, item.url),
      }))
      .sort((a, b) => b.score - a.score);

    return scored[0]?.url;
  }

  private scoreUrlCandidate(keyPath: string, url: string): number {
    let score = 0;
    const key = keyPath.toLowerCase();
    const value = url.toLowerCase();

    if (key.includes('image')) score += 4;
    if (key.includes('output')) score += 2;
    if (key.includes('url')) score += 1;
    if (key.includes('input') || key.includes('source')) score -= 4;
    if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(value)) score += 2;

    return score;
  }

  private extractBestVideoUrl(response: Record<string, any>): string | undefined {
    const candidates = this.collectUrlCandidates(response);
    if (!candidates.length) return undefined;

    const scored = candidates
      .map((item) => ({
        ...item,
        score: this.scoreVideoUrlCandidate(item.keyPath, item.url),
      }))
      .sort((a, b) => b.score - a.score);

    return scored[0]?.score > 0 ? scored[0]?.url : undefined;
  }

  private scoreVideoUrlCandidate(keyPath: string, url: string): number {
    let score = 0;
    const key = keyPath.toLowerCase();
    const value = url.toLowerCase();

    if (key.includes('fileurl')) score += 6;
    if (key.includes('video')) score += 4;
    if (key.includes('proceduretask')) score += 3;
    if (key.includes('output')) score += 2;
    if (key.includes('image')) score -= 4;
    if (key.includes('input') || key.includes('source')) score -= 5;
    if (/\.(mp4|mov|webm|m3u8)(\?|$)/i.test(value)) score += 4;
    if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(value)) score -= 4;

    return score;
  }

  private collectUrlCandidates(
    root: unknown,
  ): Array<{ keyPath: string; url: string }> {
    const results: Array<{ keyPath: string; url: string }> = [];

    const walk = (value: unknown, keyPath: string): void => {
      if (typeof value === 'string') {
        const normalized = this.normalizeHttpUrl(value);
        if (normalized) {
          results.push({ keyPath, url: normalized });
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          walk(item, `${keyPath}[${index}]`);
        });
        return;
      }

      if (!value || typeof value !== 'object') {
        return;
      }

      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = keyPath ? `${keyPath}.${k}` : k;
        walk(v, nextPath);
      }
    };

    walk(root, '');
    return results;
  }

  private async callTencentApi(action: string, body: Record<string, any>): Promise<Record<string, any>> {
    this.ensureCredentialReady();

    const payload = JSON.stringify(body || {});
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const authorization = this.buildAuthorization(action, payload, timestamp, date);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: this.endpoint,
        'X-TC-Action': action,
        'X-TC-Version': this.version,
        'X-TC-Timestamp': String(timestamp),
      };
      if (this.region) {
        headers['X-TC-Region'] = this.region;
      }
      if (this.sessionToken) {
        headers['X-TC-Token'] = this.sessionToken;
      }

      const response = await fetch(`https://${this.endpoint}/`, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: Record<string, any> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, any>) : {};
      } catch {
        parsed = {};
      }

      if (!response.ok) {
        const message =
          this.pickFirstString(parsed?.Response?.Error?.Message, parsed?.message) ||
          text ||
          `HTTP ${response.status}`;
        throw new BadGatewayException(
          `Tencent VOD ${action} failed: ${response.status} ${response.statusText} - ${message}`,
        );
      }

      const responsePayload = this.extractResponse(parsed);
      const upstreamError = responsePayload?.Error || responsePayload?.error;
      if (upstreamError) {
        const code = this.pickFirstString(upstreamError?.Code, upstreamError?.code);
        const message = this.pickFirstString(upstreamError?.Message, upstreamError?.message);
        this.throwTencentError(action, code, message);
      }

      return responsePayload;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException(`Tencent VOD ${action} request timeout`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Tencent VOD ${action} request exception: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildAuthorization(action: string, payload: string, timestamp: number, date: string): string {
    const canonicalHeaders =
      `content-type:application/json; charset=utf-8\n` +
      `host:${this.endpoint}\n` +
      `x-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedPayload = this.sha256Hex(payload);
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const stringToSign =
      `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${this.sha256Hex(canonicalRequest)}`;

    const secretDate = this.hmac(`TC3${this.secretKey}`, date);
    const secretService = this.hmac(secretDate, this.service);
    const secretSigning = this.hmac(secretService, 'tc3_request');
    const signature = this.hmac(secretSigning, stringToSign).toString('hex');

    return (
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
    );
  }

  private ensureCredentialReady(): void {
    if (!this.secretId || !this.secretKey) {
      throw new ServiceUnavailableException(
        'Tencent VOD credentials are not configured (TENCENT_VOD_SECRET_ID/TENCENT_VOD_SECRET_KEY)',
      );
    }
    // Common misconfiguration: copied "SecretId,SecretKey" into SecretKey field.
    if (this.secretKey.includes(',') || this.secretKey.startsWith('AKID')) {
      throw new ServiceUnavailableException(
        'Tencent VOD credential format invalid: TENCENT_VOD_SECRET_KEY should be SecretKey only (do not include AKID or comma).',
      );
    }
  }

  private throwTencentError(action: string, code?: string, message?: string): never {
    const suffix = [code, message].filter(Boolean).join(': ');

    if (code?.startsWith('InvalidParameter') || code?.startsWith('MissingParameter')) {
      throw new BadRequestException(`Tencent VOD ${action} bad request${suffix ? ` (${suffix})` : ''}`);
    }

    if (code?.startsWith('AuthFailure') || code === 'UnauthorizedOperation') {
      throw new ServiceUnavailableException(
        `Tencent VOD credential or permission error${suffix ? ` (${suffix})` : ''}`,
      );
    }

    throw new BadGatewayException(`Tencent VOD ${action} failed${suffix ? ` (${suffix})` : ''}`);
  }

  private extractResponse(payload: Record<string, any>): Record<string, any> {
    if (payload?.Response && typeof payload.Response === 'object') {
      return payload.Response as Record<string, any>;
    }
    if (payload?.response && typeof payload.response === 'object') {
      return payload.response as Record<string, any>;
    }
    return payload || {};
  }

  private sha256Hex(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private hmac(key: string | Buffer, content: string): Buffer {
    return crypto.createHmac('sha256', key).update(content).digest();
  }

  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private findFirstStringByKeys(root: unknown, keys: string[]): string | undefined {
    if (!root || typeof root !== 'object') return undefined;
    const normalized = new Set(keys.map((key) => key.toLowerCase()));
    const queue: unknown[] = [root];
    const visited = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
        if (normalized.has(k.toLowerCase()) && typeof v === 'string' && v.trim()) {
          return v.trim();
        }
        if (v && typeof v === 'object') {
          queue.push(v);
        }
      }
    }

    return undefined;
  }

  private normalizeHttpUrl(value: string): string | undefined {
    const raw = value.trim();
    if (!raw) return undefined;

    let candidate = raw;
    if (candidate.startsWith('//')) {
      candidate = `https:${candidate}`;
    }

    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private sanitizeForLog(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeForLog(item));
    }

    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && value.length > 500) {
        return `${value.slice(0, 500)}...[truncated ${value.length} chars]`;
      }
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
        if (typeof nested === 'string' && nested.length > 500) {
          return [key, `${nested.slice(0, 500)}...[truncated ${nested.length} chars]`];
        }
        return [key, this.sanitizeForLog(nested)];
      }),
    );
  }

  private sleep(ms: number): Promise<void> {
    const timeout = Math.max(0, Math.floor(ms));
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return Math.floor(num);
    }
    return fallback;
  }

  private parseOptionalPositiveInt(value: string | undefined): number | undefined {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return Math.floor(num);
    }
    return undefined;
  }
}
