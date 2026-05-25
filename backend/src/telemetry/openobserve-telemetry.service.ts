import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getActiveSpanContext } from './tracing';
import { getRequestContext } from './request-context';
import { sendOpenObserveJsonIngest } from './openobserve-ingest.util';
import {
  isEnabledFlag,
  normalizeKeysForOpenObserve,
  sanitizeHeadersForTelemetry,
  sanitizeSpanId,
  sanitizeTelemetryValue,
  sanitizeTraceId,
} from './openobserve-log.util';

type FrontendErrorLog = {
  kind: string;
  message: string;
  stack: string | null;
  source: string | null;
  appVersion: string;
  buildTime: string | null;
  href: string | null;
  userAgent: string;
  timestamp: string | null;
  ip: string | null;
  traceId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  receivedAt: string;
};

type BackendRequestLog = {
  traceId: string | null;
  method: string;
  path: string;
  route: string | null;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  userId: string | null;
  requestId: string | null;
  headers: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  body: unknown;
  receivedAt: string;
};

type BackendEventLog = {
  traceId: string | null;
  requestId?: string | null;
  userId?: string | null;
  category: string;
  action: string;
  message: string;
  payload?: Record<string, unknown> | null;
  receivedAt: string;
};

type BackendErrorLog = {
  traceId: string | null;
  requestId?: string | null;
  userId?: string | null;
  message: string;
  stack: string | null;
  errorName?: string | null;
  category?: string | null;
  statusCode?: number | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  headers?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  body?: unknown;
  response?: unknown;
  payload?: Record<string, unknown> | null;
  upstream?: Record<string, unknown> | null;
  upstreamPayload?: unknown;
  upstreamResponse?: unknown;
  upstreamUrl?: string | null;
  upstreamHost?: string | null;
  upstreamPathname?: string | null;
  upstreamStatusCode?: number | null;
  upstreamError?: string | null;
  receivedAt: string;
};

type GenerationTaskLog = {
  traceId: string | null;
  parentRequestId?: string | null;
  requestId?: string | null;
  taskId: string;
  taskType: string;
  stage: 'queued' | 'processing' | 'succeeded' | 'failed';
  userId: string | null;
  provider: string | null;
  prompt: string | null;
  status: string;
  durationMs?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  receivedAt: string;
};

type UpstreamRequestLog = {
  traceId: string | null;
  spanId?: string | null;
  method: string;
  url: string;
  type?: 'text' | 'video' | 'picture' | 'audio' | 'file' | 'binary' | 'other';
  origin?: string | null;
  originHost?: string | null;
  host: string | null;
  pathname: string | null;
  statusCode: number | null;
  durationMs: number | null;
  requestHeaders?: Record<string, unknown> | null;
  requestBody?: unknown;
  responseHeaders?: Record<string, unknown> | null;
  responseBody?: unknown;
  error?: string | null;
  serviceName?: string | null;
  receivedAt: string;
};

const DEFAULT_BACKEND_REQUEST_BODY_MAX_LENGTH = 4096;

@Injectable()
export class OpenObserveTelemetryService {
  private readonly logger = new Logger(OpenObserveTelemetryService.name);

  constructor(private readonly configService: ConfigService) {}

