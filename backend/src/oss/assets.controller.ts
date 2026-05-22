import { BadGatewayException, BadRequestException, Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { OssService } from './oss.service';

const MANAGED_ASSET_KEY_REGEX = /^(projects|uploads|templates|videos|ai)\//i;
const DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_PROXY_UPSTREAM_RETRIES = 1;
const RETRYABLE_PROXY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

  constructor(private readonly oss: OssService) {}

  private normalizeManagedAssetKey(raw?: string | null): string | null {
    const value = typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : '';
    if (!value) return null;
    return MANAGED_ASSET_KEY_REGEX.test(value) ? value : null;
  }

  private async resolveBucketOriginUrl(key: string): Promise<string | null> {
    const normalizedKey = this.normalizeManagedAssetKey(key);
    if (!normalizedKey) return null;
    const signed = await this.oss.signUrl(normalizedKey, 300);
    if (signed) return signed;
    return this.oss.publicUrl(normalizedKey);
  }

  private extractManagedAssetKey(
    input?: string | null,
    visited: Set<string> = new Set(),
  ): string | null {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (!trimmed) return null;
    if (visited.has(trimmed)) return null;
    visited.add(trimmed);

    const direct = this.normalizeManagedAssetKey(trimmed);
    if (direct) return direct;

    try {
      const parsed = new URL(trimmed);
      const fromPath = this.normalizeManagedAssetKey(parsed.pathname);
      if (fromPath) return fromPath;

      const fromKeyQuery = this.normalizeManagedAssetKey(parsed.searchParams.get('key'));
      if (fromKeyQuery) return fromKeyQuery;

      const nestedUrl = parsed.searchParams.get('url');
      if (nestedUrl && nestedUrl !== trimmed) {
        const nested = this.extractManagedAssetKey(nestedUrl, visited);
        if (nested) return nested;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private async normalizeTargetUrlForFetch(rawUrl: string): Promise<string> {
    const managedKey = this.extractManagedAssetKey(rawUrl);
    if (!managedKey) return rawUrl;
    return (await this.resolveBucketOriginUrl(managedKey)) || this.oss.publicUrl(managedKey);
  }

  private async resolveTargetUrl(params: { url?: string; key?: string }): Promise<string> {
    const key = typeof params.key === 'string' ? params.key.trim().replace(/^\/+/, '') : '';
    if (key) {
      const normalizedKey = this.normalizeManagedAssetKey(key);
      if (normalizedKey) {
        return (await this.resolveBucketOriginUrl(normalizedKey)) || this.oss.publicUrl(normalizedKey);
      }
      return this.oss.publicUrl(key.replace(/^\/+/, ''));
    }

    const url = typeof params.url === 'string' ? params.url.trim() : '';
    if (!url) {
      throw new BadRequestException('Missing `url` or `key`');
    }
    return this.normalizeTargetUrlForFetch(url);
  }

  private isAllowedHost(hostname: string): boolean {
    const allowed = this.oss.allowedPublicHosts();
    // 支持精确匹配和后缀匹配（如 .aliyuncs.com）
    return allowed.some(host =>
      hostname === host || hostname.endsWith('.' + host) || hostname.endsWith(host)
    );
  }

  @Get('proxy')
  @ApiOperation({ summary: 'Proxy public OSS assets to avoid browser CORS' })
  @ApiQuery({ name: 'url', required: false, description: 'Full remote URL (must be an allowed OSS/CDN host)' })
  @ApiQuery({ name: 'key', required: false, description: 'OSS object key (alternative to url)' })
  async proxy(
    @Res() reply: FastifyReply,
    @Req() req: FastifyRequest,
    @Query('url') url?: string,
    @Query('key') key?: string
  ) {
    const abortController = new AbortController();
    let abortedByClient = false;
    let upstreamBody: ReadableStream<Uint8Array> | null = null;
    let upstreamNodeStream: Readable | null = null;

    const abortUpstream = () => {
      if (abortedByClient) return;
      abortedByClient = true;
      try {
        abortController.abort();
      } catch {
        // ignore
      }
      try {
        upstreamNodeStream?.destroy();
      } catch {
        // ignore
      }
      let cancelPromise: Promise<void> | undefined;
      try {
        cancelPromise = upstreamBody?.cancel();
      } catch {
        // ignore
      }
      void cancelPromise?.catch(() => {
        // ignore
      });
    };

    // 客户端中断时：取消上游请求，避免继续拉取大文件占用内存/连接池。
    // 注意：FastifyReply.raw 是 Node ServerResponse。
    try {
      const rawReply = reply.raw as any;
      rawReply?.once?.('close', () => {
        if (!rawReply?.writableEnded) abortUpstream();
      });
      rawReply?.once?.('error', abortUpstream);
    } catch {
      // ignore
    }
    try {
      const rawReq = req.raw as any;
      rawReq?.once?.('aborted', abortUpstream);
      rawReq?.once?.('error', abortUpstream);
    } catch {
      // ignore
    }

    const managedKeyForLog = this.normalizeManagedAssetKey(key) || this.extractManagedAssetKey(url);
    const initialUrl = await this.resolveTargetUrl({ url, key });

    let parsed: URL;
    try {
      parsed = new URL(initialUrl);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Unsupported URL protocol');
    }

    if (!this.isAllowedHost(parsed.hostname)) {
      throw new BadRequestException('Host not allowed');
    }

    const pickHeader = (name: string): string | undefined => {
      const raw = (req.headers as Record<string, unknown>)[name];
      return typeof raw === 'string' ? raw : undefined;
    };

    const upstreamHeaders: Record<string, string> = {};
    const range = pickHeader('range');
    const ifNoneMatch = pickHeader('if-none-match');
    const ifModifiedSince = pickHeader('if-modified-since');
    // 避免 Node fetch 透明解压后仍沿用上游压缩前 content-length，导致浏览器读取到截断的二进制流。
    upstreamHeaders['accept-encoding'] = 'identity';
    if (range) upstreamHeaders['range'] = range;
    if (ifNoneMatch) upstreamHeaders['if-none-match'] = ifNoneMatch;
    if (ifModifiedSince) upstreamHeaders['if-modified-since'] = ifModifiedSince;

    const upstreamTimeoutMs = (() => {
      const raw =
        process.env.ASSET_PROXY_UPSTREAM_TIMEOUT_MS ||
        process.env.OSS_PROXY_TIMEOUT_MS ||
        '';
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS;
      return Math.max(2_000, Math.min(60_000, Math.floor(parsed)));
    })();

    const fetchWithAbortAndTimeout = async (targetUrl: string): Promise<Response> => {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort();
      }, upstreamTimeoutMs);
      const onClientAbort = () => timeoutController.abort();
      abortController.signal.addEventListener('abort', onClientAbort, { once: true });
      try {
        return await fetch(targetUrl, {
          redirect: 'manual',
          headers: upstreamHeaders,
          signal: timeoutController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onClientAbort);
      }
    };

    const fetchWithRedirectCheck = async (inputUrl: string) => {
      let currentUrl = inputUrl;
      for (let i = 0; i < 5; i++) {
        const res = await fetchWithAbortAndTimeout(currentUrl);

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) return res;

          let next: URL;
          try {
            next = new URL(location, currentUrl);
          } catch {
            throw new BadRequestException('Invalid redirect URL');
          }

          if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            throw new BadRequestException('Unsupported redirect URL protocol');
          }
          if (!this.isAllowedHost(next.hostname)) {
            throw new BadRequestException('Redirect host not allowed');
          }

          // 继续跟随重定向前，必须显式取消/消费上一个响应体，否则 undici 会占用连接与内存。
          try {
            await res.body?.cancel();
          } catch {
            // ignore
          }
          currentUrl = next.toString();
          continue;
        }

        return res;
      }
      throw new BadRequestException('Too many redirects');
    };

    const fetchWithRetry = async (inputUrl: string) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= MAX_PROXY_UPSTREAM_RETRIES; attempt++) {
        try {
          const res = await fetchWithRedirectCheck(inputUrl);
          if (RETRYABLE_PROXY_STATUS.has(res.status) && attempt < MAX_PROXY_UPSTREAM_RETRIES) {
            try {
              await res.body?.cancel();
            } catch {
              // ignore
            }
            await sleep(150 * (attempt + 1));
            continue;
          }
          return res;
        } catch (err: any) {
          if (abortedByClient) throw err;
          if (err instanceof BadRequestException || attempt >= MAX_PROXY_UPSTREAM_RETRIES) {
            throw err;
          }
          lastError = err;
          await sleep(150 * (attempt + 1));
        }
      }
      if (lastError) throw lastError;
      throw new BadGatewayException('Upstream fetch failed');
    };

    let upstream: Response;
    try {
      upstream = await fetchWithRetry(initialUrl);
    } catch (err: any) {
      if (abortedByClient) return;
      throw new BadGatewayException(err?.message || 'Upstream fetch failed');
    }
    upstreamBody = upstream.body;
    if (abortedByClient) return;

    // 设置 CORS 头，允许跨域访问（用于视频抽帧等场景）
    reply.header('access-control-allow-origin', '*');
    reply.header(
      'access-control-expose-headers',
      'content-type,content-length,content-range,accept-ranges,etag,last-modified,cache-control'
    );
    reply.header('cross-origin-resource-policy', 'cross-origin');

    const upstreamContentEncoding = upstream.headers.get('content-encoding');
    const passthroughHeaders = [
      'content-type',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
      'cache-control',
      'content-disposition',
    ] as const;
    passthroughHeaders.forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) reply.header(name, value);
    });
    const upstreamContentLength = upstream.headers.get('content-length');
    if (upstreamContentLength && !upstreamContentEncoding) {
      reply.header('content-length', upstreamContentLength);
    } else if (upstreamContentLength && upstreamContentEncoding) {
      this.logger.warn(
        `[assets/proxy] skip content-length passthrough because upstream is encoded: encoding=${upstreamContentEncoding} key=${managedKeyForLog || '-'} target=${parsed.toString()}`,
      );
    }

    // 仅对成功响应缓存，避免把偶发的 4xx/5xx “缓存成空白图”。
    // 上游若未提供 cache-control，则设置一个温和的默认值。
    if (upstream.ok && !upstream.headers.get('cache-control')) {
      reply.header('cache-control', 'public, max-age=3600');
    }
    if (!upstream.ok) {
      this.logger.warn(
        `[assets/proxy] upstream non-ok status=${upstream.status} key=${managedKeyForLog || '-'} target=${parsed.toString()}`
      );
      reply.header('cache-control', 'no-store');
    }

    reply.status(upstream.status);

    if (!upstream.body) {
      reply.send(Buffer.from(await upstream.arrayBuffer()));
      return;
    }

    // Node fetch 返回 Web ReadableStream；转为 Node stream 以支持流式转发（视频 Range/seek）
    const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => Readable }).fromWeb;
    const nodeStream: Readable = typeof fromWeb === 'function'
      ? fromWeb(upstream.body as unknown)
      : Readable.from(Buffer.from(await upstream.arrayBuffer()));

    upstreamNodeStream = nodeStream;
    reply.send(nodeStream);
  }
}
