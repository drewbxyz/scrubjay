# Bulk Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-row ingest transactions with one all-or-nothing bulk upsert transaction per region (backlog 2.2).

**Architecture:** `ObservationRepository.upsertObservation` (one transaction per row) becomes `upsertObservations(batch)` (one transaction per region: deduped bulk location upsert, then bulk observation upsert, statements chunked at 1,000 rows inside the transaction). `IngestService` drops its loop. Two zod gaps that could poison an all-or-nothing batch (`howMany` non-integer, unparseable `obsDt`) are closed at the fetcher's warn-and-skip layer first.

**Tech Stack:** NestJS, drizzle-orm (node-postgres), zod v4, vitest, @testcontainers/postgresql (repo specs run against a real Postgres).

**Spec:** `docs/superpowers/specs/2026-07-10-bulk-ingest-design.md`

## Global Constraints

- All paths below are relative to `apps/scrubjay-discord`; run all commands from that directory.
- Package manager is `pnpm`. Test command: `pnpm vitest run <file>` (full suite: `pnpm test`). Repo specs need Docker running (testcontainers).
- Chunk size is exactly **1,000 rows per INSERT statement**, chunks issued **inside one transaction** (Postgres 65,535 bind-param cap is a wire-protocol limit, not a transactional boundary).
- Failure mode is all-or-nothing per region: on repo failure the service logs and returns 0; no per-row fallback path.
- The `obsDt` validation only guarantees the string parses; it must NOT change how the date is interpreted (backlog 1.4 owns timezone semantics).
- Lint/format is Biome (repo root `biome.json`); match existing code style (alphabetized object keys, JSDoc on public repo methods).
- Commit messages follow the existing convention: `feat(scrubjay-discord): ...` / `test(scrubjay-discord): ...`.

---

### Task 1: Close the poison-row zod gaps (fetcher layer)

**Files:**
- Modify: `src/features/ingest/ebird.schema.ts:12,19`
- Test: `src/features/ingest/ebird.fetcher.spec.ts`

**Interfaces:**
- Consumes: existing `RawEBirdObservationSchema`, fetcher warn-and-skip loop (`ebird.fetcher.ts:71-81`) — unchanged.
- Produces: `EBirdObservation` rows whose `howMany` is an integer (or absent) and whose `obsDt` string is parseable by `Date.parse`. Tasks 2–3 rely on this: any row reaching the repo can be inserted.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("EBirdFetcher")` block in `src/features/ingest/ebird.fetcher.spec.ts` (after the "skips malformed rows" test, which shows the pattern these follow):

```ts
it("skips rows with a fractional howMany", async () => {
  const fractional = { ...validObservation, howMany: 2.5 };
  mockFetchResponse([validObservation, fractional]);

  const result = await fetcher.fetchRareObservations("US-WA");

  expect(result).toEqual([validObservation]);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining("Skipping malformed observation at index 1"),
  );
});

it("skips rows whose obsDt cannot be parsed as a date", async () => {
  const badDate = { ...validObservation, obsDt: "not-a-date" };
  mockFetchResponse([validObservation, badDate]);

  const result = await fetcher.fetchRareObservations("US-WA");

  expect(result).toEqual([validObservation]);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining("Skipping malformed observation at index 1"),
  );
});

it("accepts eBird's native space-separated obsDt format", async () => {
  const native = { ...validObservation, obsDt: "2020-01-21 16:35" };
  mockFetchResponse([native]);

  const result = await fetcher.fetchRareObservations("US-WA");

  expect(result).toEqual([native]);
  expect(warnSpy).not.toHaveBeenCalled();
});
```

The third test is a regression guard: eBird sends `"2020-01-21 16:35"` (space, no offset) and V8's `Date.parse` accepts it — the new refinement must not reject the real payload format.

- [ ] **Step 2: Run tests to verify the first two fail**

Run: `pnpm vitest run src/features/ingest/ebird.fetcher.spec.ts`
Expected: "skips rows with a fractional howMany" and "skips rows whose obsDt cannot be parsed" FAIL (rows currently pass validation, so `result` contains 2 rows); "accepts eBird's native space-separated obsDt format" PASSES.

- [ ] **Step 3: Tighten the schema**

In `src/features/ingest/ebird.schema.ts`, change two fields:

```ts
  howMany: z.number().int().optional(),
