# Jest → Vitest Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jest with Vitest in `apps/scrubjay-discord` — all 23 specs ported (22 kept, 1 deleted), per-worker test databases, Jest deps gone, CI green.

**Architecture:** Vitest with `unplugin-swc` for Nest decorator metadata; one testcontainers Postgres whose migrated `scrubjay_template` database is cloned per Vitest worker (`test_<VITEST_POOL_ID>`), so spec files run in parallel across workers while keeping the existing truncate-per-test pattern within a worker.

**Tech Stack:** Vitest (latest), unplugin-swc + @swc/core (already a dep), @vitest/coverage-v8, @testcontainers/postgresql (unchanged), drizzle migrations (unchanged).

**Spec:** `docs/superpowers/specs/2026-07-09-vitest-migration-design.md`

## Global Constraints

- Explicit imports in every spec: `import { describe, it, expect, vi, … } from "vitest"`. Never enable `globals: true`.
- Biome enforces **sorted object keys** and import sorting — write object literals alphabetized; run `pnpm run format-and-lint:fix` (repo root) before every commit.
- All commands below run from the **repo root** unless stated otherwise. Package-scoped commands use `pnpm --filter scrubjay-discord …`.
- `apps/test-api` is untouched. `turbo.json` and `.github/workflows/status-checks.yml` are untouched.
- Do not add a `vitest/globals` types entry to tsconfig; the only tsconfig change is removing `"jest"` from `types` (Task 1).
- Local gate before push (Drew's flow — no PR needed, push `main` directly): `pnpm run test && pnpm run check-types && pnpm run format-and-lint`.

---

### Task 1: Vitest toolchain + config + decorator-metadata canary

**Files:**
- Modify: `apps/scrubjay-discord/package.json` (devDeps only — scripts stay Jest for now)
- Create: `apps/scrubjay-discord/vitest.config.ts`
- Modify: `apps/scrubjay-discord/tsconfig.json` (`types`)
- Create: `apps/scrubjay-discord/src/testing/decorator-metadata.spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `vitest.config.ts` (Task 2 adds a `globalSetup` line to it); a working `pnpm --filter scrubjay-discord exec vitest run <file>` command all later tasks use.

- [ ] **Step 1: Install the Vitest toolchain**

```bash
pnpm --filter scrubjay-discord add -D vitest @vitest/coverage-v8 unplugin-swc
```

Expected: lockfile updates, no peer-dependency errors.

- [ ] **Step 2: Write the canary test (it must fail first)**

Create `apps/scrubjay-discord/src/testing/decorator-metadata.spec.ts`. This is not DI ceremony — it guards the one foreign contract in this migration: that the SWC transform emits `emitDecoratorMetadata`, without which every constructor-injected class under `Test.createTestingModule` silently gets `undefined` deps.

```ts
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

@Injectable()
class Engine {
  start() {
    return "started";
  }
}

@Injectable()
class Car {
  constructor(private readonly engine: Engine) {}

  drive() {
    return this.engine.start();
  }
}

describe("vitest transform", () => {
  it("emits decorator metadata so Nest can constructor-inject", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Car, Engine],
    }).compile();

    expect(moduleRef.get(Car).drive()).toBe("started");
  });
});
```

- [ ] **Step 3: Write vitest.config.ts WITHOUT the swc plugin, run canary, verify it fails**

Create `apps/scrubjay-discord/vitest.config.ts`:

```ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reportsDirectory: "./coverage",
    },
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
```

Run:

```bash
pnpm --filter scrubjay-discord exec vitest run src/testing/decorator-metadata.spec.ts
```

Expected: **FAIL** — esbuild either rejects the decorators or Nest throws (e.g. "Nest can't resolve dependencies of the Car" / `engine` is undefined). This proves the canary detects a missing transform.

- [ ] **Step 4: Add the swc plugin, verify the canary passes**

Edit `vitest.config.ts` to its final Task-1 form:

```ts
import { resolve } from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        transform: {
          decoratorMetadata: true,
          legacyDecorator: true,
        },
      },
      module: {
        type: "es6",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reportsDirectory: "./coverage",
    },
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
```

Run:

```bash
pnpm --filter scrubjay-discord exec vitest run src/testing/decorator-metadata.spec.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Drop `"jest"` from tsconfig types**

In `apps/scrubjay-discord/tsconfig.json` change:

```json
    "types": ["node", "jest"]
```

to:

```json
    "types": ["node"]
```

Note: `pnpm run check-types` will now FAIL on the 22 unported specs (bare `describe`/`jest` globals no longer typed). That is expected and stays red until Task 4 finishes — do not "fix" it by re-adding the types entry.

