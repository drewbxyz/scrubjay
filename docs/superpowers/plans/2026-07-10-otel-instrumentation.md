# OpenTelemetry Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Env-gated, vendor-neutral OpenTelemetry instrumentation for the scrubjay-discord bot — traces, metrics, and structured JSON logs exported over OTLP/HTTP, a total no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.

**Architecture:** A side-effect bootstrap module (`src/telemetry/otel.bootstrap.ts`) is the **first import** of `main.ts` — instrumentation monkey-patches `pg`/`http`/`undici`/`pino` only if it loads before they do. The SDK is `require()`d lazily inside the env gate, so a disabled run never loads it. All app-side instrumentation (interceptor, job wrapper, gauges) uses only `@opentelemetry/api`, whose no-op globals make it free when the SDK is off. Logging moves from Nest's console logger to pino (structured JSON on stdout); `@opentelemetry/instrumentation-pino` adds trace correlation and OTLP log export when the SDK is on. A daily-driver metric set covers commands, cron jobs, the pg pool, gateway reconnects, and dispatch queue depth.

**Tech Stack:** NestJS 11, Necord 6, discord.js 14, drizzle/pg, `@opentelemetry/sdk-node` 0.220.x + OTLP/HTTP exporters, `nestjs-pino`/`pino`, vitest.

## Global Constraints

- All commands run from `apps/scrubjay-discord/` unless noted. Per-file tests: `pnpm vitest run <file>`; full gate: `pnpm test && pnpm check-types` in the app, then `pnpm format-and-lint:fix` at the repo root (biome).
- **Off by default:** with `OTEL_EXPORTER_OTLP_ENDPOINT` unset the bot must behave exactly as today — no SDK loaded, no telemetry, no errors.
- **App code never imports SDK packages.** Outside `src/telemetry/otel.ts` (and specs/test harness), only `@opentelemetry/api` (+ `@opentelemetry/api-logs` in the e2e spec) may be imported. SDK packages are `require()`d inside the env gate.
- **Standard env vars only:** `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER` etc. are read by the SDK itself. Do NOT add them to the zod config schema — they must be readable before Nest config validation exists. The only new app-owned var is `LOG_LEVEL` (pino level, default `info`), also read straight from `process.env` for the same reason.
- Meter and tracer name is always `"scrubjay-discord"`. Metric names and attributes are fixed in the table below — no user/channel/guild IDs as metric attributes (cardinality).
- Repo style: biome enforces alphabetized object keys (`useSortedKeys` assist), double quotes, 80-col lines. Path alias `@/` = `src/` (works in specs and in `nest build` output — tsc rewrites it). Comments only for non-obvious constraints.
- OTel API globals may only be registered once per process. Vitest's default `forks` pool gives each spec file its own process, but **within one spec file** run at most one real-SDK start/shutdown cycle, and always register test providers before constructing the unit under test (metric instruments bind to the global MeterProvider at construction; there is no late-binding proxy for metrics, unlike tracers).
- Commit messages: conventional commits, `feat(scrubjay-discord): otel — <what>` / `test(...)` / `docs(...)`.

### Metric reference (implemented across Tasks 4–8)

| Name | Instrument | Unit | Attributes |
|---|---|---|---|
| `scrubjay.command.duration` | Histogram | ms | `command`, `status` (`ok`\|`error`) |
| `scrubjay.command.errors` | Counter | — | `command` |
| `scrubjay.job.duration` | Histogram | ms | `job` (`dispatch`\|`ingest`\|`retention`), `status` |
| `scrubjay.job.runs` | Counter | — | `job`, `status` |
| `scrubjay.dispatch.queue.depth` | Gauge | — | — |
| `scrubjay.discord.gateway.reconnects` | Counter | — | `event` (`reconnecting`\|`resume`) |
| `db.client.connection.count` | ObservableUpDownCounter | — | `state` (`used`\|`idle`) |
| `db.client.connection.pending_requests` | ObservableUpDownCounter | — | — |
| `scrubjay.db.pool.errors` | Counter | — | — |

---

### Task 1: Env-gated SDK bootstrap

**Files:**
- Create: `src/telemetry/otel.ts`
- Create: `src/telemetry/otel.bootstrap.ts`
- Create: `src/telemetry/telemetry.module.ts`
- Test: `src/telemetry/otel.spec.ts`
- Modify: `src/main.ts` (add first-line import)
- Modify: `src/app.module.ts` (import TelemetryModule)
- Modify: `package.json` (via pnpm add)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3, 4):
  - `startOtel(): boolean` — starts the SDK iff `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` is set; idempotent; returns whether the SDK is running.
  - `shutdownOtel(): Promise<void>` — flushes and stops the SDK; safe to call when never started or twice.
  - `TelemetryModule` — Nest module owning SDK shutdown (extended with providers in Tasks 4–6).

