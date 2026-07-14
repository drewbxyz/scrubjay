# Management Portal App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/scrubjay-portal` — the TanStack Start management portal from
`docs/superpowers/specs/2026-07-13-management-portal-design.md` — on top of the
already-completed bot REST API, **with OTel/Grafana-Cloud-compatible telemetry as a
hard v1 requirement** (this supersedes the spec's "portal OTel is a later
nice-to-have" line, per operator directive on 2026-07-13).

**Architecture:** TanStack Start (Vite plugin + nitro node-server output) app. All
data access via server functions that call the bot API over the Docker network
using `@scrubjay/api-contracts` schemas; the browser never sees the API token.
Better Auth (Discord provider, drizzle adapter, portal-owned `portal_*` tables in
the shared Postgres) with an env allowlist of operator Discord IDs. Telemetry
mirrors the bot's vendor-neutral pattern: OTLP/HTTP exporters configured purely by
`OTEL_*` env vars, gated on `OTEL_EXPORTER_OTLP_ENDPOINT`, loaded via
`node --import` **outside** the Vite bundle.

**Tech Stack:** TanStack Start `^1.168.28` + Router, Tailwind v4 + shadcn/ui,
Better Auth `^1.6.23`, drizzle-orm `^0.45.2` + pg `^8.22.0`, zod `^4.4.3`,
`@opentelemetry/*` (SDK `^0.220.0`, api `^1.9.1`), vitest `^4.1.10`.

**One deliberate spec deviation:** the spec's stack line names TanStack Query. v1
uses Router loaders + `router.invalidate()` instead — every read is loader-driven
and every mutation invalidates, so Query would add an SSR-integration moving part
with no v1 payoff (YAGNI). Query can be layered in later without restructuring.

## Global Constraints

- Node `24.11.1` (`.nvmrc`), pnpm `11.10.0` (`packageManager`); run all commands from repo root.
- zod `^4.4.3` idioms: `z.iso.datetime()`, `z.url()`, `z.prettifyError`, `z.treeifyError`.
- Biome `2.3.6` is the lint/format gate: alphabetized object keys, sorted imports, double quotes, 2-space indent. Run `pnpm run format-and-lint:fix` before every commit.
- Turbo integration: the app MUST expose `build`, `check-types`, `dev`, `test` scripts (there is no `lint` turbo task).
- Tests: vitest, co-located `src/**/*.spec.ts(x)`; run `pnpm --filter scrubjay-portal test`.
- **Telemetry (non-negotiable):** vendor-neutral OTLP/HTTP only; single on-switch `OTEL_EXPORTER_OTLP_ENDPOINT`; default `service.name` = `scrubjay-portal`; meter/tracer/logger name is always `"scrubjay-portal"`; app code imports only `@opentelemetry/api` / `@opentelemetry/api-logs` (SDK packages only inside the gated bootstrap). NEVER name a metric attribute `job` or `instance` (Prometheus reserved); NEVER put user/channel/guild IDs in metric attributes (cardinality).
- Bot schema is untouched: the portal owns only its `portal_*` Better Auth tables.
- Commits: `feat(scrubjay-portal): …` / `ci: …` / `docs: …`. Never push to `main`.
- Branch: run `git log --oneline main..origin/feat/management-portal-api -- apps/scrubjay-discord/src/api | head -1`. If empty (API merged), branch `feat/management-portal-app` from `main`; otherwise branch from `feat/management-portal-api`.
- If `pnpm install` rejects a dependency version because of the workspace `minimumReleaseAge` policy, pick the newest version older than the threshold rather than editing `minimumReleaseAgeExclude`.
- Every server-function read/mutation goes through `requireOperator()` (Task 5) — no unauthenticated data path.

## File Structure

```
apps/scrubjay-portal/
├── package.json              # scripts + deps; "files" packlist for pnpm deploy
├── tsconfig.json             # extends @scrubjay/typescript-config, bundler resolution
├── vite.config.ts            # tanstackStart + nitro + react + tailwind + tsconfigPaths
├── vitest.config.ts
├── drizzle.config.ts         # auth tables only, out: ./drizzle
├── drizzle/                  # generated SQL migrations (committed)
├── otel/instrumentation.mjs  # gated OTel SDK bootstrap — NEVER bundled
├── scripts/migrate.mjs       # boot-time migration runner
├── scripts/docker-entry.sh   # migrate → exec node (with --import when OTel on)
├── Dockerfile
├── .env.example
└── src/
    ├── router.tsx            # getRouter()
    ├── styles/app.css        # tailwind (+ shadcn vars after init)
    ├── lib/auth-client.ts    # better-auth react client
    ├── components/           # shadcn/ui (generated) + confirm-button.tsx
    ├── server/
    │   ├── env.ts            # zod-validated env (cached)
    │   ├── telemetry.ts      # meter/tracer handles (@opentelemetry/api only)
    │   ├── logger.ts         # stdout JSON + OTel api-logs emit
    │   ├── bot-api.ts        # typed fetch wrapper: bearer, contracts, metrics
    │   ├── db.ts             # pg Pool + drizzle (auth tables)
    │   ├── auth-schema.ts    # generated Better Auth drizzle schema (portal_*)
    │   ├── auth.ts           # betterAuth() config
    │   ├── operators.ts      # requireOperator / allowlist logic
    │   └── functions/        # createServerFn wrappers + testable *Impl fns
    │       ├── session.ts    # getSessionUser
    │       ├── guilds.ts
    │       ├── subscriptions.ts
    │       ├── filters.ts
    │       ├── ops.ts        # regions, observations, deliveries, pending, health
    │       └── ebird.ts      # county picker proxy
    └── routes/
        ├── __root.tsx
        ├── login.tsx
        ├── forbidden.tsx
        ├── api/auth/$.ts     # Better Auth handler mount
        ├── api/health.ts     # container healthcheck
        ├── _authed.tsx       # session+allowlist gate, nav shell
        └── _authed/
            ├── index.tsx     # Dashboard
            ├── channels/index.tsx
            ├── channels/$channelId.tsx
            ├── observations.tsx
            └── deliveries.tsx
```

Repo-level touches: `biome.json` (ignore generated files), `.dockerignore`
(`**/.output`), `.github/workflows/status-checks.yml` + `release.yml` (portal
image), `.changeset/management-portal-app.md`, `README.md`, `OBSERVABILITY.md`.

---

### Task 1: Scaffold the app and wire it into turbo

**Files:**
- Create: `apps/scrubjay-portal/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/router.tsx`, `src/styles/app.css`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `.env.example`
- Modify: `biome.json` (ignore list)

**Interfaces:**
- Produces: a booting Start app; `@/*` path alias; scripts `build`/`check-types`/`dev`/`test` that turbo picks up. Later tasks assume `pnpm --filter scrubjay-portal <script>` works.

- [ ] **Step 1: Create branch** (see Global Constraints for base ref)

```bash
git checkout -b feat/management-portal-app
```

- [ ] **Step 2: Write `apps/scrubjay-portal/package.json`**

```json
{
  "name": "scrubjay-portal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "files": [".output", "drizzle", "otel", "scripts"],
  "scripts": {
    "build": "vite build",
    "check-types": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "dev": "vite dev --port 3100",
    "start": "node .output/server/index.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.1",
    "@opentelemetry/api-logs": "^0.220.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.220.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.220.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.220.0",
    "@opentelemetry/instrumentation-http": "^0.220.0",
    "@opentelemetry/instrumentation-undici": "^0.30.0",
    "@opentelemetry/sdk-node": "^0.220.0",
    "drizzle-orm": "^0.45.2",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "@scrubjay/api-contracts": "workspace:*",
    "@scrubjay/typescript-config": "workspace:*",
    "@tailwindcss/vite": "^4.3.2",
    "@tanstack/react-router": "^1.168.0",
    "@tanstack/react-start": "^1.168.28",
    "@types/pg": "^8.15.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.3",
    "better-auth": "^1.6.23",
    "drizzle-kit": "^0.31.10",
    "nitro": "^3.0.260610-beta",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "tailwindcss": "^4.3.2",
    "typescript": "^5.9.3",
    "vite": "^8.1.4",
    "vite-tsconfig-paths": "^6.1.1",
    "vitest": "^4.1.10",
    "zod": "^4.4.3"
  }
}
```

`dependencies` is deliberately ONLY what must exist in the runtime image outside
the server bundle: the OTel SDK loaded via `--import` (Task 3) and
drizzle-orm/pg for `scripts/migrate.mjs` (Task 5). Everything Vite bundles is a
devDependency — nitro traces bundled deps into `.output` itself.

- [ ] **Step 3: Write `apps/scrubjay-portal/tsconfig.json`**

```json
{
  "extends": "@scrubjay/typescript-config/base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["dom", "dom.iterable", "es2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] },
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts", "drizzle.config.ts"]
}
```

- [ ] **Step 4: Write `apps/scrubjay-portal/vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), tanstackStart(), nitro(), viteReact(), tailwindcss()],
});
```

- [ ] **Step 5: Write `apps/scrubjay-portal/vitest.config.ts`**

```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 6: Write `src/styles/app.css`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`**

`src/styles/app.css`:

```css
@import "tailwindcss";
```

`src/router.tsx`:

```ts
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

`src/routes/__root.tsx`:

```tsx
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    links: [{ href: appCss, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "ScrubJay Portal" },
    ],
  }),
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

`src/routes/index.tsx` (placeholder — replaced by the `_authed` tree in Task 6):

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <main className="p-8">ScrubJay Portal — scaffold OK</main>,
});
```

- [ ] **Step 7: Write `apps/scrubjay-portal/.env.example`**

```bash
# Portal server
PORT=3100
DATABASE_URL=postgresql://scrubjay:scrubjay@localhost:5432/scrubjay
# Bot API (internal Docker network in prod)
BOT_API_URL=http://localhost:3000
SCRUBJAY_API_TOKEN=change-me-to-the-32char-bot-token00
# Better Auth
BETTER_AUTH_SECRET=generate-with-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3100
DISCORD_CLIENT_ID=your-discord-app-client-id
DISCORD_CLIENT_SECRET=your-discord-app-client-secret
# Comma-separated operator Discord user IDs
PORTAL_OPERATOR_IDS=000000000000000000
# Telemetry (unset = disabled; set all OTEL_* only in deploy env)
# OTEL_EXPORTER_OTLP_ENDPOINT=
# OTEL_EXPORTER_OTLP_HEADERS=
# OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=scrubjay
```

- [ ] **Step 8: Add generated/vendored paths to `biome.json` ignores**

In `biome.json`, find the existing ignore entry for
`apps/scrubjay-discord/src/drizzle/meta` and add, in the same list, entries for:
`apps/scrubjay-portal/src/routeTree.gen.ts`, `apps/scrubjay-portal/drizzle`,
`apps/scrubjay-portal/src/components/ui` (shadcn-generated, Task 9).

- [ ] **Step 9: Install and boot**

```bash
pnpm install
pnpm --filter scrubjay-portal build
```

Expected: build succeeds; `apps/scrubjay-portal/.output/server/index.mjs` exists
(`routeTree.gen.ts` is generated on first build/dev).

```bash
(cd apps/scrubjay-portal && PORT=3100 node .output/server/index.mjs &) && sleep 2 \
  && curl -s http://localhost:3100/ | grep -o "ScrubJay Portal" && kill %1