```

```ts
  obsDt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "unparseable observation date"),
```

(`howMany` is currently `z.number().optional()` on line 12; `obsDt` is `z.string()` on line 19.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/ingest/ebird.fetcher.spec.ts`
Expected: all tests PASS, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/features/ingest/ebird.schema.ts src/features/ingest/ebird.fetcher.spec.ts
git commit -m "feat(scrubjay-discord): reject non-integer counts and unparseable dates at ingest validation"
```

---

### Task 2: `ObservationRepository.upsertObservations` (bulk, one transaction)

**Files:**
- Modify: `src/features/ingest/observation.repository.ts` (full rewrite of the class body)
- Test: `src/features/ingest/observation.repository.spec.ts`

**Interfaces:**
- Consumes: `DrizzleService.db` (drizzle node-postgres instance), `locations` / `observations` tables from `@/core/drizzle/drizzle.schema`, `Observation` from `./observation.interface`.
- Produces: `upsertObservations(batch: Observation[]): Promise<void>` — the ONLY public method; `upsertObservation` (singular) is deleted. Task 3's service calls exactly this signature.

- [ ] **Step 1: Rewrite the spec file's `upsertObservation` describe block**

Replace the entire `describe("upsertObservation", ...)` block in `src/features/ingest/observation.repository.spec.ts` with (imports, `baseObservation`, and the outer `describe` setup stay as they are):

```ts
  describe("upsertObservations", () => {
    it("persists observations and their embedded locations in one call", async () => {
      await repository.upsertObservations([baseObservation]);

      const location = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L001"),
      });
      const observation = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(location?.name).toBe("Test Hotspot");
      expect(observation?.speciesCode).toBe("verfly");
    });

    it("dedups locations shared within a batch, last row wins", async () => {
      await repository.upsertObservations([
        baseObservation,
        {
          ...baseObservation,
          locationName: "Renamed Hotspot",
          speciesCode: "carwre",
          subId: "S002",
        },
      ]);

      const locationRows = await db.db.query.locations.findMany();
      const observationRows = await db.db.query.observations.findMany();
      expect(locationRows).toHaveLength(1);
      expect(locationRows[0]?.name).toBe("Renamed Hotspot");
      expect(observationRows).toHaveLength(2);
    });

    it("updates mapped columns on conflict", async () => {
      await repository.upsertObservations([baseObservation]);
      await repository.upsertObservations([{ ...baseObservation, howMany: 7 }]);

      const row = await db.db.query.observations.findFirst({
        where: eq(observations.subId, "S001"),
      });
      expect(row?.howMany).toBe(7);
    });

    it("propagates location renames and privacy changes on conflict", async () => {
      await repository.upsertObservations([baseObservation]);
      await repository.upsertObservations([
        { ...baseObservation, isPrivate: true, locationName: "New Name" },
      ]);

      const row = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L001"),
      });
      expect(row?.name).toBe("New Name");
      expect(row?.isPrivate).toBe(true);
    });

    it("is a no-op for an empty batch", async () => {
      await repository.upsertObservations([]);

      const observationRows = await db.db.query.observations.findMany();
      expect(observationRows).toHaveLength(0);
    });

    it("handles batches larger than one statement chunk", async () => {
      const batch = Array.from({ length: 1050 }, (_, i) => ({
        ...baseObservation,
        locId: `L${i}`,
        subId: `S${i}`,
      }));

      await repository.upsertObservations(batch);

      const observationRows = await db.db.query.observations.findMany();
      expect(observationRows).toHaveLength(1050);
    });
  });
```

Why these cases: the shared-`locId` test covers the mandatory dedup (Postgres rejects a multi-row `ON CONFLICT DO UPDATE` touching the same row twice — without dedup this test errors, it doesn't just miscount); the 1,050-row test crosses the 1,000-row chunk boundary for both tables; the empty-batch test guards drizzle's throw on `.values([])`; the two conflict tests preserve the old update semantics through the new API.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/features/ingest/observation.repository.spec.ts`
Expected: FAIL — `repository.upsertObservations is not a function` (Docker must be running for testcontainers).

- [ ] **Step 3: Rewrite the repository**

Replace the entire contents of `src/features/ingest/observation.repository.ts` with:

