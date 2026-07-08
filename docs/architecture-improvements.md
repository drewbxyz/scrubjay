# ScrubJay — Architecture Improvement Opportunities

_Compiled 2026-07-06 from a full read of the codebase (~3.5k lines of app source) plus
research into Necord's documented conventions. Every "dead code" claim below was
verified by grep; every code excerpt is verbatim from the tree at commit `e29ccbb`._

> **Status update — 2026-07-07.** PR #61 (`refactor: delete RSS feature, put dispatch
> behind AlertQueue`) landed §3 and §9 in one move: dispatch now lives behind
> `features/dispatch/` (an `AlertQueue`-shaped module), `deliveries/` is gone, and RSS was
> deleted outright rather than finished or declared ops-managed. That also incidentally
> resolved §5 (no more dispatcher map — there's one dispatch path now) and several of the
> RSS-specific bugs (B2's RSS half, B9 is unrelated and still open). File paths in §3, §5,
> and §9 below are now stale; the rest of the document (§2 bugs, §4 remainder, §6, §7, §8,
> §10, §11) was re-verified against the current tree and is still accurate as written.
> Per-item status is called out inline below.

> **Status update — 2026-07-07 (evening), PR #62.** The `apps/test-api` half of §8 is
> done: dead root-level data files, the RSS mock surface (~630 lines, mocking the
> feature #61 deleted), 6 of 7 mock eBird endpoints (the bot calls only
> `recent/notable`), the unused `moment` and `tsup` deps, and the dead `getApiKeys`
> export are all deleted; the test-api README was rewritten (it documented the wrong
> auth header). Two findings from that pass are folded in below: the
> `features/dispatch/__tests__/` suite **is** the real-Postgres integration suite §11
> asked for (see §3/§11), and `DiscordHelper` is even deader post-#61 (see §7c). Also
> fixed on that branch: `pnpm-workspace.yaml`'s `allowBuilds` had unfilled
> "set this to true or false" placeholders (introduced in `29eb15b`), which made
> `pnpm install` hard-fail on pnpm 11 — the first PR to run CI after that commit caught it.

## Vocabulary used in this document

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Deep / shallow** — a module is *deep* when a small interface hides a lot of behaviour;
  *shallow* when the interface is nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place.
- **Locality** — change, bugs, and knowledge concentrated in one place.
- **Deletion test** — imagine deleting the module. If complexity vanishes, it was a
  pass-through. If complexity reappears across N callers, it was earning its keep.

---

## 1. The system in one picture

ScrubJay is **two pipelines that never call each other**. They communicate only through
Postgres, on independent cron schedules:

```
INGEST (cron)                                DISPATCH (cron */1)
─────────────                                ──────────────────
eBird API ─▶ fetcher ─▶ transformer ─▶ DB    DB ─▶ 5-table join ─▶ group ─▶ embed ─▶ Discord
RSS feeds ─▶ fetcher ─▶ transformer ─▶ DB    DB ─▶ 4-table join ─▶ embed ─▶ Discord
   (*/15 ebird, */5 rss)                                └─▶ deliveries table (dedup)
