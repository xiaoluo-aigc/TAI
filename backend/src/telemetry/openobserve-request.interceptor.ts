import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import crypto from 'crypto';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';
import { getActiveSpanContext } from './tracing';
import { enterRequestContext } from './request-context';
import {
  extractTraceIdFromTraceparent,
  resolveFastifyRoutePath,
} from './openobserve-log.util';

type AuthLikeUser = {
  id?: string;
  userId?: string;
  sub?: string;
};

type TraceableRequest = FastifyRequest & {
  user?: AuthLikeUser;
  traceId?: string;
  routerPath?: string;
};

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

@Injectable()
export class OpenObserveRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly openObserveTelemetryService: OpenObserveTelemetryService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<TraceableRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const startTime = Date.now();
    const path = request.url || resolveFastifyRoutePath(request) || '';
    const route = resolveFastifyRoutePath(request);
    const activeSpanContext = getActiveSpanContext();
    const headerTraceId = typeof request.headers['x-trace-id'] === 'string'
      ? request.headers['x-trace-id'].trim()
      : '';
    const traceparentTraceId = extractTraceIdFromTraceparent(request.headers.traceparent);
    const traceId =
      activeSpanContext?.traceId ||
      headerTraceId ||
      traceparentTraceId ||
      request.traceId ||
      crypto.randomUUID().replace(/-/g, '');
    request.traceId = traceId;
    reply.header('x-trace-id', traceId);
    if (request.id) {
      reply.header('x-request-id', request.id);
    }
    const originHeader = toOriginInfo(request.headers.origin);
    const refererHeader = toOriginInfo(request.headers.referer || request.headers.referrer);
    const requestOrigin = originHeader.origin || refererHeader.origin;
    const requestOriginHost = originHeader.originHost || refererHeader.originHost;

    // Avoid recursive logging from the telemetry ingestion endpoint itself.
    if (path.startsWith('/api/telemetry/')) {
      return next.handle();
    }

    const emit = (statusCode: number) => {
      const user = request.user;
      const userId = user?.id || user?.userId || user?.sub || null;
      void this.openObserveTelemetryService.ingestBackendRequest({
        traceId,
        method: request.method,
        path,
        route,
        statusCode,
        durationMs: Date.now() - startTime,
        ip: request.ip || null,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        userId,
        requestId: request.id || null,
        headers: request.headers ? (request.headers as unknown as Record<string, unknown>) : null,
        query: request.query && typeof request.query === 'object' ? (request.query as Record<string, unknown>) : null,
        body: request.body ?? null,
        receivedAt: new Date().toISOString(),
      });
    };

    const user = request.user;
    enterRequestContext({
      traceId,
      requestId: request.id || null,
      userId: user?.id || user?.userId || user?.sub || null,
      origin: requestOrigin,
      originHost: requestOriginHost,
    });

    return next.handle().pipe(
      tap(() => {
        emit(reply.statusCode || 200);
      }),
      catchError((error) => {
        const statusCode =
          typeof error?.status === 'number'
            ? error.status
            : typeof error?.statusCode === 'number'
              ? error.statusCode
              : reply.statusCode || 500;
        emit(statusCode);
        return throwError(() => error);
      }),
    );
  }
}