  async ingestFrontendError(log: FrontendErrorLog): Promise<void> {
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_FRONTEND_ERROR_STREAM')?.trim() || 'frontend_errors',
      {
        ...this.attachContext(log),
        kind: sanitizeTelemetryValue(log.kind),
        message: sanitizeTelemetryValue(log.message, { maxStringLength: 2000 }),
        stack: sanitizeTelemetryValue(log.stack, { maxStringLength: 8000 }),
        source: sanitizeTelemetryValue(log.source),
        href: sanitizeTelemetryValue(log.href),
        userAgent: sanitizeTelemetryValue(log.userAgent),
        service: 'frontend',
        log_type: 'frontend_error',
      },
    );
  }

  async ingestBackendRequest(log: BackendRequestLog): Promise<void> {
    const maxBodyLength = this.getBackendRequestBodyMaxLength();
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_REQUEST_STREAM')?.trim() || 'backend_requests',
      {
        ...this.attachContext(log),
        headers: sanitizeHeadersForTelemetry(log.headers),
        query: sanitizeTelemetryValue(log.query, { maxStringLength: maxBodyLength }),
        body: sanitizeTelemetryValue(log.body, { maxStringLength: maxBodyLength }),
        service: 'backend',
        log_type: 'backend_request',
      },
    );
  }

  async ingestBackendEvent(log: BackendEventLog): Promise<void> {
    const requestContext = getRequestContext();
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_EVENT_STREAM')?.trim() || 'backend_events',
      {
        ...this.attachContext(log, requestContext),
        payload: sanitizeTelemetryValue(log.payload, { maxStringLength: this.getBackendRequestBodyMaxLength() }),
        service: 'backend',
        log_type: 'backend_event',
      },
    );
  }

  async ingestBackendError(log: BackendErrorLog): Promise<void> {
    const requestContext = getRequestContext();
    const maxBodyLength = this.getBackendRequestBodyMaxLength();
    const upstream = log.upstream || requestContext?.latestUpstreamRequest || null;
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_BACKEND_ERROR_STREAM')?.trim() || 'backend_errors',
      {
        ...this.attachContext(log, requestContext),
        headers: sanitizeHeadersForTelemetry(log.headers),
        query: sanitizeTelemetryValue(log.query, { maxStringLength: maxBodyLength }),
        params: sanitizeTelemetryValue(log.params, { maxStringLength: maxBodyLength }),
        body: sanitizeTelemetryValue(log.body, { maxStringLength: maxBodyLength }),
        response: sanitizeTelemetryValue(log.response, { maxStringLength: maxBodyLength }),
        payload: sanitizeTelemetryValue(log.payload, { maxStringLength: maxBodyLength }),
        upstream: sanitizeTelemetryValue(upstream, { maxStringLength: maxBodyLength }),
        upstreamUrl: log.upstreamUrl ?? upstream?.url ?? null,
        upstreamHost: log.upstreamHost ?? upstream?.host ?? null,
        upstreamPathname: log.upstreamPathname ?? upstream?.pathname ?? null,
        upstreamStatusCode: log.upstreamStatusCode ?? upstream?.statusCode ?? null,
        upstreamError: log.upstreamError ?? upstream?.error ?? null,
        upstreamPayload: sanitizeTelemetryValue(
          log.upstreamPayload ?? upstream?.requestBody ?? null,
          { maxStringLength: maxBodyLength },
        ),
        upstreamResponse: sanitizeTelemetryValue(
          log.upstreamResponse ?? upstream?.responseBody ?? null,
          { maxStringLength: maxBodyLength },
        ),
        service: 'backend',
        log_type: 'backend_error',
      },
    );
  }

  async ingestGenerationTask(log: GenerationTaskLog): Promise<void> {
    const isError = log.stage === 'failed' || log.status === 'failed' || Boolean(log.error);
    const requestContext = getRequestContext();
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_GENERATION_TASK_STREAM')?.trim() || 'generation_tasks',
      {
        ...this.attachContext(log, requestContext),
        metadata: sanitizeTelemetryValue(log.metadata, { maxStringLength: this.getBackendRequestBodyMaxLength() }),
        prompt: sanitizeTelemetryValue(log.prompt, { maxStringLength: this.getBackendRequestBodyMaxLength() }),
        error: sanitizeTelemetryValue(log.error),
        isError,
        failureStage: isError ? log.stage : null,
        failureReason: isError ? log.error || log.status : null,
        service: 'backend',
        log_type: 'generation_task',
      },
    );
  }

  async ingestUpstreamRequest(log: UpstreamRequestLog): Promise<void> {
    const isError = Boolean(log.error) || (typeof log.statusCode === 'number' && log.statusCode >= 400);
    await this.ingest(
      this.configService.get<string>('OPENOBSERVE_UPSTREAM_REQUEST_STREAM')?.trim() || 'upstream_requests',
      {
        ...this.attachContext(log),
        requestHeaders: sanitizeHeadersForTelemetry(log.requestHeaders),
        responseHeaders: sanitizeHeadersForTelemetry(log.responseHeaders),
        requestBody: sanitizeTelemetryValue(log.requestBody, {
          maxStringLength: this.getBackendRequestBodyMaxLength(),
        }),
        responseBody: sanitizeTelemetryValue(log.responseBody, {
          maxStringLength: this.getBackendRequestBodyMaxLength(),
        }),
        error: sanitizeTelemetryValue(log.error),
        isError,
        failureStage: isError ? 'upstream_request' : null,
        failureReason: log.error || (isError ? `HTTP_${log.statusCode}` : null),
        service: 'backend',
        log_type: 'upstream_request',
      },
    );
  }

  private async ingest(stream: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.shouldSend()) return;

    const normalizedPayload = normalizeKeysForOpenObserve(this.attachContext(payload));

    await sendOpenObserveJsonIngest({
      baseUrl: this.configService.get<string>('OPENOBSERVE_BASE_URL'),
      username: this.configService.get<string>('OPENOBSERVE_USERNAME'),
      password: this.configService.get<string>('OPENOBSERVE_PASSWORD'),
      org: this.configService.get<string>('OPENOBSERVE_ORG'),
      stream,
      payload: normalizedPayload as Record<string, unknown>,
      logger: this.logger,
    });
  }

  private shouldSend(): boolean {
    return isEnabledFlag(this.configService.get('OPENOBSERVE_TELEMETRY_ENABLED'), true);
  }

  private getBackendRequestBodyMaxLength(): number {
    const raw = Number(this.configService.get('OPENOBSERVE_BACKEND_REQUEST_BODY_MAX_LENGTH'));
    if (!Number.isFinite(raw) || raw <= 0) {
      return DEFAULT_BACKEND_REQUEST_BODY_MAX_LENGTH;
    }
    return Math.floor(raw);
  }

  private attachContext(
    payload: Record<string, unknown>,
    requestContext = getRequestContext(),
  ): Record<string, unknown> {
    const activeSpanContext = getActiveSpanContext();

    return {
      ...payload,
      traceId:
        sanitizeTraceId(payload.traceId) ||
        activeSpanContext?.traceId ||
        requestContext?.traceId ||
        null,
      spanId:
        sanitizeSpanId(payload.spanId) ||
        activeSpanContext?.spanId ||
        null,
      requestId:
        (typeof payload.requestId === 'string' && payload.requestId.trim()) ||
        requestContext?.requestId ||
        null,
      userId:
        (typeof payload.userId === 'string' && payload.userId.trim()) ||
        requestContext?.userId ||
        null,
    };
  }
}
