import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

@Injectable()
export class OssService {
  constructor(private readonly config: ConfigService) {}

  private cachedClient: S3Client | null = null;
  private ossEnabledChecked = false;
  private ossEnabled = false;
  private loggedDisabled = false;

  private get conf() {
    return {
      region: this.config.get<string>('OSS_REGION') || 'cn-guangzhou',
      bucket: this.config.get<string>('OSS_BUCKET') || 'your-bucket',
      accessKeyId: this.config.get<string>('OSS_ACCESS_KEY_ID') || 'test-id',
      accessKeySecret: this.config.get<string>('OSS_ACCESS_KEY_SECRET') || 'test-secret',
      cdnHost: this.config.get<string>('OSS_CDN_HOST') || '',
      // 如果没有配置 Endpoint，默认给一个火山引擎广州的节点作为占位
      endpoint: this.config.get<string>('OSS_ENDPOINT') || 'https://tos-cn-guangzhou.volces.com',
    };
  }

  private isOssEnabled(): boolean {
    if (this.ossEnabledChecked) return this.ossEnabled;

    const disable =
      (this.config.get<string>('OSS_DISABLE') ?? 'false') === 'true' ||
      (this.config.get<string>('DISABLE_OSS') ?? 'false') === 'true';
    if (disable) {
      this.ossEnabled = false;
      this.ossEnabledChecked = true;
      return this.ossEnabled;
    }

    const enabledOverride = (this.config.get<string>('OSS_ENABLED') ?? 'false') === 'true';
    if (enabledOverride) {
      this.ossEnabled = true;
      this.ossEnabledChecked = true;
      return this.ossEnabled;
    }

    const { bucket, accessKeyId, accessKeySecret } = this.conf;
    this.ossEnabled =
      Boolean(bucket && accessKeyId && accessKeySecret) &&
      bucket !== 'your-bucket' &&
      accessKeyId !== 'test-id' &&
      accessKeySecret !== 'test-secret';

    this.ossEnabledChecked = true;
    return this.ossEnabled;
  }

  isEnabled(): boolean {
    return this.isOssEnabled();
  }

  private logDisabledOnce() {
    if (this.loggedDisabled) return;
    this.loggedDisabled = true;
    // eslint-disable-next-line no-console
    console.warn('[OSS] OSS 未配置或已禁用，将跳过 OSS 读写（仅使用数据库内容）。');
  }

  private timeoutMs(): number {
    const raw = this.config.get<string>('OSS_TIMEOUT_MS');
    const n = raw ? Number(raw) : 300000;
    if (!Number.isFinite(n)) return 300000;
    return Math.max(1000, Math.min(600000, Math.floor(n)));
  }

  private normalizeEndpoint(endpoint: string): string {
    const trimmed = String(endpoint || '').trim();
    if (!trimmed) return 'https://tos-cn-guangzhou.volces.com';
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  }

  private resolveClientEndpoint(endpoint: string): {
    endpoint: string;
    isVolcengineTos: boolean;
  } {
    const normalized = this.normalizeEndpoint(endpoint);
    try {
      const parsed = new URL(normalized);
      const hostname = parsed.hostname.toLowerCase();
      const isVolcengineTos =
        hostname.endsWith('.volces.com') || hostname.endsWith('.ivolces.com');

      if (
        isVolcengineTos &&
        hostname.startsWith('tos-') &&
        !hostname.startsWith('tos-s3-')
      ) {
        parsed.hostname = hostname.replace(/^tos-/, 'tos-s3-');
      }

      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';

      return {
        endpoint: parsed.toString().replace(/\/+$/, ''),
        isVolcengineTos,
      };
    } catch {
      return { endpoint: normalized, isVolcengineTos: false };
    }
  }

