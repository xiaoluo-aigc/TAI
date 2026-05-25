import { context, trace } from '@opentelemetry/api';
import { Logger } from '@nestjs/common';
import { getRequestContext, recordLatestUpstreamRequest } from './request-context';
import { buildOpenObserveApiPrefix } from './openobserve-url';
import { sendOpenObserveJsonIngest } from './openobserve-ingest.util';
import {
  isEnabledFlag,
  sanitizeHeadersForTelemetry,
  sanitizeTelemetryValue,
} from './openobserve-log.util';

type PatchedFetch = typeof fetch & {
  __tanvaUpstreamLoggingPatched?: boolean;
};

type UpstreamRequestType = 'text' | 'video' | 'picture' | 'audio' | 'file' | 'binary' | 'other';

const logger = new Logger('UpstreamFetchLogger');

const shouldLogUpstreamRequests = (): boolean => {
  return isEnabledFlag(process.env.OPENOBSERVE_UPSTREAM_REQUEST_LOGGING_ENABLED, true);
};

const getOpenObserveEndpointPrefix = (): string | null => {
  const baseUrl = process.env.OPENOBSERVE_BASE_URL?.trim();
  const org = process.env.OPENOBSERVE_ORG?.trim() || 'default';
  if (!baseUrl) return null;
  return buildOpenObserveApiPrefix(baseUrl, org);
};

const sanitizeValue = (value: unknown): unknown => {
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const entries: Record<string, unknown[]> = {};
    for (const [key, entryValue] of value.entries()) {
      if (!entries[key]) entries[key] = [];
      if (typeof entryValue === 'string') {
        entries[key].push(entryValue);
      } else {
        entries[key].push({
          kind: 'binary_form_entry',
          name: 'name' in entryValue ? String(entryValue.name || '') : '',
          type: 'type' in entryValue ? String(entryValue.type || '') : '',
          size: 'size' in entryValue ? Number(entryValue.size || 0) : null,
        });
      }
    }
    return entries;
  }

  return sanitizeTelemetryValue(value);
};

const normalizeHeaders = (headers: Headers): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  headers.forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
};

const getMimeType = (contentType: string | null | undefined): string | null => {
  const normalized = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
  if (!normalized) return null;
  return normalized.split(';')[0]?.trim() || null;
};

const isVideoMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) return false;
  return mimeType.startsWith('video/') || mimeType === 'application/vnd.apple.mpegurl';
};

const isAudioMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) return false;
  return mimeType.startsWith('audio/');
};

const isPictureMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) return false;
  return mimeType.startsWith('image/');
};

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/problem+json',
  'application/x-www-form-urlencoded',
  'application/xml',
  'text/xml',
  'image/svg+xml',
]);

const isTextMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) return false;
  return mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType);
};

const FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'application/csv',
  'model/gltf-binary',
  'model/gltf+json',
]);

const isFileMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) return false;
  return FILE_MIME_TYPES.has(mimeType);
};

const isBinaryMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) return false;
  return mimeType === 'application/octet-stream';
};

const containsKeyword = (value: string, keywords: readonly string[]): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  return keywords.some((keyword) => normalized.includes(keyword));
};

const VIDEO_KEYWORDS = [
  'video',
  'videos',
  'movie',
  'movies',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.m3u8',
] as const;

const AUDIO_KEYWORDS = [
  'audio',
  'speech',
  'voice',
  'music',
  'sound',
  '.mp3',
  '.wav',
  '.aac',
  '.flac',
  '.ogg',
  '.m4a',
] as const;

const PICTURE_KEYWORDS = [
  'image',
  'images',
  'picture',
  'pictures',
  'photo',
  'photos',
  'thumbnail',
  'poster',
  'avatar',
  'mask',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
] as const;

const FILE_KEYWORDS = [
  'file',
  'files',
  'document',
  'documents',
  'attachment',
  'attachments',
  'archive',
  'download',
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.glb',
  '.gltf',
] as const;

const BINARY_KEYWORDS = [
  'binary',
  'octet-stream',
] as const;

