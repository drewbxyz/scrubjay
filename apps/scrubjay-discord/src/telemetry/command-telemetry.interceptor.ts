import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import {
  metrics,
  context as otelContext,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { ChatInputCommandInteraction } from "discord.js";
import { Observable } from "rxjs";

/** Duck-typed so specs don't have to construct real discord.js objects. */
type InteractionLike = {
  isChatInputCommand(): boolean;
};

function isInteractionLike(value: unknown): value is InteractionLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as InteractionLike).isChatInputCommand === "function"
  );
}

/**
 * Slash commands get their full path ("subscription add"); component
 * handlers use the handler method name — customIds carry per-message
 * parameters and would blow up metric cardinality.
 */
function commandLabel(
  interaction: InteractionLike,
  handlerName: string,
): string {
  if (interaction.isChatInputCommand()) {
    const chat = interaction as unknown as ChatInputCommandInteraction;
    return [
      chat.commandName,
      chat.options.getSubcommandGroup(false),
      chat.options.getSubcommand(false),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return handlerName;
}

/**
 * Root span + latency/error metrics for every Discord interaction handler.
 * Interactions arrive over the gateway websocket, so no auto-instrumentation
 * creates a server span for them — this interceptor is the trace root.
 * Errors are rethrown: CommandExceptionFilter still owns the user reply.
 */
@Injectable()
export class CommandTelemetryInterceptor implements NestInterceptor {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by duration/errors below (cross-field usage isn't tracked).
  private readonly meter = metrics.getMeter("scrubjay-discord");
  private readonly tracer = trace.getTracer("scrubjay-discord");

  private readonly duration = this.meter.createHistogram(
    "scrubjay.command.duration",
    { description: "Discord interaction handler latency", unit: "ms" },
  );

  private readonly errors = this.meter.createCounter(
    "scrubjay.command.errors",
    { description: "Discord interaction handler failures" },
  );

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType<string>() !== "necord") {
      return next.handle();
    }
    // Necord handler args are [contextTuple, discovery]; interactions are
    // the tuple's first element (same access as CommandExceptionFilter).
    const [interaction] = ctx.getArgByIndex<unknown[]>(0) ?? [];
    if (!isInteractionLike(interaction)) {
      return next.handle();
    }

    const command = commandLabel(interaction, ctx.getHandler().name);
    const span = this.tracer.startSpan(command, {
      attributes: { "discord.command": command },
      kind: SpanKind.SERVER,
    });
    const spanContext = trace.setSpan(otelContext.active(), span);
    const startedAt = performance.now();

    return new Observable((subscriber) => {
      const subscription = otelContext.with(spanContext, () =>
        next.handle().subscribe({
          complete: () => {
            this.finish(span, command, startedAt);
            subscriber.complete();
          },
          error: (err: unknown) => {
            this.finish(span, command, startedAt, err);
            subscriber.error(err);
          },
          next: (value) => subscriber.next(value),
        }),
      );
      return () => subscription.unsubscribe();
    });
  }

  private finish(
    span: Span,
    command: string,
    startedAt: number,
    err?: unknown,
  ): void {
    const status = err === undefined ? "ok" : "error";
    this.duration.record(performance.now() - startedAt, { command, status });
    if (err !== undefined) {
      this.errors.add(1, { command });
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();
  }
}