```

Expected: `ScrubJay Portal` printed.

- [ ] **Step 10: Gate and commit**

```bash
pnpm run format-and-lint:fix
pnpm run check-types
pnpm --filter scrubjay-portal test
git add -A
git commit -m "feat(scrubjay-portal): scaffold TanStack Start app"
```

---

### Task 2: Validated server env (`env.ts`)

**Files:**
- Create: `apps/scrubjay-portal/src/server/env.ts`
- Test: `apps/scrubjay-portal/src/server/env.spec.ts`

**Interfaces:**
- Produces: `parseEnv(source: NodeJS.ProcessEnv): PortalEnv`, `env(): PortalEnv` (cached), type `PortalEnv` with fields `BETTER_AUTH_SECRET: string`, `BETTER_AUTH_URL: string`, `BOT_API_URL: string`, `DATABASE_URL: string`, `DISCORD_CLIENT_ID: string`, `DISCORD_CLIENT_SECRET: string`, `PORTAL_OPERATOR_IDS: string[]`, `SCRUBJAY_API_TOKEN: string`. All later server modules call `env()`.

- [ ] **Step 1: Write the failing test** — `src/server/env.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const VALID = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  BOT_API_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DISCORD_CLIENT_ID: "abc",
  DISCORD_CLIENT_SECRET: "def",
  PORTAL_OPERATOR_IDS: "123456789012345678, 876543210987654321",
  SCRUBJAY_API_TOKEN: "t".repeat(32),
};

describe("parseEnv", () => {
  it("parses a valid environment and splits the operator allowlist", () => {
    const env = parseEnv(VALID);
    expect(env.PORTAL_OPERATOR_IDS).toEqual([
      "123456789012345678",
      "876543210987654321",
    ]);
    expect(env.BOT_API_URL).toBe("http://localhost:3000");
  });

  it("rejects a missing variable with a readable message", () => {
    const { DATABASE_URL: _omitted, ...rest } = VALID;
    expect(() => parseEnv(rest)).toThrow(/Invalid environment/);
  });

  it("rejects an empty allowlist", () => {
    expect(() => parseEnv({ ...VALID, PORTAL_OPERATOR_IDS: " , " })).toThrow();
  });

  it("rejects non-snowflake operator ids", () => {
    expect(() => parseEnv({ ...VALID, PORTAL_OPERATOR_IDS: "notanid" })).toThrow();
  });

  it("rejects a short bot API token", () => {
    expect(() => parseEnv({ ...VALID, SCRUBJAY_API_TOKEN: "short" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/env.spec.ts`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 3: Write `src/server/env.ts`**

```ts
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

const envSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  BOT_API_URL: z.url(),
  DATABASE_URL: z.url(),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  PORTAL_OPERATOR_IDS: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(z.array(snowflake).min(1)),
  SCRUBJAY_API_TOKEN: z.string().min(32),
});

export type PortalEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): PortalEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: PortalEnv | undefined;

export function env(): PortalEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/env.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-portal/src/server
git commit -m "feat(scrubjay-portal): zod-validated server env"
```

---

### Task 3: Telemetry — gated OTel bootstrap, logger, meter/tracer handles

The non-negotiable requirement. Design (mirrors the bot, adapted for a bundler):

- `otel/instrumentation.mjs` lives OUTSIDE `src/` and is never bundled; it runs
  via `node --import ./otel/instrumentation.mjs .output/server/index.mjs`, so
  `node:http` and undici are patched before the server bundle loads. Inert
  unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (SDK packages lazily imported
  inside the gate, exactly like the bot's `otel.ts`).
- Bundled app code uses ONLY `@opentelemetry/api` / `@opentelemetry/api-logs`.
  Their globals live on `Symbol.for(...)` registries, so the bundled copy and
  the `--import`-loaded SDK copy connect automatically.
- Logs: no pino (a bundled pino can't be reliably monkey-patched). `logger.ts`
  writes one JSON line to stdout/stderr AND emits through the OTel Logs API —
  active span context (trace_id/span_id) attaches automatically, and the
  gated SDK exports via OTLP. SDK off → api-logs is a no-op, stdout remains.

**Files:**
- Create: `apps/scrubjay-portal/otel/instrumentation.mjs`, `src/server/telemetry.ts`, `src/server/logger.ts`
- Test: `src/server/logger.spec.ts`

**Interfaces:**
- Produces: `meter` and `tracer` (named `"scrubjay-portal"`) from `src/server/telemetry.ts`; `logger.info/warn/error(message: string, attributes?: Record<string, string | number | boolean>)` from `src/server/logger.ts`. Task 4 creates instruments from `meter`.

- [ ] **Step 1: Write the failing test** — `src/server/logger.spec.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a JSON line with level, msg and attributes to stdout", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logger.info("portal started", { port: 3100 });
    expect(write).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "info", msg: "portal started", port: 3100 });
    expect(typeof line.time).toBe("string");
  });

  it("routes errors to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logger.error("boom", { reason: "test" });
    const line = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "error", msg: "boom", reason: "test" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/logger.spec.ts`
Expected: FAIL — cannot resolve `./logger`.

- [ ] **Step 3: Write `src/server/telemetry.ts` and `src/server/logger.ts`**

`src/server/telemetry.ts`:

```ts
import { metrics, trace } from "@opentelemetry/api";

// Global-registry handles: no-ops unless otel/instrumentation.mjs started the
// SDK (the api globals bridge the bundle boundary via Symbol.for registries).
export const meter = metrics.getMeter("scrubjay-portal");
export const tracer = trace.getTracer("scrubjay-portal");
```

`src/server/logger.ts`:

```ts
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type LogAttributes = Record<string, string | number | boolean>;

const otelLogger = logs.getLogger("scrubjay-portal");

function emit(
  severityNumber: SeverityNumber,
  level: "error" | "info" | "warn",
  message: string,
  attributes: LogAttributes = {},
): void {
  otelLogger.emit({
    attributes,
    body: message,
    severityNumber,
    severityText: level.toUpperCase(),
  });
  const line = `${JSON.stringify({
    level,
    msg: message,
    time: new Date().toISOString(),
    ...attributes,
  })}\n`;
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(line);
}

export const logger = {
  error: (message: string, attributes?: LogAttributes) =>
    emit(SeverityNumber.ERROR, "error", message, attributes),
  info: (message: string, attributes?: LogAttributes) =>
    emit(SeverityNumber.INFO, "info", message, attributes),
  warn: (message: string, attributes?: LogAttributes) =>
    emit(SeverityNumber.WARN, "warn", message, attributes),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/logger.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `otel/instrumentation.mjs`**

Before writing, open `apps/scrubjay-discord/src/telemetry/otel.ts` and mirror
its exact NodeSDK option keys — both apps pin `@opentelemetry/sdk-node ^0.220.0`,
so whatever key the bot uses for the metric reader / log processors is the
correct one here too.

```js
// OTel bootstrap for scrubjay-portal. Loaded via
//   node --import ./otel/instrumentation.mjs .output/server/index.mjs
// so node:http and undici are patched before the server bundle imports them.
// Must stay OUTSIDE the Vite build: a bundled SDK copy cannot patch anything,
// and the bundled app talks to this SDK only through @opentelemetry/api's
// global registries. Vendor-neutral: all endpoint/auth/resource config comes
// from standard OTEL_* env vars; unset endpoint = fully inert (bot parity).
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { OTLPLogExporter },
    sdkNodeMetrics,
    sdkNodeLogs,
    { HttpInstrumentation },
    { UndiciInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/exporter-logs-otlp-http"),
    import("@opentelemetry/sdk-node").then((m) => m.metrics),
    import("@opentelemetry/sdk-node").then((m) => m.logs),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
  ]);

  const sdk = new NodeSDK({
    instrumentations: [
      new HttpInstrumentation({
        // Health probes every 30s would drown real traffic.
        ignoreIncomingRequestHook: (req) =>
          (req.url ?? "").startsWith("/api/health"),
      }),
      new UndiciInstrumentation(),
    ],
    logRecordProcessors: [
      new sdkNodeLogs.BatchLogRecordProcessor(new OTLPLogExporter()),
    ],
    metricReader: new sdkNodeMetrics.PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    serviceName: process.env.OTEL_SERVICE_NAME ?? "scrubjay-portal",
    traceExporter: new OTLPTraceExporter(),
  });

  sdk.start();

  process.once("SIGTERM", () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
```

- [ ] **Step 6: Verify the bootstrap is inert without the endpoint and starts with it**

```bash
cd apps/scrubjay-portal
node --import ./otel/instrumentation.mjs -e "console.log('inert ok')"
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:9 OTEL_LOG_LEVEL=debug \
  node --import ./otel/instrumentation.mjs -e "console.log('started ok')" 2>&1 | tail -3
cd ../..
```

Expected: `inert ok` with no OTel output; second command prints `started ok`
(exporter connection errors to the dead endpoint are fine — proves the SDK
started). If NodeSDK rejects an option key, align it with the bot's `otel.ts`.

- [ ] **Step 7: Commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): gated OTel bootstrap, logger and meter handles"
```

---

### Task 4: Bot API client (`bot-api.ts`) with contract parsing and metrics

**Files:**
- Create: `apps/scrubjay-portal/src/server/bot-api.ts`
- Test: `apps/scrubjay-portal/src/server/bot-api.spec.ts`

**Interfaces:**
- Consumes: `env()` (Task 2), `meter` (Task 3), `apiErrorSchema` from `@scrubjay/api-contracts`.
- Produces:
  - `class BotApiError extends Error { status: number; code: string; details?: unknown }`
  - `botApi<T>(schema: z.ZodType<T>, req: { endpoint: string; method?: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown }): Promise<T>`
  - `toQuery(params: Record<string, string | number | undefined>): string` — `""` or `"?k=v&…"`, URL-encoded.
  All Task 7/8 impl functions call these. `endpoint` is a LOGICAL name (e.g. `"subscriptions.list"`) used as a metric attribute — never an ID-bearing path.

- [ ] **Step 1: Write the failing test** — `src/server/bot-api.spec.ts`

```ts
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exportIntervalMillis: 60_000,
  exporter,
});