const toOriginInfo = (
  value: unknown,
): { origin: string | null; originHost: string | null } => {
  if (typeof value !== 'string') {
    return { origin: null, originHost: null };
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') {
    return { origin: null, originHost: null };
  }

  try {
    const parsed = new URL(trimmed);
    return {
      origin: parsed.origin,
      originHost: parsed.hostname || null,
    };
  } catch {
    return { origin: null, originHost: null };
  }
};

const bodyContainsKeyword = (
  value: unknown,
  keywords: readonly string[],
  depth = 0,
): boolean => {
  if (depth > 3 || value == null) return false;

  if (typeof value === 'string') {
    return containsKeyword(value, keywords);
  }

  if (Array.isArray(value)) {
    return value.some((item) => bodyContainsKeyword(item, keywords, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nestedValue]) =>
        containsKeyword(key, keywords) || bodyContainsKeyword(nestedValue, keywords, depth + 1),
    );
  }

  return false;
};

const inferUpstreamRequestType = (params: {
  url: URL;
  requestHeaders: Record<string, unknown>;
  requestBody: unknown;
  responseHeaders?: Record<string, unknown> | null;
  responseBody?: unknown;
}): UpstreamRequestType => {
  const requestMimeType = getMimeType(
    typeof params.requestHeaders['content-type'] === 'string'
      ? params.requestHeaders['content-type']
      : null,
  );
  const responseMimeType = getMimeType(
    typeof params.responseHeaders?.['content-type'] === 'string'
      ? params.responseHeaders['content-type']
      : null,
  );
  const urlText = `${params.url.pathname}${params.url.search}`.toLowerCase();

  if (
    isVideoMimeType(responseMimeType) ||
    isVideoMimeType(requestMimeType) ||
    containsKeyword(urlText, VIDEO_KEYWORDS) ||
    bodyContainsKeyword(params.requestBody, VIDEO_KEYWORDS) ||
    bodyContainsKeyword(params.responseBody, VIDEO_KEYWORDS)
  ) {
    return 'video';
  }

  if (
    isAudioMimeType(responseMimeType) ||
    isAudioMimeType(requestMimeType) ||
    containsKeyword(urlText, AUDIO_KEYWORDS) ||
    bodyContainsKeyword(params.requestBody, AUDIO_KEYWORDS) ||
    bodyContainsKeyword(params.responseBody, AUDIO_KEYWORDS)
  ) {
    return 'audio';
  }

  if (
    isPictureMimeType(responseMimeType) ||
    isPictureMimeType(requestMimeType) ||
    containsKeyword(urlText, PICTURE_KEYWORDS) ||
    bodyContainsKeyword(params.requestBody, PICTURE_KEYWORDS) ||
    bodyContainsKeyword(params.responseBody, PICTURE_KEYWORDS)
  ) {
    return 'picture';
  }

  if (
    isFileMimeType(responseMimeType) ||
    isFileMimeType(requestMimeType) ||
    containsKeyword(urlText, FILE_KEYWORDS) ||
    bodyContainsKeyword(params.requestBody, FILE_KEYWORDS) ||
    bodyContainsKeyword(params.responseBody, FILE_KEYWORDS)
  ) {
    return 'file';
  }

  if (
    isBinaryMimeType(responseMimeType) ||
    isBinaryMimeType(requestMimeType) ||
    containsKeyword(urlText, BINARY_KEYWORDS) ||
    bodyContainsKeyword(params.requestBody, BINARY_KEYWORDS) ||
    bodyContainsKeyword(params.responseBody, BINARY_KEYWORDS)
  ) {
    return 'binary';
  }

  if (isTextMimeType(responseMimeType) || isTextMimeType(requestMimeType)) {
    return 'text';
  }

  if (responseMimeType || requestMimeType) {
    return 'other';
  }

  return 'text';
};

/**
 * 从已解析的 request body 中尝试取出 `model` 字段（顶层）。
 * 上游 AI API 通常把模型 ID 放在 body.model（DashScope/OpenAI/Anthropic 风格）。
 * 提取后挂到日志的顶层 `model` 字段，方便 OpenObserve 直接查询，
 * 不再依赖各平台单独配置 stream function 抽取嵌套字段。
 */
