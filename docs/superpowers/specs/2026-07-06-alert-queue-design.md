# AlertQueue: delete RSS, deepen dispatch

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan
**Origin:** `docs/architecture-improvements.md` §3 (deepen dispatch), §5 (dispatcher map), §9 (RSS fate)

## Goal

Dispatch is where the product lives — which subscriptions match, which species are
filtered, what was already sent — but that logic is one unnamed SQL expression with
zero tests, plus a confirmed-species `Set` computed in the dispatcher. This spec puts
all of it behind one deep, named module, **AlertQueue**, tested through its interface
against real Postgres.

The RSS feature is being deleted outright (users disliked it), which shrinks the
problem: one alert kind, one dispatcher, no routing layer.

## Decisions already made

| Decision | Choice |
|---|---|
| Module name | `AlertQueue` |
| Module shape | One concrete injectable class; no abstract interface (one adapter = hypothetical seam). Raw data access is split into `AlertQueueRepository`, following the codebase's repository convention — but it's consumed only by `AlertQueue` and its own tests, never injected elsewhere, so `AlertQueue` stays the module's sole public seam. |
| RSS feature | Deleted entirely, including database tables and rows |
| Behavior policy | Fix as we go — tests assert desired behavior, not current quirks |
| Test database | Testcontainers (`@testcontainers/postgresql`), real Postgres 17 |
| Deliveries feature | Deleted at the end (it has zero live callers after rewiring) |

## Phase 1 — delete RSS

### Code

- **Whole modules:** `features/rss/*` (fetcher, service, repository, transformer,
  schema, tests) and `features/dispatcher/dispatchers/rss-dispatcher.service.ts`.
- **RSS halves of shared files:**
  - `SourcesService.getRssSources` / `SourcesRepository.getRssSources`
  - `SubscriptionsRepository.insertRssSubscription` (and any service/command surface for it)
  - `BootstrapService`: the RSS ingest pass and `markExistingAsDelivered("rss")`
  - `DispatchJob`: the `dispatchSince("rss")` call
  - `dispatcher.schema.ts`: RSS types
  - `drizzle.schema.ts`: `rssItems`, `rssSources`, `channelRssSubscriptions` tables
    and their relations
- **Free fallout:** with one alert kind left, the routing ceremony has nothing to
  route. Delete `DispatcherService`, `dispatcher.interface.ts` (`Dispatcher`,
  `DispatcherMap`). `DispatchJob` and `BootstrapService` depend on the eBird
  dispatcher (and later `AlertQueue`) directly. This lands §5 of the architecture
  document as a side effect.

### Database (migration 0004)

- Drop tables `rss_items`, `rss_sources`, `channel_rss_subscriptions`.
- `DELETE FROM deliveries WHERE alert_kind = 'rss'`.
- The `alert_kind` column **stays**: it is part of `deliveries_unique_idx` and keeps
  alert identity general for future kinds.
- Mechanics: `drizzle-kit generate` for the drops, then append the `DELETE` to the
  generated SQL. Runs automatically at startup via the existing `migrate()` in
  `main.ts` — no manual step on the VPS.

The data is unrecoverable after this migration; that is accepted (dead feature).

## Phase 2 — AlertQueue

### Placement

Rename `features/dispatcher/` → `features/dispatch/`:

```
features/dispatch/
  dispatch.module.ts
  alert-queue.ts               # the deep module: alert identity, batching, orchestration
  alert-queue.repository.ts    # raw data access; consumed only by AlertQueue
  ebird-dispatcher.service.ts  # Discord-facing half: grouping, embeds, sending
  __tests__/alert-queue.spec.ts             # behavior, through AlertQueue's interface
  __tests__/alert-queue.repository.spec.ts  # query plan (EXPLAIN), through the repository
```

### Interface

```ts
export type PendingEBirdAlert = {
  channelId: string;
  speciesCode: string;
  comName: string;
  sciName: string;
  subId: string;
  locId: string;
  locationName: string;
  county: string;
  state: string;
  isPrivate: boolean;
  howMany: number;
  obsDt: Date;
  createdAt: Date;
  photoCount: number;
  videoCount: number;
  audioCount: number;
  recentlyConfirmed: boolean;
};

@Injectable()
export class AlertQueue {
  constructor(private readonly repository: AlertQueueRepository) {}

  /** Matched, unfiltered, undelivered observation×channel rows. */
  pendingEBirdAlerts(since?: Date): Promise<PendingEBirdAlert[]>;

  /** Record alerts as sent. Idempotent; owns alert identity. */
  markSent(alerts: SentAlert[]): Promise<void>;
}

export type SentAlert = { speciesCode: string; subId: string; channelId: string };

@Injectable()
export class AlertQueueRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  pendingEBirdAlerts(since?: Date): Promise<PendingEBirdAlert[]>;
  insertDeliveries(rows: DeliveryRow[]): Promise<void>;
}
```

`AlertQueue` builds the `alertId` (`speciesCode:subId`) and batches `markSent` calls
(100 per insert) before handing prepared rows to `AlertQueueRepository.insertDeliveries`
— that's business logic, not data access, so it stays out of the repository.
`AlertQueueRepository` does no filtering/branching of its own; it just runs the query
and the insert. `pendingEBirdAlertsQuery`, the unexecuted query builder, is exported
from `alert-queue.repository.ts` solely for the EXPLAIN smoke test.

Plain exported TypeScript types — no zod. Every source column is `NOT NULL` in the
schema, so the type is fully non-nullable; the dispatcher's `?? 0` fallbacks on media
counts are vestigial and disappear with the rewiring.

