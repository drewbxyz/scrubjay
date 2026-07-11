# scrubjay-discord

## 0.2.7

### Patch Changes

- 7bd0e74: Fix `scrubjay.job.runs` / `scrubjay.job.duration` emitting their job identity
  under the attribute key `job`, which collides with Prometheus's reserved `job`
  target label (OTLP ingestion sets `job` = `service.name`). Every series
  therefore showed `job="scrubjay-discord"` and per-job filtering matched
  nothing. The attribute is now `job_name`, so filtering by `dispatch`/`ingest`/…
  works.

## 0.2.6

### Patch Changes

- d8de813: Add operational counters for the critical-health dashboard: `scrubjay.ingest.records{region}` (eBird observations upserted per ingest) and `scrubjay.dispatch.alerts{status}` (alert delivery outcomes — sent, failed, transient, suppressed, expired). Note: `transient` counts retry attempts, not unique alerts, so `sent + failed + transient` is not a partition of unique alerts.

## 0.2.5

### Patch Changes

- 24d6308: Bound and batch the subscribe-time backfill so `subscription add` no longer
  crashes on large regions.

  `backfillDeliveries` marked every currently-pending alert as suppressed with a
  single unbatched insert (4 bind params/row) over an unbounded pending select.
  Two problems compounded on a busy/statewide (`*` county) subscription:

  - **Wire-protocol overflow.** Past 16,383 rows the insert exceeded Postgres's
    16-bit parameter count (max 65,535), desyncing the bind message — surfacing as
    `ERROR: bind message has N parameter formats but 0 parameters` (SQLSTATE
    `08P01`) and rolling back the whole command. Delivery inserts (backfill and the
    expired sweep) now chunk at 1,000 rows / 4,000 params.

  - **Unbounded scan.** The select suppressed the entire retention window, and
    before the retention prune runs the table can hold months of history. Backfill
    now only suppresses alerts from the last 8 days. Dispatch sends on a fixed
    15-minute lookback, so anything older can never reach a newly-subscribed
    channel anyway; 8 days covers the eBird ingest / sweep window (7 days) with a
    day of margin.

## 0.2.4

### Patch Changes

- 7cd2c6a: Stop tracing the Discord gateway WebSocket connection in the OTel
  `HttpInstrumentation`. The gateway is opened via an HTTP GET that upgrades to a
  long-lived WebSocket and never returns, so it produced a client span that
  stayed open for the whole bot session and silently adopted every interaction as
  a child — command traces (e.g. `/ping`) hung off a root that was never exported,
  which Tempo surfaced as "root span not yet received". An `ignoreOutgoingRequestHook`
  now skips `*.discord.gg`, so interactions become their own trace roots.

## 0.2.3

### Patch Changes

- 83be019: Harden `peer.service` host detection in the OTel undici `requestHook`: parse
  the request origin and suffix-match on a label boundary instead of a naive
  substring `includes()` (which `evil-discord.com` / `discord.com.evil.com`
  could slip past), and guard against malformed origins.

## 0.2.2

### Patch Changes

- be08727: Tag outbound eBird and Discord calls with the standard `peer.service`
  attribute via the undici `requestHook`, so a service-graph generator draws
  virtual-node edges for these uninstrumented dependencies and labels them
  cleanly (`ebird`/`discord`) instead of raw hostnames.

## 0.2.1

### Patch Changes

- 8a90c17: Repair the Docker build: put pnpm 11's global bin dir (`$PNPM_HOME/bin`) on PATH so the base-stage turbo install succeeds, and point CMD at `dist/main.js` (output flattened when tsconfig gained an explicit `include: ["src/**/*"]`).

## 0.2.0

### Minor Changes

- 53567da: Delete the RSS feature end-to-end and replace the dispatcher routing layer with `AlertQueue`, a single deep module owning pending-alert selection (matched × unfiltered × undelivered, `recentlyConfirmed` computed in SQL) and idempotent send-marking. `DispatcherService`/`DispatcherMap` are gone now that only eBird alerts exist; callers depend on `EBirdDispatcherService` directly. Migration 0004 drops the `rss_items`, `rss_sources`, and `channel_rss_subscriptions` tables and purges `kind='rss'` delivery rows — irreversible, run automatically at startup.

  Also adds testcontainers-based integration tests (a real `postgres:17` container, migrated with the same programmatic `migrate()` production uses) covering the full pending-alerts spec matrix, including an EXPLAIN smoke test asserting the deliveries exclusion stays an anti-join.

  Spec: `docs/superpowers/specs/2026-07-06-alert-queue-design.md`
  Plan: `docs/superpowers/plans/2026-07-06-alert-queue.md`

- 9839690: create command to add subscriptions

### Patch Changes