const TEST_ENV = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  BOT_API_URL: "http://bot.internal:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DISCORD_CLIENT_ID: "abc",
  DISCORD_CLIENT_SECRET: "def",
  PORTAL_OPERATOR_IDS: "123456789012345678",
  SCRUBJAY_API_TOKEN: "t".repeat(32),
};

const okSchema = z.object({ guilds: z.array(z.object({ id: z.string() })) });

// Import lazily so the global meter provider is registered first.
let botApi: typeof import("./bot-api").botApi;
let BotApiError: typeof import("./bot-api").BotApiError;
let toQuery: typeof import("./bot-api").toQuery;

beforeAll(async () => {
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  ({ botApi, BotApiError, toQuery } = await import("./bot-api"));
});

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("botApi", () => {
  it("sends the bearer token and parses a valid response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ guilds: [{ id: "1" }] }), { status: 200 }),
    );
    const result = await botApi(okSchema, {
      endpoint: "guilds.list",
      path: "/api/v1/guilds",
    });
    expect(result.guilds).toHaveLength(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://bot.internal:3000/api/v1/guilds");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${"t".repeat(32)}`,
    );
  });

  it("maps the bot error envelope to BotApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "no such subscription" } }),
        { status: 404 },
      ),
    );
    const err = await botApi(okSchema, { endpoint: "x", path: "/api/v1/x" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BotApiError);
    expect(err).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("flags contract mismatches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ wrong: true }), { status: 200 }),
    );
    await expect(
      botApi(okSchema, { endpoint: "x", path: "/api/v1/x" }),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH", status: 502 });
  });

  it("maps network failures to BOT_UNREACHABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      botApi(okSchema, { endpoint: "x", path: "/api/v1/x" }),
    ).rejects.toMatchObject({ code: "BOT_UNREACHABLE", status: 502 });
  });

  it("records request count and duration with logical-endpoint attributes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ guilds: [] }), { status: 200 }),
    );
    await botApi(okSchema, { endpoint: "guilds.list", path: "/api/v1/guilds" });
    await reader.forceFlush();
    const names = exporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => m.descriptor.name);
    expect(names).toContain("scrubjay_portal_bot_api_requests");
    expect(names).toContain("scrubjay_portal_bot_api_duration");
  });
});

describe("toQuery", () => {
  it("builds an encoded query string and drops undefined", () => {
    expect(toQuery({ a: "x y", b: undefined, c: 5 })).toBe("?a=x+y&c=5");
    expect(toQuery({})).toBe("");
  });
});
```

Add `@opentelemetry/sdk-metrics` to devDependencies first:

```bash
pnpm --filter scrubjay-portal add -D @opentelemetry/sdk-metrics@^2.9.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/bot-api.spec.ts`
Expected: FAIL — cannot resolve `./bot-api`.

- [ ] **Step 3: Write `src/server/bot-api.ts`**

```ts
import { apiErrorSchema } from "@scrubjay/api-contracts";
import type { z } from "zod";
import { env } from "./env";
import { meter } from "./telemetry";

export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(`${code}: ${message}`);
    this.name = "BotApiError";
  }
}

export interface BotApiRequest {
  body?: unknown;
  /** Logical name used as a metric attribute, e.g. "subscriptions.list". */
  endpoint: string;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  /** Path + query on the bot API, e.g. "/api/v1/guilds". */
  path: string;
}

const requests = meter.createCounter("scrubjay_portal_bot_api_requests", {
  description: "Portal server -> bot API requests",
  unit: "{request}",
});
const duration = meter.createHistogram("scrubjay_portal_bot_api_duration", {
  description: "Portal server -> bot API request duration",
  unit: "ms",
});

function record(endpoint: string, method: string, status: string, startedAt: number): void {
  // Attribute names deliberately avoid the Prometheus-reserved `job`/`instance`
  // and carry no Discord IDs (logical endpoint names only — cardinality).
  const attributes = { endpoint, method, status };
  requests.add(1, attributes);
  duration.record(performance.now() - startedAt, attributes);
}

export function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

export async function botApi<T>(schema: z.ZodType<T>, req: BotApiRequest): Promise<T> {
  const { BOT_API_URL, SCRUBJAY_API_TOKEN } = env();
  const method = req.method ?? "GET";
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(new URL(req.path, BOT_API_URL), {
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      headers: {
        authorization: `Bearer ${SCRUBJAY_API_TOKEN}`,
        ...(req.body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
    });
  } catch (cause) {
    record(req.endpoint, method, "network_error", startedAt);
    throw new BotApiError(502, "BOT_UNREACHABLE", "bot API is unreachable", cause);
  }
  record(req.endpoint, method, String(response.status), startedAt);

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new BotApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new BotApiError(response.status, "UPSTREAM", `bot API returned ${response.status}`);
  }

  const body = schema.safeParse(await response.json());
  if (!body.success) {
    throw new BotApiError(
      502,
      "CONTRACT_MISMATCH",
      "bot API response failed contract validation",
    );
  }
  return body.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/bot-api.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): instrumented bot API client with contract parsing"
```

---

### Task 5: Database, Better Auth, migrations, operator allowlist

**Files:**
- Create: `apps/scrubjay-portal/src/server/db.ts`, `src/server/auth.ts`, `src/server/auth-schema.ts` (CLI-generated), `src/server/operators.ts`, `src/lib/auth-client.ts`, `src/routes/api/auth/$.ts`, `drizzle.config.ts`, `drizzle/` (generated migration), `scripts/migrate.mjs`, `apps/scrubjay-portal/.env` (gitignored, from `.env.example`)
- Test: `src/server/operators.spec.ts`

**Interfaces:**
- Consumes: `env()` (Task 2).
- Produces:
  - `getDb()` from `db.ts` — drizzle instance over a lazy pg Pool.
  - `auth` from `auth.ts` — Better Auth instance (`auth.handler`, `auth.api.getSession`).
  - From `operators.ts`: `pickDiscordAccountId(accounts: { accountId: string; providerId: string }[]): string | undefined`, `resolveSessionStatus(discordId: string | undefined, allowlist: string[]): "forbidden" | "operator"`, `requireOperator(): Promise<{ discordId: string; name: string; userId: string }>` (throws `UnauthenticatedError` / `ForbiddenError`, both exported).
  - `authClient` from `lib/auth-client.ts` (has `signIn.social`, `signOut`).
- Better Auth tables are renamed `portal_user` / `portal_session` / `portal_account` / `portal_verification` so the shared Postgres stays unambiguous and the bot schema untouched.

- [ ] **Step 1: Create `.env` for local dev and CLI runs**

```bash
cp apps/scrubjay-portal/.env.example apps/scrubjay-portal/.env
```

Fill real local values (`DATABASE_URL` from the repo `docker-compose.yaml`
postgres; a real `BETTER_AUTH_SECRET` via `openssl rand -base64 32`; Discord
client id/secret can stay placeholders until manual login testing). Confirm
`.env` is gitignored: `git check-ignore apps/scrubjay-portal/.env` must print the path.

- [ ] **Step 2: Write `src/server/db.ts`** (schema import added after generation)

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "./env";

let pool: Pool | undefined;

export function getDb() {
  pool ??= new Pool({ connectionString: env().DATABASE_URL, max: 5 });
  return drizzle(pool);
}
```

- [ ] **Step 3: Write `src/server/auth.ts` (phase 1 — no schema yet)**

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { reactStartCookies } from "better-auth/react-start";
import { getDb } from "./db";
import { env } from "./env";

const portalEnv = env();

export const auth = betterAuth({
  account: { modelName: "portal_account" },
  baseURL: portalEnv.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg" }),
  secret: portalEnv.BETTER_AUTH_SECRET,
  session: { modelName: "portal_session" },
  socialProviders: {
    discord: {
      clientId: portalEnv.DISCORD_CLIENT_ID,
      clientSecret: portalEnv.DISCORD_CLIENT_SECRET,
    },
  },
  // reactStartCookies must be the LAST plugin (Better Auth docs).
  plugins: [reactStartCookies()],
  user: { modelName: "portal_user" },
  verification: { modelName: "portal_verification" },
});
```

- [ ] **Step 4: Generate the drizzle schema for Better Auth's tables**

```bash
pnpm --filter scrubjay-portal add -D @better-auth/cli@^1.6.23
cd apps/scrubjay-portal
pnpm exec @better-auth/cli generate --config src/server/auth.ts --output src/server/auth-schema.ts
cd ../..
```

Expected: `src/server/auth-schema.ts` created exporting pgTable definitions
`portalUser`, `portalSession`, `portalAccount`, `portalVerification` (names may
be camelCased exports over the `portal_*` table names — inspect the file; the
`portal_account` table must have `accountId`, `providerId`, `userId` columns).
Commit whatever the CLI emits verbatim (it is generated but versioned).

Then wire it in — `db.ts` gains the schema:

```ts
import * as authSchema from "./auth-schema";
// …
  return drizzle(pool, { schema: authSchema });
```

and `auth.ts` phase 2 — pass the schema to the adapter:

```ts
import * as schema from "./auth-schema";
// …
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
```

- [ ] **Step 5: Write `drizzle.config.ts` and generate the SQL migration**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/server/auth-schema.ts",
});
```

```bash
cd apps/scrubjay-portal && pnpm exec drizzle-kit generate --name portal-auth && cd ../..
```

Expected: `apps/scrubjay-portal/drizzle/0000_portal-auth.sql` + `drizzle/meta/`
creating the four `portal_*` tables.

- [ ] **Step 6: Write `scripts/migrate.mjs`** (runs before the server in Docker; also usable locally)

```js
// Applies the portal's own migrations (Better Auth tables only). Runs from the
// app root: node scripts/migrate.mjs. Never touches the bot's schema.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await migrate(drizzle(pool), {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
await pool.end();
console.log("portal migrations applied");
```

Verify against local postgres (`docker compose up -d` first):

```bash
cd apps/scrubjay-portal && node --env-file=.env scripts/migrate.mjs && cd ../..
```

Expected: `portal migrations applied`; `\dt portal_*` in psql lists 4 tables.

- [ ] **Step 7: Mount the auth handler and client**

`src/routes/api/auth/$.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/server/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
```

`src/lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

Sanity check: `pnpm --filter scrubjay-portal dev` then
`curl -s http://localhost:3100/api/auth/ok` → `{"ok":true}` (Better Auth's
liveness route; exact body may vary but must be 200 JSON).

