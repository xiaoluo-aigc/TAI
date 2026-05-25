import { context, diag, DiagConsoleLogger, DiagLogLevel, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Attributes, type Context, type SpanOptions } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { buildOpenObserveTraceEndpoint } from './openobserve-url';
import { isEnabledFlag } from './openobserve-log.util';

export type PersistedTraceContext = {
  traceId?: string | null;
  parentRequestId?: string | null;
  parentSpanId?: string | null;
  traceFlags?: number | null;
};

let sdk: NodeSDK | null = null;
let started = false;

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

const buildTraceEndpoint = (): string | null => {
  const explicit = process.env.OPENOBSERVE_TRACE_OTLP_ENDPOINT?.trim();
  if (explicit) return explicit;

  const baseUrl = process.env.OPENOBSERVE_BASE_URL?.trim();
  const org = process.env.OPENOBSERVE_ORG?.trim() || 'default';
  if (!baseUrl) return null;

  return buildOpenObserveTraceEndpoint(baseUrl, org);
};

const getExporterHeaders = (): Record<string, string> | null => {
  const username = process.env.OPENOBSERVE_USERNAME?.trim();
  const password = process.env.OPENOBSERVE_PASSWORD?.trim();
  if (!username || !password) return null;

  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  };
};

export const initOpenTelemetry = (): void => {
  if (started) return;
  started = true;

  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const defaultEnabled = true;
  const enabled = isEnabledFlag(process.env.OPENOBSERVE_TRACING_ENABLED, defaultEnabled);
  if (!enabled) return;

  const endpoint = buildTraceEndpoint();
  const headers = getExporterHeaders();
  if (!endpoint || !headers) return;

  if (isEnabledFlag(process.env.OPENOBSERVE_TRACE_DEBUG, false)) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OPENOBSERVE_TRACE_SERVICE_NAME?.trim() || 'my-backend',
      'service.version': process.env.npm_package_version || '0.1.0',
      'deployment.environment': nodeEnv || 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
      headers,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  void Promise.resolve(sdk.start()).catch((error) => {
    console.warn(
      `[Tracing] OpenTelemetry init failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const shutdown = async () => {
    if (!sdk) return;
    const current = sdk;
    sdk = null;
    try {
      await current.shutdown();
    } catch (error) {
      console.warn(
        `[Tracing] OpenTelemetry shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
};

export const getActiveSpanContext = () => trace.getActiveSpan()?.spanContext() ?? null;

export const captureTraceContext = (
  seed?: PersistedTraceContext | null,
): PersistedTraceContext => {
  const activeSpanContext = getActiveSpanContext();
  return {
    traceId: seed?.traceId ?? activeSpanContext?.traceId ?? null,
    parentRequestId: seed?.parentRequestId ?? null,
    parentSpanId: seed?.parentSpanId ?? activeSpanContext?.spanId ?? null,
    traceFlags: seed?.traceFlags ?? activeSpanContext?.traceFlags ?? 1,
  };
};

export const buildParentTraceContext = (
  traceContext?: PersistedTraceContext | null,
): Context => {
  const traceId = traceContext?.traceId?.trim() || '';
  const spanId = traceContext?.parentSpanId?.trim() || '';

  if (!TRACE_ID_PATTERN.test(traceId) || !SPAN_ID_PATTERN.test(spanId)) {
    return ROOT_CONTEXT;
  }

  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags:
      typeof traceContext?.traceFlags === 'number' && traceContext.traceFlags > 0
        ? traceContext.traceFlags
        : 1,
    isRemote: true,
  });
};

export const runWithSpan = async <T>(
  name: string,
  traceContext: PersistedTraceContext | null | undefined,
  attributes: Attributes,
  callback: () => Promise<T>,
): Promise<T> => {
  const tracer = trace.getTracer('tanva-backend');
  const parentContext = buildParentTraceContext(traceContext);
  const options: SpanOptions = {
    kind: SpanKind.INTERNAL,
    attributes,
  };

  return tracer.startActiveSpan(name, options, parentContext, async (span) => {
    try {
      const result = await callback();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
};

export const withTraceContext = <T>(
  traceContext: PersistedTraceContext | null | undefined,
  callback: () => T,
): T => context.with(buildParentTraceContext(traceContext), callback);
