// OTel bootstrap for scrubjay-portal. Loaded via
//   node --import ./otel/instrumentation.mjs .output/server/index.mjs
// so node:http and undici are patched before the server bundle imports them.
// Must stay OUTSIDE the Vite build: a bundled SDK copy cannot patch anything,
// and the bundled app talks to this SDK only through @opentelemetry/api's
// global registries. Vendor-neutral: all endpoint/auth/resource config comes
// from standard OTEL_* env vars; unset endpoint = fully inert (bot parity).
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { OTLPLogExporter },
    sdkNodeMetrics,
    sdkNodeLogs,
    { HttpInstrumentation },
    { UndiciInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/exporter-logs-otlp-http"),
    import("@opentelemetry/sdk-node").then((m) => m.metrics),
    import("@opentelemetry/sdk-node").then((m) => m.logs),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
  ]);

  const sdk = new NodeSDK({
    instrumentations: [
      new HttpInstrumentation({
        // Health probes every 30s would drown real traffic.
        ignoreIncomingRequestHook: (req) =>
          (req.url ?? "").startsWith("/api/health"),
      }),
      new UndiciInstrumentation(),
    ],
    logRecordProcessors: [
      new sdkNodeLogs.BatchLogRecordProcessor({
        exporter: new OTLPLogExporter(),
      }),
    ],
    metricReader: new sdkNodeMetrics.PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    serviceName: process.env.OTEL_SERVICE_NAME ?? "scrubjay-portal",
    traceExporter: new OTLPTraceExporter(),
  });

  sdk.start();

  process.once("SIGTERM", () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