- [ ] **Step 8: Write the failing operators test** — `src/server/operators.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import { pickDiscordAccountId, resolveSessionStatus } from "./operators";

describe("pickDiscordAccountId", () => {
  it("returns the discord account id", () => {
    const accounts = [
      { accountId: "gh-1", providerId: "github" },
      { accountId: "123456789012345678", providerId: "discord" },
    ];
    expect(pickDiscordAccountId(accounts)).toBe("123456789012345678");
  });

  it("returns undefined when no discord account is linked", () => {
    expect(pickDiscordAccountId([{ accountId: "x", providerId: "github" }])).toBeUndefined();
  });
});

describe("resolveSessionStatus", () => {
  const allowlist = ["123456789012345678"];

  it("grants operators on the allowlist", () => {
    expect(resolveSessionStatus("123456789012345678", allowlist)).toBe("operator");
  });

  it("forbids authenticated non-operators and missing discord links", () => {
    expect(resolveSessionStatus("999999999999999999", allowlist)).toBe("forbidden");
    expect(resolveSessionStatus(undefined, allowlist)).toBe("forbidden");
  });
});
```

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/operators.spec.ts`
Expected: FAIL — cannot resolve `./operators`.

- [ ] **Step 9: Write `src/server/operators.ts`**

```ts
import { eq } from "drizzle-orm";
import { getRequest } from "@tanstack/react-start/server";
import { portalAccount } from "./auth-schema";
import { auth } from "./auth";
import { getDb } from "./db";
import { env } from "./env";

// NOTE: if `getRequest` is not exported by the installed @tanstack/react-start,
// the pre-rename export is `getWebRequest` — same signature, swap the import.

export class UnauthenticatedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("not an operator");
    this.name = "ForbiddenError";
  }
}

export interface OperatorSession {
  discordId: string;
  name: string;
  userId: string;
}

export function pickDiscordAccountId(
  accounts: { accountId: string; providerId: string }[],
): string | undefined {
  return accounts.find((account) => account.providerId === "discord")?.accountId;
}

export function resolveSessionStatus(
  discordId: string | undefined,
  allowlist: string[],
): "forbidden" | "operator" {
  return discordId !== undefined && allowlist.includes(discordId)
    ? "operator"
    : "forbidden";
}

async function discordIdForUser(userId: string): Promise<string | undefined> {
  const rows = await getDb()
    .select({
      accountId: portalAccount.accountId,
      providerId: portalAccount.providerId,
    })
    .from(portalAccount)
    .where(eq(portalAccount.userId, userId));
  return pickDiscordAccountId(rows);
}

/** Session + allowlist gate; every data server function calls this first. */
export async function requireOperator(): Promise<OperatorSession> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) throw new UnauthenticatedError();
  const discordId = await discordIdForUser(session.user.id);
  if (resolveSessionStatus(discordId, env().PORTAL_OPERATOR_IDS) !== "operator") {
    throw new ForbiddenError();
  }
  return { discordId: discordId as string, name: session.user.name, userId: session.user.id };
}
```

If the generated `auth-schema.ts` export is not named `portalAccount`, use the
actual export for the `portal_account` table and keep everything else identical.

- [ ] **Step 10: Run tests, gate, commit**

Run: `pnpm --filter scrubjay-portal test` — Expected: PASS (env, logger,
bot-api, operators suites).

```bash
pnpm run format-and-lint:fix
pnpm run check-types
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): Better Auth with Discord, portal-owned tables, operator allowlist"
```

---

### Task 6: Route guard, login and forbidden pages, authed shell

**Files:**
- Create: `src/server/functions/session.ts`, `src/routes/login.tsx`, `src/routes/forbidden.tsx`, `src/routes/_authed.tsx`, `src/routes/_authed/index.tsx`
- Delete: `src/routes/index.tsx` (Task 1 placeholder — `_authed/index.tsx` now owns `/`)
- Test: covered by `operators.spec.ts` (pure logic); this task's checks are behavioral (Step 5)

**Interfaces:**
- Consumes: `auth`, `requireOperator` internals (`pickDiscordAccountId`, `resolveSessionStatus`), `authClient`, `env()`, `getDb()`.
- Produces: `getSessionUser` server fn returning `{ status: "anonymous" } | { status: "forbidden"; name: string } | { status: "operator"; discordId: string; name: string }`; the `/_authed` layout route whose `beforeLoad` returns `{ user }` context. All Task 9–11 pages nest under `/_authed`.

- [ ] **Step 1: Write `src/server/functions/session.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { portalAccount } from "@/server/auth-schema";
import { getDb } from "@/server/db";
import { env } from "@/server/env";
import { pickDiscordAccountId, resolveSessionStatus } from "@/server/operators";

export type SessionUser =
  | { status: "anonymous" }
  | { name: string; status: "forbidden" }
  | { discordId: string; name: string; status: "operator" };

export const getSessionUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser> => {
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return { status: "anonymous" };
    const rows = await getDb()
      .select({
        accountId: portalAccount.accountId,
        providerId: portalAccount.providerId,
      })
      .from(portalAccount)
      .where(eq(portalAccount.userId, session.user.id));
    const discordId = pickDiscordAccountId(rows);
    if (resolveSessionStatus(discordId, env().PORTAL_OPERATOR_IDS) !== "operator") {
      return { name: session.user.name, status: "forbidden" };
    }
    return { discordId: discordId as string, name: session.user.name, status: "operator" };
  },
);
```

- [ ] **Step 2: Write `src/routes/login.tsx` and `src/routes/forbidden.tsx`**

`login.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">ScrubJay Portal</h1>
      <p className="text-neutral-400">Operator sign-in required.</p>
      <button
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500"
        onClick={() =>
          authClient.signIn.social({ callbackURL: "/", provider: "discord" })
        }
        type="button"
      >
        Sign in with Discord
      </button>
    </main>
  );
}
```

`forbidden.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/forbidden")({
  component: ForbiddenPage,
});

function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">403 — not an operator</h1>
      <p className="max-w-md text-center text-neutral-400">
        You signed in successfully, but this Discord account is not on the
        operator allowlist for this ScrubJay deployment.
      </p>
      <button
        className="rounded-md border border-neutral-700 px-4 py-2 hover:bg-neutral-800"
        onClick={() =>
          void authClient.signOut().then(() => navigate({ to: "/login" }))
        }
        type="button"
      >
        Sign out
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Write `src/routes/_authed.tsx`** (gate + nav shell)

```tsx
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { getSessionUser } from "@/server/functions/session";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const user = await getSessionUser();
    if (user.status === "anonymous") throw redirect({ to: "/login" });
    if (user.status === "forbidden") throw redirect({ to: "/forbidden" });
    return { user };
  },
  component: AuthedLayout,
});

const NAV = [
  { label: "Dashboard", to: "/" },
  { label: "Channels", to: "/channels" },
  { label: "Observations", to: "/observations" },
  { label: "Deliveries", to: "/deliveries" },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-neutral-800 p-4">
        <span className="mb-6 text-lg font-semibold">ScrubJay</span>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-neutral-800 text-white" }}
              className="rounded px-3 py-2 text-neutral-300 hover:bg-neutral-900"
              key={item.to}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 text-sm text-neutral-400">
          <span>{user.name}</span>
          <button
            className="rounded border border-neutral-700 px-2 py-1 text-left hover:bg-neutral-800"
            onClick={() =>
              void authClient
                .signOut()
                .then(() => router.invalidate())
                .then(() => navigate({ to: "/login" }))
            }
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Replace the root index route**

Delete `src/routes/index.tsx`. Create `src/routes/_authed/index.tsx` (dashboard
placeholder; Task 9 fills it):

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/")({
  component: () => <h1 className="text-xl font-semibold">Dashboard</h1>,
});
```

- [ ] **Step 5: Behavioral check**

```bash
pnpm --filter scrubjay-portal dev
```

- `curl -sI http://localhost:3100/ | head -1` → a redirect (302/307) toward
  `/login` (anonymous gate works).
- `curl -s http://localhost:3100/login | grep -o "Sign in with Discord"` →
  matches.
- Full Discord login can only be tested with real client credentials; defer to
  the Task 12 deploy verification if placeholders are still in `.env`.

- [ ] **Step 6: Gate and commit**

```bash
pnpm run format-and-lint:fix && pnpm run check-types && pnpm --filter scrubjay-portal test
git add -A apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): auth gate, login/403 pages, authed shell"
```

---

### Task 7: Server functions — guilds and subscriptions CRUD

Pattern for ALL data server functions (Tasks 7–8): a plain exported `*Impl`
function holds the logic and is what vitest tests (bot API faked at the fetch
boundary); the `createServerFn` wrapper only does `requireOperator()` + input
validation + delegation. Wrappers stay 5 lines and untested.

**Files:**
- Create: `src/server/functions/guilds.ts`, `src/server/functions/subscriptions.ts`
- Test: `src/server/functions/subscriptions.spec.ts`

**Interfaces:**
- Consumes: `botApi`, `toQuery`, `BotApiError` (Task 4); `requireOperator` (Task 5); from `@scrubjay/api-contracts`: `guildsResponseSchema`, `listSubscriptionsQuerySchema`, `listSubscriptionsResponseSchema`, `createSubscriptionResponseSchema`, `updateSubscriptionResponseSchema`, `channelIdSchema`.
- Produces (server fns for routes; impls for tests):
  - `fetchGuilds()` → `GuildsResponse`
  - `listSubscriptions({ data: ListSubscriptionsQuery })` → `ListSubscriptionsResponse`
  - `createSubscription({ data: { channelId: string; regionCode: string } })` → `{ created: boolean }`
  - `updateSubscription({ data: { channelId: string; stateCode: string; countyCode: string; active: boolean } })` → `{ subscription: Subscription }`
  - `deleteSubscription({ data: { channelId: string; stateCode: string; countyCode: string } })` → `{ deleted: boolean }`
  - `deletedResponseSchema` (local: `z.object({ deleted: z.boolean() })` — the bot returns it but the contracts package has no schema for it).

