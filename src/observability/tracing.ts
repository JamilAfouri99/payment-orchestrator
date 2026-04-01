import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { trace, type Tracer, type Span, SpanStatusCode, context } from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

export function initTracing(serviceName: string): void {
  const otlpEndpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];

  const exporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: otlpEndpoint })
    : new ConsoleSpanExporter();

  sdk = new NodeSDK({
    serviceName,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export function shutdownTracing(): Promise<void> {
  return sdk?.shutdown() ?? Promise.resolve();
}

export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

/**
 * Wraps an async function in an OpenTelemetry span.
 */
export async function withSpan<T>(
  tracer: Tracer,
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(spanName, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export { trace, context, SpanStatusCode };
