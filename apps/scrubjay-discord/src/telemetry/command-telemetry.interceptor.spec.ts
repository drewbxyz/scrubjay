import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { defer, lastValueFrom, of, throwError } from "rxjs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  registerMetricHarness,
  registerTraceHarness,
} from "@/testing/otel-harness";
import { CommandTelemetryInterceptor } from "./command-telemetry.interceptor";

const metricHarness = registerMetricHarness();
const traceHarness = registerTraceHarness();

function chatInteraction(name: string, sub: string | null) {
  return {
    commandName: name,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => null,
    },
  };
}

function necordContext(
  interaction: unknown,
  handlerName = "onHandler",
): ExecutionContext {
  const handler = () => undefined;
  Object.defineProperty(handler, "name", { value: handlerName });
  return {
    getArgByIndex: () => [interaction],
    getHandler: () => handler,
    getType: () => "necord",
  } as unknown as ExecutionContext;
}

describe("CommandTelemetryInterceptor", () => {
  let interceptor: CommandTelemetryInterceptor;

  beforeAll(() => {
    // Providers are registered at module scope above, so instruments bind
    // to the in-memory harness rather than no-ops.
    interceptor = new CommandTelemetryInterceptor();
  });

  afterEach(() => {
    traceHarness.exporter.reset();
  });

  afterAll(async () => {
    await metricHarness.shutdown();
    await traceHarness.shutdown();
  });

  it("records ok latency labeled with the full slash-command path", async () => {
    const ctx = necordContext(chatInteraction("subscription", "add"));
    const next: CallHandler = { handle: () => of("done") };

    await lastValueFrom(interceptor.intercept(ctx, next));

    const duration = await metricHarness.collect("scrubjay.command.duration");
    expect(duration?.dataPoints).toHaveLength(1);
    expect(duration?.dataPoints[0]?.attributes).toEqual({
      command: "subscription add",
      status: "ok",
    });
  });

  it("exports a SERVER root span named after the command", async () => {
    const ctx = necordContext(chatInteraction("subscription", "list"));

    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(1) }));

    const [span] = traceHarness.exporter.getFinishedSpans();
    expect(span?.name).toBe("subscription list");
    expect(span?.kind).toBe(SpanKind.SERVER);
    expect(span?.parentSpanContext).toBeUndefined();
  });

  it("runs the handler inside the command span", async () => {
    let activeSpanId: string | undefined;
    const ctx = necordContext(chatInteraction("subscription", "list"));
    const next: CallHandler = {
      handle: () =>
        defer(() => {
          activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
          return of(undefined);
        }),
    };

    await lastValueFrom(interceptor.intercept(ctx, next));

    const [span] = traceHarness.exporter.getFinishedSpans();
    expect(activeSpanId).toBeDefined();
    expect(activeSpanId).toBe(span?.spanContext().spanId);
  });

  it("counts errors, marks the span, and rethrows for the exception filter", async () => {
    const ctx = necordContext(
      { isChatInputCommand: () => false },
      "onSubscriptionListNav",
    );
    const next: CallHandler = {
      handle: () => throwError(() => new Error("boom")),
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, next)),
    ).rejects.toThrow("boom");

    const errors = await metricHarness.collect("scrubjay.command.errors");
    expect(errors?.dataPoints[0]?.attributes).toEqual({
      command: "onSubscriptionListNav",
    });
    const [span] = traceHarness.exporter.getFinishedSpans();
    expect(span?.name).toBe("onSubscriptionListNav");
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("passes non-interaction necord events through untouched", async () => {
    const ctx = necordContext({ emoji: "👎" }); // a MessageReaction, roughly

    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(1) }));

    expect(traceHarness.exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("passes http contexts through untouched", async () => {
    const ctx = {
      getType: () => "http",
    } as unknown as ExecutionContext;

    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(1) }));

    expect(traceHarness.exporter.getFinishedSpans()).toHaveLength(0);
  });
});