- [ ] **Step 1: Install dependencies**

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/instrumentation-http @opentelemetry/instrumentation-undici \
  @opentelemetry/instrumentation-express \
  @opentelemetry/instrumentation-nestjs-core \
  @opentelemetry/instrumentation-pg @opentelemetry/instrumentation-pino \
  dotenv
pnpm add -D @opentelemetry/sdk-metrics @opentelemetry/sdk-trace-node \
  @opentelemetry/api-logs
```

(Expected majors as of 2026-07: api 1.9.x, sdk-node/exporters/instr-http 0.220.x, sdk-metrics/sdk-trace-node 2.9.x. `dotenv` is needed because the SDK's env gate must run before Nest loads `.env`.)

- [ ] **Step 2: Write the failing test**

`src/telemetry/otel.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/telemetry/otel.spec.ts`
Expected: FAIL — cannot resolve `./otel`.

- [ ] **Step 4: Implement `src/telemetry/otel.ts`**

```ts
import type { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

/**
 * Env-gated OpenTelemetry bootstrap. OTEL_EXPORTER_OTLP_ENDPOINT is the
 * single on-switch; every other knob rides the standard OTEL_* env vars,
 * which the SDK and OTLP exporters read themselves. The SDK is require()d
 * lazily so a disabled run never pays its load cost.
 */
export function startOtel(): boolean {
  if (sdk) {
    return true;
  }
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return false;
  }

  const {
    logs,
    metrics,
    NodeSDK: SDK,
  } = require("@opentelemetry/sdk-node") as typeof import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } =
    require("@opentelemetry/exporter-trace-otlp-http") as typeof import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } =
    require("@opentelemetry/exporter-metrics-otlp-http") as typeof import("@opentelemetry/exporter-metrics-otlp-http");
  const { OTLPLogExporter } =
    require("@opentelemetry/exporter-logs-otlp-http") as typeof import("@opentelemetry/exporter-logs-otlp-http");
  const { HttpInstrumentation } =
    require("@opentelemetry/instrumentation-http") as typeof import("@opentelemetry/instrumentation-http");
  const { UndiciInstrumentation } =
    require("@opentelemetry/instrumentation-undici") as typeof import("@opentelemetry/instrumentation-undici");
  const { ExpressInstrumentation } =
    require("@opentelemetry/instrumentation-express") as typeof import("@opentelemetry/instrumentation-express");
  const { NestInstrumentation } =
    require("@opentelemetry/instrumentation-nestjs-core") as typeof import("@opentelemetry/instrumentation-nestjs-core");
  const { PgInstrumentation } =
    require("@opentelemetry/instrumentation-pg") as typeof import("@opentelemetry/instrumentation-pg");
  const { PinoInstrumentation } =
    require("@opentelemetry/instrumentation-pino") as typeof import("@opentelemetry/instrumentation-pino");

  sdk = new SDK({
    instrumentations: [
      new HttpInstrumentation({
        // Docker probes /health every 30s; don't trace it.
        ignoreIncomingRequestHook: (req) => req.url === "/health",
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new UndiciInstrumentation({
        // Client spans only inside an existing trace, otherwise every
        // background Discord REST call becomes its own root trace.
        requireParentforSpans: true,
      }),
      new PgInstrumentation({ requireParentSpan: true }),
      new PinoInstrumentation(),
    ],
    logRecordProcessors: [
      new logs.BatchLogRecordProcessor(new OTLPLogExporter()),
    ],
    metricReader: new metrics.PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    serviceName: process.env.OTEL_SERVICE_NAME ?? "scrubjay-discord",
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  return true;
}

export async function shutdownOtel(): Promise<void> {
  const running = sdk;
  sdk = null;
  await running?.shutdown();
}
```

(If biome flags the `require()` calls, add a `// biome-ignore lint/...: SDK must not load when telemetry is disabled` on the offending lines — do not convert to static imports.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/telemetry/otel.spec.ts`
Expected: PASS (3 tests). A console warning about duplicate global registration in the third test is expected and harmless.

- [ ] **Step 6: Create `src/telemetry/otel.bootstrap.ts`**

```ts
// Nest only loads .env inside ConfigModule.forRoot(), long after the SDK
// must decide whether to start — so load it here. dotenv never overwrites
// variables that are already set in the environment.
import "dotenv/config";
import { startOtel } from "./otel";

startOtel();
```

- [ ] **Step 7: Create `src/telemetry/telemetry.module.ts`**

```ts
import { Module, type OnApplicationShutdown } from "@nestjs/common";
import { shutdownOtel } from "./otel";

/**
 * Owns the OTel SDK's Nest-side lifecycle: enableShutdownHooks() wires
 * SIGTERM/SIGINT to onApplicationShutdown, which flushes pending telemetry.
 */
@Module({})
export class TelemetryModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownOtel();
  }
}
```

- [ ] **Step 8: Wire into `main.ts` and `app.module.ts`**

`src/main.ts` — add as the **very first line**, above all other imports:

```ts
// OTel bootstrap must be the first import: instrumentation monkey-patches
// pg/http/undici/pino only if it loads before they do (require order).
import "./telemetry/otel.bootstrap";
```

`src/app.module.ts` — add the import and register the module:

```ts
import { TelemetryModule } from "@/telemetry/telemetry.module";
```

and in the `imports:` array, directly after `ConfigModule.forRoot({...})`:

```ts
    TelemetryModule,
```

- [ ] **Step 9: Full check and commit**

Run: `pnpm vitest run src/telemetry && pnpm check-types && pnpm build`
Expected: PASS; build emits `dist/src/telemetry/otel.bootstrap.js` and `dist/src/main.js` whose first require is `./telemetry/otel.bootstrap` (verify with `head -15 dist/src/main.js`).

```bash
git add . ../../pnpm-lock.yaml
git commit -m "feat(scrubjay-discord): otel — env-gated SDK bootstrap, first-import wiring, shutdown hook"
```

---

### Task 2: Structured JSON logging via pino

**Files:**
- Create: `src/telemetry/logging.config.ts`
- Test: `src/telemetry/logging.config.spec.ts`
- Modify: `src/main.ts`, `src/app.module.ts`, `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildLoggerParams(env: NodeJS.ProcessEnv): Params` (nestjs-pino `Params`), consumed by `app.module.ts`.
- Note: every existing `new Logger(X)` (`@nestjs/common`) call in the app routes through pino once `app.useLogger` is set — no call-site changes. Existing specs that spy on `Logger.prototype` are unaffected (they never call `useLogger`).

- [ ] **Step 1: Install dependencies**

```bash
pnpm add nestjs-pino pino pino-http
```

- [ ] **Step 2: Write the failing test**

`src/telemetry/logging.config.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLoggerParams } from "./logging.config";

type PinoHttpShape = { autoLogging: boolean; level: string };

describe("buildLoggerParams", () => {
  it("defaults to info level with request auto-logging off", () => {
    const { pinoHttp } = buildLoggerParams({}) as { pinoHttp: PinoHttpShape };

    expect(pinoHttp.autoLogging).toBe(false);
    expect(pinoHttp.level).toBe("info");
  });

  it("honors LOG_LEVEL", () => {
    const { pinoHttp } = buildLoggerParams({ LOG_LEVEL: "debug" }) as {
      pinoHttp: PinoHttpShape;
    };

    expect(pinoHttp.level).toBe("debug");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/telemetry/logging.config.spec.ts`
Expected: FAIL — cannot resolve `./logging.config`.

- [ ] **Step 4: Implement `src/telemetry/logging.config.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/telemetry/logging.config.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire pino in**

`src/app.module.ts` — add imports:

```ts
import { LoggerModule } from "nestjs-pino";
import { buildLoggerParams } from "@/telemetry/logging.config";
```

and in the `imports:` array, directly after `ConfigModule.forRoot({...})` (before `TelemetryModule`):

```ts
    LoggerModule.forRoot(buildLoggerParams(process.env)),
```

`src/main.ts` — final state of the bootstrap function's first lines (buffer early logs, then hand them to pino):

```ts
import { Logger as PinoLogger } from "nestjs-pino";
```

```ts
async function bootstrap() {
  // Creating the app validates the environment and loads .env.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  const config = app.get(ConfigService<AppConfig, true>);
```

(The rest of `bootstrap()` — shutdown hooks, migration pool, `app.listen` — is unchanged.)

- [ ] **Step 7: Full check and commit**

Run: `pnpm test && pnpm check-types`
Expected: PASS — the whole existing suite stays green (specs construct classes directly; the global logger swap only happens inside `bootstrap()`).

```bash
git add src package.json ../../pnpm-lock.yaml
git commit -m "feat(scrubjay-discord): otel — structured JSON logs via nestjs-pino, LOG_LEVEL knob"
```

---

### Task 3: OTLP end-to-end spec (fake receiver)

**Files:**
- Test: `src/telemetry/otlp-export.e2e.spec.ts`

**Interfaces:**
- Consumes: `startOtel`, `shutdownOtel` from Task 1.
- Produces: nothing (acceptance test for "signals arrive at any OTLP endpoint").

- [ ] **Step 1: Write the test**

`src/telemetry/otlp-export.e2e.spec.ts` — an in-process HTTP server plays the OTLP receiver; SDK shutdown flushes every pipeline. (Note: this file performs the process's single SDK start/shutdown cycle; keep it free of other SDK usage. It emits a log via the api-logs global rather than pino because require-hook patching doesn't apply under vitest's module runner — the pino path is verified manually in Task 9.)

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/telemetry/otlp-export.e2e.spec.ts`
Expected: PASS. If `/v1/logs` is missing, the SDK didn't register a global logger provider — check that `logRecordProcessors` is set in `otel.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/telemetry/otlp-export.e2e.spec.ts
git commit -m "test(scrubjay-discord): otel — e2e OTLP export against in-process receiver"
```

---

### Task 4: Command telemetry interceptor (latency, errors, root spans)

**Files:**
- Create: `src/telemetry/command-telemetry.interceptor.ts`
- Create: `src/testing/otel-harness.ts` (shared test harness, reused in Tasks 5–8)
- Test: `src/telemetry/command-telemetry.interceptor.spec.ts`
- Modify: `src/telemetry/telemetry.module.ts`

**Interfaces:**
- Consumes: Necord handler args layout — `ctx.getArgByIndex(0)` is the context tuple `[interaction]` (same access as the existing `CommandExceptionFilter`).
- Produces:
  - `CommandTelemetryInterceptor` (registered as `APP_INTERCEPTOR`) — for every Necord *interaction* handler (slash command, button, select): a root `SpanKind.SERVER` span named by command, `scrubjay.command.duration` histogram, `scrubjay.command.errors` counter. Non-interaction Necord events (reactions, ClientReady) and HTTP requests pass through untouched. Errors are observed and **rethrown**, so `CommandExceptionFilter` still handles user-facing replies.
  - Test harness (used by Tasks 5–8):
    - `registerMetricHarness(): { collect(name: string): Promise<MetricData | undefined>; shutdown(): Promise<void> }`
    - `registerTraceHarness(): { exporter: InMemorySpanExporter; shutdown(): Promise<void> }`

- [ ] **Step 1: Create the shared test harness**

`src/testing/otel-harness.ts`:

```ts
import { context as otelContext, metrics, trace } from "@opentelemetry/api";
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
```

- [ ] **Step 2: Write the failing test**

`src/telemetry/command-telemetry.interceptor.spec.ts`:

```ts
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
```

(If `parentSpanContext` doesn't exist on the exported span type in the installed sdk-trace version, drop that single assertion — root-ness is implied by the harness having no enclosing span.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/telemetry/command-telemetry.interceptor.spec.ts`
Expected: FAIL — cannot resolve `./command-telemetry.interceptor`.

- [ ] **Step 4: Implement `src/telemetry/command-telemetry.interceptor.ts`**

```ts
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import {
  context as otelContext,
  metrics,
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/telemetry/command-telemetry.interceptor.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Register globally in `telemetry.module.ts`**

Final state of `src/telemetry/telemetry.module.ts`:

```ts
import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { CommandTelemetryInterceptor } from "./command-telemetry.interceptor";
import { shutdownOtel } from "./otel";

/**
 * Owns the OTel SDK's Nest-side lifecycle: enableShutdownHooks() wires
 * SIGTERM/SIGINT to onApplicationShutdown, which flushes pending telemetry.
 */
@Global()
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: CommandTelemetryInterceptor },
  ],
})
export class TelemetryModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownOtel();
  }
}
```

- [ ] **Step 7: Full check and commit**

Run: `pnpm test && pnpm check-types`
Expected: PASS.

```bash
git add src
git commit -m "feat(scrubjay-discord): otel — command spans + latency/error metrics via global Necord interceptor"
```

---

### Task 5: Cron job telemetry (duration, outcome, root spans)

**Files:**
- Create: `src/telemetry/job-telemetry.service.ts`
- Test: `src/telemetry/job-telemetry.service.spec.ts`
- Modify: `src/telemetry/telemetry.module.ts`, `src/features/jobs/dispatch.job.ts`, `src/features/jobs/ingest.job.ts`, `src/features/jobs/retention.job.ts` and their three specs.

**Interfaces:**
- Consumes: nothing new.
- Produces: `JobTelemetry.run<T>(job: string, fn: () => Promise<T>): Promise<T>` — wraps one cron run in a root span `"job <name>"`, records `scrubjay.job.duration` + `scrubjay.job.runs`, and **rethrows** so each job's own catch-and-log stays in charge. Exported from `TelemetryModule` (`@Global`), injected as the **last** constructor parameter of each job.

- [ ] **Step 1: Write the failing test**

`src/telemetry/job-telemetry.service.spec.ts`:

```ts
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
    expect(runs?.dataPoints[0]?.attributes).toEqual({
      job: "ingest",
      status: "error",
    });
    const [span] = traceHarness.exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/telemetry/job-telemetry.service.spec.ts`
Expected: FAIL — cannot resolve `./job-telemetry.service`.

- [ ] **Step 3: Implement `src/telemetry/job-telemetry.service.ts`**

```ts
import { Injectable } from "@nestjs/common";
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";

