import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shutdownOtel, startOtel } from "./otel";

describe("startOtel", () => {
  afterEach(async () => {
    await shutdownOtel();
    vi.unstubAllEnvs();
  });

  it("is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");

    expect(startOtel()).toBe(false);
    const span = trace.getTracer("test").startSpan("noop");
    expect(span.isRecording()).toBe(false);
    span.end();
  });

  // The single real start/shutdown cycle in this file: global OTel API
  // registration is once-per-process, so later starts can't re-register.
  it("starts a recording SDK when the endpoint is set", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318");

    expect(startOtel()).toBe(true);
    const span = trace.getTracer("test").startSpan("recorded");
    expect(span.isRecording()).toBe(true);
    span.end();
  });

  it("is idempotent while running", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318");

    expect(startOtel()).toBe(true);
    expect(startOtel()).toBe(true);
  });
});
