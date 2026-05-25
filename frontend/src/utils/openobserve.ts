export type OpenObserveEnv = "local" | "test" | "prod";

export type BuildOpenObserveOptions = {
  from?: number | string;
  to?: number | string;
  refresh?: number;
};

export const OPENOBSERVE_STREAMS = {
  upstreamRequests: "upstream_requests",
  generationTasks: "generation_tasks",
  backendRequests: "backend_requests",
  backendErrors: "backend_errors",
  backendEvents: "backend_events",
  frontendErrors: "frontend_errors",
} as const;

export type OpenObserveStream =
  (typeof OPENOBSERVE_STREAMS)[keyof typeof OPENOBSERVE_STREAMS];

export type LogJumpRecord = {
  id?: string | null;
  apiUsageId?: string | null;
  userId?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  taskId?: string | null;
  upstreamRequestId?: string | null;
  provider?: string | null;
  serviceType?: string | null;
  status?: string | null;
  responseStatus?: string | null;
  failureStage?: string | null;
  createdAt?: string | number | Date | null;
  requestParams?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

const DEFAULT_LOGS_BASE_URLS: Record<OpenObserveEnv, string> = {
  local: "http://localhost:5080/web/logs",
  test: "http://101.96.217.132:8080/web/logs",
  prod: "http://tgtai.com/web/logs",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_HOSTS = new Set(["101.96.217.132", "test.tgtai.com", "test.tanvas.cn"]);
const PROD_HOSTS = new Set(["tgtai.com"]);

const trimToString = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeLogsBaseUrl = (value: string, fallback: string): string => {
  const trimmed = trimToString(value) || fallback;
  const sanitized = trimmed.replace(/\/+$/, "");
  if (sanitized.endsWith("/web/logs")) return sanitized;
  if (sanitized.endsWith("/web")) return `${sanitized}/logs`;
  return `${sanitized}/web/logs`;
};

const getHostname = (): string => {
  if (typeof window === "undefined" || !window.location?.hostname) return "";
  return window.location.hostname.trim().toLowerCase();
};

const getLocationHref = (): string => {
  if (typeof window === "undefined" || !window.location?.href) return "";
  return window.location.href.trim().toLowerCase();
};

const normalizeEnv = (value: unknown): OpenObserveEnv | null => {
  const raw = trimToString(value).toLowerCase();
  if (raw === "local" || raw === "test" || raw === "prod") return raw;
  return null;
};

const encodeQueryForUrl = (query: string): string => {
  if (!query) return "";
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(query);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(query, "utf-8").toString("base64");
  }
  return query;
};

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = trimToString(value);
    if (normalized) return normalized;
  }
  return undefined;
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const findNestedString = (
  value: unknown,
  keys: readonly string[],
  depth = 0,
): string | undefined => {
  if (depth > 3 || !isRecordObject(value)) return undefined;

  for (const key of keys) {
    const direct = pickString(value[key]);
    if (direct) return direct;
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const nestedValue = findNestedString(item, keys, depth + 1);
        if (nestedValue) return nestedValue;
      }
      continue;
    }

    const nestedValue = findNestedString(nested, keys, depth + 1);
    if (nestedValue) return nestedValue;
  }

  return undefined;
};

