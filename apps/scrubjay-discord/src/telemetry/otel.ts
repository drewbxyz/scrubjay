import type { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

/**
 * True if `host` is `domain` or a subdomain of it, matched on a label
 * boundary. Avoids the substring trap where `evil-discord.com` or
 * `discord.com.evil.com` would slip past a naive `includes()`.
 */
function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Env-gated OpenTelemetry bootstrap. OTEL_EXPORTER_OTLP_ENDPOINT is the
 * single on-switch; every other knob rides the standard OTEL_* env vars,
 * which the SDK and OTLP exporters read themselves. The SDK is require()d
 * lazily so a disabled run never pays its load cost.
 */
export function startOtel(): boolean {
  if (sdk) {
    return true;
  }
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return false;
  }

  const {
    logs,
    metrics,
    NodeSDK: SDK,
  } = require("@opentelemetry/sdk-node") as typeof import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } =
    require("@opentelemetry/exporter-trace-otlp-http") as typeof import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } =
    require("@opentelemetry/exporter-metrics-otlp-http") as typeof import("@opentelemetry/exporter-metrics-otlp-http");
  const { OTLPLogExporter } =
    require("@opentelemetry/exporter-logs-otlp-http") as typeof import("@opentelemetry/exporter-logs-otlp-http");
  const { HttpInstrumentation } =
    require("@opentelemetry/instrumentation-http") as typeof import("@opentelemetry/instrumentation-http");
  const { UndiciInstrumentation } =
    require("@opentelemetry/instrumentation-undici") as typeof import("@opentelemetry/instrumentation-undici");
  const { ExpressInstrumentation } =
    require("@opentelemetry/instrumentation-express") as typeof import("@opentelemetry/instrumentation-express");
  const { NestInstrumentation } =
    require("@opentelemetry/instrumentation-nestjs-core") as typeof import("@opentelemetry/instrumentation-nestjs-core");
  const { PgInstrumentation } =
    require("@opentelemetry/instrumentation-pg") as typeof import("@opentelemetry/instrumentation-pg");
  const { PinoInstrumentation } =
    require("@opentelemetry/instrumentation-pino") as typeof import("@opentelemetry/instrumentation-pino");

  sdk = new SDK({
    instrumentations: [
      new HttpInstrumentation({
        // Docker probes /health every 30s; don't trace it.
        ignoreIncomingRequestHook: (req) => req.url === "/health",
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new UndiciInstrumentation({
        // Tag outbound calls with the standard peer.service attribute so a
        // service-graph generator draws virtual-node edges for these
        // uninstrumented dependencies (undici emits server.address but not
        // peer.service, which such generators key on) — and names them
        // cleanly ("ebird"/"discord") instead of raw hostnames.
        requestHook: (span, request) => {
          let host: string;
          try {
            host = new URL(request.origin).hostname;
          } catch {
            return;
          }
          if (isHost(host, "ebird.org")) {
            span.setAttribute("peer.service", "ebird");
          } else if (isHost(host, "discord.com")) {
            span.setAttribute("peer.service", "discord");
          }
        },
        // Client spans only inside an existing trace, otherwise every
        // background Discord REST call becomes its own root trace.
        requireParentforSpans: true,
      }),
      new PgInstrumentation({ requireParentSpan: true }),
      new PinoInstrumentation(),
    ],
    logRecordProcessors: [
      new logs.BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }),
    ],
    metricReader: new metrics.PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    serviceName: process.env.OTEL_SERVICE_NAME ?? "scrubjay-discord",
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  return true;
}

export async function shutdownOtel(): Promise<void> {
  const running = sdk;
  sdk = null;
  // A flush failure (e.g. collector unreachable) must not prevent app
  // shutdown from completing, but it shouldn't be silent either. console is
  // deliberate: pino (and its transports) may already be torn down by the
  // time shutdown runs, so the app logger isn't a reliable sink here.
  await running?.shutdown().catch((err) => {
    console.error("OTel shutdown failed", err);
  });
}
