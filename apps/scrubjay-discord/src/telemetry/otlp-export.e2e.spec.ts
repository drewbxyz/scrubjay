import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { shutdownOtel, startOtel } from "./otel";

describe("OTLP export (e2e)", () => {
  let server: Server;
  const seenPaths = new Set<string>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      seenPaths.add(req.url ?? "");
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/x-protobuf" });
        res.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${port}`);
    startOtel();
  });

  afterAll(async () => {
    await shutdownOtel();
    await new Promise((resolve) => server.close(resolve));
    vi.unstubAllEnvs();
  });

  it("delivers traces, metrics, and logs to the receiver", async () => {
    trace.getTracer("e2e").startSpan("e2e-span").end();
    metrics.getMeter("e2e").createCounter("e2e.counter").add(1);
    logs.getLogger("e2e").emit({ body: "e2e-log", severityNumber: 9 });

    // Shutdown force-flushes the batch processors and the metric reader.
    await shutdownOtel();

    expect(seenPaths.has("/v1/traces")).toBe(true);
    expect(seenPaths.has("/v1/metrics")).toBe(true);
    expect(seenPaths.has("/v1/logs")).toBe(true);
  }, 20_000);
});