- 6d4ea2e: Swat seven latent bugs (B1, B3, B6–B10), each with a regression test:

  - **B1** — `isChannelFilterable` never awaited its query, so a 👎 reaction in any channel could insert a filter row; the guard now actually guards.
  - **B3** — eBird upserts spread raw API keys into `onConflictDoUpdate`, which drizzle silently dropped; location renames and privacy changes now propagate via explicit column mappings.
  - **B6** — a failed bootstrap no longer sets `bootstrapComplete` in a `finally`; startup now fails fast instead of unblocking dispatch into a stale-alert burst.
  - **B7** — bootstrap timeout rejects with a named `Error("Bootstrap timed out after 5 minutes")` instead of a bare `reject()`.
  - **B8** — `DispatchJob.run` catches and logs failures instead of emitting an unhandled rejection every minute.
  - **B9** — the reaction listener resolves partial users before reading `user.bot`.
  - **B10** — `/sub-ebird` no longer interpolates raw error text into Discord replies; invalid-region messages pass through, everything else gets a generic message with the full error logged server-side.

  Spec: `docs/superpowers/specs/2026-07-07-bug-swat-design.md`

- abdfe14: Reorganize the Discord surface the Necord way (§7): the 6-file reaction
  router/explorer/decorator chain collapses into `FiltersReactions`, a single
  Necord handler in the filters slice (which now calls `FiltersRepository`
  directly — the pass-through `FiltersService` is gone). Slash commands move
  into their feature slices (`/sub-ebird` → subscriptions, `/ping` →
  `discord/util.commands.ts`) behind one `CommandExceptionFilter` that logs
  stacks server-side and replies generically (typed `UserFacingError`
  messages, such as `InvalidRegionError`, pass through verbatim). `/sub-ebird`
  now defers its reply, removing the 3-second-window failure mode.
  `DiscordHelper` shrinks to `ChannelSenderService.send()` (~85 dead lines
  deleted).

  Behavior changes: the 👎-filter threshold is now `FILTER_REACTION_THRESHOLD`
  (default 3), and species names containing " - " are parsed correctly from
  embed titles (B2-residual).

- 9c2836e: Make the eBird fetcher seam honest (§6): `fetchRareObservations` now
  validates every row against `RawEBirdObservationSchema` (malformed rows are
  logged and skipped) and throws on HTTP failure instead of silently
  returning an empty batch. The location shape is mapped in one place
  (`upsertLocation` reads it off the observation; `extractLocation` and the
  `EBirdLocation`/`EBirdObservationResponse` types are gone). Pass-through
  `SourcesService` and the dead `getObservationsSinceCreatedDate` chain are
  deleted (§4). `EBirdIngestJob.run` gets the same whole-body try/catch as
  `DispatchJob.run`; a DB failure during startup bootstrap now fails fast
  instead of booting with zero regions.
- 382f0ca: update status text to read "looking for birds..."
- a07650e: Pipeline boundary refactor. Dispatch: send-then-record protocol moves into
  DispatchService (replacing EBirdDispatcherService); a failed Discord send is
  no longer recorded as delivered — the alert stays pending and retries until
  it ages out of the dispatch window. Ingest: features/ebird becomes
  features/ingest; location+observation persistence is one transactional
  upsertObservation; eBird→domain field translation moves into the
  transformer behind a domain Observation type. File names now follow the
  NestJS <name>.<role>.ts convention and specs are co-located with sources.
- 199208f: Migrate the test suite from Jest to Vitest: native oxc decorator-metadata transform, per-worker template databases for parallel integration tests, explicit vitest imports, Jest toolchain removed.

## 0.1.8

### Patch Changes

- 15df5eb: bugfix: create composite primary key on channelId and sourceId for channelRssSubscriptions table
- 146fd69: refactor to create a global service for drizzle

## 0.1.7

### Patch Changes

- e0be080: fix max length for rss description

## 0.1.6

### Patch Changes

- a73f4b5: fix issue where channel rss subscriptions to sources were ignored

## 0.1.5

### Patch Changes

- 885b91a: update readme

## 0.1.4

### Patch Changes

- de75388: update readme

## 0.1.3

### Patch Changes

- 1683bd1: update scrubjay package name

## 0.1.2

### Patch Changes

- a0d7e1f: update configuration

## 0.1.1

### Patch Changes

- cc2eeff: ci fixes

## 0.1.0

### Minor Changes

- 42c7640: Add RSS feed subscription and alerting system

  - Add RSS feed ingestion with automatic fetching every 5 minutes
  - Add RSS dispatcher service to send RSS alerts to Discord channels
  - Add database schema for RSS sources, items, and channel subscriptions
  - Integrate RSS dispatcher into the dispatch job alongside eBird alerts
  - Add RSS service, repository, fetcher, and transformer for feed processing

- 0ff7ef3: Adds voting on messages to add species to channel eBird filters
