import type { Params } from "nestjs-pino";

/**
 * Structured JSON logs on stdout. autoLogging is off because the only HTTP
 * surface is /health, probed every 30s by Docker — request logs would be
 * pure noise. LOG_LEVEL comes straight from the environment (not the zod
 * config) because the logger must exist before config validation runs.
 * When the OTel SDK is active, instrumentation-pino adds trace_id/span_id
 * to every line and forwards records to the OTLP log exporter.
 */
export function buildLoggerParams(env: NodeJS.ProcessEnv): Params {
  return {
    pinoHttp: {
      autoLogging: false,
      level: env.LOG_LEVEL ?? "info",
    },
  };
}
