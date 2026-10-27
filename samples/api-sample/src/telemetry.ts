import { ORPCInstrumentation } from "@orpc/opentelemetry";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

/**
 * `ORPCInstrumentation` does not patch modules: it installs an OpenTelemetry
 * tracer into `@orpc/shared`, so every procedure, middleware and client call
 * emits a span on both sides, with context propagated between them.
 */
export function startTelemetry(exporter: SpanExporter = new ConsoleSpanExporter()) {
  const sdk = new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    instrumentations: [new ORPCInstrumentation()],
  });

  sdk.start();
  return sdk;
}