const pushEqualsClause = (
  queryParts: string[],
  fields: readonly string[],
  value: string | undefined,
) => {
  if (!value) return;
  const escaped = escapeValue(value);
  const clauses = fields.map((field) => `${field} = '${escaped}'`);
  queryParts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" or ")})`);
};

const includesKeyword = (value: string | undefined, keywords: readonly string[]): boolean => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
};

const isLikelyUuid = (value: string | undefined): boolean =>
  Boolean(value && /^[a-f0-9-]{16,}$/i.test(value));

type NormalizedLogRecord = {
  apiUsageId?: string;
  userId?: string;
  traceId?: string;
  requestId?: string;
  taskId?: string;
  upstreamRequestId?: string;
  provider?: string;
  serviceType?: string;
  status?: string;
  failureStage?: string;
};

const normalizeLogJumpRecord = (record: LogJumpRecord): NormalizedLogRecord => {
  const requestParams = isRecordObject(record.requestParams) ? record.requestParams : null;
  const metadata = isRecordObject(record.metadata) ? record.metadata : null;

  const apiUsageId = pickString(
    record.apiUsageId,
    record.id,
    metadata?.apiUsageId,
    metadata?.api_usage_id,
    metadata?.metadata_api_usage_id,
    requestParams?.apiUsageId,
    requestParams?.api_usage_id,
    requestParams?.metadata_api_usage_id,
  );

  const traceId = pickString(
    record.traceId,
    metadata?.traceId,
    metadata?.trace_id,
    requestParams?.traceId,
    requestParams?.trace_id,
    findNestedString(metadata, ["traceId", "trace_id"]),
    findNestedString(requestParams, ["traceId", "trace_id"]),
  );

  const requestId = pickString(
    record.requestId,
    metadata?.requestId,
    metadata?.request_id,
    metadata?.upstreamRequestId,
    metadata?.upstream_request_id,
    requestParams?.requestId,
    requestParams?.request_id,
    findNestedString(metadata, ["requestId", "request_id"]),
    findNestedString(requestParams, ["requestId", "request_id"]),
  );

  const taskId = pickString(
    record.taskId,
    metadata?.taskId,
    metadata?.task_id,
    requestParams?.taskId,
    requestParams?.task_id,
    requestParams?.upstreamTaskId,
    requestParams?.upstream_task_id,
    findNestedString(metadata, ["taskId", "task_id"]),
    findNestedString(requestParams, ["taskId", "task_id"]),
  );

  const upstreamRequestId = pickString(
    record.upstreamRequestId,
    metadata?.upstreamRequestId,
    metadata?.upstream_request_id,
    requestParams?.upstreamRequestId,
    requestParams?.upstream_request_id,
    findNestedString(metadata, ["upstreamRequestId", "upstream_request_id"]),
    findNestedString(requestParams, ["upstreamRequestId", "upstream_request_id"]),
  );

  return {
    apiUsageId,
    userId: pickString(record.userId, metadata?.userId, metadata?.user_id),
    traceId,
    requestId,
    taskId,
    upstreamRequestId,
    provider: pickString(record.provider, metadata?.provider, requestParams?.provider),
    serviceType: pickString(record.serviceType, metadata?.serviceType, metadata?.service_type),
    status: pickString(record.status, record.responseStatus, metadata?.status),
    failureStage: pickString(
      record.failureStage,
      metadata?.failureStage,
      metadata?.failure_stage,
      requestParams?.failureStage,
      requestParams?.failure_stage,
    ),
  };
};

const buildUpstreamRequestsQuery = (record: NormalizedLogRecord): string => {
  const queryParts: string[] = [];

  pushEqualsClause(
    queryParts,
    ["upstream_request_id", "request_id"],
    record.upstreamRequestId || record.requestId,
  );
  pushEqualsClause(queryParts, ["request_body_taskid"], record.taskId);
  pushEqualsClause(queryParts, ["metadata_api_usage_id"], record.apiUsageId);
  pushEqualsClause(queryParts, ["trace_id"], record.traceId);
  pushEqualsClause(queryParts, ["user_id"], record.userId);

  return queryParts.join(" and ");
};

const buildGenerationTasksQuery = (record: NormalizedLogRecord): string => {
  const queryParts: string[] = [];

  pushEqualsClause(
    queryParts,
    ["metadata_api_usage_id", "api_usage_id"],
    record.apiUsageId,
  );
  pushEqualsClause(queryParts, ["task_id"], record.taskId);
  pushEqualsClause(queryParts, ["request_id"], record.requestId);
  pushEqualsClause(queryParts, ["trace_id"], record.traceId);

  return queryParts.join(" and ");
};

const buildBackendRequestsQuery = (record: NormalizedLogRecord): string => {
  const queryParts: string[] = [];

  pushEqualsClause(queryParts, ["request_id"], record.requestId);
  pushEqualsClause(queryParts, ["trace_id"], record.traceId);
  pushEqualsClause(queryParts, ["metadata_api_usage_id", "api_usage_id"], record.apiUsageId);
  pushEqualsClause(queryParts, ["task_id"], record.taskId);

  return queryParts.join(" and ");
};

const buildBackendErrorsQuery = (record: NormalizedLogRecord): string => {
  const queryParts: string[] = [];

  pushEqualsClause(queryParts, ["trace_id"], record.traceId);
  pushEqualsClause(queryParts, ["request_id"], record.requestId);
  pushEqualsClause(queryParts, ["metadata_api_usage_id", "api_usage_id"], record.apiUsageId);
  pushEqualsClause(queryParts, ["task_id"], record.taskId);

  return queryParts.join(" and ");
};

const resolvePreferredStream = (record: NormalizedLogRecord): OpenObserveStream => {
  const hasUpstreamFailureHints =
    Boolean(record.upstreamRequestId) ||
    includesKeyword(record.failureStage, ["upstream", "provider", "submit", "poll"]) ||
    Boolean(record.taskId && !record.apiUsageId) ||
    Boolean(record.taskId && isLikelyUuid(record.taskId) === false);

  if (hasUpstreamFailureHints) return OPENOBSERVE_STREAMS.upstreamRequests;

  if (record.apiUsageId || record.taskId) {
    return OPENOBSERVE_STREAMS.generationTasks;
  }

  if (record.status?.toLowerCase() === "failed") {
    return OPENOBSERVE_STREAMS.backendErrors;
  }

  return OPENOBSERVE_STREAMS.backendRequests;
};

const buildStreamQuery = (stream: OpenObserveStream, record: NormalizedLogRecord): string => {
  switch (stream) {
    case OPENOBSERVE_STREAMS.upstreamRequests:
      return buildUpstreamRequestsQuery(record);
    case OPENOBSERVE_STREAMS.generationTasks:
      return buildGenerationTasksQuery(record);
    case OPENOBSERVE_STREAMS.backendErrors:
      return buildBackendErrorsQuery(record);
    case OPENOBSERVE_STREAMS.backendEvents:
    case OPENOBSERVE_STREAMS.backendRequests:
    case OPENOBSERVE_STREAMS.frontendErrors:
    default:
      return buildBackendRequestsQuery(record);
  }
};

export function getOpenObserveEnv(): OpenObserveEnv {
  const explicitEnv = normalizeEnv(import.meta.env.VITE_APP_ENV);
  if (explicitEnv) return explicitEnv;

  const hostname = getHostname();
  const href = getLocationHref();

  if (LOCAL_HOSTS.has(hostname)) return "local";
  if (TEST_HOSTS.has(hostname) || href.includes("101.96.217.132")) return "test";
  if (PROD_HOSTS.has(hostname)) return "prod";

  if (import.meta.env.DEV) return "local";
  return "prod";
}

export function getOpenObserveLogsBaseUrl(): string {
  const env = getOpenObserveEnv();

  const localUrl = normalizeLogsBaseUrl(
    import.meta.env.VITE_OPENOBSERVE_LOGS_URL_LOCAL || "",
    DEFAULT_LOGS_BASE_URLS.local,
  );
  const testUrl = normalizeLogsBaseUrl(
    import.meta.env.VITE_OPENOBSERVE_LOGS_URL_TEST || "",
    DEFAULT_LOGS_BASE_URLS.test,
  );
  const prodUrl = normalizeLogsBaseUrl(
    import.meta.env.VITE_OPENOBSERVE_LOGS_URL_PROD || "",
    DEFAULT_LOGS_BASE_URLS.prod,
  );

  if (env === "local") return localUrl;
  if (env === "test") return testUrl;
  return prodUrl;
}

export function buildOpenObserveUrl(
  stream: string,
  query: string,
  options: BuildOpenObserveOptions = {},
): string {
  const base = getOpenObserveLogsBaseUrl();
  const params = new URLSearchParams();

  params.set("stream_type", "logs");
  params.set("stream", stream);
  params.set("refresh", String(options.refresh ?? 0));
  params.set("sql_mode", "false");
  params.set("query", encodeQueryForUrl(query));
  params.set("fn_editor", "false");
  params.set("type", "stream_explorer");
  params.set("defined_schemas", "user_defined_schema");
  params.set("org_identifier", "default");
  params.set("quick_mode", "false");
  params.set("show_histogram", "true");
  params.set("logs_visualize_toggle", "logs");

  if (options.from != null) params.set("from", String(options.from));
  if (options.to != null) params.set("to", String(options.to));
  if (options.from == null && options.to == null) {
    params.set("period", "7d");
  }

  return `${base}?${params.toString()}`;
}

export function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

export function canOpenObserveLogJump(record: LogJumpRecord): boolean {
  const normalized = normalizeLogJumpRecord(record);
  return Boolean(
    normalized.apiUsageId ||
      normalized.traceId ||
      normalized.requestId ||
      normalized.taskId ||
      normalized.upstreamRequestId,
  );
}

export function buildOpenObserveFailureUrl(record: LogJumpRecord): string {
  const normalized = normalizeLogJumpRecord(record);
  const preferredStream = resolvePreferredStream(normalized);
  const preferredQuery = buildStreamQuery(preferredStream, normalized);

  if (preferredQuery) {
    return buildOpenObserveUrl(preferredStream, preferredQuery);
  }

  const fallbackStreams: OpenObserveStream[] = [
    OPENOBSERVE_STREAMS.generationTasks,
    OPENOBSERVE_STREAMS.upstreamRequests,
    OPENOBSERVE_STREAMS.backendErrors,
    OPENOBSERVE_STREAMS.backendRequests,
  ];

  for (const stream of fallbackStreams) {
    const query = buildStreamQuery(stream, normalized);
    if (query) return buildOpenObserveUrl(stream, query);
  }

  return buildOpenObserveUrl(OPENOBSERVE_STREAMS.backendRequests, "");
}
