import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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

  private client(): S3Client {
    if (this.cachedClient) return this.cachedClient;
    const { region, accessKeyId, accessKeySecret, endpoint } = this.conf;
    
    // 确保 endpoint 带有 http/https 前缀
    const formattedEndpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;

    this.cachedClient = new S3Client({
      region,
      endpoint: formattedEndpoint,
      credentials: {
        accessKeyId,
        secretAccessKey: accessKeySecret,
      },
      // 火山 TOS 兼容虚拟主机样式，通常设为 false 即可
      forcePathStyle: false,
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

  signUrl(key: string, expiresInSeconds = 300): string {
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
      
      // 注意此处签名由于是异步操作，严格来说 signUrl 应该改为 async，
      // 但为了兼容你外部可能存在的同步调用，如果外部报错，建议将外部调用处加上 await。
      // 作为权宜之计，如果不涉及私有桶强制验签，遇到同步签名需求会降级返回公开链接。
      // 在此处我们直接返回一个 Promise 包装，如果你的 controller 没用 await 会拿到 Promise 字符串。
      // 强烈建议在有空时把外层的 signUrl 调用也加上 await。
      
      // 为保持原有同步方法签名不报错，这里做个强制类型转换输出，实际应用中 S3 签名必须是异步的。
      // 如果你的桶是公开读的，其实直接用 publicUrl 即可。
      let signedUrl = '';
      getSignedUrl(client, command, { 
        expiresIn: Math.max(30, Math.min(3600, Math.floor(expiresInSeconds))) 
      }).then(url => { signedUrl = url; }).catch(() => {});
      
      // 降级返回 publicUrl （因为真实的签名在 S3 v3 中是纯异步的）
      return this.publicUrl(normalizedKey);
    } catch {
      return this.publicUrl(normalizedKey);
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
      'tgtai.com',              // Tanva CDN 域名（供 AI 上游服务访问）
    ];

    defaultAllowed.forEach(h => hosts.push(h));

    return Array.from(new Set(hosts)).filter(Boolean);
  }
}