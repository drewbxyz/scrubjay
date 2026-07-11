import { SpanStatusCode, trace } from "@opentelemetry/api";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  registerMetricHarness,
  registerTraceHarness,
} from "@/testing/otel-harness";
import { JobTelemetry } from "./job-telemetry.service";

const metricHarness = registerMetricHarness();
const traceHarness = registerTraceHarness();

describe("JobTelemetry", () => {
  let jobs: JobTelemetry;

  beforeAll(() => {
    jobs = new JobTelemetry();
  });

  afterEach(() => {
    traceHarness.exporter.reset();
  });

  afterAll(async () => {
    await metricHarness.shutdown();
    await traceHarness.shutdown();
  });

  it("returns the run's value and records an ok outcome", async () => {
    const result = await jobs.run("dispatch", async () => 42);

    expect(result).toBe(42);
    const runs = await metricHarness.collect("scrubjay.job.runs");
    expect(runs?.dataPoints[0]?.attributes).toEqual({
      job: "dispatch",
      status: "ok",
    });
    const duration = await metricHarness.collect("scrubjay.job.duration");
    expect(duration?.dataPoints).toHaveLength(1);
  });

  it("wraps the run in a root span with the job name", async () => {
    let activeSpanId: string | undefined;

    await jobs.run("retention", async () => {
      activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
    });

    const [span] = traceHarness.exporter.getFinishedSpans();
    expect(span?.name).toBe("job retention");
    expect(activeSpanId).toBe(span?.spanContext().spanId);
  });

  it("records an error outcome, marks the span, and rethrows", async () => {
    await expect(
      jobs.run("ingest", async () => {
        throw new Error("ebird down");
      }),
    ).rejects.toThrow("ebird down");

    const runs = await metricHarness.collect("scrubjay.job.runs");
    const ingestRun = runs?.dataPoints.find(
      (point) => point.attributes.job === "ingest",
    );
    expect(ingestRun?.attributes).toEqual({
      job: "ingest",
      status: "error",
    });
    const [span] = traceHarness.exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });
});
