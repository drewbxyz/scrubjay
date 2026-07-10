# Jest → Vitest Migration — Design

_2026-07-09. Motivation: NestJS 12 will ship Vitest out of the box; migrate now so the
upgrade lands on an already-Vitest codebase. Secondary wins: faster test runs via
per-worker databases, and two test-related crumbs from `architecture-improvements.md`
swept along the way._

## Decisions (settled in brainstorming)

1. **Per-worker databases** — the integration suite goes parallel instead of porting
   `maxWorkers: 1` as `fileParallelism: false`.
2. **Explicit imports** — `import { describe, it, expect, vi } from "vitest"` in every
   spec; no `globals: true`, no tsconfig types shim.
3. **One PR, with crumbs** — full cut-over (Jest deps deleted, CI green) in a single
   branch; the broken `test:e2e` script and the DI-ceremony
   `subscriptions.module.spec.ts` are deleted rather than ported.
4. **`unplugin-swc` transform** — Vitest's default esbuild transform cannot emit
   decorator metadata, which Nest DI needs. SWC via `unplugin-swc` is the approach
   NestJS's own Vitest recipe uses (best bet for matching Nest 12), and `@swc/core` is
   already a dependency.

## Scope

Only `apps/scrubjay-discord` has tests: 23 co-located `*.spec.ts` files under `src/`,
Jest 29 + ts-jest, config inline in `package.json`. `apps/test-api` has no tests and is
untouched. Jest API usage is mechanical: `jest.fn` ×58, `jest.spyOn` ×18, mock-reset
calls, `jest.SpyInstance`/`jest.Mock` types, fake timers in 2 files, no `@jest/globals`
imports. Three specs use `Test.createTestingModule`.

## 1. Tooling & config

- New `apps/scrubjay-discord/vitest.config.ts`; the `jest` block leaves `package.json`.
- Plugins: `unplugin-swc` (Vite flavor) with `jsc.transform.legacyDecorator` +
  `decoratorMetadata` enabled and ES module output — the Nest-documented setup.
- `resolve.alias`: `"@" → ./src` (replaces the `^@/(.*)$` moduleNameMapper).
- `test.include`: `src/**/*.spec.ts`; `test.environment`: `node`;
  `test.globalSetup`: the merged setup file (see §2).
- Coverage: `@vitest/coverage-v8`, replacing Jest's babel-based collection. Keep the
  current behavior of no thresholds.
- devDeps added: `vitest`, `unplugin-swc`, `@vitest/coverage-v8`.
- devDeps removed: `jest`, `ts-jest`. Also remove `ts-node`, `tsconfig-paths`,
  `source-map-support`, and `supertest` **iff** a usage grep confirms nothing outside
  the Jest scripts uses them (drizzle-kit and the Nest CLI bundle their own loaders;
  verify before deleting).

## 2. Per-worker databases (the one real design change)

Current shape: `globalSetup` starts one testcontainers Postgres 17, migrates one shared
database, exports `TEST_DATABASE_URL`; every spec file truncates the shared tables, so
Jest runs with `maxWorkers: 1`.

New shape:

- **Global setup** (single Vitest-style file returning a teardown closure, replacing the
  `global-setup.ts`/`global-teardown.ts` pair): start one Postgres 17 container, create
  and migrate a **template database** `scrubjay_template` (same `migrate()` call
  production uses in `main.ts`), close all connections to it, and export the base
  connection URI (host/port/credentials, no database path) as `TEST_PG_BASE_URL` —
  replacing today's `TEST_DATABASE_URL`, which pointed at one shared database.
- **`createTestDb()`** (in `testing/db-helpers.ts`): derive the database name from
  `VITEST_POOL_ID` → `test_<id>`; if it doesn't exist, run
  `CREATE DATABASE test_<id> TEMPLATE scrubjay_template`. Guard creation with
  `pg_advisory_lock` (or a bounded retry loop) — concurrent `CREATE DATABASE` calls
  copying the same template can conflict in Postgres.
- Spec files keep the existing truncate-per-test pattern unchanged. Files within one
  worker run sequentially against that worker's database, so test semantics are
  identical to today — just partitioned per worker. `fileParallelism` stays on
  (Vitest's default).
- Teardown: stop the container (dropping per-worker DBs individually is unnecessary —
  they die with it).

## 3. Spec codemod

22 files ported; `subscriptions.module.spec.ts` deleted (long-identified DI-ceremony
spec — it asserts only that Nest resolves providers).

Per file:

- Add explicit `import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest"` — only the names the file uses.
- Rewrite runtime API: `jest.fn` → `vi.fn`, `jest.spyOn` → `vi.spyOn`,
  `jest.clearAllMocks`/`resetAllMocks`/`restoreAllMocks` → `vi.*`,
  `jest.useFakeTimers`/`advanceTimersByTime`/`useRealTimers` → `vi.*`.
- Rewrite types: `jest.SpyInstance` → `MockInstance`, `jest.Mock` → `Mock` (both
  imported from `vitest`). **Hand-check, don't sed:** Vitest's generics differ —
  `Mock<(args) => ret>` takes a single function type where Jest took
  `<ret, args>` pairs. Four `jest.Mock` casts and four `jest.SpyInstance` annotations
  are affected.
- `Test.createTestingModule` specs (3 files) need no changes beyond the above — they
  work under Vitest once decorator metadata is emitted (§1).

## 4. Scripts, CI, crumbs

`apps/scrubjay-discord/package.json` scripts:

| Script | Before | After |
|---|---|---|
| `test` | `jest` | `vitest run` |
| `test:watch` | `jest --watch` | `vitest` |
| `test:cov` | `jest --coverage` | `vitest run --coverage` |
| `test:debug` | `node --inspect-brk … jest --runInBand` | `vitest --inspect-brk --no-file-parallelism` |
| `test:e2e` | `jest --config ./test/jest-e2e.json` (config doesn't exist) | **deleted** (closes B11's last half) |

`turbo.json` and `.github/workflows/status-checks.yml` are unchanged — both just invoke
`pnpm run test`.

## 5. Verification

- Full suite green locally, with multi-worker parallelism confirmed (worker count > 1
  observed, per-worker `test_<id>` databases created).
- Specific eyeballs on the two specs most likely to surface template-database quirks:
  the EXPLAIN-based index regression test (`alert-queue.repository.spec.ts`) and
  `migrations.spec.ts`.
- CI green on the PR.

## Out of scope

- `apps/test-api` (no tests).
- Enabling turbo caching for the `test` task (stays `cache: false`).
- The Nest 12 upgrade itself. When Nest 12 ships, reconcile `vitest.config.ts` against
  whatever its CLI scaffolds; nothing here should conflict.