- [ ] **Step 1: Write the failing test** — `src/server/functions/subscriptions.spec.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubscriptionImpl,
  deleteSubscriptionImpl,
  listSubscriptionsImpl,
  updateSubscriptionImpl,
} from "./subscriptions";

const TEST_ENV = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  BOT_API_URL: "http://bot.internal:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DISCORD_CLIENT_ID: "abc",
  DISCORD_CLIENT_SECRET: "def",
  PORTAL_OPERATOR_IDS: "123456789012345678",
  SCRUBJAY_API_TOKEN: "t".repeat(32),
};

const SUB = {
  active: true,
  channelId: "123456789012345678",
  countyCode: "US-CA-085",
  lastUpdated: "2026-07-13T00:00:00.000Z",
  stateCode: "US-CA",
};

function stubFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("subscriptions impls", () => {
  it("lists with query filters", async () => {
    const spy = stubFetch(200, { subscriptions: [SUB] });
    const result = await listSubscriptionsImpl({ channelId: SUB.channelId });
    expect(result.subscriptions).toHaveLength(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      "http://bot.internal:3000/api/v1/subscriptions?channelId=123456789012345678",
    );
  });

  it("creates via channel-scoped POST with regionCode body", async () => {
    const spy = stubFetch(200, { created: true });
    await createSubscriptionImpl({ channelId: SUB.channelId, regionCode: "US-CA-085" });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://bot.internal:3000/api/v1/channels/123456789012345678/subscriptions",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ regionCode: "US-CA-085" });
  });

  it("toggles active via PATCH with the region key in the body", async () => {
    const spy = stubFetch(200, { subscription: { ...SUB, active: false } });
    const result = await updateSubscriptionImpl({
      active: false,
      channelId: SUB.channelId,
      countyCode: SUB.countyCode,
      stateCode: SUB.stateCode,
    });
    expect(result.subscription.active).toBe(false);
    const [, init] = spy.mock.calls[0] ?? [];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      active: false,
      countyCode: "US-CA-085",
      stateCode: "US-CA",
    });
  });

  it("deletes with the region key in the query string", async () => {
    const spy = stubFetch(200, { deleted: true });
    await deleteSubscriptionImpl({
      channelId: SUB.channelId,
      countyCode: SUB.countyCode,
      stateCode: SUB.stateCode,
    });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(init?.method).toBe("DELETE");
    expect(String(url)).toBe(
      "http://bot.internal:3000/api/v1/channels/123456789012345678/subscriptions?countyCode=US-CA-085&stateCode=US-CA",
    );
  });

  it("propagates bot error envelopes", async () => {
    stubFetch(404, { error: { code: "NOT_FOUND", message: "no such subscription" } });
    await expect(
      deleteSubscriptionImpl({
        channelId: SUB.channelId,
        countyCode: SUB.countyCode,
        stateCode: SUB.stateCode,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/functions/subscriptions.spec.ts`
Expected: FAIL — cannot resolve `./subscriptions`.

- [ ] **Step 3: Write `src/server/functions/guilds.ts` and `src/server/functions/subscriptions.ts`**

`guilds.ts`:

```ts
import { guildsResponseSchema } from "@scrubjay/api-contracts";
import type { GuildsResponse } from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { botApi } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";

export function fetchGuildsImpl(): Promise<GuildsResponse> {
  return botApi(guildsResponseSchema, {
    endpoint: "guilds.list",
    path: "/api/v1/guilds",
  });
}

export const fetchGuilds = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return fetchGuildsImpl();
});
```

`subscriptions.ts`:

```ts
import {
  channelIdSchema,
  createSubscriptionResponseSchema,
  listSubscriptionsQuerySchema,
  listSubscriptionsResponseSchema,
  updateSubscriptionResponseSchema,
} from "@scrubjay/api-contracts";
import type {
  CreateSubscriptionResponse,
  ListSubscriptionsQuery,
  ListSubscriptionsResponse,
  UpdateSubscriptionResponse,
} from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi, toQuery } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";

export const deletedResponseSchema = z.object({ deleted: z.boolean() });
export type DeletedResponse = z.infer<typeof deletedResponseSchema>;

const createInputSchema = z.object({
  channelId: channelIdSchema,
  regionCode: z.string().min(1),
});
const regionKeyInputSchema = z.object({
  channelId: channelIdSchema,
  countyCode: z.string().min(1),
  stateCode: z.string().min(1),
});
const updateInputSchema = regionKeyInputSchema.extend({ active: z.boolean() });

export function listSubscriptionsImpl(
  query: ListSubscriptionsQuery,
): Promise<ListSubscriptionsResponse> {
  return botApi(listSubscriptionsResponseSchema, {
    endpoint: "subscriptions.list",
    path: `/api/v1/subscriptions${toQuery(query)}`,
  });
}

export function createSubscriptionImpl(
  input: z.infer<typeof createInputSchema>,
): Promise<CreateSubscriptionResponse> {
  return botApi(createSubscriptionResponseSchema, {
    body: { regionCode: input.regionCode },
    endpoint: "subscriptions.create",
    method: "POST",
    path: `/api/v1/channels/${input.channelId}/subscriptions`,
  });
}

export function updateSubscriptionImpl(
  input: z.infer<typeof updateInputSchema>,
): Promise<UpdateSubscriptionResponse> {
  return botApi(updateSubscriptionResponseSchema, {
    body: { active: input.active, countyCode: input.countyCode, stateCode: input.stateCode },
    endpoint: "subscriptions.update",
    method: "PATCH",
    path: `/api/v1/channels/${input.channelId}/subscriptions`,
  });
}

export function deleteSubscriptionImpl(
  input: z.infer<typeof regionKeyInputSchema>,
): Promise<DeletedResponse> {
  return botApi(deletedResponseSchema, {
    endpoint: "subscriptions.delete",
    method: "DELETE",
    path: `/api/v1/channels/${input.channelId}/subscriptions${toQuery({
      countyCode: input.countyCode,
      stateCode: input.stateCode,
    })}`,
  });
}

export const listSubscriptions = createServerFn({ method: "GET" })
  .validator(listSubscriptionsQuerySchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listSubscriptionsImpl(data);
  });

export const createSubscription = createServerFn({ method: "POST" })
  .validator(createInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return createSubscriptionImpl(data);
  });

export const updateSubscription = createServerFn({ method: "POST" })
  .validator(updateInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return updateSubscriptionImpl(data);
  });

export const deleteSubscription = createServerFn({ method: "POST" })
  .validator(regionKeyInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return deleteSubscriptionImpl(data);
  });
```

(Mutations use `method: "POST"` at the RPC layer regardless of the upstream
verb — the bot API call inside the impl carries the real PATCH/DELETE.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/functions/subscriptions.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): guilds and subscriptions server functions"
```

---

### Task 8: Server functions — filters, ops views, eBird counties

**Files:**
- Create: `src/server/functions/filters.ts`, `src/server/functions/ops.ts`, `src/server/functions/ebird.ts`
- Test: `src/server/functions/ops.spec.ts`

**Interfaces:**
- Consumes: `botApi`, `toQuery`, `requireOperator`, `deletedResponseSchema` (Task 7); contracts: `listFiltersResponseSchema`, `addFilterResponseSchema`, `regionsResponseSchema`, `listObservationsQuerySchema`, `listObservationsResponseSchema`, `listDeliveriesQuerySchema`, `listDeliveriesResponseSchema`, `pendingAlertsResponseSchema`, `countiesResponseSchema`, `stateCodeSchema`, `channelIdSchema`.
- Produces server fns: `listFilters({ data: { channelId } })`, `addFilter({ data: { channelId, commonName } })`, `removeFilter({ data: { channelId, commonName } })`, `fetchRegions()`, `listObservations({ data: ListObservationsQuery })`, `listDeliveries({ data: ListDeliveriesQuery })`, `fetchPendingAlerts()`, `fetchBotHealth()` → `{ ok: boolean; status: string }`, `fetchCounties({ data: { stateCode } })`. Matching `*Impl` exports for each.

- [ ] **Step 1: Write the failing test** — `src/server/functions/ops.spec.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBotHealthImpl, listDeliveriesImpl, listObservationsImpl } from "./ops";

const TEST_ENV = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  BOT_API_URL: "http://bot.internal:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DISCORD_CLIENT_ID: "abc",
  DISCORD_CLIENT_SECRET: "def",
  PORTAL_OPERATOR_IDS: "123456789012345678",
  SCRUBJAY_API_TOKEN: "t".repeat(32),
};

function stubFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ops impls", () => {
  it("passes observation filters and pagination through the query string", async () => {
    const spy = stubFetch(200, { hasMore: false, observations: [] });
    await listObservationsImpl({ limit: 50, offset: 100, stateCode: "US-CA" });
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      "http://bot.internal:3000/api/v1/observations?limit=50&offset=100&stateCode=US-CA",
    );
  });

  it("passes delivery filters through", async () => {
    const spy = stubFetch(200, { deliveries: [], hasMore: true });
    const result = await listDeliveriesImpl({ limit: 50, offset: 0, status: "failed" });
    expect(result.hasMore).toBe(true);
    expect(String(spy.mock.calls[0]?.[0])).toContain("status=failed");
  });

  it("reports bot health from /health outside the API envelope", async () => {
    const spy = stubFetch(200, { details: {}, status: "ok" });
    const result = await fetchBotHealthImpl();
    expect(result).toEqual({ ok: true, status: "ok" });
    expect(String(spy.mock.calls[0]?.[0])).toBe("http://bot.internal:3000/health");
  });

  it("reports unhealthy on a non-2xx health response", async () => {
    stubFetch(503, { status: "error" });
    await expect(fetchBotHealthImpl()).resolves.toEqual({ ok: false, status: "error" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/functions/ops.spec.ts`
Expected: FAIL — cannot resolve `./ops`.

- [ ] **Step 3: Write the three modules**

`filters.ts`:

```ts
import {
  addFilterResponseSchema,
  channelIdSchema,
  listFiltersResponseSchema,
} from "@scrubjay/api-contracts";
import type { AddFilterResponse, ListFiltersResponse } from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi, toQuery } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";
import { deletedResponseSchema } from "./subscriptions";
import type { DeletedResponse } from "./subscriptions";

const channelInputSchema = z.object({ channelId: channelIdSchema });
const filterInputSchema = channelInputSchema.extend({
  commonName: z.string().min(1),
});

export function listFiltersImpl(channelId: string): Promise<ListFiltersResponse> {
  return botApi(listFiltersResponseSchema, {
    endpoint: "filters.list",
    path: `/api/v1/channels/${channelId}/filters`,
  });
}

export function addFilterImpl(
  input: z.infer<typeof filterInputSchema>,
): Promise<AddFilterResponse> {
  return botApi(addFilterResponseSchema, {
    body: { commonName: input.commonName },
    endpoint: "filters.add",
    method: "POST",
    path: `/api/v1/channels/${input.channelId}/filters`,
  });
}

export function removeFilterImpl(
  input: z.infer<typeof filterInputSchema>,
): Promise<DeletedResponse> {
  return botApi(deletedResponseSchema, {
    endpoint: "filters.remove",
    method: "DELETE",
    path: `/api/v1/channels/${input.channelId}/filters${toQuery({
      commonName: input.commonName,
    })}`,
  });
}

export const listFilters = createServerFn({ method: "GET" })
  .validator(channelInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listFiltersImpl(data.channelId);
  });

export const addFilter = createServerFn({ method: "POST" })
  .validator(filterInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return addFilterImpl(data);
  });

export const removeFilter = createServerFn({ method: "POST" })
  .validator(filterInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return removeFilterImpl(data);
  });
```

`ops.ts`:

```ts
import {
  listDeliveriesQuerySchema,
  listDeliveriesResponseSchema,
  listObservationsQuerySchema,
  listObservationsResponseSchema,
  pendingAlertsResponseSchema,
  regionsResponseSchema,
} from "@scrubjay/api-contracts";
import type {
  ListDeliveriesQuery,
  ListDeliveriesResponse,
  ListObservationsQuery,
  ListObservationsResponse,
  PendingAlertsResponse,
  RegionsResponse,
} from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi, toQuery } from "@/server/bot-api";
import { env } from "@/server/env";
import { requireOperator } from "@/server/operators";