```ts
import { Injectable } from "@nestjs/common";
import { getTableColumns, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import type { Observation } from "./observation.interface";

/**
 * Rows per INSERT statement. Postgres caps a statement at 65,535 bind
 * parameters (~15 columns per row here). Chunks are issued inside ONE
 * transaction, so the cap never splits a batch's atomicity.
 */
const CHUNK_SIZE = 1000;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

/**
 * Build an onConflictDoUpdate `set` that reads each column's value from the
 * incoming row (Postgres `excluded.*`). Required for multi-row upserts,
 * where a literal value cannot vary per row.
 */
function excludedColumns<T extends PgTable>(
  table: T,
  keys: (keyof T["_"]["columns"] & string)[],
): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded."${columns[key].name}"`)]),
  );
}

@Injectable()
export class ObservationRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Persist one region's ingested batch in a single transaction: bulk
   * location upsert, then bulk observation upsert. Locations are deduped
   * by id first — a multi-row INSERT ... ON CONFLICT DO UPDATE may not
   * touch the same row twice. All-or-nothing by design: the batch is
   * idempotent, so callers retry it on the next tick.
   */
  async upsertObservations(batch: Observation[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const locationRows = [
      ...new Map(
        batch.map((data) => [
          data.locId,
          {
            county: data.county,
            countyCode: data.countyCode,
            id: data.locId,
            isPrivate: data.isPrivate,
            lat: data.lat,
            lng: data.lng,
            name: data.locationName,
            state: data.state,
            stateCode: data.stateCode,
          },
        ]),
      ).values(),
    ];

    const observationRows = batch.map((data) => ({
      audioCount: data.audioCount,
      comName: data.comName,
      hasComments: data.hasComments,
      howMany: data.howMany,
      locId: data.locId,
      obsDt: data.obsDt,
      obsReviewed: data.obsReviewed,
      obsValid: data.obsValid,
      photoCount: data.photoCount,
      presenceNoted: data.presenceNoted,
      sciName: data.sciName,
      speciesCode: data.speciesCode,
      subId: data.subId,
      videoCount: data.videoCount,
    }));

    await this.drizzle.db.transaction(async (tx) => {
      for (const rows of chunk(locationRows, CHUNK_SIZE)) {
        await tx
          .insert(locations)
          .values(rows)
          .onConflictDoUpdate({
            set: {
              ...excludedColumns(locations, [
                "county",
                "countyCode",
                "isPrivate",
                "lat",
                "lng",
                "name",
                "state",
                "stateCode",
              ]),
              lastUpdated: new Date(),
            },
            target: [locations.id],
          });
      }

      for (const rows of chunk(observationRows, CHUNK_SIZE)) {
        await tx
          .insert(observations)
          .values(rows)
          .onConflictDoUpdate({
            set: {
              ...excludedColumns(observations, [
                "audioCount",
                "comName",
                "hasComments",
                "howMany",
                "locId",
                "obsDt",
                "obsReviewed",
                "obsValid",
                "photoCount",
                "presenceNoted",
                "sciName",
                "videoCount",
              ]),
              lastUpdated: new Date(),
            },
            target: [observations.speciesCode, observations.subId],
          });
      }
    });
  }
}
```

Notes for the implementer:
- The `set` column lists reproduce the old per-row `set` clauses exactly (they update every mapped column except primary keys and `createdAt`, plus `lastUpdated: new Date()`).
- `excludedColumns` maps drizzle property names (`countyCode`) to SQL column names (`county_code`) via `getTableColumns` — do not hand-write `excluded.countyCode`, the SQL name is what Postgres sees.
- `new Map(...)` keyed by `locId` gives last-wins dedup because later `set` calls overwrite earlier keys.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/features/ingest/observation.repository.spec.ts`
Expected: all 6 tests PASS.

Note: `src/features/ingest/ingest.service.ts` still calls the deleted `upsertObservation` at this point, so the app does not compile until Task 3 — that is expected mid-plan; the repo spec passing is this task's gate. (`pnpm check-types` will fail here; run it after Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/features/ingest/observation.repository.ts src/features/ingest/observation.repository.spec.ts
git commit -m "feat(scrubjay-discord): bulk observation upsert in one transaction per region"
```

---

### Task 3: `IngestService` drops the loop

**Files:**
- Modify: `src/features/ingest/ingest.service.ts:35-47`
- Test: `src/features/ingest/ingest.service.spec.ts`

**Interfaces:**
- Consumes: `ObservationRepository.upsertObservations(batch: Observation[]): Promise<void>` from Task 2.
- Produces: `ingestRegion(regionCode: string): Promise<number>` — unchanged signature; returns the transformed-batch size on success, 0 on fetch OR persist failure. Callers (`jobs/ingest.job.ts:36`, `jobs/bootstrap.service.ts:45`) need no changes.

- [ ] **Step 1: Rework the service spec**

In `src/features/ingest/ingest.service.spec.ts`:

1. Change the repo mock (currently `upsertObservation: vi.fn()`):

```ts
  const repoMock = {
    upsertObservations: vi.fn(),
  };