const extractModelFromBody = (body: unknown): string | null => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).model;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * 兜底：从 URL 路径抽取 Gemini 风格的 model（`/models/<MODEL>:generateContent` 等）。
 * 适用于 147 / Vertex AI / Google Generative Language API 系列。
 */
const extractModelFromUrl = (url: URL): string | null => {
  const match = url.pathname.match(/\/models\/([^/:]+)(?::[a-zA-Z]+)?$/);
  if (!match) return null;
  const trimmed = match[1].trim();
  return trimmed.length > 0 ? decodeURIComponent(trimmed) : null;
};

const resolveUpstreamModel = (url: URL, body: unknown): string | null =>
  extractModelFromBody(body) || extractModelFromUrl(url);

const tryParseBody = (bodyText: string, contentType: string | null): unknown => {
  if (!bodyText) return null;

  const trimmed = bodyText.trim();
  if (!trimmed) return null;

  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(trimmed).entries());
  }

  return trimmed;
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  const cloned = response.clone();
  const contentType = cloned.headers.get('content-type');

  try {
    const buffer = await cloned.arrayBuffer();
    if (buffer.byteLength === 0) return null;

    const mimeType = contentType?.split(';')[0]?.trim().toLowerCase() || null;
    const isTextLike =
      (mimeType?.startsWith('text/') ?? false) ||
      mimeType === 'application/json' ||
      mimeType === 'application/problem+json' ||
      mimeType === 'application/x-www-form-urlencoded' ||
      mimeType === 'application/xml' ||
      mimeType === 'text/xml' ||
      mimeType === 'image/svg+xml';

    if (!isTextLike) {
      return {
        kind: 'binary_response_body',
        mimeType,
        byteLength: buffer.byteLength,
      };
    }

    const bodyText = new TextDecoder().decode(buffer);
    return tryParseBody(bodyText, contentType);
  } catch (error) {
    return {
      kind: 'unreadable_response_body',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const readRequestBody = async (request: Request): Promise<unknown> => {
  const cloned = request.clone();
  const contentType = cloned.headers.get('content-type');
  if (!cloned.body) return null;

  try {
    const bodyText = await cloned.text();
    return tryParseBody(bodyText, contentType);
  } catch (error) {
    return {
      kind: 'unreadable_request_body',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const shouldLogUrl = (url: URL): boolean => {
  if (!/^https?:$/i.test(url.protocol)) return false;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return false;

  const openObservePrefix = getOpenObserveEndpointPrefix();
  if (openObservePrefix && url.toString().startsWith(openObservePrefix)) {
    return false;
  }

  return true;
};

const ingestUpstreamRequestLog = async (payload: Record<string, unknown>) => {
  const stream = process.env.OPENOBSERVE_UPSTREAM_REQUEST_STREAM?.trim() || 'upstream_requests';
  const originalFetch = globalThis.fetch.bind(globalThis);

  await sendOpenObserveJsonIngest({
    baseUrl: process.env.OPENOBSERVE_BASE_URL,
    username: process.env.OPENOBSERVE_USERNAME,
    password: process.env.OPENOBSERVE_PASSWORD,
    org: process.env.OPENOBSERVE_ORG,
    stream,
    payload,
    logger,
    fetchImpl: originalFetch,
  });
};

export const installUpstreamFetchLogger = (): void => {
  if (!shouldLogUpstreamRequests()) return;

  const currentFetch = globalThis.fetch as PatchedFetch | undefined;
  if (!currentFetch || currentFetch.__tanvaUpstreamLoggingPatched) return;

  const originalFetch = currentFetch.bind(globalThis);

  const patchedFetch: PatchedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (!shouldLogUrl(url)) {
      return originalFetch(input as any, init);
    }

    const startedAt = Date.now();
    const activeSpan = trace.getSpan(context.active())?.spanContext();
    const requestContext = getRequestContext();
    const requestBody = await readRequestBody(request);
    const requestHeaders = normalizeHeaders(request.headers);
    const requestOriginHeader = toOriginInfo(request.headers.get('origin'));
    const requestRefererHeader = toOriginInfo(request.headers.get('referer') || request.headers.get('referrer'));
    const origin = requestContext?.origin || requestOriginHeader.origin || requestRefererHeader.origin || null;
    const originHost =
      requestContext?.originHost ||
      requestOriginHeader.originHost ||
      requestRefererHeader.originHost ||
      null;

    try {
      const response = await originalFetch(request);
      const responseHeaders = normalizeHeaders(response.headers);
      const responseBody = await readResponseBody(response);
      const sanitizedRequestHeaders = sanitizeHeadersForTelemetry(requestHeaders);
      const sanitizedResponseHeaders = sanitizeHeadersForTelemetry(responseHeaders);
      const sanitizedRequestBody = sanitizeValue(requestBody);
      const sanitizedResponseBody = sanitizeValue(responseBody);
      const requestType = inferUpstreamRequestType({
        url,
        requestHeaders,
        requestBody,
        responseHeaders,
        responseBody,
      });
      const upstreamPayload = {
        trace_id: activeSpan?.traceId || requestContext?.traceId || null,
        span_id: activeSpan?.spanId || null,
        request_id: requestContext?.requestId || null,
        user_id: requestContext?.userId || null,
        method: request.method,
        url: request.url,
        origin,
        origin_host: originHost,
        host: url.host,
        pathname: url.pathname,
        status_code: response.status,
        duration_ms: Date.now() - startedAt,
        request_headers: sanitizedRequestHeaders,
        request_body: sanitizedRequestBody,
        response_headers: sanitizedResponseHeaders,
        response_body: sanitizedResponseBody,
        type: requestType,
        model: resolveUpstreamModel(url, requestBody),
        service_name: process.env.OPENOBSERVE_TRACE_SERVICE_NAME?.trim() || 'my-backend',
        received_at: new Date().toISOString(),
        log_type: 'upstream_request',
        service: 'backend',
      };
      recordLatestUpstreamRequest({
        method: request.method,
        url: request.url,
        host: url.host,
        pathname: url.pathname,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        requestHeaders: sanitizedRequestHeaders,
        requestBody: sanitizedRequestBody,
        responseHeaders: sanitizedResponseHeaders,
        responseBody: sanitizedResponseBody,
        type: requestType,
        model: resolveUpstreamModel(url, requestBody),
        receivedAt: String(upstreamPayload.received_at),
      });
      void ingestUpstreamRequestLog(upstreamPayload);
      return response;
    } catch (error) {
      const requestType = inferUpstreamRequestType({
        url,
        requestHeaders,
        requestBody,
      });
      const sanitizedRequestHeaders = sanitizeHeadersForTelemetry(requestHeaders);
      const sanitizedRequestBody = sanitizeValue(requestBody);
      const upstreamPayload = {
        trace_id: activeSpan?.traceId || requestContext?.traceId || null,
        span_id: activeSpan?.spanId || null,
        request_id: requestContext?.requestId || null,
        user_id: requestContext?.userId || null,
        method: request.method,
        url: request.url,
        origin,
        origin_host: originHost,
        host: url.host,
        pathname: url.pathname,
        status_code: null,
        duration_ms: Date.now() - startedAt,
        request_headers: sanitizedRequestHeaders,
        request_body: sanitizedRequestBody,
        response_headers: null,
        type: requestType,
        model: resolveUpstreamModel(url, requestBody),
        error: error instanceof Error ? error.message : String(error),
        service_name: process.env.OPENOBSERVE_TRACE_SERVICE_NAME?.trim() || 'my-backend',
        received_at: new Date().toISOString(),
        log_type: 'upstream_request',
        service: 'backend',
      };
      recordLatestUpstreamRequest({
        method: request.method,
        url: request.url,
        host: url.host,
        pathname: url.pathname,
        statusCode: null,
        durationMs: Date.now() - startedAt,
        requestHeaders: sanitizedRequestHeaders,
        requestBody: sanitizedRequestBody,
        responseHeaders: null,
        responseBody: null,
        type: requestType,
        model: resolveUpstreamModel(url, requestBody),
        error: error instanceof Error ? error.message : String(error),
        receivedAt: String(upstreamPayload.received_at),
      });
      void ingestUpstreamRequestLog(upstreamPayload);
      throw error;
    }
  };

  patchedFetch.__tanvaUpstreamLoggingPatched = true;
  globalThis.fetch = patchedFetch;
};