- [ ] **Step 6: Format and commit**

```bash
pnpm run format-and-lint:fix
git add -A
git commit -m "test: add vitest toolchain with swc decorator-metadata transform"
```

---

### Task 2: Per-worker database infrastructure + first integration spec

**Files:**
- Rewrite: `apps/scrubjay-discord/src/testing/global-setup.ts`
- Delete: `apps/scrubjay-discord/src/testing/global-teardown.ts`
- Modify: `apps/scrubjay-discord/src/testing/db-helpers.ts` (top of file; seed helpers unchanged)
- Modify: `apps/scrubjay-discord/vitest.config.ts` (add `globalSetup`)
- Modify: `apps/scrubjay-discord/src/core/drizzle/migrations.spec.ts` (port to Vitest)

**Interfaces:**
- Consumes: `vitest.config.ts` from Task 1.
- Produces: `createTestDb(): Promise<{ db: DrizzleService; pool: Pool }>` — **now async** (was sync). Env contract: global setup exports `TEST_PG_BASE_URL` (container URI, credentials + the container's default database); workers clone `scrubjay_template` into `test_<VITEST_POOL_ID>`. Tasks 3–4 rely on `await createTestDb()` and the unchanged `truncateAll`/`seed*` helpers.

- [ ] **Step 1: Rewrite global-setup.ts as a merged Vitest setup/teardown**

Replace the entire contents of `apps/scrubjay-discord/src/testing/global-setup.ts`:

```ts
import { join } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { dbUri, TEMPLATE_DB } from "./db-helpers";

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer("postgres:17").start();
  const baseUri = container.getConnectionUri();

  const adminPool = new Pool({ connectionString: baseUri });
  try {
    await adminPool.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await adminPool.end();
  }

  // Same migration path production takes in main.ts, applied to the template.
  const templatePool = new Pool({
    connectionString: dbUri(baseUri, TEMPLATE_DB),
  });
  try {
    await migrate(drizzle(templatePool), {
      migrationsFolder: join(process.cwd(), "src", "drizzle"),
    });
  } finally {
    await templatePool.end();
  }

  // Workers derive per-worker database names from this base URI.
  process.env.TEST_PG_BASE_URL = baseUri;
}

export async function teardown() {
  await container?.stop();
}
```

Notes for the implementer:
- Vitest global setup runs in the main process; env vars set here are inherited by the worker processes it forks. Named `setup`/`teardown` exports are Vitest's supported shape.
- `process.cwd()` is the package root (`apps/scrubjay-discord`) when Vitest runs via the package script — the old file's `__dirname` is not reliable under vite-node's ESM transform.
- The template must have **zero open connections** when workers `CREATE DATABASE … TEMPLATE` from it — that's why both pools close in `finally` here and nothing else ever connects to `scrubjay_template`.

- [ ] **Step 2: Delete the old teardown file**

```bash
git rm apps/scrubjay-discord/src/testing/global-teardown.ts
```

- [ ] **Step 3: Rework db-helpers.ts for per-worker databases**

In `apps/scrubjay-discord/src/testing/db-helpers.ts`, replace the existing `createTestDb` function (and keep every seed/truncate helper below it untouched) with:

```ts
export const TEMPLATE_DB = "scrubjay_template";

const ENSURE_DB_LOCK = 727_001;

export function dbUri(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function ensureWorkerDatabase(baseUri: string, dbName: string) {
  // Serialize CREATE DATABASE calls: concurrent clones of the same template
  // fail in Postgres, and pg advisory locks are session-scoped, so lock and
  // unlock must happen on one dedicated client.
  const pool = new Pool({ connectionString: baseUri, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ENSURE_DB_LOCK]);
    try {
      const existing = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName],
      );
      if (existing.rowCount === 0) {
        await client.query(
          `CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`,
        );
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ENSURE_DB_LOCK]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export async function createTestDb() {
  const baseUri = process.env.TEST_PG_BASE_URL;
  if (!baseUri) {
    throw new Error("TEST_PG_BASE_URL not set — is global-setup configured?");
  }
  const dbName = `test_${process.env.VITEST_POOL_ID ?? "0"}`;
  await ensureWorkerDatabase(baseUri, dbName);

  const pool = new Pool({ connectionString: dbUri(baseUri, dbName) });
  const db = new DrizzleService(drizzle(pool, { schema }));
  return { db, pool };
}
```

Existing imports at the top of the file (`sql`, `drizzle`, `Pool`, `schema`, table imports, `DrizzleService`) stay as they are.

- [ ] **Step 4: Register globalSetup in vitest.config.ts**

In the `test` block of `apps/scrubjay-discord/vitest.config.ts`, add (keys stay alphabetized):

```ts
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reportsDirectory: "./coverage",
    },
    environment: "node",
    globalSetup: ["src/testing/global-setup.ts"],
    include: ["src/**/*.spec.ts"],
  },
```

- [ ] **Step 5: Port migrations.spec.ts as the proving spec**

Replace the first six lines of `apps/scrubjay-discord/src/core/drizzle/migrations.spec.ts` so the file starts:

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/testing/db-helpers";

describe("migrations", () => {
  it("creates the expected tables", async () => {
    const { db, pool } = await createTestDb();
```

The rest of the file (the `try`/`finally` with table assertions) is unchanged.

- [ ] **Step 6: Run the ported spec, verify the whole chain works**

```bash
pnpm --filter scrubjay-discord exec vitest run src/core/drizzle/migrations.spec.ts
```

Expected: PASS. First run pulls/starts the `postgres:17` container (slow once), migrates the template, clones `test_1`, and the table-inventory assertions pass.

- [ ] **Step 7: Format and commit**

```bash
pnpm run format-and-lint:fix
git add -A
git commit -m "test: per-worker template databases for vitest integration suite"
```

---

### Task 3: Port the five hand-check specs (mock types + fake timers)

**Files (Modify):**
- `apps/scrubjay-discord/src/discord/common/filters/command-exception.filter.spec.ts`
- `apps/scrubjay-discord/src/features/ingest/ebird.fetcher.spec.ts`
- `apps/scrubjay-discord/src/features/jobs/ingest.job.spec.ts`
- `apps/scrubjay-discord/src/features/jobs/dispatch.job.spec.ts`
- `apps/scrubjay-discord/src/features/jobs/bootstrap.service.spec.ts`

**Interfaces:**
- Consumes: Task 1's config (these are unit specs — no DB).
- Produces: nothing later tasks call; these five are simply excluded from Task 4's mechanical sweep.

These five are the only specs using `jest.SpyInstance` (4×), `jest.Mock` casts (4×), or fake timers — the places where Jest and Vitest APIs genuinely differ, so they're ported by hand, not sed.

- [ ] **Step 1: Apply the rewrite rules to all five files**

Rules, with before/after taken from the actual code:

1. **Runtime calls** — `jest.fn` → `vi.fn`, `jest.spyOn` → `vi.spyOn`, `jest.clearAllMocks` → `vi.clearAllMocks`, `jest.restoreAllMocks` → `vi.restoreAllMocks`, `jest.resetAllMocks` → `vi.resetAllMocks`, `jest.useFakeTimers` → `vi.useFakeTimers`, `jest.useRealTimers` → `vi.useRealTimers`, `jest.advanceTimersByTime` → `vi.advanceTimersByTime`. (Vitest's sync `advanceTimersByTime` matches Jest's semantics; only switch to `advanceTimersByTimeAsync` if a test provably hangs.)

2. **Spy type** — `let loggerErrorSpy: jest.SpyInstance;` → `let loggerErrorSpy: MockInstance;` with `MockInstance` imported (type-only) from vitest.

3. **Mock casts** — `(interaction.reply as jest.Mock)` → `(interaction.reply as Mock)`; same for `editReply`, `configServiceMock.get`, `global.fetch`. Vitest's bare `Mock` defaults its generic to any function, so no type args needed.

4. **Bare `.mockImplementation()`** — Vitest's TS signature requires an argument: `.mockImplementation()` → `.mockImplementation(() => {})`. (Occurs on the logger spies, e.g. `command-exception.filter.spec.ts:26`.)

5. **Imports** — one vitest import per file listing exactly the names used. Example, `command-exception.filter.spec.ts`:

```ts
import type { ArgumentsHost } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from "vitest";
import { UserFacingError } from "../errors/user-facing.error";
import { CommandExceptionFilter } from "./command-exception.filter";
```

To find which names each file needs:

```bash
grep -oE '\b(describe|it|test|expect|beforeAll|beforeEach|afterAll|afterEach)\b' <file> | sort -u
```

plus `vi` if any `jest.` call was rewritten, plus `Mock`/`MockInstance` per rules 2–3.

- [ ] **Step 2: Run the five specs, verify they pass**

```bash
pnpm --filter scrubjay-discord exec vitest run \
  src/discord/common/filters/command-exception.filter.spec.ts \
  src/features/ingest/ebird.fetcher.spec.ts \
  src/features/jobs/ingest.job.spec.ts \
  src/features/jobs/dispatch.job.spec.ts \
  src/features/jobs/bootstrap.service.spec.ts
```

Expected: PASS (all 5 files). Pay attention to `bootstrap.service.spec.ts` — it's the fake-timers file; if a timer test times out, apply the `advanceTimersByTimeAsync` fallback from rule 1 and re-run.

- [ ] **Step 3: Verify no jest references remain in these files**

```bash
grep -n "jest\." \
  apps/scrubjay-discord/src/discord/common/filters/command-exception.filter.spec.ts \
  apps/scrubjay-discord/src/features/ingest/ebird.fetcher.spec.ts \
  apps/scrubjay-discord/src/features/jobs/ingest.job.spec.ts \
  apps/scrubjay-discord/src/features/jobs/dispatch.job.spec.ts \
  apps/scrubjay-discord/src/features/jobs/bootstrap.service.spec.ts
```

Expected: no output.

- [ ] **Step 4: Format and commit**

```bash
pnpm run format-and-lint:fix
git add -A
git commit -m "test: port mock-type and fake-timer specs to vitest"
```

---

### Task 4: Port the remaining 16 specs; delete the DI-ceremony spec

**Files:**
- Delete: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.module.spec.ts`
- Modify (16 files):
  - `src/discord/necord.config.spec.ts`
  - `src/discord/message-sender.service.spec.ts`
  - `src/core/config/config.schema.spec.ts`
  - `src/features/filters/filters.reactions.spec.ts`
  - `src/features/filters/filters.repository.spec.ts` †
  - `src/features/dispatch/dispatch.service.spec.ts`
  - `src/features/dispatch/alert-queue.service.spec.ts` †
  - `src/features/dispatch/ebird-alert.formatter.spec.ts`
  - `src/features/dispatch/alert-queue.repository.spec.ts` †
  - `src/features/ingest/observation.repository.spec.ts` †
  - `src/features/ingest/ebird.transformer.spec.ts`
  - `src/features/ingest/ingest.service.spec.ts`
  - `src/features/subscriptions/subscriptions.service.spec.ts`
  - `src/features/subscriptions/subscriptions.repository.spec.ts`
  - `src/features/subscriptions/subscription-list.view.spec.ts`
  - `src/features/subscriptions/subscriptions.commands.spec.ts`

  († = integration spec calling `createTestDb`)

**Interfaces:**
- Consumes: `await createTestDb()` (async, Task 2), unchanged `truncateAll`/`seed*` helpers.
- Produces: a fully green `vitest run` over `src/**/*.spec.ts` — the state Task 5's script swap depends on.

- [ ] **Step 1: Delete the DI-ceremony spec**

```bash
git rm apps/scrubjay-discord/src/features/subscriptions/subscriptions.module.spec.ts
```

(Long-identified dead weight — it asserts only that Nest resolves providers.)

- [ ] **Step 2: Mechanical jest→vi rewrite across the 16 files**

From `apps/scrubjay-discord`:

```bash
cd apps/scrubjay-discord
perl -pi -e 's/\bjest\.(fn|spyOn|clearAllMocks|resetAllMocks|restoreAllMocks|useFakeTimers|useRealTimers|advanceTimersByTime)\b/vi.$1/g; s/\.mockImplementation\(\)/.mockImplementation(() => {})/g' \
  src/discord/necord.config.spec.ts \
  src/discord/message-sender.service.spec.ts \
  src/core/config/config.schema.spec.ts \
  src/features/filters/filters.reactions.spec.ts \
  src/features/filters/filters.repository.spec.ts \
  src/features/dispatch/dispatch.service.spec.ts \
  src/features/dispatch/alert-queue.service.spec.ts \
  src/features/dispatch/ebird-alert.formatter.spec.ts \
  src/features/dispatch/alert-queue.repository.spec.ts \
  src/features/ingest/observation.repository.spec.ts \
  src/features/ingest/ebird.transformer.spec.ts \
  src/features/ingest/ingest.service.spec.ts \
  src/features/subscriptions/subscriptions.service.spec.ts \
  src/features/subscriptions/subscriptions.repository.spec.ts \
  src/features/subscriptions/subscription-list.view.spec.ts \
  src/features/subscriptions/subscriptions.commands.spec.ts
cd ../..
```

- [ ] **Step 3: Add explicit vitest imports to each of the 16 files**

For each file, determine used names and add one import:

```bash
grep -oE '\b(describe|it|test|expect|beforeAll|beforeEach|afterAll|afterEach)\b' <file> | sort -u
```

Add at the top (biome will sort its position):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

— trimmed/extended to exactly the names that grep (plus any `vi.` usage) shows for that file. No `Mock`/`MockInstance` should be needed in these 16; if one turns up, apply Task 3 rule 3.

- [ ] **Step 4: Await the async createTestDb in the four † integration specs**

In `filters.repository.spec.ts`, `alert-queue.service.spec.ts`, `alert-queue.repository.spec.ts`, `observation.repository.spec.ts`, the `beforeAll` currently does:

```ts
    ({ db, pool } = createTestDb());
```

change to:

```ts
    ({ db, pool } = await createTestDb());
```

(The enclosing `beforeAll(async () => …)` callbacks are already async; if one isn't, make it `async`.)

- [ ] **Step 5: Verify zero jest references remain anywhere**

```bash
grep -rn "jest\." apps/scrubjay-discord/src --include="*.ts"
```

Expected: no output.

- [ ] **Step 6: Run the FULL suite under Vitest**

```bash
pnpm --filter scrubjay-discord exec vitest run
```

Expected: all 23 spec files (22 ported + the Task 1 canary) PASS, running on multiple workers (Vitest's default parallelism — you'll see several files running concurrently, unlike Jest's old `maxWorkers: 1`). Give special attention to the two specs most likely to surface template-database quirks: `alert-queue.repository.spec.ts` (EXPLAIN-based index assertion — plans must behave the same in a cloned database) and `migrations.spec.ts` (table inventory).

- [ ] **Step 7: Type-check now passes again**

```bash
pnpm run check-types
```

Expected: PASS — the red state introduced in Task 1 Step 5 is resolved because no spec references Jest globals anymore.

- [ ] **Step 8: Format and commit**

```bash
pnpm run format-and-lint:fix
git add -A
git commit -m "test: port remaining specs to vitest; drop DI-ceremony module spec"
```

---

### Task 5: Scripts, Jest removal, dep cleanup, changeset, final gate

**Files:**
- Modify: `apps/scrubjay-discord/package.json` (scripts, remove `jest` block, remove devDeps)
- Create: `.changeset/<generated-name>.md`

**Interfaces:**
- Consumes: green full suite from Task 4.
- Produces: final state — `pnpm run test` at root runs Vitest via turbo; Jest is uninstallable history.

- [ ] **Step 1: Swap the test scripts and delete the broken e2e script**

In `apps/scrubjay-discord/package.json`, replace the five test scripts:

```json
    "test": "vitest run",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --no-file-parallelism",
    "test:watch": "vitest"
```

(`test:e2e` is deleted outright — it pointed at a config file that never existed; this closes B11's last half from `docs/architecture-improvements.md`.)

- [ ] **Step 2: Delete the entire `"jest"` block from package.json**

Remove the whole object — `collectCoverageFrom` through `transform` (currently lines 44–66). Its replacements all live in `vitest.config.ts`.

- [ ] **Step 3: Remove Jest-era devDependencies**

```bash
pnpm --filter scrubjay-discord remove jest ts-jest @types/jest ts-node tsconfig-paths source-map-support supertest @types/supertest
```

Rationale: a grep confirmed no source file references any of these; `ts-node`/`tsconfig-paths`/`source-map-support` existed only for the old `test:debug` script, and `supertest` had no e2e suite to serve. `drizzle-kit` and `@nestjs/cli` bundle their own TS loaders — verified by the next step, and if `nest build` or `drizzle-kit` complains about a missing loader, re-add only the specific package it names.

- [ ] **Step 4: Full local gate**

```bash
pnpm install
pnpm run build
pnpm run check-types
pnpm run test
pnpm run format-and-lint
```

Expected: every command exits 0. `pnpm run test` runs turbo → `vitest run`, all files pass in parallel.

- [ ] **Step 5: Add a changeset**

Create `.changeset/vitest-migration.md`:

```md
---
"scrubjay-discord": patch
---

Migrate the test suite from Jest to Vitest: swc-based decorator-metadata transform, per-worker template databases for parallel integration tests, explicit vitest imports, Jest toolchain removed.
```

- [ ] **Step 6: Commit and push (Drew's flow: local gate above is the merge gate; push main directly, no PR)**

```bash
git add -A
git commit -m "build: replace jest with vitest"
git push origin main
```

Then watch the Status Checks workflow on the push:

```bash
gh run watch $(gh run list --workflow=status-checks.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: CI green (`pnpm run check-types` + `pnpm run test` both pass on ubuntu-latest — testcontainers works on GitHub-hosted runners' Docker daemon, same as the Jest suite did).
