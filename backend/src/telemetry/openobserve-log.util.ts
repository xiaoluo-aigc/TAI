const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i;
const BASE64_REDACT_THRESHOLD = 1024;
const DEFAULT_MAX_VALUE_LENGTH = 4096;
const DEFAULT_MAX_DEPTH = 4;

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
]);

type SanitizeTelemetryOptions = {
  maxStringLength?: number;
  maxDepth?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stripWhitespace = (value: string): string => value.replace(/\s+/g, '');

const matchBase64DataUrl = (value: string): RegExpMatchArray | null =>
  value.trim().match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/i);

const isPureLargeBase64 = (value: string): boolean => {
  const trimmed = stripWhitespace(value.trim());
  if (trimmed.length < BASE64_REDACT_THRESHOLD) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(trimmed);
};

const redactBase64String = (value: string): Record<string, unknown> => {
  const dataUrlMatch = matchBase64DataUrl(value);
  const base64Payload = stripWhitespace(
    dataUrlMatch ? dataUrlMatch[2] : value.trim(),
  );
  const mimeType = dataUrlMatch?.[1] || 'application/base64';

  return {
    kind: 'redacted_base64',
    mimeType,
    encoding: 'base64',
    base64Length: base64Payload.length,
    approximateBytes: Math.floor((base64Payload.length * 3) / 4),
  };
};

export const truncateStringValue = (
  value: string,
  maxLength = DEFAULT_MAX_VALUE_LENGTH,
): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
};

export const sanitizeTelemetryValue = (
  value: unknown,
  options: SanitizeTelemetryOptions = {},
  depth = 0,
): unknown => {
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_VALUE_LENGTH;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    if (matchBase64DataUrl(value) || isPureLargeBase64(value)) {
      return redactBase64String(value);
    }

    return truncateStringValue(value, maxStringLength);
  }

  if (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
  ) {
    const byteLength =
      value instanceof ArrayBuffer ? value.byteLength : (value as Uint8Array).byteLength;

    return {
      kind: 'binary_payload',
      byteLength,
    };
  }

  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      return {
        truncated: true,
        kind: 'array',
        length: value.length,
      };
    }

    return value.map((item) => sanitizeTelemetryValue(item, options, depth + 1));
  }

  if (value instanceof URLSearchParams) {
    return sanitizeTelemetryValue(Object.fromEntries(value.entries()), options, depth + 1);
  }

  if (depth >= maxDepth && isRecord(value)) {
    return {
      truncated: true,
      kind: 'object',
      keys: Object.keys(value).slice(0, 50),
    };
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sanitizeTelemetryValue(nestedValue, options, depth + 1),
      ]),
    );
  }

  return value;
};

export const sanitizeHeadersForTelemetry = (
  headers: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  if (!headers) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
        ? '[redacted]'
        : sanitizeTelemetryValue(value),
    ]),
  );
};

export const isEnabledFlag = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
};

export const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

export const normalizeKeysForOpenObserve = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeysForOpenObserve(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      toSnakeCase(key),
      normalizeKeysForOpenObserve(nestedValue),
    ]),
  );
};

export const sanitizeTraceId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return TRACE_ID_PATTERN.test(normalized) ? normalized : null;
};

export const sanitizeSpanId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SPAN_ID_PATTERN.test(normalized) ? normalized : null;
};

export const extractTraceIdFromTraceparent = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value
    .trim()
    .match(/^[\da-fA-F]{2}-([\da-fA-F]{32})-([\da-fA-F]{16})-[\da-fA-F]{2}$/);

  if (!match) {
    return null;
  }

  return sanitizeTraceId(match[1]);
};

export const resolveFastifyRoutePath = (
  request: { routerPath?: string | null; routeOptions?: { url?: string | undefined } } | null,
): string | null => {
  if (!request) {
    return null;
  }

  const routerPath = typeof request.routerPath === 'string' ? request.routerPath.trim() : '';
  if (routerPath) {
    return routerPath;
  }

  const routeOptionsUrl =
    typeof request.routeOptions?.url === 'string' ? request.routeOptions.url.trim() : '';
  return routeOptionsUrl || null;
};
