import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { getActiveSpanContext } from './tracing';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';
import { resolveFastifyRoutePath } from './openobserve-log.util';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeResponsePayload = (response: unknown): unknown => {
  if (typeof response === 'string') {
    return { message: response };
  }

  return response;
};

@Catch()
export class OpenObserveExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OpenObserveExceptionFilter.name);

  constructor(
    private readonly openObserveTelemetryService: OpenObserveTelemetryService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<TraceableRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const user = request.user;
    const userId = user?.id || user?.userId || user?.sub || null;
    const traceId = request.traceId || getActiveSpanContext()?.traceId || null;
    const route = resolveFastifyRoutePath(request);

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const responsePayload = isHttpException
      ? normalizeResponsePayload(exception.getResponse())
      : {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };

    const message = this.getMessage(exception, responsePayload);
    const stack = exception instanceof Error ? exception.stack || null : null;
    const errorName = exception instanceof Error ? exception.name : null;

    void this.openObserveTelemetryService.ingestBackendError({
      traceId,
      requestId: request.id || null,
      userId,
      message,
      stack,
      errorName,
      category: isHttpException ? 'http_exception' : 'unhandled_exception',
      statusCode,
      method: request.method || null,
      path: request.url || null,
      route,
      ip: request.ip || null,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
      headers: request.headers
        ? (request.headers as unknown as Record<string, unknown>)
        : null,
      query: isRecord(request.query) ? request.query : null,
      params: isRecord(request.params) ? request.params : null,
      body: request.body ?? null,
      response: responsePayload,
      payload: this.buildPayload(exception),
      receivedAt: new Date().toISOString(),
    });

    if (statusCode >= 500) {
      this.logger.error(
        `[${request.method} ${request.url}] ${message}`,
        stack || undefined,
      );
    } else {
      this.logger.warn(`[${request.method} ${request.url}] ${message}`);
    }

    reply.status(statusCode).send(responsePayload);
  }

  private getMessage(exception: unknown, responsePayload: unknown): string {
    if (exception instanceof Error && exception.message) {
      return exception.message;
    }

    if (typeof responsePayload === 'string') {
      return responsePayload;
    }

    if (isRecord(responsePayload)) {
      const message = responsePayload.message;
      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.filter((item) => typeof item === 'string').join('; ');
      }
    }

    return 'Unknown backend exception';
  }

  private buildPayload(exception: unknown): Record<string, unknown> | null {
    if (!exception) {
      return null;
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return isRecord(response)
        ? response
        : {
            response,
          };
    }

    if (exception instanceof Error) {
      const candidate = exception as Error & {
        code?: string;
        cause?: unknown;
      };

      return {
        code: candidate.code || null,
        cause:
          candidate.cause instanceof Error
            ? {
                name: candidate.cause.name,
                message: candidate.cause.message,
              }
            : candidate.cause ?? null,
      };
    }

    if (isRecord(exception)) {
      return exception;
    }

    return {
      raw: String(exception),
    };
  }
}