### Semantics of `pendingEBirdAlerts`

A row is pending for a channel when **all** of:

1. **Matched:** an active `channelEBirdSubscriptions` row with the same `stateCode`
   and either the same `countyCode` or the `'*'` wildcard.
2. **Unfiltered:** no `filteredSpecies` row for that channel with `commonName`
   equal to the observation's `comName`.
3. **Undelivered:** no `deliveries` row with `kind = 'ebird'`,
   `alertId = speciesCode || ':' || subId`, and that `channelId`.
4. **Recent (optional):** if `since` is given, `observations.createdAt > since`
   (ingest time, not observation time — an old sighting ingested now still alerts).

Each row carries `recentlyConfirmed`: an SQL `EXISTS` for an observation of the same
`speciesCode` × `locId` with `obsValid AND obsReviewed` and `obsDt` within the last
**7 days** (module-internal constant `CONFIRMED_WINDOW_DAYS = 7`, evaluated with SQL
`now()`). This replaces `getConfirmedSinceDate` + the `Set` intersection currently
built inside `EBirdDispatcherService` — the meaning of "confirmed" lives in one query.

### Semantics of `markSent`

- Builds `alertId` as `` `${speciesCode}:${subId}` `` internally with
  `kind = 'ebird'` — callers never hand-assemble alert identity (today three call
  sites do).
- Inserts in batches of 100 with `onConflictDoNothing` against
  `deliveries_unique_idx` → idempotent; safe to call twice with the same alerts.

### Caller rewiring

- **`EBirdDispatcherService`** depends only on `AlertQueue` + `DiscordHelper`. It
  loses `getConfirmedSinceDate`/`Set` logic (reads `row.recentlyConfirmed`) and the
  `DeliveriesService` dependency (calls `alertQueue.markSent`). Grouping and embed
  construction stay as-is (extraction is a follow-up). `getUndeliveredSinceDate`
  pass-through is deleted.
- **`DispatchJob`** calls `EBirdDispatcherService.dispatchSince(since)` directly.
- **`BootstrapService`** replaces `markExistingAsDelivered` + the generic helper with:
  `await this.alertQueue.markSent(await this.alertQueue.pendingEBirdAlerts())`.
- **`features/deliveries/*`** then has zero live callers → deleted (service,
  repository, module, specs). §4 becomes pure deletion.
- **`DispatcherRepository`** and `dispatcher.schema.ts` are deleted; their live
  content moves into `alert-queue.repository.ts`.

### Delivery guarantee (unchanged, now documented)

Sending happens before recording, so a crash between the two re-sends on the next
tick: **at-least-once** delivery, deduped per (kind, alertId, channelId) under normal
operation. Accepted; exactly-once is not a goal.

## Phase 3 — integration tests

### Infrastructure

- Dev deps: `@testcontainers/postgresql` (jest + ts-jest already present).
- Jest `globalSetup`: start a `postgres:17` container, run the checked-in migrations
  with the same programmatic `migrate()` as `main.ts`, export the connection string
  via env. `globalTeardown` stops the container. Docker is required wherever tests
  run (dev machine, CI, or the VPS — all have it).
- Tests construct `DrizzleService` with the container URL — the real production
  adapter, not a different driver — and `new AlertQueue(new AlertQueueRepository(drizzle))`.
  `alert-queue.repository.spec.ts` constructs `AlertQueueRepository` directly for the
  EXPLAIN query-plan case, which needs the unexecuted query builder.
- Tables truncated between tests; small seed helpers insert
  observations/locations/subscriptions/filters/deliveries rows.

### Test matrix

Each case seeds a handful of rows and asserts exactly which alert rows come out:

| Case | Expectation |
|---|---|
| State + county exact match | row pending |
| Same state, different county | absent |
| `countyCode = '*'` wildcard | any county in state pending |
| Inactive subscription | absent |
| Filtered species (comName match on that channel) | absent for that channel, present for others |
| Existing delivery for (species:subId, channel) | absent for that channel, present for others |
| `since` cutoff | `createdAt` before cutoff absent |
| Confirmed obs (valid+reviewed) same species×loc within 7 days | `recentlyConfirmed = true` |
| Confirmed obs outside 7 days, or valid-but-unreviewed | `recentlyConfirmed = false` |
| `markSent` called twice with same alerts | no error, one delivery row each |
| `markSent` with >100 alerts | all recorded (batching) |
| `markSent` alertId format | `speciesCode:subId`, kind `ebird` |
| EXPLAIN smoke test | deliveries anti-join is not a per-row sequential scan (hash anti-join or index usage acceptable) |

The existing mock-chain specs for dispatcher and deliveries are **deleted**, not
migrated — they assert call order, not behavior.

## Error handling

`AlertQueue` methods throw on database errors; `DispatchJob` runs under the Nest
scheduler, which logs uncaught cron errors — current posture, unchanged. Per-channel
Discord send failures stay caught inside the dispatcher (a dead channel must not
block other channels). Note the existing quirk that a failed send is still marked
sent (send-then-record loop records all grouped alerts); preserving that is
acceptable for this spec.

## Out of scope (follow-ups)

- **Backfill unification:** `SubscriptionsRepository.insertEBirdSubscription` still
  contains its own copy of the match/filter/dedup predicates. Next spec: share them
  through `AlertQueue`.
- **Grouping extraction:** `groupObservations` / `getAggregatedObservationStats`
  stay private in the dispatcher for now.
- **Bootstrap timing bugs** (B6: `bootstrapComplete = true` in `finally`) — separate fix.
- The remaining bug list in `docs/architecture-improvements.md` §2.