```

2. In the test `"ingests transformed observations for a region"`, replace the per-row assertion:

```ts
    expect(repoMock.upsertObservations).toHaveBeenCalledWith([
      transformedObservation,
    ]);
```

3. Replace the test `"continues past a failed observation and counts only successes"` entirely with:

```ts
  it("returns zero and logs when persisting the batch fails", async () => {
    const errorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
    transformerMock.transformObservations.mockReturnValue([
      transformedObservation,
    ]);
    repoMock.upsertObservations.mockRejectedValue(new Error("db down"));

    const inserted = await service.ingestRegion("US-WA");

    expect(inserted).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("US-WA"),
      expect.any(String),
    );
  });
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/features/ingest/ingest.service.spec.ts`
Expected: FAIL — the happy-path test and the new failure test both fail (service still calls the now-nonexistent `upsertObservation` per row).

- [ ] **Step 3: Rewrite `ingestRegion`'s persist section**

In `src/features/ingest/ingest.service.ts`, replace lines 32–47 (from `const transformedObservations = ...` through `return insertedCount;`) with:

```ts
    const batch = this.transformer.transformObservations(rawObservations);

    try {
      await this.repo.upsertObservations(batch);
    } catch (err) {
      this.logger.error(
        `Error persisting ${batch.length} observations from ${regionCode}`,
        err instanceof Error ? err.stack : String(err),
      );
      return 0;
    }

    return batch.length;
```

The fetch section (lines 17–30) is unchanged; the failure branch mirrors its shape.

- [ ] **Step 4: Run the spec and the type check**

Run: `pnpm vitest run src/features/ingest/ingest.service.spec.ts`
Expected: all tests PASS.

Run: `pnpm check-types`
Expected: clean — this also proves no other caller of the deleted `upsertObservation` exists.

- [ ] **Step 5: Commit**

```bash
git add src/features/ingest/ingest.service.ts src/features/ingest/ingest.service.spec.ts
git commit -m "feat(scrubjay-discord): ingest persists each region as one bulk batch"
```

---

### Task 4: Full verification + backlog bookkeeping

**Files:**
- Modify: `.superpowers/notes/improvements.md:92` (repo root)

**Interfaces:**
- Consumes: everything above.
- Produces: green suite, updated backlog.

- [ ] **Step 1: Run the full gate**

Run (from `apps/scrubjay-discord`): `pnpm test && pnpm check-types && pnpm lint`
Expected: full suite PASS, types clean, no lint errors. If Biome reformats anything, include it in the commit below.

- [ ] **Step 2: Verify no stragglers reference the old API**

Run: `grep -rn "upsertObservation\b" src/`
Expected: no matches (only `upsertObservations` remains).

- [ ] **Step 3: Mark 2.2 done in the backlog**

In `.superpowers/notes/improvements.md` (repo root), change the 2.2 heading and append a status line, following the 2.1 convention:

```markdown
### 2.2 Ingest does per-row transactions in a loop — DONE 2026-07-10
- Was: `ingest.service.ts:33-42` looped; `observation.repository.ts` opened a
  transaction per observation (2 upserts each) → 2N statements / N transactions per tick.
- Now: one transaction per region — locations deduped by locId, bulk
  `onConflictDoUpdate` upserts via `excluded.*`, statements chunked at 1,000 rows.
  Zod tightened (`howMany` int, `obsDt` must parse) so poison rows warn-and-skip
  at the fetcher instead of failing the batch.
- Spec: docs/superpowers/specs/2026-07-10-bulk-ingest-design.md
```

- [ ] **Step 4: Commit**

```bash
git add .superpowers/notes/improvements.md
git commit -m "docs(scrubjay-discord): mark backlog 2.2 (bulk ingest) done"
```