@Injectable()
export class JobTelemetry {
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

  private record(
    job: string,
    status: "error" | "ok",
    startedAt: number,
  ): void {
    this.duration.record(performance.now() - startedAt, { job, status });
    this.runs.add(1, { job, status });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/telemetry/job-telemetry.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from TelemetryModule**

In `src/telemetry/telemetry.module.ts`, add the import and change the decorator metadata to:

```ts
@Global()
@Module({
  exports: [JobTelemetry],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: CommandTelemetryInterceptor },
    JobTelemetry,
  ],
})
```

- [ ] **Step 6: Wire into the three jobs**

`src/features/jobs/dispatch.job.ts` — add import `import { JobTelemetry } from "@/telemetry/job-telemetry.service";`, add `private readonly jobTelemetry: JobTelemetry,` as the last constructor parameter, and change `run()` to:

```ts
  @Cron("*/1 * * * *")
  async run() {
    if (this.inFlight) {
      this.logger.debug("Previous dispatch tick still running; skipping");
      return;
    }
    this.inFlight = true;
    try {
      await this.jobTelemetry.run("dispatch", async () => {
        // Wait for bootstrap to complete before running
        await this.bootstrapService.waitForBootstrap();

        this.healthState.recordDispatchTick();

        const since = new Date(Date.now() - 15 * 60 * 1000);
        this.logger.debug(
          `Running dispatch job for alerts since ${since.toISOString()}`,
        );
        await this.dispatch.dispatchSince(since);
      });
    } catch (err) {
      this.logger.error(
        `Dispatch tick failed`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.inFlight = false;
    }
  }
```

`src/features/jobs/ingest.job.ts` — same import + last constructor parameter, and change `run()` to (the per-region try/catch stays: one bad region must not abort the others, so region failures count as an `ok` run — they surface via logs and eBird HTTP spans):

```ts
  @Cron("*/15 * * * *")
  async run() {
    try {
      await this.jobTelemetry.run("ingest", async () => {
        // Wait for bootstrap to complete before running
        await this.bootstrapService.waitForBootstrap();

        this.logger.debug("Starting eBird ingestion job...");

        const regions = await this.sources.getEBirdSources();
        this.healthState.recordIngestTick(regions);
        if (regions.length === 0) {
          // Zero subscriptions makes every tick a silent no-op; say so.
          this.logger.warn("No eBird sources configured; ingest is a no-op");
        }

        for (const region of regions) {
          try {
            const inserted = await this.ingest.ingestRegion(region);
            this.healthState.recordIngestSuccess(region);
            this.logger.log(`Region ${region}: ${inserted} alerts ingested`);
          } catch (err) {
            this.logger.error(
              `Failed to ingest ${region}`,
              err instanceof Error ? err.stack : String(err),
            );
          }
        }
      });
    } catch (err) {
      this.logger.error(
        `Ingest tick failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
```

`src/features/jobs/retention.job.ts` — same import + last constructor parameter, and change `run()` to:

```ts
  @Cron("17 4 * * *")
  async run() {
    try {
      await this.jobTelemetry.run("retention", async () => {
        await this.bootstrapService.waitForBootstrap();
        await this.retention.prune();
      });
    } catch (err) {
      this.logger.error(
        `Retention run failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
```

(Keep the existing doc comment above `@Cron("17 4 * * *")`.)

- [ ] **Step 7: Update the three job specs**

With no global meter/tracer registered, `JobTelemetry` is a pure pass-through — the job specs can use a real instance. In each of `dispatch.job.spec.ts`, `ingest.job.spec.ts`, `retention.job.spec.ts`:

1. Add `import { JobTelemetry } from "@/telemetry/job-telemetry.service";`
2. Add `new JobTelemetry()` as the final argument of every `new DispatchJob(...)` / `new IngestJob(...)` / `new RetentionJob(...)` call, e.g. in `dispatch.job.spec.ts`:

```ts
    job = new DispatchJob(
      dispatcherMock as unknown as DispatchService,
      bootstrapMock as unknown as BootstrapService,
      healthStateMock as unknown as HealthStateService,
      new JobTelemetry(),
    );
```

- [ ] **Step 8: Run the job specs, then the full gate**

Run: `pnpm vitest run src/features/jobs && pnpm test && pnpm check-types`
Expected: PASS — all existing job behaviors (re-entrancy guard, catch-and-log, health ticks) unchanged.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat(scrubjay-discord): otel — cron job spans + duration/outcome metrics"
```

---

### Task 6: pg pool saturation metrics

**Files:**
- Create: `src/telemetry/pool-metrics.service.ts`
- Test: `src/telemetry/pool-metrics.service.spec.ts`
- Modify: `src/telemetry/telemetry.module.ts`

**Interfaces:**
- Consumes: `PG_POOL` token from `@/core/drizzle/pg-connection` (DrizzleModule is `@Global`, so the pool is injectable here).
- Produces: `PoolMetricsService` (provider only, nothing exported) — observable gauges over `pool.totalCount/idleCount/waitingCount` plus an idle-client error counter. Query-level errors are already visible as `ERROR`-status pg spans from `instrumentation-pg`.

- [ ] **Step 1: Write the failing test**

`src/telemetry/pool-metrics.service.spec.ts`:

```ts
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerMetricHarness } from "@/testing/otel-harness";
import { PoolMetricsService } from "./pool-metrics.service";

const metricHarness = registerMetricHarness();

class FakePool extends EventEmitter {
  idleCount = 2;
  totalCount = 5;
  waitingCount = 1;
}

describe("PoolMetricsService", () => {
  const pool = new FakePool();

  beforeAll(() => {
    const service = new PoolMetricsService(pool as unknown as Pool);
    service.onModuleInit();
  });

  afterAll(async () => {
    await metricHarness.shutdown();
  });

  it("observes used and idle connection counts", async () => {
    const count = await metricHarness.collect("db.client.connection.count");

    const byState = Object.fromEntries(
      (count?.dataPoints ?? []).map((point) => [
        point.attributes.state,
        point.value,
      ]),
    );
    expect(byState).toEqual({ idle: 2, used: 3 });
  });

  it("observes pending connection requests", async () => {
    const pending = await metricHarness.collect(
      "db.client.connection.pending_requests",
    );

    expect(pending?.dataPoints[0]?.value).toBe(1);
  });

  it("counts idle client errors", async () => {
    pool.emit("error", new Error("connection reset"));

    const errors = await metricHarness.collect("scrubjay.db.pool.errors");
    expect(errors?.dataPoints[0]?.value).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/telemetry/pool-metrics.service.spec.ts`
Expected: FAIL — cannot resolve `./pool-metrics.service`.

- [ ] **Step 3: Implement `src/telemetry/pool-metrics.service.ts`**

```ts
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import type { Pool } from "pg";
import { PG_POOL } from "@/core/drizzle/pg-connection";

/**
 * Pool saturation gauges, observed lazily at each metric export. Query-level
 * errors are not counted here — instrumentation-pg already marks their spans.
 */
@Injectable()
export class PoolMetricsService implements OnModuleInit {
  private readonly meter = metrics.getMeter("scrubjay-discord");

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    const connections = this.meter.createObservableUpDownCounter(
      "db.client.connection.count",
      { description: "Open pg pool connections by state" },
    );
    connections.addCallback((result) => {
      const idle = this.pool.idleCount;
      result.observe(this.pool.totalCount - idle, { state: "used" });
      result.observe(idle, { state: "idle" });
    });

    const pending = this.meter.createObservableUpDownCounter(
      "db.client.connection.pending_requests",
      { description: "Requests waiting for a pg pool connection" },
    );
    pending.addCallback((result) => {
      result.observe(this.pool.waitingCount);
    });

    const errors = this.meter.createCounter("scrubjay.db.pool.errors", {
      description: "Errors emitted by idle pg pool clients",
    });
    // Second listener alongside DrizzleModule's logging handler.
    this.pool.on("error", () => errors.add(1));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/telemetry/pool-metrics.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the provider**

In `src/telemetry/telemetry.module.ts`, add the import and extend `providers` to:

```ts
  providers: [
    { provide: APP_INTERCEPTOR, useClass: CommandTelemetryInterceptor },
    JobTelemetry,
    PoolMetricsService,
  ],
```

- [ ] **Step 6: Full check and commit**

Run: `pnpm test && pnpm check-types`
Expected: PASS.

```bash
git add src
git commit -m "feat(scrubjay-discord): otel — pg pool saturation gauges + idle-client error counter"
```

---

### Task 7: Discord gateway reconnect counter

**Files:**
- Modify: `src/discord/lifecycle.update.ts`
- Test: `src/discord/lifecycle.update.spec.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `scrubjay.discord.gateway.reconnects` counter, incremented on `Events.ShardReconnecting` (`event: "reconnecting"`) and `Events.ShardResume` (`event: "resume"`).

- [ ] **Step 1: Write the failing test**

`src/discord/lifecycle.update.spec.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { registerMetricHarness } from "@/testing/otel-harness";
import { LifecycleUpdate } from "./lifecycle.update";

const metricHarness = registerMetricHarness();

describe("LifecycleUpdate gateway metrics", () => {
  afterAll(async () => {
    await metricHarness.shutdown();
  });

  it("counts reconnecting and resume events separately", async () => {
    const lifecycle = new LifecycleUpdate();

    lifecycle.onShardReconnecting();
    lifecycle.onShardReconnecting();
    lifecycle.onShardResume();

    const reconnects = await metricHarness.collect(
      "scrubjay.discord.gateway.reconnects",
    );
    const byEvent = Object.fromEntries(
      (reconnects?.dataPoints ?? []).map((point) => [
        point.attributes.event,
        point.value,
      ]),
    );
    expect(byEvent).toEqual({ reconnecting: 2, resume: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/discord/lifecycle.update.spec.ts`
Expected: FAIL — `onShardReconnecting is not a function`.

- [ ] **Step 3: Extend `src/discord/lifecycle.update.ts`**

Full new file contents:

```ts
import { Injectable } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import { ActivityType, Events } from "discord.js";
import { Context, type ContextOf, On, Once } from "necord";

@Injectable()
export class LifecycleUpdate {
  private readonly reconnects = metrics
    .getMeter("scrubjay-discord")
    .createCounter("scrubjay.discord.gateway.reconnects", {
      description: "Discord gateway reconnect/resume events",
    });

  @Once(Events.ClientReady)
  async onClientReady(@Context() [client]: ContextOf<Events.ClientReady>) {
    client.user.setActivity("looking for birds...", {
      type: ActivityType.Custom,
    });
  }

  @On(Events.ShardReconnecting)
  onShardReconnecting() {
    this.reconnects.add(1, { event: "reconnecting" });
  }

  @On(Events.ShardResume)
  onShardResume() {
    this.reconnects.add(1, { event: "resume" });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/discord/lifecycle.update.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/discord
git commit -m "feat(scrubjay-discord): otel — gateway reconnect/resume counter"
```

---

### Task 8: Dispatch queue depth gauge

**Files:**
- Modify: `src/features/dispatch/dispatch.service.ts`
- Modify: `src/features/dispatch/dispatch.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `scrubjay.dispatch.queue.depth` gauge — pending-alert count recorded at the start of every dispatch tick (updates once per minute; a rising value means sends are failing or falling behind).

- [ ] **Step 1: Write the failing test**

In `src/features/dispatch/dispatch.service.spec.ts`, add to the imports:

```ts
import { registerMetricHarness } from "@/testing/otel-harness";
```

Add at module scope, above the existing `describe` (before any `DispatchService` is constructed, so its gauge binds to the harness):

```ts
const metricHarness = registerMetricHarness();
```

Inside the existing `describe("DispatchService", ...)`, add:

```ts
  afterAll(async () => {
    await metricHarness.shutdown();
  });

  it("records the pending queue depth for the tick", async () => {
    alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
    senderMock.send.mockResolvedValue(undefined);

    await service.dispatchSince(since);

    const depth = await metricHarness.collect(
      "scrubjay.dispatch.queue.depth",
    );
    expect(depth?.dataPoints.at(-1)?.value).toBe(1);
  });
```

(Add `afterAll` to the existing vitest import list.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/dispatch/dispatch.service.spec.ts`
Expected: FAIL — the new test finds no `scrubjay.dispatch.queue.depth` metric (`depth` is undefined); all pre-existing tests still pass.

- [ ] **Step 3: Record the gauge in `dispatch.service.ts`**

Add to imports:

```ts
import { metrics } from "@opentelemetry/api";
```

Add as the first field of `DispatchService` (above `private readonly logger`):

```ts
  private readonly queueDepth = metrics
    .getMeter("scrubjay-discord")
    .createGauge("scrubjay.dispatch.queue.depth", {
      description: "Pending alerts at the start of each dispatch tick",
    });
```

And in `dispatchSince`, directly after `const pending = await this.alertQueue.pendingEBirdAlerts(since);`:

```ts
    this.queueDepth.record(pending.length);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/dispatch/dispatch.service.spec.ts`
Expected: PASS — new test plus all existing dispatch tests.

- [ ] **Step 5: Full check and commit**

Run: `pnpm test && pnpm check-types`
Expected: PASS.

```bash
git add src/features/dispatch
git commit -m "feat(scrubjay-discord): otel — dispatch queue depth gauge"
```

---

### Task 9: OBSERVABILITY.md, README link, final gate

**Files:**
- Create: `OBSERVABILITY.md` (repo root)
- Modify: `README.md` (repo root)

**Interfaces:** none — documentation and final verification.

- [ ] **Step 1: Write `OBSERVABILITY.md`** (repo root)

````markdown
# Observability

ScrubJay instruments itself with [OpenTelemetry](https://opentelemetry.io/)
and exports over **OTLP/HTTP (protobuf)**. OTLP is the contract, not a
product: point the bot at any OTLP endpoint — a self-hosted collector, a
SaaS free tier, or nothing at all. **No backend ships in this repo, and the
choice of one is left entirely to the operator.**

## The on-switch

Telemetry is **off by default**. If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset,
the SDK is never loaded — a fork gets zero observability, zero overhead, and
zero new runtime behavior.

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node dist/src/main.js
```

Standard OTel environment variables are honored (read by the SDK itself,
never re-invented):

| Variable | Meaning | Default |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP receiver base URL; the on-switch | unset (off) |
| `OTEL_SERVICE_NAME` | `service.name` resource attribute | `scrubjay-discord` |
| `OTEL_EXPORTER_OTLP_HEADERS` | e.g. auth headers for a hosted backend | — |
| `OTEL_RESOURCE_ATTRIBUTES` | extra resource attributes | — |
| `OTEL_TRACES_SAMPLER` / `_ARG` | sampling policy | `parentbased_always_on` |
| `OTEL_METRIC_EXPORT_INTERVAL` | metric push cadence (ms) | `60000` |
| `OTEL_LOG_LEVEL` | SDK self-diagnostics | — |

Only OTLP over HTTP/protobuf is wired; `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` is
not supported.

App-owned (non-OTel) knob: `LOG_LEVEL` — pino log level (`info` default).

## Signals

**Logs** — always-on structured JSON on stdout (pino). With telemetry
enabled, each line gains `trace_id`/`span_id` when inside a span, and log
records are also exported over OTLP.

**Traces** — root spans for every Discord interaction (named by command,
e.g. `subscription add`) and every cron run (`job dispatch`, `job ingest`,
`job retention`), with nested spans from auto-instrumented pg queries,
outbound HTTP (Discord REST, eBird), Express, and Nest handlers. `/health`
requests are not traced.

**Metrics** — pushed every `OTEL_METRIC_EXPORT_INTERVAL`:

| Metric | Type | What it tells you |
|---|---|---|
| `scrubjay.command.duration` (ms) | histogram | interaction latency, by `command` + `status` |
| `scrubjay.command.errors` | counter | handler failures, by `command` |
| `scrubjay.job.duration` (ms) | histogram | cron run duration, by `job` + `status` |
| `scrubjay.job.runs` | counter | cron outcomes, by `job` + `status` |
| `scrubjay.dispatch.queue.depth` | gauge | pending alerts per dispatch tick; rising = falling behind |
| `scrubjay.discord.gateway.reconnects` | counter | gateway instability, by `event` |
| `db.client.connection.count` | gauge | pg pool connections, by `state` (`used`/`idle`) |
| `db.client.connection.pending_requests` | gauge | callers waiting on a saturated pool |
| `scrubjay.db.pool.errors` | counter | idle pg client errors |

## Liveness

`GET /health` (on `PORT`, default 3000) is independent of telemetry and
suits any external uptime checker; the Docker `HEALTHCHECK` already probes
it. It reports DB connectivity plus ingest/dispatch freshness.

## Verifying against a throwaway receiver

No backend needed — run a scratch collector that prints everything it
receives:

```sh
cat > /tmp/otelcol.yaml <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces:   { receivers: [otlp], exporters: [debug] }
    metrics:  { receivers: [otlp], exporters: [debug] }
    logs:     { receivers: [otlp], exporters: [debug] }
EOF
docker run --rm -p 4318:4318 \
  -v /tmp/otelcol.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector:latest
```

Then start the bot with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
(e.g. in `apps/scrubjay-discord/.env`) and watch the collector's stdout:
spans appear as commands run and crons tick, metrics arrive every minute,
and every log line shows up as a log record.
````

- [ ] **Step 2: Link from `README.md`**

In the repo-root `README.md`, extend the paragraph in "Running locally" that ends with `...reports DB connectivity plus ingest/dispatch freshness.` by appending this sentence to it:

```markdown
Optional OpenTelemetry export (traces, metrics, structured logs over OTLP) is documented in [OBSERVABILITY.md](OBSERVABILITY.md).
```

- [ ] **Step 3: Full gate**

From `apps/scrubjay-discord/`:

```bash
pnpm test && pnpm check-types && pnpm build
```

From the repo root:

```bash
pnpm format-and-lint:fix && pnpm format-and-lint
```

Expected: all PASS. Fix anything biome rewrites, re-run, and re-stage.

- [ ] **Step 4: Manual acceptance (optional but recommended — needs Docker, the local `.env` tokens)**

1. `docker compose up -d postgres` (repo root) and start the throwaway collector from OBSERVABILITY.md.
2. From `apps/scrubjay-discord/`: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev`
3. Confirm in collector stdout: startup log records; a `job ingest` span within 15 min (or a `job dispatch` span within 1 min); metrics batches each minute.
4. Run `/subscription list` in the dev guild → a `subscription list` SERVER span with nested pg + Discord REST spans. Pretty traces achieved.
5. Stop the bot; restart WITHOUT the env var; confirm normal logs (JSON), no SDK output, `/health` still 200.

- [ ] **Step 5: Commit**

```bash
# From the repo root; -A also picks up any biome fixes from Step 3.
git add -A
git commit -m "docs: OBSERVABILITY.md — OTLP on-switch, emitted signals, throwaway-receiver recipe"
```