  private client(): S3Client {
    if (this.cachedClient) return this.cachedClient;
    const { region, accessKeyId, accessKeySecret, endpoint } = this.conf;
    const resolvedEndpoint = this.resolveClientEndpoint(endpoint);

    this.cachedClient = new S3Client({
      region,
      endpoint: resolvedEndpoint.endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey: accessKeySecret,
      },
      // Volcengine TOS browser presign works better with bucket-host style.
      forcePathStyle: resolvedEndpoint.isVolcengineTos ? false : true,
      requestHandler: {
        requestTimeout: this.timeoutMs(),
      } as any,
    });
    return this.cachedClient;
  }

  /**
   * 生成供前端 PUT 直传的预签名 URL（替代旧的 presignPost 表单策略）
   */
  async getPresignedPutUrl(key: string, contentType = 'application/octet-stream', expiresInSeconds = 300) {
    const client = this.client();
    const command = new PutObjectCommand({
      Bucket: this.conf.bucket,
      Key: key,
      ContentType: contentType,
    });
    
    const uploadUrl = await getSignedUrl(client, command, { 
      expiresIn: Math.max(30, Math.min(3600, Math.floor(expiresInSeconds))) 
    });

    return {
      uploadUrl,
      publicUrl: this.publicUrl(key),
    };
  }

  async putStream(
    key: string,
    stream: NodeJS.ReadableStream | Readable,
    options?: any
  ): Promise<{ key: string; url: string }> {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return { key, url: '' };
    }

    const client = this.client();
    const upload = new Upload({
      client,
      params: {
        Bucket: this.conf.bucket,
        Key: key,
        Body: stream as any,
        ContentType: options?.headers?.['Content-Type'],
        CacheControl: options?.headers?.['Cache-Control'],
      },
    });

    await upload.done();
    return { key, url: this.publicUrl(key) };
  }

  async putBuffer(
    key: string,
    buffer: Buffer,
    contentType?: string
  ): Promise<{ key: string; url: string }> {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return { key, url: '' };
    }
    const client = this.client();
    
    const command = new PutObjectCommand({
      Bucket: this.conf.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await client.send(command);
    return { key, url: this.publicUrl(key) };
  }

  async putJSON(
    key: string,
    data: unknown,
    options?: { acl?: 'private' | 'public-read' | 'public-read-write' }
  ) {
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      return key;
    }
    try {
      const client = this.client();
      const body = Buffer.from(JSON.stringify(data));
      
      const commandOptions: any = {
        Bucket: this.conf.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      };

      if (options?.acl) {
        commandOptions.ACL = options.acl;
      }

      const command = new PutObjectCommand(commandOptions);
      await client.send(command);
      console.log(`OSS putJSON success: ${key}`);
      return key;
    } catch (error: any) {
      console.warn(`OSS putJSON failed: ${error.message || error}`);
      return key;
    }
  }

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    console.log('[OssService] getJSON called with key:', key);
    if (!this.isOssEnabled()) {
      this.logDisabledOnce();
      console.log('[OssService] OSS is disabled, returning null');
      return null;
    }
    try {
      const client = this.client();
      console.log('[OssService] Fetching from OSS...');
      
      const command = new GetObjectCommand({
        Bucket: this.conf.bucket,
        Key: key,
      });

      const res = await client.send(command);
      const content = await res.Body?.transformToString();
      
      console.log('[OssService] Got content, length:', content?.length || 0);
      if (!content) return null;
      return JSON.parse(content) as T;
    } catch (err: any) {
      // S3 标准错误码为 NoSuchKey
      if (err?.name === 'NoSuchKey' || err?.Code === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        console.log('[OssService] Key not found:', key);
        return null;
      }
      console.warn(`OSS getJSON failed: ${err.message || err}`);
      return null;
    }
  }

  async signUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const normalizedKey = typeof key === 'string' ? key.trim().replace(/^\/+/, '') : '';
    if (!normalizedKey) return '';
    if (!this.isOssEnabled()) {
      return this.publicUrl(normalizedKey);
    }
    try {
      const client = this.client();
      const command = new GetObjectCommand({
        Bucket: this.conf.bucket,
        Key: normalizedKey,
      });
      const signedUrl = await getSignedUrl(client, command, {
        expiresIn: Math.max(30, Math.min(3600, Math.floor(expiresInSeconds))),
      });
      return signedUrl || this.publicUrl(normalizedKey);
    } catch {
      return this.publicUrl(normalizedKey);
    }
  }

  async objectExists(key: string): Promise<boolean> {
    const normalizedKey = typeof key === 'string' ? key.trim().replace(/^\/+/, '') : '';
    if (!normalizedKey) return false;
    if (!this.isOssEnabled()) return true;
    try {
      const client = this.client();
      const command = new HeadObjectCommand({
        Bucket: this.conf.bucket,
        Key: normalizedKey,
      });
      await client.send(command);
      return true;
    } catch (err: any) {
      const statusCode = err?.$metadata?.httpStatusCode;
      const code = String(err?.name || err?.Code || '');
      if (statusCode === 404 || statusCode === 403 || code === 'NotFound' || code === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }

  publicUrl(key: string): string {
    const { cdnHost, bucket, endpoint } = this.conf;
    
    // 动态提取端点的主机名 (移除 http:// 或 https://)
    const rawEndpoint = (endpoint || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    
    // 默认 OSS/TOS 访问域名格式: bucket.endpoint
    const defaultHost = rawEndpoint ? `${bucket}.${rawEndpoint}` : `${bucket}.oss-cn-hangzhou.aliyuncs.com`;
    const host = cdnHost || defaultHost;
    
    return `https://${host}/${key}`;
  }

  publicHosts(): string[] {
    const { cdnHost, bucket, endpoint } = this.conf;
    const stripProtocol = (value: string) => value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    
    const rawEndpoint = (endpoint || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const defaultHost = rawEndpoint ? `${bucket}.${rawEndpoint}` : `${bucket}.oss-cn-hangzhou.aliyuncs.com`;
    
    const hosts = [defaultHost];
    if (cdnHost) {
      hosts.push(stripProtocol(cdnHost));
    }
    return Array.from(new Set(hosts)).filter(Boolean);
  }

  allowedPublicHosts(): string[] {
    const { cdnHost, bucket, endpoint } = this.conf;
    const stripProtocol = (value: string) => value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    
    const rawEndpoint = (endpoint || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const defaultHost = rawEndpoint ? `${bucket}.${rawEndpoint}` : `${bucket}.oss-cn-hangzhou.aliyuncs.com`;
    
    const hosts = [defaultHost];
    
    if (cdnHost) {
      hosts.push(stripProtocol(cdnHost));
    }

    const extraHosts = this.config.get<string>('ALLOWED_PROXY_HOSTS');
    if (extraHosts) {
      extraHosts.split(',').forEach(h => {
        const trimmed = h.trim();
        if (trimmed) hosts.push(stripProtocol(trimmed));
      });
    }

    const defaultAllowed = [
      'aliyuncs.com',           // 阿里云 OSS
      'amazonaws.com.cn',       // AWS 中国区 (Vidu)
      'amazonaws.com',          // AWS 国际
      's3.cn-northwest-1.amazonaws.com.cn', // Vidu S3
      'apimart.ai',             // Nano2 / Apimart 图像资源
      'kechuangai.com',         // Kling / 可灵
      'models.kapon.cloud',     // Kapon / Vidu
      'volces.com',             // 字节/Seedance 1.5 Pro / 火山引擎
      'tencentcos.cn',          // 腾讯 COS（混元 3D 输出）
      'myqcloud.com',           // 腾讯云通用域名
      'qcloud.com',             // 腾讯云下载域名（含 vod-qcloud.com）
      'vod-qcloud.com',         // 腾讯 VOD 临时资源常见域名
      'tgtai.com',              // Tanva CDN 域名（供 AI 上游服务访问）
    ];

    defaultAllowed.forEach(h => hosts.push(h));

    return Array.from(new Set(hosts)).filter(Boolean);
  }
}
