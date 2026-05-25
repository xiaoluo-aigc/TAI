import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { OpenObserveTelemetryService } from './openobserve-telemetry.service';
import { extractTraceIdFromTraceparent, sanitizeTraceId } from './openobserve-log.util';

type FrontendErrorRequest = FastifyRequest & {
  user?: {
    id?: string;
    userId?: string;
    sub?: string;
  };
  traceId?: string;
};

@Controller('telemetry')
export class TelemetryController {
  constructor(
    private readonly openObserveTelemetryService: OpenObserveTelemetryService,
  ) {}

  @Post('frontend-error')
  @HttpCode(204)
  frontendError(@Body() body: unknown, @Req() req: FrontendErrorRequest): void {
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const stringifyIfNeeded = (value: unknown): string | null => {
      if (value == null) return null;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const headerTraceId =
      sanitizeTraceId(req.headers['x-trace-id']) ||
      extractTraceIdFromTraceparent(req.headers.traceparent) ||
      sanitizeTraceId(req.traceId) ||
      sanitizeTraceId(payload.traceId);
    const userId = req.user?.id || req.user?.userId || req.user?.sub || null;

    const normalized = {
      kind: stringifyIfNeeded(payload.kind) ?? 'unknown',
      message: stringifyIfNeeded(payload.message) ?? 'Unknown frontend error',
      stack: stringifyIfNeeded(payload.stack),
      source: stringifyIfNeeded(payload.source),
      appVersion: stringifyIfNeeded(payload.appVersion) ?? 'unknown',
      buildTime: stringifyIfNeeded(payload.buildTime),
      href: stringifyIfNeeded(payload.href),
      userAgent:
        stringifyIfNeeded(payload.userAgent) ??
        stringifyIfNeeded(req.headers['user-agent']) ??
        'unknown',
      timestamp: stringifyIfNeeded(payload.timestamp),
      ip: req.ip,
      traceId: headerTraceId,
      requestId: typeof req.id === 'string' ? req.id : null,
      userId,
      receivedAt: new Date().toISOString(),
    };

    void this.openObserveTelemetryService.ingestFrontendError(normalized);
  }
}
