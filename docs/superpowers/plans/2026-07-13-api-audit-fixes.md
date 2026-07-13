# API Audit Fixes — NestJS Best-Practices Batch

Fix all actionable findings from the 2026-07-13 NestJS best-practices audit of the operator REST API, on branch `feat/management-portal-api`, before PR #78 merges. Base commit: `cfec90e`.

Findings addressed: Important #2 (POST status honesty), #3 (fail-closed guard); Minor #4 (channelId validation), #5 (route reshape), #6 (listGuilds resilience), #7 (deliveries ordering), #8 (401-envelope e2e); Nitpick #9 (headersSent), #10 (500 log context), #11 (bootstrap catch), #12 (API_PREFIX constant), #13 (dead @Injectable), #14 (PATCH returns row); Info #1 (CORS decision comment). Explicitly out of scope: helmet/throttler (#15), pagination redesign (#16), OpenAPI generation (#17 — portal-phase work).

## Global Constraints

- Branch `feat/management-portal-api`; one commit per task, conventional-commit message; do NOT push (controller pushes after final review).
- Error envelope for every `/api/` error response: `{ error: { code, message, details? } }`, produced by `ApiExceptionFilter`.
- `packages/api-contracts` is ESM zod v4; the bot is CJS. Dual zod instances exist — across the package boundary use only structural APIs (`.parse`, `.safeParse`, `.shape`, `z.treeifyError`); NEVER `instanceof` zod classes; no top-level await in the contracts package.
- Biome with alphabetized object keys. Format/lint ONLY the files you changed: `pnpm biome check --write <paths>`. Never run repo-wide formatters.
- Tests are vitest; repository tests use the testcontainers helpers in `apps/scrubjay-discord/src/testing/db-helpers.ts` (`createTestDb`, `truncateAll`, seed helpers). Run focused test files while iterating (`pnpm --filter scrubjay-discord exec vitest run <file>`); before committing run the affected package suites (`pnpm --filter scrubjay-discord test`, and `pnpm --filter @scrubjay/api-contracts test` if contracts changed) plus `pnpm check-types` at the repo root.
- TDD for every behavior change: write the failing test first, show RED, then implement.
- Wire-shape tests round-trip through `JSON.parse(JSON.stringify(value))` before `schema.parse(...)` (Dates serialize to ISO strings on the wire).
- Controller unit specs call handler methods directly, so `@Param`/`@Query`/`@Body` pipes do NOT run in them — pipe behavior is verified via contract tests or e2e specs.
- Do not add changesets (the existing changeset for this PR covers the whole feature; `@scrubjay/api-contracts` is in the changeset ignore list).
- Do not modify Discord slash-command feature behavior (`src/features/**` logic changes only where a task explicitly says so).
- The existing e2e harness pattern (`api-exception.filter.e2e.spec.ts`) uses `Test.createTestingModule` + `app.listen(0)` + native `fetch` — no supertest. Follow it for any new e2e coverage.

## Task 1: Reshape subscription mutation routes under channels/:channelId

**Finding #5 (route consistency) + Info #1 (CORS decision comment).**

Filters live at `api/v1/channels/:channelId/filters`, but subscription mutations are flat with `channelId` smuggled in body/query. No consumers exist yet, so reshape now:

- `GET /api/v1/subscriptions?channelId=…&stateCode=…` — UNCHANGED (cross-channel list).
- `POST /api/v1/channels/:channelId/subscriptions` body `{ regionCode }` → `{ created: boolean }`.
- `PATCH /api/v1/channels/:channelId/subscriptions` body `{ active, countyCode, stateCode }` → existing update response.
- `DELETE /api/v1/channels/:channelId/subscriptions?countyCode=…&stateCode=…` → existing delete response.

Implementation notes:

- Keep a single `SubscriptionsController` class: change `@Controller("api/v1/subscriptions")` to `@Controller("api/v1")` and put full sub-paths on the method decorators (`@Get("subscriptions")`, `@Post("channels/:channelId/subscriptions")`, etc.). Class-level `@UseFilters`/`@UseGuards` stay.
- `channelId` comes from `@Param("channelId")` (plain string for now — Task 4 adds validation; match the current `FiltersController` param style).
- Contracts (`packages/api-contracts/src/subscriptions.ts`):
  - `createSubscriptionBodySchema` drops `channelId` → `{ regionCode }` only.
  - `updateSubscriptionBodySchema` drops `channelId` → `{ active, countyCode, stateCode }`.
  - The DELETE query schema drops `channelId` → `{ countyCode, stateCode }` (rename to reflect it's a region key if that reads better; update the exported types).
  - Add a doc comment explaining the round-trip: create takes an eBird `regionCode`; the list returns the split key `(stateCode, countyCode)` with `countyCode: "*"` for statewide; PATCH/DELETE address by that split key.
- The controller reassembles the full composite key (channelId + stateCode + countyCode) for `repo.setSubscriptionActive` and computes the region code for `service.unsubscribe` exactly as today (`regionCodeOf`). Repository/service signatures do NOT change.
- The `isPostableChannel` precondition on create now checks the path param instead of the body field.
- CORS comment: in `apps/scrubjay-discord/src/main.ts`, immediately above `NestFactory.create(...)`, add a short comment recording the deliberate absence of CORS config: the operator API is called server-to-server only (portal server functions over the internal Docker network); browsers never call it directly, so no CORS headers are needed.
- Update `subscriptions.controller.spec.ts` (handler signatures change: channelId becomes a separate argument), contracts specs, and the drift spec if it references the changed schemas.

Acceptance:
- All four routes behave as specified; contracts package exports the new shapes; both package suites and `pnpm check-types` pass.
- Controller spec covers: create rejects non-postable channel before calling subscribe (channelId from param), PATCH 404 on missing key, DELETE statewide vs county region resolution — all updated to the new signatures.

## Task 2: Honest POST status codes and PATCH returning the updated row

**Finding #2 (Important) + #14 (Info).**

Nest defaults POST to 201. A duplicate subscribe currently returns `201 { created: false }`, and a duplicate filter-add returns `201 { added: true }` even though `onConflictDoNothing` inserted nothing.

- Add `@HttpCode(HttpStatus.OK)` to `SubscriptionsController.create` and the filter-add handler in `FiltersController` — these are idempotent "ensure" endpoints; 200 + an honest flag is the chosen semantic.
- `FiltersController` add: use the rows already returned by the repository's `.returning()` (`addChannelFilter`) to respond `{ added: rows.length > 0 }`. Update the response schema in `packages/api-contracts/src/filters.ts` to `{ added: boolean }` (if it currently hardcodes/implies `true`). Do NOT change repository behavior — `onConflictDoNothing().returning()` already yields `[]` on conflict.
- `SubscriptionsController.update` (PATCH): return the updated subscription row instead of `{ updated: true }`. `setSubscriptionActive` already uses `.returning()` — surface that row through the repository return value if it currently returns only a boolean (adjust the repository method to return the row or undefined; keep the 404-on-missing behavior). Response shape: `{ subscription: <same wire shape as one element of the list response> }` — reuse the existing subscription wire schema in contracts; update `updateSubscriptionResponseSchema` accordingly.
- e2e status-code proof (unit specs can't see `@HttpCode`): add a small e2e spec (or extend the existing harness pattern) mounting `SubscriptionsController` and `FiltersController` with faked service/repository providers; assert POST duplicate-subscribe → HTTP 200 `{ created: false }`, POST duplicate filter-add → HTTP 200 `{ added: false }`, and fresh create → 200 `{ created: true }`.
- Update controller specs, contract specs, and the drift spec for the new PATCH response.

Acceptance: e2e proves 200 (not 201) with honest flags; PATCH returns the row; suites + check-types pass.

## Task 3: Fail-closed global guard, API_PREFIX constant, 401-envelope e2e

**Finding #3 (Important) + #12 (Info) + #8 (Minor).**

The exception filter is registered as a global `APP_FILTER` inside `ApiModule` so nothing under `/api/` escapes the envelope, but auth relies on each controller remembering `@UseGuards(ApiTokenGuard)`. A future controller without the decorator ships unauthenticated.

- Create `apps/scrubjay-discord/src/api/api.constants.ts` exporting `API_PREFIX = "api/v1"` (and, if helpful, `API_PATH_PREFIX = "/api/"` for predicates). All five controllers derive their `@Controller` paths from it (template literals); `ApiExceptionFilter`'s path predicate derives from it too.
- Register `{ provide: APP_GUARD, useClass: ApiTokenGuard }` in `ApiModule`'s providers (mirroring the existing `APP_FILTER` pattern). Inside `ApiTokenGuard.canActivate`, early-return `true` when `(request.originalUrl ?? request.url)` does NOT start with `/api/` — `/health` and any future non-API routes stay open. Keep the per-controller `@UseGuards(ApiTokenGuard)` decorators as defense-in-depth (mirrors the deliberate dual registration of the filter).
- Extend `api-exception.filter.e2e.spec.ts` (same harness, real APP_GUARD + APP_FILTER wiring as `ApiModule`): unauthenticated request to a guarded `/api/v1/...` route → HTTP 401 with body parsing against the error envelope (`code: "UNAUTHORIZED"`); request with the correct bearer token → 200; `/health`-style non-API route → reachable without a token.
- Update `api-token.guard.spec.ts` for the new non-API early-return branch.

Acceptance: a controller with no `@UseGuards` mounted in the e2e app is still guarded (that IS the e2e assertion — use a probe controller without the decorator); non-API paths bypass; envelope verified; suites + check-types pass.

## Task 4: Validate channelId as a Discord snowflake everywhere it crosses the wire

**Finding #4 (Minor).**

`FiltersController` takes `@Param("channelId")` with no pipe while the regions controller validates its param; bogus ids flow to SQL (parameterized — safe, but a junk id yields an empty 200 instead of a 400).

- Add to `packages/api-contracts/src/common.ts`: `channelIdSchema = z.string().regex(/^\d{17,20}$/)` with a doc comment ("Discord snowflake id"). Export it (and a `ChannelId` type if idiomatic there).
- Apply `new ZodValidationPipe(channelIdSchema)` to every `@Param("channelId")`: the three `FiltersController` handlers and the `channels/:channelId/subscriptions` routes from Task 1.
- Use `channelIdSchema` (`.optional()` where the field is an optional filter) in place of bare `z.string()`/`min(1)` for: `listSubscriptionsQuerySchema.channelId`, the deliveries list query `channelId` filter in `packages/api-contracts/src/deliveries.ts`, and any other wire-level channelId fields in contracts.
- Contract specs: valid snowflake accepted; `"CH1"`, empty string, 16-digit and 21-digit strings rejected.
- Controller unit specs call handlers directly (pipes don't run) — existing `"CH1"` fixtures in controller/repository specs stay as-is; only contract-level specs and any e2e requests need real-shaped ids (e.g. `"123456789012345678"`).

Acceptance: every wire-crossing channelId validates against the snowflake schema; contract specs cover accept/reject; suites + check-types pass.

## Task 5: Make listGuilds resilient to per-guild Discord failures and fetch in parallel

**Finding #6 (Minor).**

`GuildsService.listGuilds` calls `guild.channels.fetch()` serially per guild with no error handling — one flaky guild fetch fails the whole endpoint as an opaque 500, unlike `isPostableChannel`, which already catches `DiscordAPIError`.

- Wrap the per-guild channel fetch: on `DiscordAPIError`, log a warning (`Logger` from `@nestjs/common`, named for the service) including the guild id, and include the guild in the response with `channels: []`. Non-`DiscordAPIError` errors still propagate (matches the `isPostableChannel` idiom).
- Fetch all guilds' channels concurrently with `Promise.all` over `this.client.guilds.cache.values()`; keep the final alphabetical sorts (channels within guild, guilds by name).
- `guilds.service.spec.ts`: one guild whose `channels.fetch` rejects with a `DiscordAPIError` appears with empty channels while a healthy guild's channels are intact; a non-Discord error rejects the whole call.

Acceptance: TDD evidence for both new behaviors; suites + check-types pass.

## Task 6: Make deliveries NULLS FIRST ordering explicit and tested

**Finding #7 (Minor).**

`listDeliveries` orders by `desc(deliveries.sentAt)`; Postgres `DESC` defaults to `NULLS FIRST`, so failed/suppressed rows with `sentAt: null` sort ahead — desirable for ops, but implicit, untested, load-bearing pagination behavior.

- In `apps/scrubjay-discord/src/api/ops.repository.ts`, make the ordering explicit with drizzle's `sql` template (e.g. ``sql`${deliveries.sentAt} DESC NULLS FIRST` ``) and a one-line comment stating the intent: unsent problem rows surface first.
- Keep the existing stable tie-breaker ordering that follows it.
- `ops.repository.spec.ts` (testcontainers): seed a `sentAt: null` delivery (e.g. `status: "failed"`) alongside sent rows; assert the null-sentAt row is first and that limit/offset pagination across the boundary neither duplicates nor drops rows.

Acceptance: explicit ordering with test proof against real Postgres; suites + check-types pass.

## Task 7: Exception-filter and bootstrap hardening nitpicks

**Findings #9, #10, #11, #13 (Nitpicks).**

- `api-exception.filter.ts`: at the top of `catch()`, if `response.headersSent`, delegate to `super.catch(exception, host)` and return — insurance against double-send if streaming ever appears.
- Same file: the unknown-error 500 log currently logs only the exception. Change to `this.logger.error(`${request.method} ${path}`, exception instanceof Error ? exception.stack : String(exception))` so the line is self-sufficient (OTel correlation still applies; do NOT add any other per-request logging).
- `apps/scrubjay-discord/src/main.ts`: replace the floating `bootstrap()` call with `bootstrap().catch((err) => { console.error(err); process.exit(1); });`.
- `zod-validation.pipe.ts`: remove the dead `@Injectable()` decorator (and the then-unused import) — the pipe is always constructed with `new`, never DI-resolved.
- Extend the filter unit spec: headersSent path delegates to base (spy on `super.catch` via prototype or assert no envelope write), and the 500 log call receives `"<METHOD> <path>"` as the message.

Acceptance: filter spec covers both new behaviors; no behavior change anywhere else; suites + check-types pass.