export function fetchRegionsImpl(): Promise<RegionsResponse> {
  return botApi(regionsResponseSchema, {
    endpoint: "regions.list",
    path: "/api/v1/regions",
  });
}

export function listObservationsImpl(
  query: ListObservationsQuery,
): Promise<ListObservationsResponse> {
  return botApi(listObservationsResponseSchema, {
    endpoint: "observations.list",
    path: `/api/v1/observations${toQuery(query)}`,
  });
}

export function listDeliveriesImpl(
  query: ListDeliveriesQuery,
): Promise<ListDeliveriesResponse> {
  return botApi(listDeliveriesResponseSchema, {
    endpoint: "deliveries.list",
    path: `/api/v1/deliveries${toQuery(query)}`,
  });
}

export function fetchPendingAlertsImpl(): Promise<PendingAlertsResponse> {
  return botApi(pendingAlertsResponseSchema, {
    endpoint: "alerts.pending",
    path: "/api/v1/alerts/pending",
  });
}

const healthBodySchema = z.looseObject({ status: z.string() });

export interface BotHealth {
  ok: boolean;
  status: string;
}

/** /health sits outside /api/v1 (public, no bearer) — plain fetch, no envelope. */
export async function fetchBotHealthImpl(): Promise<BotHealth> {
  try {
    const response = await fetch(new URL("/health", env().BOT_API_URL));
    const parsed = healthBodySchema.safeParse(await response.json().catch(() => undefined));
    return {
      ok: response.ok,
      status: parsed.success ? parsed.data.status : `http ${response.status}`,
    };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

export const fetchRegions = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return fetchRegionsImpl();
});

export const listObservations = createServerFn({ method: "GET" })
  .validator(listObservationsQuerySchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listObservationsImpl(data);
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .validator(listDeliveriesQuerySchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return listDeliveriesImpl(data);
  });

export const fetchPendingAlerts = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return fetchPendingAlertsImpl();
});

export const fetchBotHealth = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return fetchBotHealthImpl();
});
```

`ebird.ts`:

```ts
import { countiesResponseSchema, stateCodeSchema } from "@scrubjay/api-contracts";
import type { CountiesResponse } from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { botApi } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";

const countiesInputSchema = z.object({ stateCode: stateCodeSchema });

export function fetchCountiesImpl(stateCode: string): Promise<CountiesResponse> {
  return botApi(countiesResponseSchema, {
    endpoint: "ebird.counties",
    path: `/api/v1/ebird/regions/${stateCode}/counties`,
  });
}

