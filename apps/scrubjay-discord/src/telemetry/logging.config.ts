import type { Params } from "nestjs-pino";

const PINO_LEVELS = new Set([
  "debug",
  "error",
  "fatal",
  "info",
  "trace",
  "warn",
]);

/**
 * pino throws at startup on any level string it doesn't recognize
 * (including ""), so an empty or non-lowercase LOG_LEVEL must fall back to
 * "info" rather than reach pino as-is.
 */
function resolveLogLevel(rawLevel: string | undefined): string {
  const normalized = (rawLevel ?? "").toLowerCase();
  return PINO_LEVELS.has(normalized) ? normalized : "info";
}

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
      level: resolveLogLevel(env.LOG_LEVEL),
    },
  };
}
