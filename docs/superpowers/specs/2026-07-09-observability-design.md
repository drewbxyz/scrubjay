# Observability — Health Endpoint, Ingest Freshness, Silent No-op

**Date:** 2026-07-09
**Status:** Approved
**Scope:** `apps/scrubjay-discord` (backlog item 2.1)

## Problem

The app has no way to answer "is it working?" without reading logs:

1. **Silent ingest no-op.** `getEBirdSources()` returning `[]` makes the ingest
   tick a no-op with zero log lines (`ingest.job.ts`). Nothing anywhere records
   when ingest last succeeded, so a wedged or misconfigured ingest is
   indistinguishable from a quiet day.
2. **Dead port.** The app listens on `PORT` (default 3000) serving nothing — no
   HTTP controllers exist. The `features/health` module is only the Discord
   `/ping` command.
3. **No orchestrator signal.** The Dockerfile has no `HEALTHCHECK`; Docker
   considers a wedged container healthy forever.

Already resolved since the 2026-07-09 audit (not in scope here): the log-stack
sweep (`f22d77d`) and the delivery `status`/`detail` columns (dispatch-semantics
work), whose spec explicitly defers "health-endpoint consumers of the new
statuses" to this design.

## Decisions (made with owner, 2026-07-09)

1. **Consumer: Docker healthcheck** (plus manual curl). No external uptime
   monitor for now.
2. **Only the DB ping fails the check.** Unhealthy → Docker restarts the
   container, and a restart only fixes DB-unreachable/wedged-process states.
   Ingest staleness during an eBird outage must not cause a restart loop — it
   is reported in the response body, never in the status code.
3. **Ingest freshness is in-memory.** Single process, informational-only data,
   reconstructible within one 15-minute tick — no migration, no per-tick DB
   writes. Resets on restart (reads as "no ingest since boot", which is true).
4. **Library: `@nestjs/terminus`** (owner's choice over a hand-rolled
   controller). Standard response shape; no `@nestjs/axios` (the HTTP indicator
   is not needed).
5. **Scope: all of backlog 2.1** — health endpoint, ingest freshness tracking,
   empty-sources visibility, Dockerfile `HEALTHCHECK`, plus the deferred
   dispatch-status consumer (last tick + 24h outcome counts).

## Design

### 1. Module layout

Everything lives in `features/health`, which grows from "Discord /ping" into
the observability surface:

```
features/health/
  health.commands.ts        (existing /ping, unchanged)
  health.module.ts          (adds TerminusModule, controller, providers)
  health.controller.ts      GET /health
  health-state.service.ts   in-memory tick/success recorder (exported)
  health.repository.ts      read-only grouped count over deliveries
  indicators/
    database.health.ts
    ingest.health.ts
    dispatch.health.ts
```

`HealthModule` depends only on `core/drizzle` (global) and exports
`HealthStateService`. `JobsModule` imports `HealthModule` so the jobs can write
into the state service. Health never imports from `features/dispatch` or
`features/ingest` — no cycles.

New dependency: `@nestjs/terminus`. Custom indicators use the current
`HealthIndicatorService` API (the `HealthIndicator` base class is deprecated).

### 2. `HealthStateService` — in-memory freshness

Singleton with:

- `recordIngestTick(regions: string[])` — stamps `lastIngestTickAt`, stores the
  region list.
- `recordIngestSuccess(region: string)` — stamps per-region last success.
- `recordDispatchTick()` — stamps `lastDispatchTickAt`.
- `snapshot()` — returns the above plus a computed `stale` boolean per region:
  no success within `INGEST_STALE_AFTER_MS = 45 * 60 * 1000` (3 missed ticks of
  the `*/15` ingest cron; exported const next to the service). For a region
  with no recorded success the clock starts at service construction (boot), so
  a fresh boot reports `lastSuccessAt: null, stale: false` for its first 45
  minutes rather than flagging every region stale until the first tick.

### 3. Indicators and semantics

- **`database`** — `SELECT 1` via `DrizzleService`. The **only** indicator that
  can fail. The existing pool already carries connection/statement timeouts, so
  a dead DB fails fast rather than hanging the healthcheck.
- **`ingest`** — always "up"; carries details from `HealthStateService`:
  `lastTickAt`, `sources` (region list), per-region `{ lastSuccessAt, stale }`,
  and `noSources: true` when the list is empty.
- **`dispatch`** — always "up"; details: `lastTickAt` plus counts of
  `deliveries.status` (`sent`/`failed`/`expired`/`suppressed`) where `sentAt`
  is within the trailing 24 hours, via `health.repository.ts`.

Caveat (accepted): the dispatch indicator queries the DB, so a dead DB makes it
error too. Consistent with decision 2 — the `database` indicator already
returns 503 in that scenario.

`GET /health` → terminus `health.check([database, ingest, dispatch])`. 200 with
`info`/`details` sections when healthy; 503 with an `error` section when the DB
ping fails.

### 4. Job wiring

`IngestJob` (inject `HealthStateService`):

- After fetching sources: `recordIngestTick(regions)`; if `regions.length === 0`,
  `logger.warn("No eBird sources configured; ingest is a no-op")` — the silent
  no-op becomes visible in logs every empty tick.
- After each successful `ingestRegion(region)`: `recordIngestSuccess(region)`.
  Failed regions are already logged and simply don't advance freshness.

`DispatchJob`: `recordDispatchTick()` at the start of a non-skipped run.

### 5. Dockerfile

Add to the runner stage (alpine has no curl; node 22's global fetch works):

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT ?? 3000) + "/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
```

The script must stay single-quoted with string concatenation — backticks or
`${...}` inside double quotes would be expanded by `/bin/sh` before node sees
them.

The 60s start period covers migrations plus Discord login before the first
probe counts against the container.

## Error handling

Terminus catches per-indicator errors natively: a throwing indicator becomes an
`error` entry and a 503. No custom exception filtering. The state service does
no I/O and cannot fail.

## Testing

Vitest unit specs, matching repo convention:

- `health-state.service.spec.ts` — staleness math (fresh/stale/never-succeeded),
  snapshot shape, empty-region handling. Fake timers.
- `indicators/*.spec.ts` — database up/down (mock DrizzleService), ingest
  details incl. `noSources`, dispatch counts (mock repository).
- `health.controller.spec.ts` — mocked indicators wire into `health.check`;
  healthy → combined payload, DB-down → 503.
- `ingest.job.spec.ts` additions — records tick/success, warns on empty
  sources, failed region does not record success.
- Dockerfile `HEALTHCHECK`: manual verification (build image, `docker inspect`
  health status) — not automated.

## Out of scope

- Discord `/status` command (Tier 3 item 4 — reads the same
  `HealthStateService`, natural follow-up).
- External uptime monitoring, metrics/Prometheus, alerting.
- Persisting freshness across restarts.
- Ingest staleness ever failing the healthcheck.

## Sequencing

Lands **after** the in-flight dispatch-semantics work commits — the dispatch
indicator reads the `status` column that work is stabilizing.
