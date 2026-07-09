# Design: honest eBird fetcher seam (§6 + eBird half of §4)

**Date:** 2026-07-08
**Status:** Approved
**Source:** `docs/architecture-improvements.md` §6, plus the eBird-adjacent
remainder of §4 (`SourcesService`, dead eBird chain) and §8's dead
`EBirdObservationResponse` type. Re-verified against main (post PR #66) on
2026-07-08. Ships as one PR on `refactor/ebird-seam`.

**Decisions made during brainstorming:**
- Validate (don't drop zod): per-item `safeParse`, log-and-skip invalid rows.
  One malformed observation costs that observation, not the region.
- The parse loop lives inline in the fetcher — no separate parser module.
  The fetcher's job IS the untrusted→trusted boundary; extract a parser only
  when a second eBird endpoint appears (e.g. region-list autocomplete).
- `BootstrapService.onModuleInit` keeps its bare `getEBirdSources()` call:
  with `SourcesService`'s swallow gone, a dead DB at startup now crashes the
  app instead of booting a bot that thinks it has zero subscriptions.
  Deliberate, and consistent with the existing B6 comment ("a crashed
  startup beats dispatching a burst of stale alerts").
- B3 is already fixed (PR #64); this design only collapses the remaining
  triple transcription of the location shape.

## Current state (verified 2026-07-08)

- `ebird.fetcher.ts:32` does `await response.json()` and returns it cast to
  `EBirdObservation[]`; `RawEBirdObservationSchema` is parsed nowhere.
- The fetcher swallows HTTP errors (`!response.ok` → warn → `return []`)
  while network errors throw — two error channels for one failure mode;
  `EBirdService.ingestRegion`'s catch only ever sees the second.
- The location shape is transcribed three times: the `EBirdLocation` `Pick`
  (schema), an 11-field identity copy in `extractLocation` (transformer),
  and the column mapping in `upsertLocation` (repository).
- `EBirdService.getObservationsSinceCreatedDate` →
  `EBirdRepository.getAlertsCreatedSinceDate` is a dead vertical chain; the
  repo method's only other reference is a jest mock stub in
  `ebird.service.spec.ts`.
- `SourcesService` wraps its single repo call in catch-log-return-`[]`.
  **The doc's claim that its callers have their own try/catch is stale:**
  `EBirdIngestJob.run` calls `waitForBootstrap()` and `getEBirdSources()`
  bare (only the per-region loop is wrapped), and
  `BootstrapService.onModuleInit` calls `getEBirdSources()` bare. PR #64
  gave `DispatchJob.run` a whole-body try/catch but `EBirdIngestJob.run`
  never got one — a bootstrap timeout there is an unhandled rejection today.

## 1. Fetcher seam (`ebird.fetcher.ts`)

`fetchRareObservations(regionCode)` becomes the single boundary where
untrusted network data becomes trusted domain data. New contract:
**returns validated observations, or throws.**

```ts
const response = await fetch(url, { headers: { "X-eBirdApiToken": token } });
if (!response.ok) {
  throw new Error(
    `eBird API returned ${response.status} ${response.statusText}`,
  );
}

const data: unknown = await response.json();
if (!Array.isArray(data)) {
  throw new Error("eBird API returned a non-array payload");
}

const valid: EBirdObservation[] = [];
let skipped = 0;
for (const [index, row] of data.entries()) {
  const result = RawEBirdObservationSchema.safeParse(row);
  if (result.success) {
    valid.push(result.data);
  } else {
    skipped++;
    this.logger.warn(
      `Skipping malformed observation at index ${index}: ${z.prettifyError(result.error)}`,
    );
  }
}

this.logger.log(
  skipped > 0
    ? `Fetched ${valid.length} observations (${skipped} skipped)`
    : `Fetched ${valid.length} observations`,
);
return valid;
```

- The `!response.ok` → warn → `return []` channel is deleted. HTTP failures
  and network failures now take the same path: a throw, caught by
  `ingestRegion`'s existing catch (which logs and returns 0 for the region).
- A malformed *row* is a data problem: skip it, log which index and why,
  ingest the rest. A malformed *payload* (non-array) is a broken response:
  throw.
- `EBirdService` needs no change for this — its catch already handles
  throws. (Its changes come from §2 and §4 below.)

## 2. Location-mapping collapse

- Delete `EBirdTransformer.extractLocation` and the `EBirdLocation` type.
- `EBirdRepository.upsertLocation(data: TransformedEBirdObservation)` reads
  the location fields off the observation directly. The insert `values` and
  conflict `set` keep their existing column-keyed shape (already correct
  post-B3) — the eBird→column mapping now lives in exactly one place.
- `EBirdService.ingestObservation` becomes:

```ts
async ingestObservation(observation: TransformedEBirdObservation) {
  await this.repo.upsertLocation(observation);
  await this.repo.upsertObservation(observation);
}
```

- `EBirdTransformer` keeps only `transformObservations` (the media-count
  collapse on `speciesCode-subId`) — the logic that earns its keep.

## 3. `SourcesService` deletion + ingest-job hardening

- Delete `sources/sources.service.ts`; `SourcesModule` provides and exports
  `SourcesRepository`. Both callers inject the repository directly.
- `EBirdIngestJob.run` gets the same whole-body try/catch `DispatchJob.run`
  got in PR #64:

```ts
@Cron("*/15 * * * *")
async run() {
  try {
    await this.bootstrapService.waitForBootstrap();
    this.logger.debug("Starting eBird ingestion job...");
    const regions = await this.sourcesRepository.getEBirdSources();
    for (const region of regions) {
      try {
        const inserted = await this.ebird.ingestRegion(region);
        this.logger.log(`Region ${region}: ${inserted} alerts ingested`);
      } catch (err) {
        this.logger.error(`Failed to ingest ${region}: ${err}`);
      }
    }
  } catch (err) {
    this.logger.error(`Ingest tick failed: ${err}`);
  }
}
```

  This closes the pre-existing B7 gap (bare `waitForBootstrap`) and gives
  the now-unswallowed `getEBirdSources` error a home. A DB hiccup during a
  cron tick means a skipped tick with an error log, not a crash.
- `BootstrapService.onModuleInit` swaps `this.sources.getEBirdSources()`
  for the repository call and stays otherwise unchanged — including no
  try/catch around it (see decision above: fail fast at startup).

## 4. Dead-code deletions

- `EBirdService.getObservationsSinceCreatedDate` and
  `EBirdRepository.getAlertsCreatedSinceDate`.
- `EBirdObservationResponse` in `ebird.schema.ts` (byte-identical duplicate
  of `EBirdObservation`).
- (`sources/` has no spec directory — nothing to delete there; verified.)

## Behavior changes (summarized)

1. Malformed eBird rows are skipped and logged instead of flowing into the
   DB as NULL-constraint errors mid-upsert.
2. eBird HTTP errors surface through `ingestRegion`'s catch as
   `logger.error` (was `logger.warn` + silent empty batch).
3. DB failure during a cron ingest tick: skipped tick with `Ingest tick
   failed` log (was: unhandled-rejection risk via bare `waitForBootstrap`,
   or silent empty region list via `SourcesService`).
4. DB failure during startup bootstrap: the app crashes (was: boots with
   zero regions, then marks pending alerts sent).

## Testing

Moved/extended specs; full suite green from `apps/scrubjay-discord/`
(`./node_modules/.bin/jest`, Docker running); `pnpm run format-and-lint:fix`
and `pnpm run check-types` clean from repo root.

- `ebird.fetcher.spec.ts` (extends the existing fetch-mock pattern):
  - HTTP 500 → throws `eBird API returned 500 Internal Server Error`
  - non-array JSON body → throws `eBird API returned a non-array payload`
  - one malformed row among valid rows → returns only the valid rows,
    `logger.warn` called with the bad row's index
  - all rows valid → returned in full, no warn
  - `X-eBirdApiToken` header still sent (existing case, unchanged)
- `ebird.service.spec.ts`: fetcher throw → returns 0 and logs error
  (existing case); delete the `getAlertsCreatedSinceDate` mock stub and any
  `getObservationsSinceCreatedDate` coverage.
- `ebird.transformer.spec.ts`: delete `extractLocation` cases;
  `transformObservations` cases unchanged.
- `ebird.repository.spec.ts` (real Postgres): `upsertLocation` is fed a
  full `TransformedEBirdObservation`; the rename-propagation regression
  case (B3) stays.
- `ebird-ingest.job` / `bootstrap.service` specs: mock `SourcesRepository`
  instead of `SourcesService`. New case for the ingest job:
  `getEBirdSources` rejects → `run()` resolves (no throw) and logs
  `Ingest tick failed`.

## Out of scope

- Region autocomplete for `/sub-ebird` (deferred; its arrival is the
  trigger to extract a shared eBird parsing seam).
- The dispatch alert-loss question (failed send still marks alerts `sent`)
  — needs its own retry-semantics design.
- Any schema/migration change.
- `core/timezones` (owner decided to keep it).