export const fetchCounties = createServerFn({ method: "GET" })
  .validator(countiesInputSchema)
  .handler(async ({ data }) => {
    await requireOperator();
    return fetchCountiesImpl(data.stateCode);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter scrubjay-portal exec vitest run src/server/functions/ops.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): filters, ops and eBird server functions"
```

---

### Task 9: UI foundation (shadcn/ui) and Dashboard

**Files:**
- Create: `components.json` + `src/components/ui/*` (shadcn CLI), `src/components/confirm-button.tsx`, `src/lib/utils.ts` (CLI)
- Modify: `src/styles/app.css` (CLI adds theme vars), `src/routes/__root.tsx` (Toaster), `src/routes/_authed/index.tsx` (real dashboard)
- Test: `src/components/confirm-button.spec.tsx`

**Interfaces:**
- Consumes: `fetchRegions`, `fetchPendingAlerts`, `listDeliveries`, `fetchBotHealth` (Task 8).
- Produces: shadcn primitives under `@/components/ui/*`; `<ConfirmButton label confirmTitle onConfirm variant?>` used by Tasks 10–11 for destructive actions (spec: destructive actions confirm first).

- [ ] **Step 1: Initialize shadcn/ui**

```bash
cd apps/scrubjay-portal
pnpm dlx shadcn@latest init
# prompts: style=default, base color=neutral, css=src/styles/app.css,
# aliases: components=@/components, utils=@/lib/utils  (CLI reads tsconfig paths)
pnpm dlx shadcn@latest add alert-dialog badge button card input label select sonner table tabs
cd ../..
pnpm install
```

Expected: `components.json`, `src/lib/utils.ts`, `src/components/ui/*.tsx`;
`app.css` gains shadcn CSS variables. If the CLI balks at the framework, pick
"Vite" when asked — it only affects path detection. (The generated dir is
already in the Task 1 biome ignore list.)

- [ ] **Step 2: Mount toasts in `__root.tsx`**

Add to imports: `import { Toaster } from "@/components/ui/sonner";` and render
`<Toaster />` directly after `{children}` in `RootDocument`.

- [ ] **Step 3: Write the failing ConfirmButton test** — `src/components/confirm-button.spec.tsx`

```bash
pnpm --filter scrubjay-portal add -D @testing-library/react@^16.3.0 @testing-library/user-event@^14.6.0 jsdom@^26.1.0
```

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";

describe("ConfirmButton", () => {
  it("does not fire the action until confirmed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmButton confirmTitle="Delete subscription?" label="Delete" onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not fire when cancelled", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton confirmTitle="Sure?" label="Remove" onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter scrubjay-portal exec vitest run src/components/confirm-button.spec.tsx`
Expected: FAIL — cannot resolve `./confirm-button`.

- [ ] **Step 4: Write `src/components/confirm-button.tsx`**

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmButtonProps {
  confirmTitle: string;
  description?: string;
  label: string;
  onConfirm: () => void;
  variant?: "destructive" | "outline";
}

export function ConfirmButton({
  confirmTitle,
  description,
  label,
  onConfirm,
  variant = "destructive",
}: ConfirmButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Run the spec again — Expected: PASS (2 tests).

- [ ] **Step 5: Replace `src/routes/_authed/index.tsx` with the real Dashboard**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchBotHealth,
  fetchPendingAlerts,
  fetchRegions,
  listDeliveries,
} from "@/server/functions/ops";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
  loader: async () => {
    const [health, regions, pending, failures] = await Promise.all([
      fetchBotHealth(),
      fetchRegions(),
      fetchPendingAlerts(),
      listDeliveries({ data: { limit: 10, offset: 0, status: "failed" } }),
    ]);
    return { failures, health, pending, regions };
  },
});

function Dashboard() {
  const { failures, health, pending, regions } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Bot health</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.ok ? "default" : "destructive"}>{health.status}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending alerts</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {pending.alerts.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ingest regions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {regions.regions.map((region) => (
              <Badge key={region.stateCode} variant="outline">
                {region.stateCode} · {region.subscriptions.length}
              </Badge>
            ))}
            {regions.regions.length === 0 ? (
              <span className="text-sm text-neutral-400">No subscriptions yet</span>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent delivery failures</CardTitle>
        </CardHeader>
        <CardContent>
          {failures.deliveries.length === 0 ? (
            <p className="text-sm text-neutral-400">No recent failures.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Sent at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="font-mono text-xs">{delivery.alertId}</TableCell>
                    <TableCell className="font-mono text-xs">{delivery.channelId}</TableCell>
                    <TableCell>{delivery.kind}</TableCell>
                    <TableCell>{delivery.detail ?? "—"}</TableCell>
                    <TableCell>{delivery.sentAt ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Link className="mt-2 inline-block text-sm text-indigo-400" to="/deliveries">
            All deliveries →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Gate and commit**

```bash
pnpm run format-and-lint:fix && pnpm run check-types && pnpm --filter scrubjay-portal test
git add -A apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): shadcn foundation, confirm dialog, dashboard"
```

---

### Task 10: Channels pages (browse tree + per-channel CRUD)

**Files:**
- Create: `src/routes/_authed/channels/index.tsx`, `src/routes/_authed/channels/$channelId.tsx`, `src/components/add-subscription-form.tsx`

**Interfaces:**
- Consumes: `fetchGuilds`, `listSubscriptions`, `createSubscription`, `updateSubscription`, `deleteSubscription` (Task 7); `listFilters`, `addFilter`, `removeFilter` (Task 8); `fetchCounties` (Task 8); `ConfirmButton` (Task 9).
- Mutation pattern used everywhere: `await mutationFn({ data }) → toast.success(...) → router.invalidate()`; failures land in `catch` → `toast.error((error as Error).message)` (BotApiError.message already carries `CODE: detail`).

- [ ] **Step 1: Write `src/routes/_authed/channels/index.tsx`** (guild → channel tree)

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchGuilds } from "@/server/functions/guilds";
import { listSubscriptions } from "@/server/functions/subscriptions";

export const Route = createFileRoute("/_authed/channels/")({
  component: ChannelsPage,
  loader: async () => {
    const [guilds, subscriptions] = await Promise.all([
      fetchGuilds(),
      listSubscriptions({ data: {} }),
    ]);
    return { guilds, subscriptions };
  },
});

function ChannelsPage() {
  const { guilds, subscriptions } = Route.useLoaderData();
  const countByChannel = new Map<string, number>();
  for (const sub of subscriptions.subscriptions) {
    countByChannel.set(sub.channelId, (countByChannel.get(sub.channelId) ?? 0) + 1);
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Channels</h1>
      {guilds.guilds.map((guild) => (
        <Card key={guild.id}>
          <CardHeader>
            <CardTitle>{guild.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {guild.channels.map((channel) => (
              <Link
                className="flex items-center justify-between rounded px-3 py-2 hover:bg-neutral-900"
                key={channel.id}
                params={{ channelId: channel.id }}
                to="/channels/$channelId"
              >
                <span>#{channel.name}</span>
                <Badge variant="outline">
                  {countByChannel.get(channel.id) ?? 0} subscriptions
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/add-subscription-form.tsx`**

State picker is a free-text `US-XX` input (matches `/subscribe` semantics);
county select loads on demand through the cached bot proxy; `*` = statewide.

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchCounties } from "@/server/functions/ebird";
import type { County } from "@scrubjay/api-contracts";

interface AddSubscriptionFormProps {
  onSubmit: (regionCode: string) => Promise<void>;
}

export function AddSubscriptionForm({ onSubmit }: AddSubscriptionFormProps) {
  const [busy, setBusy] = useState(false);
  const [counties, setCounties] = useState<County[]>([]);
  const [county, setCounty] = useState("*");
  const [stateCode, setStateCode] = useState("");

  async function loadCounties(nextState: string) {
    setStateCode(nextState);
    setCounty("*");
    setCounties([]);
    if (!/^[A-Z]{2}-[A-Z0-9]{1,10}$/.test(nextState)) return;
    try {
      const response = await fetchCounties({ data: { stateCode: nextState } });
      setCounties(response.counties);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const regionCode = county === "*" ? stateCode : county;
        if (!regionCode) return;
        setBusy(true);
        void onSubmit(regionCode).finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="stateCode">State (e.g. US-CA)</Label>
        <Input
          className="w-32 font-mono uppercase"
          id="stateCode"
          onChange={(event) => void loadCounties(event.target.value.toUpperCase())}
          placeholder="US-CA"
          value={stateCode}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>County</Label>
        <Select onValueChange={setCounty} value={county}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="*">Statewide</SelectItem>
            {counties.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button disabled={busy || stateCode.length === 0} type="submit">
        Add subscription
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Write `src/routes/_authed/channels/$channelId.tsx`**

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AddSubscriptionForm } from "@/components/add-subscription-form";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchGuilds } from "@/server/functions/guilds";
import { addFilter, listFilters, removeFilter } from "@/server/functions/filters";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from "@/server/functions/subscriptions";

export const Route = createFileRoute("/_authed/channels/$channelId")({
  component: ChannelDetail,
  loader: async ({ params }) => {
    const [guilds, subscriptions, filters] = await Promise.all([
      fetchGuilds(),
      listSubscriptions({ data: { channelId: params.channelId } }),
      listFilters({ data: { channelId: params.channelId } }),
    ]);
    const channel = guilds.guilds
      .flatMap((guild) => guild.channels.map((c) => ({ ...c, guildName: guild.name })))
      .find((c) => c.id === params.channelId);
    return { channel, filters, subscriptions };
  },
});

function ChannelDetail() {
  const { channel, filters, subscriptions } = Route.useLoaderData();
  const { channelId } = Route.useParams();
  const router = useRouter();
  const [newFilter, setNewFilter] = useState("");

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
      await router.invalidate();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">
        {channel ? `#${channel.name} · ${channel.guildName}` : `Channel ${channelId}`}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>County</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.subscriptions.map((sub) => (
                <TableRow key={`${sub.stateCode}/${sub.countyCode}`}>
                  <TableCell className="font-mono">{sub.stateCode}</TableCell>
                  <TableCell className="font-mono">
                    {sub.countyCode === "*" ? "statewide" : sub.countyCode}
                  </TableCell>
                  <TableCell>
                    <Badge variant={sub.active ? "default" : "outline"}>
                      {sub.active ? "active" : "paused"}
                    </Badge>
                  </TableCell>
                  <TableCell>{sub.lastUpdated}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button
                      onClick={() =>
                        void run(
                          () =>
                            updateSubscription({
                              data: {
                                active: !sub.active,
                                channelId,
                                countyCode: sub.countyCode,
                                stateCode: sub.stateCode,
                              },
                            }),
                          sub.active ? "Subscription paused" : "Subscription resumed",
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {sub.active ? "Pause" : "Resume"}
                    </Button>
                    <ConfirmButton
                      confirmTitle={`Delete ${sub.stateCode}/${sub.countyCode}?`}
                      description="The channel will stop receiving alerts for this region."
                      label="Delete"
                      onConfirm={() =>
                        void run(
                          () =>
                            deleteSubscription({
                              data: {
                                channelId,
                                countyCode: sub.countyCode,
                                stateCode: sub.stateCode,
                              },
                            }),
                          "Subscription deleted",
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <AddSubscriptionForm
            onSubmit={(regionCode) =>
              run(
                () => createSubscription({ data: { channelId, regionCode } }),
                "Subscription created",
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Species filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {filters.filters.length === 0 ? (
            <p className="text-sm text-neutral-400">No filters for this channel.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filters.filters.map((filter) => (
                <li className="flex items-center justify-between" key={filter.commonName}>
                  <span>{filter.commonName}</span>
                  <ConfirmButton
                    confirmTitle={`Remove filter "${filter.commonName}"?`}
                    label="Remove"
                    onConfirm={() =>
                      void run(
                        () =>
                          removeFilter({
                            data: { channelId, commonName: filter.commonName },
                          }),
                        "Filter removed",
                      )
                    }
                    variant="outline"
                  />
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (newFilter.trim().length === 0) return;
              void run(
                () => addFilter({ data: { channelId, commonName: newFilter.trim() } }),
                "Filter added",
              ).then(() => setNewFilter(""));
            }}
          >
            <Input
              className="w-64"
              onChange={(event) => setNewFilter(event.target.value)}
              placeholder="Common name, e.g. Rock Pigeon"
              value={newFilter}
            />
            <Button type="submit" variant="outline">
              Add filter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Gate and commit**

```bash
pnpm run format-and-lint:fix && pnpm run check-types && pnpm --filter scrubjay-portal test
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): channels tree and per-channel subscription/filter CRUD"
```

---

### Task 11: Observations explorer and Deliveries/pending debug view

**Files:**
- Create: `src/routes/_authed/observations.tsx`, `src/routes/_authed/deliveries.tsx`

**Interfaces:**
- Consumes: `listObservations`, `listDeliveries`, `fetchPendingAlerts` (Task 8); contracts types `Observation`, `Delivery`, `PendingAlert`, `deliveryStatusSchema` values.
- Pattern: filters live in typed search params (`validateSearch` with zod) so views are shareable URLs — the "why didn't channel X get alert Y" debugging flow is copy-pastable.

- [ ] **Step 1: Write `src/routes/_authed/observations.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listObservations } from "@/server/functions/ops";

const searchSchema = z.object({
  countyCode: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  speciesCode: z.string().optional(),
  stateCode: z.string().optional(),
});

const PAGE = 50;

export const Route = createFileRoute("/_authed/observations")({
  component: ObservationsPage,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listObservations({
      data: {
        countyCode: deps.countyCode || undefined,
        limit: PAGE,
        offset: deps.offset,
        speciesCode: deps.speciesCode || undefined,
        stateCode: deps.stateCode || undefined,
      },
    }),
  validateSearch: searchSchema,
});

function ObservationsPage() {
  const data = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Observations</h1>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void navigate({
            search: {
              countyCode: String(form.get("countyCode") ?? "") || undefined,
              offset: 0,
              speciesCode: String(form.get("speciesCode") ?? "") || undefined,
              stateCode: String(form.get("stateCode") ?? "") || undefined,
            },
          });
        }}
      >
        <Input className="w-28 font-mono" defaultValue={search.stateCode ?? ""} name="stateCode" placeholder="US-CA" />
        <Input className="w-36 font-mono" defaultValue={search.countyCode ?? ""} name="countyCode" placeholder="US-CA-085" />
        <Input className="w-36 font-mono" defaultValue={search.speciesCode ?? ""} name="speciesCode" placeholder="species code" />
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Species</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>Observed</TableHead>
            <TableHead>Ingested</TableHead>
            <TableHead>Media</TableHead>
            <TableHead>Checklist</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.observations.map((obs) => (
            <TableRow key={`${obs.subId}/${obs.speciesCode}`}>
              <TableCell>
                {obs.comName} <span className="text-neutral-500">({obs.speciesCode})</span>
              </TableCell>
              <TableCell>
                {obs.locationName} · {obs.county}, {obs.state}
              </TableCell>
              <TableCell>{obs.obsDt}</TableCell>
              <TableCell>{obs.createdAt}</TableCell>
              <TableCell>
                📷{obs.photoCount} 🔊{obs.audioCount} 🎬{obs.videoCount}
              </TableCell>
              <TableCell className="font-mono text-xs">{obs.subId}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex gap-2">
        <Button
          disabled={search.offset === 0}
          onClick={() =>
            void navigate({
              search: (prev) => ({ ...prev, offset: Math.max(0, search.offset - PAGE) }),
            })
          }
          variant="outline"
        >
          Previous
        </Button>
        <Button
          disabled={!data.hasMore}
          onClick={() =>
            void navigate({ search: (prev) => ({ ...prev, offset: search.offset + PAGE }) })
          }
          variant="outline"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/routes/_authed/deliveries.tsx`** (deliveries table + pending-alerts tab)

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchPendingAlerts, listDeliveries } from "@/server/functions/ops";

const searchSchema = z.object({
  alertId: z.string().optional(),
  channelId: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["sent", "failed", "expired", "suppressed"]).optional(),
});

const PAGE = 50;

const STATUS_VARIANT = {
  expired: "outline",
  failed: "destructive",
  sent: "default",
  suppressed: "secondary",
} as const;

export const Route = createFileRoute("/_authed/deliveries")({
  component: DeliveriesPage,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [deliveries, pending] = await Promise.all([
      listDeliveries({
        data: {
          alertId: deps.alertId || undefined,
          channelId: deps.channelId || undefined,
          limit: PAGE,
          offset: deps.offset,
          status: deps.status,
        },
      }),
      fetchPendingAlerts(),
    ]);
    return { deliveries, pending };
  },
  validateSearch: searchSchema,
});

function DeliveriesPage() {
  const { deliveries, pending } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Deliveries & pending alerts</h1>
      <Tabs defaultValue="deliveries">
        <TabsList>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="pending">Pending ({pending.alerts.length})</TabsTrigger>
        </TabsList>

        <TabsContent className="flex flex-col gap-4" value="deliveries">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const status = String(form.get("status") ?? "");
              void navigate({
                search: {
                  alertId: String(form.get("alertId") ?? "") || undefined,
                  channelId: String(form.get("channelId") ?? "") || undefined,
                  offset: 0,
                  status: status === "any" || status === "" ? undefined : (status as never),
                },
              });
            }}
          >
            <Input className="w-48 font-mono" defaultValue={search.channelId ?? ""} name="channelId" placeholder="channel id" />
            <Input className="w-48 font-mono" defaultValue={search.alertId ?? ""} name="alertId" placeholder="alert id" />
            <Select defaultValue={search.status ?? "any"} name="status">
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">any status</SelectItem>
                <SelectItem value="sent">sent</SelectItem>
                <SelectItem value="failed">failed</SelectItem>
                <SelectItem value="expired">expired</SelectItem>
                <SelectItem value="suppressed">suppressed</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline">Filter</Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Sent at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[delivery.status]}>{delivery.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{delivery.alertId}</TableCell>
                  <TableCell className="font-mono text-xs">{delivery.channelId}</TableCell>
                  <TableCell>{delivery.kind}</TableCell>
                  <TableCell>{delivery.detail ?? "—"}</TableCell>
                  <TableCell>{delivery.sentAt ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-2">
            <Button
              disabled={search.offset === 0}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, offset: Math.max(0, search.offset - PAGE) }),
                })
              }
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={!deliveries.hasMore}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, offset: search.offset + PAGE }),
                })
              }
              variant="outline"
            >
              Next
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="pending">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Species</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Observed</TableHead>
                <TableHead>Queued</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.alerts.map((alert) => (
                <TableRow key={`${alert.channelId}/${alert.subId}/${alert.speciesCode}`}>
                  <TableCell>
                    {alert.comName}{" "}
                    <span className="text-neutral-500">({alert.speciesCode})</span>
                  </TableCell>
                  <TableCell>
                    {alert.locationName} · {alert.county}, {alert.state}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{alert.channelId}</TableCell>
                  <TableCell>{alert.obsDt}</TableCell>
                  <TableCell>{alert.createdAt}</TableCell>
                  <TableCell className="flex gap-1">
                    {alert.isPrivate ? <Badge variant="outline">private</Badge> : null}
                    {alert.recentlyConfirmed ? <Badge variant="outline">confirmed</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Gate and commit**

```bash
pnpm run format-and-lint:fix && pnpm run check-types && pnpm --filter scrubjay-portal test
git add apps/scrubjay-portal
git commit -m "feat(scrubjay-portal): observations explorer and deliveries debug view"
```

---

### Task 12: Health route, Dockerfile, container entry

**Files:**
- Create: `src/routes/api/health.ts`, `apps/scrubjay-portal/Dockerfile`, `apps/scrubjay-portal/scripts/docker-entry.sh`
- Modify: `.dockerignore` (repo root)

**Interfaces:**
- Consumes: `getDb()` (Task 5), the `files` packlist + prod-deps split (Task 1), `otel/instrumentation.mjs` (Task 3), `scripts/migrate.mjs` (Task 5).
- Produces: image `scrubjay-portal` — entry runs migrations, then starts the server with the OTel `--import` iff `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `GET /api/health` → 200 `{"status":"ok"}` / 503 `{"status":"unavailable"}` (checks Postgres; deliberately does NOT probe the bot — a bot restart must not mark the portal unhealthy).

- [ ] **Step 1: Write `src/routes/api/health.ts`**

```ts
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await getDb().execute(sql`select 1`);
          return Response.json({ status: "ok" });
        } catch {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});
```

- [ ] **Step 2: Write `scripts/docker-entry.sh`** (`chmod +x`)

```sh
#!/bin/sh
set -e
node scripts/migrate.mjs
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  exec node --import ./otel/instrumentation.mjs .output/server/index.mjs
fi
exec node .output/server/index.mjs
```

- [ ] **Step 3: Write `apps/scrubjay-portal/Dockerfile`** (clone of the bot's 4-stage pattern — compare against `apps/scrubjay-discord/Dockerfile` and keep divergences to the lines noted)

```dockerfile
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
RUN pnpm install turbo@2.10.3 --global

FROM base AS builder
WORKDIR /app
COPY . .
RUN turbo prune scrubjay-portal --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN turbo run build --filter=scrubjay-portal
RUN pnpm --filter=scrubjay-portal deploy --prod --legacy /prod/scrubjay-portal

FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
COPY --from=installer --chown=nodejs:nodejs /prod/scrubjay-portal ./
USER nodejs
ENV PORT=3100
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch(\`http://127.0.0.1:\${process.env.PORT}/api/health\`).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "scripts/docker-entry.sh"]
```

- [ ] **Step 4: Add `**/.output` to `.dockerignore`** (next to the existing `**/dist` entry) so a local build never leaks into the image context.

- [ ] **Step 5: Build and smoke locally**

```bash
docker build -f apps/scrubjay-portal/Dockerfile -t scrubjay-portal:local .
docker compose up -d   # repo-root postgres on the scrubjay network
docker run --rm --network scrubjay -e DATABASE_URL=postgresql://scrubjay:scrubjay@postgres:5432/scrubjay \
  -e BOT_API_URL=http://scrubjay-discord:3000 -e SCRUBJAY_API_TOKEN=$(printf 't%.0s' $(seq 32)) \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) -e BETTER_AUTH_URL=http://localhost:3100 \
  -e DISCORD_CLIENT_ID=x -e DISCORD_CLIENT_SECRET=y -e PORTAL_OPERATOR_IDS=123456789012345678 \
  -p 3100:3100 scrubjay-portal:local &
sleep 5
curl -s http://localhost:3100/api/health
curl -sI http://localhost:3100/ | head -1
```

Check the compose file for the actual postgres service name/credentials before
running. Expected: `portal migrations applied` in container logs, then
`{"status":"ok"}` and a redirect-to-login status line. Also verify OTel wiring
end-to-end with the throwaway-collector recipe from `OBSERVABILITY.md`
(set `OTEL_EXPORTER_OTLP_ENDPOINT` on the `docker run` and watch for
`scrubjay-portal` traces/metrics/logs arriving). Stop the container when done.

- [ ] **Step 6: Commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-portal .dockerignore
git commit -m "feat(scrubjay-portal): health route and Docker image with OTel-aware entrypoint"
```

---

### Task 13: CI, changeset, docs

**Files:**
- Modify: `.github/workflows/status-checks.yml`, `.github/workflows/release.yml`, `README.md`, `OBSERVABILITY.md`
- Create: `.changeset/management-portal-app.md`

**Interfaces:**
- Consumes: the Task 12 image contract (boots to a DB `ECONNREFUSED` when Postgres is absent, never "Cannot find module").
- Produces: PR gate builds+smokes BOTH images; release publishes `ghcr.io/…/scrubjay-portal` on changeset publish.

- [ ] **Step 1: Matrix the `docker-smoke` job in `status-checks.yml`**

Convert the hardcoded job to `strategy: matrix: app: [scrubjay-discord, scrubjay-portal]`; parameterize the existing build step (`file: ./apps/${{ matrix.app }}/Dockerfile`, `tags: ${{ matrix.app }}:smoke`, `cache-from/to: type=gha,scope=${{ matrix.app }}`). Keep the existing bot smoke-run step gated with `if: matrix.app == 'scrubjay-discord'` and add the portal twin:

```yaml
      - name: Smoke test portal image
        if: matrix.app == 'scrubjay-portal'
        run: |
          set -o pipefail
          docker run --rm \
            -e DATABASE_URL=postgresql://u:p@127.0.0.1:9/db \
            -e BOT_API_URL=http://127.0.0.1:9 \
            -e SCRUBJAY_API_TOKEN=tttttttttttttttttttttttttttttttt \
            -e BETTER_AUTH_SECRET=ssssssssssssssssssssssssssssssss \
            -e BETTER_AUTH_URL=http://localhost:3100 \
            -e DISCORD_CLIENT_ID=x -e DISCORD_CLIENT_SECRET=y \
            -e PORTAL_OPERATOR_IDS=123456789012345678 \
            scrubjay-portal:smoke 2>&1 | tee smoke.log || true
          grep -q "ECONNREFUSED" smoke.log
          ! grep -q "Cannot find module" smoke.log
```

(The image reaches migration → dead Postgres → `ECONNREFUSED`, proving the
bundle, prod deps, and entry script all resolve.)

- [ ] **Step 2: Add the portal publish step in `release.yml`**

Duplicate the existing `if: matrix.package.name == 'scrubjay-discord'` build/push step with `scrubjay-portal` and `file: ./apps/scrubjay-portal/Dockerfile`. Duplicate its `docker/metadata-action@v5` step likewise (`images: ghcr.io/${{ github.repository_owner }}/scrubjay-portal`).

- [ ] **Step 3: Changeset** — `.changeset/management-portal-app.md`

```markdown
---
"scrubjay-portal": minor
---

New management portal: TanStack Start app with Discord-authenticated operator
access (Better Auth + env allowlist), subscriptions/filters CRUD, ops views
(observations, deliveries, pending alerts, regions, bot health), and
OTLP-exported OTel telemetry (traces, metrics, logs) matching the bot's
vendor-neutral pattern.
```

`scrubjay-portal` must NOT be added to the `ignore` list in
`.changeset/config.json` — it is versioned/tagged like `scrubjay-discord` so
the release workflow publishes its image.

- [ ] **Step 4: Docs**

- `README.md`: add `apps/scrubjay-portal` to the layout/apps section (one
  paragraph: what it is, optional add-on, only-exposed service).
- `OBSERVABILITY.md`: add a short "scrubjay-portal" section: same
  `OTEL_*` on-switch and env table apply verbatim; `service.name` defaults to
  `scrubjay-portal`; bootstrap is `node --import otel/instrumentation.mjs`
  (bundler constraint — SDK must stay outside the Vite build); signals =
  HTTP-server + undici-client traces, `scrubjay_portal_bot_api_requests`
  (counter → `_total` in Prometheus) and `scrubjay_portal_bot_api_duration`
  (ms histogram) with `endpoint`/`method`/`status` attributes, logs via the
  OTel Logs API with trace correlation; `/api/health` spans are suppressed.
- `apps/scrubjay-portal/.env.example` already documents every env var — link
  it from the README section.

- [ ] **Step 5: Full local gate, push, PR**

```bash
pnpm run format-and-lint && pnpm run check-types && pnpm run test && pnpm run build
git add -A
git commit -m "ci: build, smoke and release the portal image; portal docs and changeset"
git push -u origin feat/management-portal-app
gh pr create --title "feat: management portal app" --body "Implements docs/superpowers/plans/2026-07-13-management-portal-app.md (portal app for the completed management API; OTel telemetry included per operator requirement)."
gh pr checks --watch
```

Expected: all four repo gates green plus both docker-smoke matrix legs.

---

## End-to-end acceptance (manual, after deploy or with real Discord creds locally)

1. Anonymous visit → redirected to `/login`; Discord OAuth round-trip lands on the dashboard for an allowlisted ID; a non-allowlisted account gets `/forbidden`.
2. Channels → pick a channel → create a county subscription (state → county picker), pause it, delete it (confirm dialog) — verify with `/subscribe`-created data that both paths see the same rows.
3. Filters: add and remove; confirm 👎-created filters appear.
4. Deliveries view filtered by `channelId` + pending tab answer "why didn't channel X get alert Y".
5. Grafana Cloud: `scrubjay-portal` service appears with traces (portal → bot API client spans), both `scrubjay_portal_bot_api_*` series, and logs carrying `trace_id`.

## Notes for the implementer

- **Version drift is the main hazard.** TanStack Start APIs verified against
  docs on 2026-07-13 for `^1.168`: `createServerFn({ method }).validator().handler()`,
  `createFileRoute` with `server.handlers`, `getRouter()` in `src/router.tsx`,
  `nitro()` from `nitro/vite`, output `.output/server/index.mjs`. If an import
  fails, check the installed version's changelog before improvising; the one
  known rename is `getRequest` (older: `getWebRequest`) in Task 5.
- The OTel SDK option keys in Task 3 must match `apps/scrubjay-discord/src/telemetry/otel.ts` — same pinned SDK version, authoritative in-repo reference.
- Never log or export the `SCRUBJAY_API_TOKEN`, Discord client secret, or Better Auth secret; the logger takes explicit attributes only — keep secrets out of them.




