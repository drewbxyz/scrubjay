import { metrics, context as otelContext, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

/**
 * Registers an in-memory global MeterProvider. Call before constructing the
 * unit under test: metric instruments bind to the global provider at
 * construction time (no late-binding proxy, unlike tracers). Delta
 * temporality: each collect() sees only points recorded since the last one.
 */
export function registerMetricHarness() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60 * 60 * 1000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);

  return {
    async collect(name: string): Promise<MetricData | undefined> {
      await reader.forceFlush();
      return exporter
        .getMetrics()
        .at(-1)
        ?.scopeMetrics.flatMap((scope) => scope.metrics)
        .find((metric) => metric.descriptor.name === name);
    },
    async shutdown(): Promise<void> {
      await provider.shutdown();
      metrics.disable();
    },
  };
}

/** In-memory global TracerProvider + context manager for span assertions. */
export function registerTraceHarness() {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  return {
    exporter,
    async shutdown(): Promise<void> {
      await provider.shutdown();
      trace.disable();
      otelContext.disable();
    },
  };
}
