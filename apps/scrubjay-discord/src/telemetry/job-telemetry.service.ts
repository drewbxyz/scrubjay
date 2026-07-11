import { Injectable } from "@nestjs/common";
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";

@Injectable()
export class JobTelemetry {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by duration/runs below (cross-field usage isn't tracked).
  private readonly meter = metrics.getMeter("scrubjay-discord");
  private readonly tracer = trace.getTracer("scrubjay-discord");

  private readonly duration = this.meter.createHistogram(
    "scrubjay.job.duration",
    { description: "Cron job run duration", unit: "ms" },
  );

  private readonly runs = this.meter.createCounter("scrubjay.job.runs", {
    description: "Cron job runs by outcome",
  });

  /**
   * Wrap one cron run: a root span plus duration/outcome metrics. Rethrows
   * so each job's own catch-and-log handling stays in charge.
   */
  async run<T>(job: string, fn: () => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(`job ${job}`, async (span) => {
      const startedAt = performance.now();
      try {
        const result = await fn();
        this.record(job, "ok", startedAt);
        return result;
      } catch (err) {
        this.record(job, "error", startedAt);
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private record(job: string, status: "error" | "ok", startedAt: number): void {
    this.duration.record(performance.now() - startedAt, { job, status });
    this.runs.add(1, { job, status });
  }
}