```

Nothing in the code makes this contract explicit. The *actual* interface between the two
halves is the pair of SQL joins in `dispatcher.repository.ts` — subscription matching,
species filtering, and "already sent" dedup all live there and only there. To answer
"will this observation be posted?" you must simultaneously hold the ingest write shape,
the schema, and the join predicates in your head.

That is the root cause of the "hard to understand" feeling: **the one deep, load-bearing
module in the codebase (the dispatch query) is unnamed and untested, while the module
structure — services, transformers, routers, maps — suggests the logic lives everywhere
else.** Most of the surrounding modules fail the deletion test.

The opportunities below are ordered by how much they change understandability, not by
effort. A suggested sequencing is at the end.

---

## 2. Latent bugs found during exploration

These are not refactors — they are defects that exploration surfaced. Worth fixing
before or alongside any cleanup, and several are one-liners.

_Re-verified 2026-07-07 against current tree. Status column added; unmarked = still open
exactly as described._

| # | Bug | Where | Effect | Status |
|---|-----|-------|--------|--------|
| B1 | `isChannelFilterable` never `await`s its query — `return !!channelMeta` wraps a **Promise**, which is always truthy | `filters/filters.repository.ts:13-19` | The "is this an eBird channel" guard always passes. Combined with B2, a 👎 on any embed in any channel adds a filter row. | **Open** — confirmed still missing `await` at `filters.repository.ts:14`. |
| B2 | Species is parsed from the embed title (`title.split(" - ")[0]`), but RSS embeds set the title to the *source name* | `filters/handlers/filters-add.handler.ts` vs `rss-dispatcher.service.ts:27` | Three 👎 reactions on an RSS post silently insert the RSS source's name into `filtered_species`. Species names containing `" - "` also break. | **Partially resolved** — RSS is deleted (PR #61), so the RSS half of this bug can't occur anymore. The underlying fragility (parsing species from title text instead of a stable id) is still present in `filters-add.handler.ts:20`. |
| B3 | `upsertLocation`'s insert path maps eBird names → DB columns (`subnational2Name`→`county`), but the on-conflict update does `set: { ...data }` with **raw eBird keys**, which don't match any column except `lat`/`lng` | `ebird/ebird.repository.ts:14-33` | Location renames / privacy changes never propagate on update; only `lat`, `lng`, `lastUpdated` are written. `upsertObservation` (`:57-64`) has the same insert-vs-update key mismatch pattern. | Not re-verified this pass. |
| B4 | Joi validates `DEVELOPMENT_SERVER`; the code reads `DEVELOPMENT_SERVER_ID`. Also, when unset the expression yields `undefined` rather than Necord's explicit `false` | `app.module.ts:12` vs `:31-33` | The validated var is never read. A dev machine without the var registers slash commands **globally** (Necord's `development` option expects `Snowflake[] \| false`). | **Open** — confirmed: Joi still has `DEVELOPMENT_SERVER`, code still reads `DEVELOPMENT_SERVER_ID` at `app.module.ts:31-32`. |
| B5 | `DATABASE_URL` and `PORT` are required at runtime but absent from the Joi schema; `DISCORD_CLIENT_ID` is validated but read nowhere | `app.module.ts:11-17`, `main.ts:9,16` | The config seam claims guarantees it doesn't provide. | **Open** — confirmed: `main.ts` still reads `DATABASE_URL`/`PORT` via raw `process.env`, not Joi/`ConfigService`. |
| B6 | `bootstrapComplete = true` is set in a `finally`, so a failed/partial bootstrap still unblocks all jobs | `jobs/bootstrap.service.ts:96-99` | Dispatch can run against a DB whose historical observations were never marked delivered → a burst of stale alerts. | Not re-verified this pass. |
| B7 | `waitForBootstrap`'s 5-minute timeout `reject()`s, and no job wraps the call in try/catch | `bootstrap.service.ts:49-60`, `dispatch.job.ts:18` | Slow bootstrap → unhandled rejection in every cron job. | Not re-verified this pass. |
| B8 | `DispatchJob.run` has no error handling around the two dispatch calls | `jobs/dispatch.job.ts` | One bad channel/API hiccup can abort the whole minute's dispatch with an unhandled rejection. | Not re-verified this pass — note `dispatch.job.ts` now calls into the AlertQueue-shaped module from PR #61, so re-check against the new shape. |
| B9 | Reaction listener checks `reaction.partial` but never `user.partial` before reading `user.bot`; `Partials.User` is not configured | `discord/listeners/reaction-listener.service.ts:15-17`, `app.module.ts:38` | On a partial user, `bot` is `null` and the bot-guard silently passes. | **Open** — confirmed: only `reaction.partial` is checked in `reaction-listener.service.ts`, no `user.partial` guard. |
| B10 | `/sub-ebird` replies interpolate the raw error (`Failed to subscribe to eBird: ${error}`) to the user | `discord/commands/subscription-commands.service.ts:37` | Leaks internal error text into Discord. | Not re-verified this pass. |
| B11 | `"test:e2e"` script points at `./test/jest-e2e.json`, which does not exist | `apps/scrubjay-discord/package.json:74` | Script is broken; also `turbo.json` defines no `test` task at all, so tests never run in the pipeline. | **Open** — confirmed: `test/jest-e2e.json` still missing, and `turbo.json` still defines no `test` task. |

Performance note (not a correctness bug): the eBird dispatch join computes
`alertId = speciesCode || ':' || subId` on the fly (`dispatcher.repository.ts:82-84`),
which likely prevents Postgres from using `deliveries_unique_idx` for that anti-join as
`deliveries` grows. Storing the composite id on `observations` (or a generated column)
would restore index use. Similarly `rss_items.created_at` and
`channel_rss_subscriptions.sourceId` have no supporting index for their dispatch
predicates. _Update 2026-07-07: addressed — the post-#61 dispatch suite has an
EXPLAIN-based regression test asserting the deliveries anti-join is index-backed
(`dispatch/__tests__/alert-queue.repository.spec.ts`); the RSS half is moot (§9)._

---

## 3. Opportunity: name and deepen the dispatch module

> **Status: done.** PR #61 (`refactor: delete RSS feature, put dispatch behind
> AlertQueue`) replaced `features/dispatcher/*` and `features/deliveries/*` with
> `features/dispatch/` behind an AlertQueue-shaped interface, along the lines proposed
> below. The file paths in this section are stale; treat it as a historical record of
> the reasoning, not a live task.
>
> **Follow-up confirmed 2026-07-07:** `features/dispatch/__tests__/` is the real-Postgres
> integration suite recommended below — `createTestDb` + seed helpers, truncate per test,
> asserting alert output through the `AlertQueue` interface. Coverage includes county vs
> `*` wildcard (and cross-state wildcard rejection), inactive subscriptions, per-channel
> species filters, per-channel delivery dedup, the `since` cutoff applying to ingest time,
> the 7-day confirmed window, and `markSent` idempotency/batching. There is even an
> EXPLAIN-based test asserting the deliveries anti-join is index-backed rather than a
> per-row scan (which addresses §2's performance note). The remaining gap is not the
> tests — it's that nothing runs them: see §11.

**Files (stale, pre-#61):** `features/dispatcher/*` (5 files), `features/deliveries/*` (2 files),
`features/jobs/dispatch.job.ts`, `features/jobs/bootstrap.service.ts`

### Problem

Dispatch is where the product actually lives — "which subscriptions match, which species
are filtered, what was already sent, how do we group into one embed" — and it is spread
so that no single interface answers those questions:

- The matching/filtering/dedup logic is one SQL expression
  (`dispatcher.repository.ts:35-95`) with no name for its semantics and **zero tests**.
- The grouping (`groupObservations`, channel→species→location nested Maps) and stat
  aggregation are `private` on `EBirdDispatcherService` — real logic, untestable
  through the current interface, no spec.
- Delivery recording goes through `DeliveriesService`, a 1:1 pass-through where **half
  the interface is dead** (see §4).
- A *second copy* of essentially the same join lives in
  `subscriptions.repository.ts:29-73` (the subscribe-time backfill) — same predicates,
  independently maintained. A predicate fix in one is a silent divergence in the other.

The existing specs cannot catch a wrong predicate. `subscriptions.repository.spec.ts`
hand-wires the drizzle fluent chain:

```ts
mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ innerJoin: mockInnerJoin, leftJoin: mockLeftJoin });
mockInnerJoin.mockReturnValue({ innerJoin: mockInnerJoin, leftJoin: mockLeftJoin });
mockLeftJoin.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
mockWhere.mockResolvedValue([]);
```

The "database result" is whatever the test hands back; `isNull(deliveries.alertId)` and
the `countyCode === "*"` wildcard branch are never executed. Reorder a join and the test
breaks; break the predicate and it passes.

### Proposed change

Make dispatch one deliberately deep module with a small, named interface — roughly:

```
AlertQueue (or DispatchRepository, deepened)
  pendingEBirdAlerts(since?) → matched, unfiltered, undelivered observation×channel rows
  pendingRssAlerts(since?)   → same for RSS
  confirmedAt(window)        → confirmed species×location set
  markSent(deliveries[])     → absorbs DeliveriesService/Repository (§4)
```

Behind that seam: the joins, the backfill query (shared with subscriptions so the
predicates exist **once**), and delivery recording. The dispatchers keep the
Discord-facing half: grouping, embeds, sending. Extract `groupObservations` +
`getAggregatedObservationStats` into a pure, exported function (or small class) so the
grouping rules are unit-testable without Discord.

**Test through the interface, against real Postgres.** This is cheap here — verified:

- Every repository already takes `DrizzleService` via constructor DI; no statics or
  globals anywhere in the repo layer.
- Migrations are checked in (`src/drizzle/0000…0003.sql`) and already run
  programmatically at startup (`main.ts:7-14` — the same `migrate()` call works in a
  Jest `globalSetup`).
- `docker-compose.yaml` already provides Postgres 17 (add an ephemeral test DB or use
  testcontainers/pglite; nothing is installed yet, dev deps are jest + ts-jest only).

Seed observations/locations/subscriptions/filters/deliveries; assert exactly which
alert rows come out. County vs `*` wildcard, filtered species, already-delivered,
confirmed-window — each becomes a five-line test that would actually fail on a wrong
predicate.

### Benefits

- **Locality:** "why did/didn't this alert fire" has one module to read, one place to
  fix, and the subscribe-time backfill can't drift from the dispatch-time query.
- **Leverage:** jobs and bootstrap call two named methods instead of coordinating
  repo + deliveries + dispatcher trios.
- **Tests:** the highest-logic-density code in the app goes from untested to tested
  through a stable interface; the brittle mock-chain specs get deleted rather than
  maintained.

---

## 4. Opportunity: delete the pass-through service layer

> **Status: partially done.** `deliveries/` disappeared as a side effect of §3 (PR #61),
> which resolves that bullet. **Still open, re-verified 2026-07-07:** `FiltersService`
> and `SourcesService` both still exist as verbatim delegates; the dead eBird chain
> (`EBirdService.getObservationsSinceCreatedDate` → `EBirdRepository.getAlertsCreatedSinceDate`)
> is also still present, callers unchanged.

**Files:** `filters/filters.service.ts`, `sources/sources.service.ts`,
`ebird/ebird.service.ts:56-58`, `ebird/ebird.repository.ts:68-72`
(`deliveries/deliveries.service.ts` no longer exists — folded away by PR #61, see §3)

### Problem

Four services fail the deletion test outright:

- **`FiltersService`** (15 lines): two methods, each a verbatim delegate to
  `FiltersRepository`. One caller.
- **`SourcesService`**: wraps each repo call in catch-log-return-`[]`; its two callers
  (`ebird-ingest.job`, `bootstrap.service`) already have their own try/catch.
- **`DeliveriesService`**: every method delegates 1:1. Verified caller analysis:

  | Symbol | Production callers |
  |---|---|
  | `ensureNotDelivered` | **none** (and it just inverts a boolean twice) |
  | `recordDelivery` | **none** |
  | `recordDeliveries` | ebird-dispatcher, rss-dispatcher, bootstrap — the only live path |
  | repo `isDelivered`, `markDelivered` | only the dead service methods above |
  | repo `getDeliveriesForChannel`, `cleanUpOlderThanDays` | **none** |

- **`EBirdService.getObservationsSinceCreatedDate` → `EBirdRepository.getAlertsCreatedSinceDate`**:
  a dead vertical chain; the repo method's only other reference is a jest mock stub.

### Proposed change

Delete `FiltersService` and `SourcesService`; callers use the repositories directly.
Fold the one live delivery method into the deepened dispatch module (§3) — after which
the `deliveries/` slice disappears entirely. Delete the dead eBird chain.

### Benefits

Tracing any flow crosses one fewer layer per hop; the DI graph shrinks by 4+ providers;
the wiring-only specs that "tested" these layers go away. No behaviour changes — that's
what the deletion test verifies.

---

## 5. Opportunity: remove the dispatcher-map ceremony

> **Status: done**, as a side effect of §3 (PR #61) rather than a targeted fix — the
> `dispatcher/` directory and its `DispatcherMap` are gone entirely, replaced by the
> single `features/dispatch/` module. File paths below are stale.

**Files (stale, pre-#61):** `dispatcher/dispatcher.service.ts`, `dispatcher/dispatcher.interface.ts`

### Problem

`DispatcherService` maintains a `DispatcherMap`, a `getDispatcher` with an
"unknown type" throw, generic signatures with `Awaited<ReturnType<…>>` casts, and a
`biome-ignore` for a field "used via bracket notation" — all to route between exactly
two injected services that every caller names with a string literal:

```ts
async dispatchSince<T extends keyof DispatcherMap>(type: T, since?: Date): Promise<void> {
  return this.getDispatcher(type).dispatchSince(since);
}
```

The `Dispatcher<T>` interface is a genuine two-adapter seam (both dispatchers implement
it) — but nothing consumes it polymorphically; the map is ceremony on top. `DispatcherType`
is exported and imported by nothing. The one spec for this class asserts that the map
forwards calls, i.e. it tests the ceremony.

### Proposed change

Keep the `Dispatcher` interface; delete the map. Two options, smallest first:

1. Callers inject `EBirdDispatcherService` / `RssDispatcherService` directly (there are
   only two call sites: `dispatch.job.ts`, `bootstrap.service.ts`).
2. If uniform iteration is wanted ("run all dispatchers"), register both under a
   multi-provider token and loop — that consumes the seam for real and scales to a
   third source without a map.

### Benefits

Removes the generics, the throw, the biome-ignore, and the map-forwarding spec. The
seam that remains is the one that actually exists.

---

## 6. Opportunity: make the fetcher seam honest (validate or drop zod)

> **Status: open.** Re-verified 2026-07-07: `ebird.fetcher.ts` still does
> `await response.json()` and casts, with no `.parse(`/`.safeParse(` anywhere. The
> `rss/rss.schema.ts` half is moot now that RSS is deleted (§9), but the eBird half of
> this opportunity — including B3's location-mapping fix — is untouched.

**Files:** `ebird/ebird.schema.ts`, `ebird/ebird.fetcher.ts`, `ebird/ebird.transformer.ts`,
`ebird/ebird.repository.ts`

### Problem

`RawEBirdObservationSchema` (30 fields of zod) is never parsed. Verified: the only
`.parse(` in the entire repo is an unrelated one in `drizzle.config.ts`. The fetcher does:

```ts
const data = await response.json();   // any
return data;                          // cast to EBirdObservation[]
```

So the schema implies a runtime guarantee that doesn't exist — a reader who sees zod
assumes validated input. Meanwhile the fetcher swallows HTTP errors internally
(`!response.ok` → warn → `return []`), so the service's catch only ever sees network
throws — two error channels for one failure mode.

Downstream, the location shape is hand-transcribed **three times**: the `EBirdLocation`
`Pick` (schema), an 11-field identity copy in `extractLocation` (transformer), and the
rename map in `upsertLocation` (repository) — which is exactly where bug B3 hides:
three transcriptions of one shape, and the fourth (the conflict-update set) drifted.

What *earns its keep* in this slice is `transformObservations`: eBird's notable feed
returns one row per media evidence item per checklist; the transformer collapses on
`speciesCode-subId` while tallying photo/audio/video counts. That's the domain logic.

### Proposed change

- Parse at the seam: `RawEBirdObservationSchema.array().parse(await response.json())`
  (or `safeParse` + log-and-skip). The fetcher's contract becomes "validated
  observations or a logged failure" — genuinely deep. Alternatively, delete zod and use
  plain interfaces; either is honest, the current state is neither.
- Unify error handling: let the fetcher throw (or return a discriminated result) and let
  the service's existing catch be the single failure path.
- Collapse `extractLocation` into `upsertLocation`'s `.values()` and write the conflict
  `set:` with the same column keys (fixes B3). One transcription instead of three.
- Delete the dead types: `EBirdObservationResponse`, `NormalizedRssFeed`.

### Benefits

The type a caller sees becomes true at runtime; malformed eBird payloads fail loudly at
the boundary instead of as NULL-constraint errors mid-upsert. Location mapping has one
home. ~40 lines net deletion.

---

## 7. Opportunity: organize the Discord surface the Necord way

> **Status: open, entirely.** Re-verified 2026-07-07: `discord/reaction-router/` still
> has all 5 files described in §7a; `discord/commands/` is still a central folder
> (`commands.dto.ts`, `commands.module.ts`, `subscription-commands.service.ts`,
> `util-commands.service.ts`) rather than commands living in their feature slices per
> §7b; `discord.helper.ts` is still 111 lines with all four methods
> (`sendEmbedsToChannel`, `sendEmbedToChannel`, `sendMessageToChannel`, `getChannel`) —
> the claimed dead-caller counts in §7c should be re-verified against the post-#61 tree
> before deleting, since dispatch's call sites moved.

This addresses "idk how to organize some of the stuff cleanly" directly. Necord's docs
prescribe little, but its two official references establish clear conventions
(examples repo: `necordjs/examples`; production bot: `necordjs/toolkit`):

- **Commands live inside the feature module they act on** (`tags/tags.commands.ts`,
  `docs/docs.commands.ts`), not in a central `discord/commands/` folder. Options DTOs
  sit next to them (`options/*.options.ts`), autocomplete interceptors in
  `autocompletes/`.
- **Grouped command classes, not one class per command**; listener classes named
  `*.update.ts`; cross-cutting Discord concerns (exception filters, metrics
  interceptors) in `common/`.
- **Dev-guild registration** is the `development: Snowflake[] | false` module option.

### 7a. The reaction plumbing is 6 files of infrastructure for 1 handler

Current chain for "3× 👎 filters a species": listener → `ReactionRouterService` →
`ReactionExplorerService` (DiscoveryService + Reflector scan) → `@Reaction()` marker
decorator → `ReactionHandler` interface + duck-type guard → `FiltersAddHandler`.

Necord has **no reaction feature** (verified against `necord@6.12.4`'s dist), so this
isn't duplicating the framework — but it *is* a miniature reimplementation of Necord's
own discovery machinery, with exactly one handler registered, and handlers wired this
way bypass Necord's context, so they can't use `@UseGuards`/`@UseFilters`.

Deletion test: fold the emoji check into a single Necord-idiomatic handler in the
filters slice —

```ts
// features/filters/filters.reactions.ts
@Injectable()
export class FiltersReactions {
  @On(Events.MessageReactionAdd)
  async onReactionAdd(@Context() [reaction, user]: ContextOf<Events.MessageReactionAdd>) {
    if (user.bot) return;                       // + user.partial fetch (B9)
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.emoji.name !== "👎") return;
    // threshold + filter logic
  }
}
```

— and `reaction-router/` (4 files), the marker decorator, and the standalone listener
all vanish. If several emoji behaviours ever appear, Necord's documented pattern for
exactly that shape is `createCustomOnDecorator<Events>()`: one listener derives domain
events (`client.emit("thumbsDownVote", …)`) and feature modules subscribe with a typed
`@On` — still no router/explorer to maintain.

While here: make the threshold a config value instead of a hardcoded `3`, and give the
alert a stable species identifier rather than parsing the embed title (fixes B1/B2 —
e.g. put `speciesCode` in the embed footer or switch from reactions to a Necord button
with `customId: "filter/<speciesCode>"`, which is the framework's first-class answer).

### 7b. Commands move into their feature slices

- `/sub-ebird` → `features/subscriptions/subscriptions.commands.ts` + options DTO.
  Two Necord idioms are currently missing:
  - **`deferReply`** — the handler does DB work inside Discord's 3-second interaction
    window; `await interaction.deferReply({ flags: MessageFlags.Ephemeral })` then
    `editReply` removes the `Unknown interaction` failure mode.
  - **Autocomplete** for the region option (an `AutocompleteInterceptor` backed by the
    known state/county codes) instead of a free-text string parsed by `parseRegionCode`.
- Replace per-command `try/catch → reply(error)` (B10) with one Necord exception filter
  in `discord/common/filters/` (the toolkit pattern).
- `/ping` stays in a small `util.commands.ts`.

### 7c. `DiscordHelper` shrinks to one sender

Re-verified 2026-07-07 against the post-#61 tree — it's deader than originally claimed:
only `sendEmbedToChannel` has a caller (`dispatch/ebird-dispatcher.service.ts:128`).
The other three methods (`sendEmbedsToChannel`, `sendMessageToChannel`, `getChannel`)
are all dead now (~85 of 111 lines), each repeating the same
fetch-channel/guard/try-catch boilerplate. Neither Necord nor discord.js offers a higher-level "send to channel id",
so a thin outbound port is the right shape — keep exactly one
`send(channelId, payload)`; `isSendable()` already implies text-based, so the double
guard collapses too. Optionally inject Necord's `ChannelManager` provider instead of the
whole `Client`.

### Resulting layout

```
src/
  app.module.ts                      # NecordModule config (fix B4: development: [...] | false)
  discord/                           # cross-cutting Discord infra ONLY
    discord.module.ts
    channel-sender.service.ts        # slimmed DiscordHelper
    lifecycle.update.ts              # @Once(ClientReady) presence
    common/filters/command-exception.filter.ts
    util.commands.ts                 # /ping
  features/
    subscriptions/  subscriptions.commands.ts, options/, autocompletes/, service, repository
    filters/        filters.reactions.ts, repository        # router+handler dirs deleted
    dispatch/       (deepened module from §3) + ebird.embeds.ts / rss.embeds.ts
    ebird/  rss/    fetcher, transformer, repository, module
    jobs/           ingest + dispatch crons, bootstrap
```

**Benefits:** each feature slice owns its full vertical (command → service → repository
→ embeds), which is both the Necord convention and the locality win — understanding
"filters" or "subscriptions" no longer requires visiting `discord/`. Net deletion:
~6 files of router/explorer/decorator infrastructure plus 71 dead helper lines.

---

## 8. Opportunity: delete the dead weight

> **Status: partially done.** The `apps/test-api` rows landed via PR #62 (2026-07-07):
> the dead root-level trio is gone, plus the RSS mock surface, 6 unused mock endpoints,
> and unused deps the original audit missed (`moment`, `tsup`, `getApiKeys`). Stale
> `dist/` was deleted locally (gitignored, nothing to commit). Still open:
> `packages/database/` and `packages/vitest-config/` — **new finding:** neither has a
> `package.json`, so they aren't workspace members at all; deleting them is a pure
> `rm -rf` with no lockfile impact. Also still open: `core/timezones` (the
> `county_timezones` drop-table decision), `EBirdObservationResponse`
> (`ebird.schema.ts:36`, zero importers — `NormalizedRssFeed`/`DispatcherType` died with
> RSS), `subscriptions.module.spec.ts` (DI ceremony; `rss.module.spec.ts` died with RSS),
> and the `test:e2e` script (B11). `DeliveriesService`/`Repository` dead surface is
> moot — the whole `deliveries/` slice is gone (§3/§4).

All grep-verified against the pre-#61 tree. **~529 dead source lines**, plus stranded directories.

| Item | Lines | Notes |
|---|---|---|
| `apps/test-api/src/{species,hotspots,regions}.ts` | 383 | Duplicates of `src/data/*`; nothing imports them. **Trap:** the dead `regions.ts` has all counties uncommented while the live `data/regions.ts` has them commented out — the dead copy looks like the richer "real" one. |
| `DiscordHelper` dead methods | 71 | See §7c. |
| `DeliveriesService`/`Repository` dead surface | 63 | See §4. |
| `core/timezones` `Timezone` type + `convertTimezone` | ~4 | The 346-entry `timezones` array itself is only consumed by the `county_timezones` table's enum column — and that table is **never queried anywhere** (it exists in migration `0000`, so removing it is a drop-table migration, not just a file delete). Decide: drop table + file (356 lines), or keep and document why. |
| Dead type exports: `EBirdObservationResponse`, `NormalizedRssFeed`, `DispatcherType` | ~8 | Zero importers each. |
| Dead eBird chain (`getObservationsSinceCreatedDate` + `getAlertsCreatedSinceDate`) | ~10 | See §4. |
| DI-ceremony specs: `rss.module.spec.ts`, `subscriptions.module.spec.ts` | 124 | Assert only that NestJS resolves providers — they test the framework. |
| `packages/database/` | — | Untracked stranded build artifact: only `.turbo/`, `dist/`, `node_modules/`; no `package.json`, no source, zero references to `@scrubjay/database` anywhere. Delete the directory. |
| `packages/vitest-config/` | — | Orphaned: no package depends on it; the app tests with Jest. Delete or actually adopt. |
| `apps/scrubjay-discord/dist/` | — | Stale compiled output of a **previous architecture** (contains `listserv/`, `sightings/`, `notifications/`, `bot/`, `health/` modules that no longer exist in `src/`). Untracked; will confuse any grep. Delete; builds regenerate it. |
| `package.json` `test:e2e` script | 1 | Points at a Jest config that doesn't exist (B11). |

**Benefits:** pure navigability — for you and for any AI agent walking the tree.
Cheapest win in this document.

---

## 9. Opportunity: decide the fate of RSS subscriptions

> **Status: decided and done.** PR #61 chose neither Option A nor Option B below —
> instead it deleted the RSS feature outright (fetcher, transformer, repository,
> dispatcher, schema, and the dead `insertRssSubscription`/`rss_sources` surface this
> section describes). This closes the "half-built vertical" problem by removing the
> vertical rather than finishing or formally ops-managing it. File paths below are
> stale; kept for historical context in case RSS (or another source type) returns.

**Files (stale, pre-#61):** `subscriptions.repository.ts:91-99`, `sources.repository.ts:22-24`,
`core/drizzle/drizzle.schema.ts:133-151`

### Problem

RSS is a half-built vertical. Verified:

- `insertRssSubscription` has **zero callers** — no command, job, or listener.
- **Nothing anywhere writes `rss_sources`** — no admin command, no seed script.
- The dispatcher happily *reads* both tables, so RSS alerting works today only if rows
  are inserted by hand in SQL. That operational knowledge lives in nobody's head but the
  operator's.
- Schema trap: `channelRssSubscriptions.sourceId` maps to a DB column literally named
  `"id"` (`text("id")`, `drizzle.schema.ts:144`) — unlike `rss_items.sourceId` →
  `"source_id"`. Every future hand-written query against this table will trip on it.

### Proposed change (a decision, not a prescription)

- **Option A — finish it:** `/sub-rss` command (the dead repo method is the start), an
  admin path to create `rss_sources` rows (command or seed script), a subscribe-time
  delivery backfill mirroring the eBird one, and an autocomplete over `rss_sources`.
- **Option B — declare it ops-managed:** delete `insertRssSubscription`, document in the
  README that RSS sources/subscriptions are managed by SQL, and add the missing indexes
  (`rss_items.created_at`, a `sourceId`-led index on `channel_rss_subscriptions`).

Either way, rename the `"id"` column to `"source_id"` in a migration while the table is
still small.

### Benefits

Locality of *operational* knowledge: how RSS gets configured becomes discoverable from
the code, whichever option is chosen.

---

## 10. Opportunity: one honest config seam

> **Status: open.** Re-verified 2026-07-07 — the drift table below is unchanged: Joi
> still lacks `DATABASE_URL`/`PORT`, `main.ts` still reads them via raw `process.env`,
> and `DEVELOPMENT_SERVER` vs `DEVELOPMENT_SERVER_ID` is still mismatched (B4/B5).

**Files:** `app.module.ts`, `main.ts`, `core/drizzle/drizzle.module.ts`

Verified drift table:

| Env var | In Joi schema? | Where read |
|---|---|---|
| `DATABASE_URL` | **no** | `main.ts` (via `process.env`), `drizzle.module.ts` (via `ConfigService`) |
| `PORT` | **no** | `main.ts` (via `process.env`) |
| `EBIRD_BASE_URL` | yes (default) | `ebird.fetcher.ts` |
| `EBIRD_TOKEN` | yes | `ebird.fetcher.ts` |
| `DISCORD_TOKEN` | yes | `app.module.ts` |
| `DISCORD_CLIENT_ID` | yes | **nowhere** |
| `DEVELOPMENT_SERVER` | yes | **nowhere** (code reads `DEVELOPMENT_SERVER_ID`, which is unvalidated) |

Fix: one schema listing exactly the vars the app reads (add `DATABASE_URL`, `PORT`;
rename to `DEVELOPMENT_SERVER_ID`; drop or use `DISCORD_CLIENT_ID`), and read everything
through `ConfigService` (main.ts currently bypasses it). Explicitly map the Necord
option: `development: devServerId ? [devServerId] : false` (B4).

**Benefits:** startup fails fast with a named missing var instead of mid-flight; the
schema becomes trustworthy documentation of the deployment contract.

---

## 11. Opportunity: a test strategy that matches the seams

> **Status update — 2026-07-07.** The centerpiece landed: the dispatch module is
> integration-tested against real Postgres through the `AlertQueue` interface (see §3
> for verified coverage). What remains is the last bullet, and it's now the single
> highest-leverage item in this document: **nothing runs the tests.** `turbo.json`
> defines no `test` task, and the Status Checks workflow runs only
> `pnpm run format-and-lint` — not `check-types`, not `jest`. A predicate regression
> in the dispatch join would pass CI today. Wiring a `test` task + a Postgres service
> container into CI (plus `check-types`) converts the already-paid-for suite into
> standing protection and de-risks every remaining refactor (§4, §6, §7, §10).

Current inventory (13 spec files): 4 test real behaviour through an interface (the two
transformers, the eBird fetcher, region parsing), 5 re-encode implementation call
sequences with mocks, 2 mock the entire drizzle fluent chain, 2 are DI ceremony.
Meanwhile the files with the most logic have **no spec at all**: `dispatcher.repository`,
`ebird-dispatcher` (grouping/aggregation), `deliveries.repository`, `filters.repository`,
`bootstrap.service`.

Target state, aligned with the refactors above:

- **Keep** the transformer/fetcher/parsing specs — they already test through interfaces.
- **Integration-test the dispatch module** (§3) against real Postgres: jest
  `globalSetup` starts/points at a DB, runs the checked-in `migrate()`, each test seeds
  and asserts alert output. This one suite replaces both drizzle mock-chain specs and
  covers the anti-join predicates nothing can test today.
- **Unit-test the extracted grouping/aggregation** as pure functions.
- **Delete** the DI-ceremony specs and the map-forwarding spec along with their subjects
  (§4, §5, §8).
- **Wire tests into the pipeline:** add a `test` task to `turbo.json`; fix or remove
  `test:e2e` (B11).

The direction of travel: fewer specs, testing more, through interfaces that survive
refactoring.

---

## 12. Suggested sequencing

Each step is independently shippable; ordering minimizes rework.

_Status as of 2026-07-07: PR #61 jumped ahead and landed step 7 (dispatch deepening,
§3) and step 8 (RSS decision, §9) before steps 1–6, which incidentally also finished
step 3's dispatcher-map half (§5). That's fine — the remaining steps don't depend on
ordering relative to what's already done — but resume with what's still open:_

1. **Bug fixes** (B1–B11) — mostly one-liners; B3 and B4 are user-visible correctness.
   **Still open**: B1, B2 (partial), B4, B5, B9, B11 confirmed open;
   B3/B6/B7/B8/B10 not re-checked.
2. **Dead-weight deletion** (§8) — zero risk, immediate navigability. **Partially
   done**: all of `apps/test-api` cleaned via PR #62; still open: `packages/database`,
   `packages/vitest-config` (pure `rm -rf`, not workspace members), `core/timezones`
   decision, `EBirdObservationResponse`, `subscriptions.module.spec.ts`.
3. ~~**Pass-through layer removal** (§4)~~ — **partially done**: `deliveries/` gone via
   §3; `FiltersService`/`SourcesService`/dead eBird chain still open.
   ~~+ **dispatcher-map removal** (§5)~~ — **done** via §3.
4. **Config seam** (§10) — small, independent. **Still open.**
5. **Discord-surface reorganization** (§7) — moves files into feature slices; do before
   §3 so the deepened dispatch module lands in its final home. **Still open** — §3 has
   already landed, so this step no longer needs to precede it; re-verify §7c's dead-line
   claims against the post-#61 call sites before executing.
6. **Fetcher validation + location mapping collapse** (§6). **Still open.**
7. ~~**Dispatch module deepening + integration tests** (§3, §11)~~ — **§3 done** via
   PR #61, and the real-Postgres integration suite is **confirmed present and
   thorough** (verified 2026-07-07, see §3). The open remainder of §11 is CI wiring:
   no `test` task in `turbo.json`, CI runs lint only. That's now the top-value item.
8. ~~**RSS decision** (§9)~~ — **done**: PR #61 deleted RSS rather than finishing or
   declaring it ops-managed.

A note on what this document deliberately does **not** propose: unifying the eBird and
RSS ingest slices under a shared pipeline abstraction. They are copy-paste-similar
(same fetch→transform→upsert skeleton) but diverge in real ways (error handling,
upsert shapes, two-step location writes). The dispatcher interface is the only place the
symmetry is load-bearing; forcing a shared ingest abstraction now would trade
duplication you can read for indirection you can't. Revisit if a third source type
appears.
