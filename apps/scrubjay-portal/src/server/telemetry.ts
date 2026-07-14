import { metrics, trace } from "@opentelemetry/api";

// Global-registry handles: no-ops unless otel/instrumentation.mjs started the
// SDK (the api globals bridge the bundle boundary via Symbol.for registries).
export const meter = metrics.getMeter("scrubjay-portal");
export const tracer = trace.getTracer("scrubjay-portal");
