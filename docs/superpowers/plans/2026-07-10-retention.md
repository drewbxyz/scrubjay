# Retention (Backlog 2.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound table growth with a daily pruning cron, index the `recentlyConfirmed` probe, and cap the dispatch pending read.

**Architecture:** A new `features/retention` module (repository + service) does batched deletes; a `retention.job.ts` cron in `features/jobs` triggers it daily, following the existing ingest/dispatch job pattern. Two ride-alongs land in existing files: a composite index on `observations` (schema + generated migration) and `ORDER BY … LIMIT` on the pending-alerts query.

**Tech Stack:** NestJS 11, `@nestjs/schedule`, drizzle-orm (node-postgres), vitest with real-Postgres specs via `src/testing/db-helpers.ts`.

**Spec:** `docs/superpowers/specs/2026-07-10-retention-design.md` — read it first; its "Facts" section is the rationale for every constant below.

## Global Constraints

- Observations prune cutoff: `created_at < now() − 14 days` — NEVER lower; pruning inside eBird's 7-day `back` lookback resurrects rows with fresh `createdAt` and double-posts (spec Fact 1-2).
- Deliveries prune cutoff: `sent_at < now() − 30 days` (hard floor is 8 days; 30 is the ops-history decision).
- Locations: orphans only, always pruned AFTER observations (FK is `onDelete: cascade` from locations → observations).
- Batch size 10,000; each batch commits independently (no wrapping transaction).
- Pending read: `ORDER BY created_at ASC, species_code, sub_id LIMIT 500`. `backfillDeliveries` and `sweepExpiredAlerts` stay unlimited.
- All commands run from `apps/scrubjay-discord/`. Tests: `npx vitest run <file>` (real Postgres via testcontainers global setup — first run is slow). Verify types with `npm run check-types`.
- Code style: match existing files — sorted object keys, `@/` path aliases, comments only for constraints code can't show.

---

### Task 1: `recentlyConfirmed` probe index (schema + migration)

**Files:**
- Modify: `apps/scrubjay-discord/src/core/drizzle/drizzle.schema.ts:68-73`
- Create: `apps/scrubjay-discord/src/drizzle/0006_retention_indexes.sql` (generated)
- Test: `apps/scrubjay-discord/src/features/dispatch/alert-queue.repository.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: index `obs_species_location_date_idx` on `observations(species_code, location_id, observation_date)` — serves the EXISTS probe in `buildPendingEBirdAlertsQuery`.

- [ ] **Step 1: Write the failing test**

In `alert-queue.repository.spec.ts`, inside the existing `describe("query plan", …)` block, add:

```ts
it("has a covering index for the recentlyConfirmed probe", async () => {
  const result = await pool.query(
    `SELECT indexdef FROM pg_indexes
     WHERE tablename = 'observations'
       AND indexname = 'obs_species_location_date_idx'`,
  );
  expect(result.rowCount).toBe(1);
  expect(result.rows[0].indexdef).toContain(
    '("species_code", "location_id", "observation_date")',
  );
});
```

Note: `pool` already exists in this spec's `beforeAll`. The test DB template applies every migration in `src/drizzle/` (see `src/testing/global-setup.ts:29-30`), so this fails until the migration exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dispatch/alert-queue.repository.spec.ts -t "covering index"`
Expected: FAIL — `expected 0 to be 1` (index does not exist yet).

- [ ] **Step 3: Add the index to the schema**

In `drizzle.schema.ts`, in the `observations` table's index list (after `obs_review_valid_date_idx`):

```ts
    index("obs_species_location_date_idx").on(t.speciesCode, t.locId, t.obsDt),
```

- [ ] **Step 4: Generate the migration**

Run: `DATABASE_URL=postgres://unused npx drizzle-kit generate --name=retention_indexes`
(`drizzle.config.ts` zod-parses `DATABASE_URL` even though `generate` never connects — any string works.)

Expected: creates `src/drizzle/0006_retention_indexes.sql` containing exactly:

```sql
CREATE INDEX "obs_species_location_date_idx" ON "observations" USING btree ("species_code","location_id","observation_date");
```

If drizzle-kit instead asks interactive questions or emits unrelated statements, STOP — the schema edit diverged from the live migration history; do not hand-edit metadata, re-check Step 3.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/dispatch/alert-queue.repository.spec.ts`
Expected: PASS (all tests in file — the new one and the untouched ones).

- [ ] **Step 6: Commit**

```bash
git add src/core/drizzle/drizzle.schema.ts src/drizzle/ src/features/dispatch/alert-queue.repository.spec.ts
git commit -m "feat(scrubjay-discord): index the recentlyConfirmed probe (backlog 2.3)"
```

---

### Task 2: LIMIT + deterministic ordering on the pending read

**Files:**
- Modify: `apps/scrubjay-discord/src/features/dispatch/alert-queue.repository.ts:196-231`
- Test: `apps/scrubjay-discord/src/features/dispatch/alert-queue.repository.spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: exported `const PENDING_ALERT_LIMIT = 500` from `alert-queue.repository.ts`; `buildPendingEBirdAlertsQuery` now returns at most that many rows, oldest `createdAt` first.

- [ ] **Step 1: Write the failing test**

In `alert-queue.repository.spec.ts`, add a top-level `describe` (sibling of the existing ones). Seed in ONE bulk insert — 510 per-row inserts would be slow:

```ts
import { observations } from "@/core/drizzle/drizzle.schema"; // extend existing import
import {
  AlertQueueRepository,
  PENDING_ALERT_LIMIT,
} from "./alert-queue.repository"; // extend existing import

describe("pending read bound", () => {
  it("returns at most PENDING_ALERT_LIMIT alerts, oldest first", async () => {
    await seedLocation(db);
    await seedSubscription(db);
    const base = Date.now();
    const rows = Array.from({ length: PENDING_ALERT_LIMIT + 10 }, (_, i) => ({
      audioCount: 0,
      comName: "Vermilion Flycatcher",
      // i = 0 is oldest; the 10 newest rows must be the ones deferred.
      createdAt: new Date(base - (PENDING_ALERT_LIMIT + 10 - i) * 1000),
      hasComments: false,
      howMany: 1,
      locId: "L001",
      obsDt: new Date(),
      obsReviewed: false,
      obsValid: false,
      photoCount: 0,
      presenceNoted: false,
      sciName: "Pyrocephalus rubinus",
      speciesCode: "verfly",
      subId: `S${String(i).padStart(4, "0")}`,
      videoCount: 0,
    }));
    await db.db.insert(observations).values(rows);

    const pending = await repository.pendingEBirdAlerts();

    expect(pending).toHaveLength(PENDING_ALERT_LIMIT);
    expect(pending[0].subId).toBe("S0000");
    const returned = new Set(pending.map((alert) => alert.subId));
    for (let i = PENDING_ALERT_LIMIT; i < PENDING_ALERT_LIMIT + 10; i += 1) {
      expect(returned.has(`S${String(i).padStart(4, "0")}`)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dispatch/alert-queue.repository.spec.ts -t "pending read bound"`
Expected: FAIL — first on the import (`PENDING_ALERT_LIMIT` not exported); after a stub export, on `expected 510 to have length 500`.

- [ ] **Step 3: Implement**

In `alert-queue.repository.ts`:

Add `asc` to the drizzle import:

```ts
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
```

Below `CONFIRMED_WINDOW_DAYS`, add:

```ts
/**
 * Per-tick cap on the pending read. Overflow stays pending (no delivery row
 * is written) and drains oldest-first on later ticks; the 15-minute window
 * gives ~15 attempts before the expired sweep records the loss. The
 * species/sub tiebreaker makes truncation deterministic — bulk-ingested
 * rows share created_at.
 */
export const PENDING_ALERT_LIMIT = 500;
```

In `buildPendingEBirdAlertsQuery`, after `.where(this.pendingWhere(since))` append:

```ts
      .orderBy(
        asc(observations.createdAt),
        asc(observations.speciesCode),
        asc(observations.subId),
      )
      .limit(PENDING_ALERT_LIMIT);
```

Do NOT touch `backfillDeliveries` or `sweepExpiredAlerts` — both must see the complete set to be correct.

- [ ] **Step 4: Run the file's tests**

Run: `npx vitest run src/features/dispatch/alert-queue.repository.spec.ts`
Expected: PASS — including the pre-existing EXPLAIN test (the LIMIT adds a numeric bind param; the test's inliner already handles numbers).

- [ ] **Step 5: Run the dispatch service spec (consumer of this query)**

Run: `npx vitest run src/features/dispatch/`
Expected: PASS — dispatch tests seed far fewer than 500 alerts, so behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/features/dispatch/alert-queue.repository.ts src/features/dispatch/alert-queue.repository.spec.ts
git commit -m "feat(scrubjay-discord): bound the pending read to 500 oldest-first (backlog 2.3)"
```

---

### Task 3: RetentionRepository — batched deletes

**Files:**
- Create: `apps/scrubjay-discord/src/features/retention/retention.repository.ts`
- Test: `apps/scrubjay-discord/src/features/retention/retention.repository.spec.ts`

**Interfaces:**
- Consumes: `DrizzleService` from `@/core/drizzle/drizzle.service`.
- Produces (used by Task 4):
  - `pruneObservations(cutoff: Date, batchSize?: number): Promise<number>`
  - `pruneDeliveries(cutoff: Date, batchSize?: number): Promise<number>`
  - `pruneOrphanLocations(batchSize?: number): Promise<number>`
  - each returns the total rows deleted; `RETENTION_BATCH_SIZE = 10_000` exported.

- [ ] **Step 1: Write the failing tests**

Create `retention.repository.spec.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deliveries,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedDelivery,
  seedLocation,
  seedObservation,
  truncateAll,
} from "@/testing/db-helpers";
import { RetentionRepository } from "./retention.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("RetentionRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: RetentionRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new RetentionRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("pruneObservations", () => {
    it("deletes rows past the cutoff and keeps younger ones", async () => {
      await seedLocation(db);
      await seedObservation(db, { createdAt: daysAgo(20), subId: "OLD" });
      await seedObservation(db, { createdAt: daysAgo(5), subId: "YOUNG" });

      const deleted = await repository.pruneObservations(daysAgo(14));

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(observations);
      expect(remaining.map((row) => row.subId)).toEqual(["YOUNG"]);
    });

    it("never deletes a recently created row, whatever its obsDt (resurrection invariant)", async () => {
      await seedLocation(db);
      await seedObservation(db, {
        createdAt: new Date(),
        obsDt: daysAgo(30),
        subId: "LATE_INGEST",
      });

      const deleted = await repository.pruneObservations(daysAgo(14));

      expect(deleted).toBe(0);
    });

    it("drains rows spanning several batches", async () => {
      await seedLocation(db);
      for (let i = 0; i < 5; i += 1) {
        await seedObservation(db, { createdAt: daysAgo(20), subId: `S${i}` });
      }

      const deleted = await repository.pruneObservations(daysAgo(14), 2);

      expect(deleted).toBe(5);
      const remaining = await db.db.select().from(observations);
      expect(remaining).toHaveLength(0);
    });
  });

  describe("pruneDeliveries", () => {
    it("deletes rows past the cutoff by sentAt and keeps younger ones", async () => {
      await seedDelivery(db, { alertId: "verfly:OLD", sentAt: daysAgo(40) });
      await seedDelivery(db, { alertId: "verfly:YOUNG", sentAt: daysAgo(10) });

      const deleted = await repository.pruneDeliveries(daysAgo(30));

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(deliveries);
      expect(remaining.map((row) => row.alertId)).toEqual(["verfly:YOUNG"]);
    });
  });

  describe("pruneOrphanLocations", () => {
    it("deletes only locations no observation references", async () => {
      await seedLocation(db, { id: "L_ORPHAN" });
      await seedLocation(db, { id: "L_LIVE" });
      await seedObservation(db, { locId: "L_LIVE" });

      const deleted = await repository.pruneOrphanLocations();

      expect(deleted).toBe(1);
      const remaining = await db.db.select().from(locations);
      expect(remaining.map((row) => row.id)).toEqual(["L_LIVE"]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/retention/retention.repository.spec.ts`
Expected: FAIL — cannot resolve `./retention.repository`.

- [ ] **Step 3: Implement the repository**

Create `retention.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { type SQL, sql } from "drizzle-orm";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

/** Rows per DELETE pass. Each pass is its own implicit transaction, so the
 * first run (months of backlog) never becomes one giant transaction and a
 * crash mid-prune just resumes on the next daily tick. */
export const RETENTION_BATCH_SIZE = 10_000;

/**
 * Raw data access for retention pruning. Every method returns the total
 * number of rows deleted. Deletes are keyed through a LIMITed subselect —
 * plain `DELETE ... LIMIT` is not SQL.
 */
@Injectable()
export class RetentionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async pruneObservations(
    cutoff: Date,
    batchSize = RETENTION_BATCH_SIZE,
  ): Promise<number> {
    return this.batchedDelete(
      (limit) => sql`
        DELETE FROM observations
        WHERE (species_code, sub_id) IN (
          SELECT species_code, sub_id FROM observations
          WHERE created_at < ${cutoff}
          LIMIT ${limit}
        )`,
      batchSize,
    );
  }

  async pruneDeliveries(
    cutoff: Date,
    batchSize = RETENTION_BATCH_SIZE,
  ): Promise<number> {
    return this.batchedDelete(
      (limit) => sql`
        DELETE FROM deliveries
        WHERE id IN (
          SELECT id FROM deliveries
          WHERE sent_at < ${cutoff}
          LIMIT ${limit}
        )`,
      batchSize,
    );
  }

  async pruneOrphanLocations(
    batchSize = RETENTION_BATCH_SIZE,
  ): Promise<number> {
    return this.batchedDelete(
      (limit) => sql`
        DELETE FROM locations
        WHERE id IN (
          SELECT id FROM locations
          WHERE NOT EXISTS (
            SELECT 1 FROM observations
            WHERE observations.location_id = locations.id
          )
          LIMIT ${limit}
        )`,
      batchSize,
    );
  }

  private async batchedDelete(
    buildDelete: (limit: number) => SQL,
    batchSize: number,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.drizzle.db.execute(buildDelete(batchSize));
      const deleted = result.rowCount ?? 0;
      total += deleted;
      if (deleted < batchSize) {
        return total;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/retention/retention.repository.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/retention/
git commit -m "feat(scrubjay-discord): retention repository with batched prunes (backlog 2.3)"
```

---

### Task 4: RetentionService + RetentionModule

**Files:**
- Create: `apps/scrubjay-discord/src/features/retention/retention.service.ts`
- Create: `apps/scrubjay-discord/src/features/retention/retention.module.ts`
- Test: `apps/scrubjay-discord/src/features/retention/retention.service.spec.ts`

**Interfaces:**
- Consumes: `RetentionRepository` (Task 3 signatures).
- Produces (used by Task 5): `RetentionService.prune(): Promise<void>`; `RetentionModule` exporting `RetentionService`. Consts `OBSERVATION_RETENTION_DAYS = 14`, `DELIVERY_RETENTION_DAYS = 30`.

- [ ] **Step 1: Write the failing tests**

Create `retention.service.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetentionRepository } from "./retention.repository";
import {
  DELIVERY_RETENTION_DAYS,
  OBSERVATION_RETENTION_DAYS,
  RetentionService,
} from "./retention.service";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("RetentionService", () => {
  let service: RetentionService;
  const calls: string[] = [];

  const repositoryMock = {
    pruneDeliveries: vi.fn(async () => {
      calls.push("deliveries");
      return 2;
    }),
    pruneObservations: vi.fn(async () => {
      calls.push("observations");
      return 3;
    }),
    pruneOrphanLocations: vi.fn(async () => {
      calls.push("locations");
      return 1;
    }),
  };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    calls.length = 0;
    repositoryMock.pruneDeliveries.mockClear();
    repositoryMock.pruneObservations.mockClear();
    repositoryMock.pruneOrphanLocations.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T04:17:00Z"));
    service = new RetentionService(
      repositoryMock as unknown as RetentionRepository,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prunes observations before orphan locations", async () => {
    await service.prune();

    expect(calls).toEqual(["observations", "deliveries", "locations"]);
  });

  it("passes each table its retention cutoff", async () => {
    await service.prune();

    expect(repositoryMock.pruneObservations).toHaveBeenCalledWith(
      new Date(Date.now() - OBSERVATION_RETENTION_DAYS * DAY_MS),
    );
    expect(repositoryMock.pruneDeliveries).toHaveBeenCalledWith(
      new Date(Date.now() - DELIVERY_RETENTION_DAYS * DAY_MS),
    );
  });

  it("logs a count per table", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log");

    await service.prune();

    const logged = logSpy.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("3 observation"))).toBe(true);
    expect(logged.some((line) => line.includes("2 deliver"))).toBe(true);
    expect(logged.some((line) => line.includes("1 orphaned location"))).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/retention/retention.service.spec.ts`
Expected: FAIL — cannot resolve `./retention.service`.

- [ ] **Step 3: Implement service and module**

Create `retention.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { RetentionRepository } from "./retention.repository";

/**
 * Floor is the eBird `back=7` lookback: the fetch re-sends every observation
 * with obsDt in the last 7 days, and the ingest upsert preserves createdAt
 * on conflict — but only for rows that still EXIST. Pruning a row inside the
 * lookback re-inserts it next tick with a fresh createdAt, re-entering the
 * dispatch window (double post). obsDt ≤ first-ingest time (±1 day of
 * site-TZ skew), so 14 days of createdAt clears the lookback AND the 7-day
 * recentlyConfirmed window with margin.
 */
export const OBSERVATION_RETENTION_DAYS = 14;

/**
 * Ops history only — nothing reads past the health endpoint's 24h counts.
 * Hard floor is 8 days (the expired sweep scans createdAt back 7 days; a
 * missing delivery row inside that span fabricates 'expired' outcomes).
 */
export const DELIVERY_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly repository: RetentionRepository) {}

  /**
   * Prune order matters only for locations: the orphan anti-join must see
   * the freshly pruned observations, so observations go first.
   */
  async prune(): Promise<void> {
    const now = Date.now();

    const observations = await this.repository.pruneObservations(
      new Date(now - OBSERVATION_RETENTION_DAYS * DAY_MS),
    );
    this.logger.log(
      `Pruned ${observations} observation(s) older than ${OBSERVATION_RETENTION_DAYS} days`,
    );

    const deliveries = await this.repository.pruneDeliveries(
      new Date(now - DELIVERY_RETENTION_DAYS * DAY_MS),
    );
    this.logger.log(
      `Pruned ${deliveries} deliver(y/ies) older than ${DELIVERY_RETENTION_DAYS} days`,
    );

    const locations = await this.repository.pruneOrphanLocations();
    this.logger.log(`Pruned ${locations} orphaned location(s)`);
  }
}
```

Create `retention.module.ts` (`DrizzleModule` is `@Global`, so no imports needed):

```ts
import { Module } from "@nestjs/common";
import { RetentionRepository } from "./retention.repository";
import { RetentionService } from "./retention.service";

@Module({
  exports: [RetentionService],
  providers: [RetentionRepository, RetentionService],
})
export class RetentionModule {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/retention/`
Expected: PASS (repository + service specs).

- [ ] **Step 5: Commit**

```bash
git add src/features/retention/
git commit -m "feat(scrubjay-discord): retention service prunes observations, deliveries, orphan locations (backlog 2.3)"
```

---

### Task 5: RetentionJob cron + JobsModule wiring

**Files:**
- Create: `apps/scrubjay-discord/src/features/jobs/retention.job.ts`
- Modify: `apps/scrubjay-discord/src/features/jobs/jobs.module.ts`
- Test: `apps/scrubjay-discord/src/features/jobs/retention.job.spec.ts`

**Interfaces:**
- Consumes: `RetentionService.prune()` (Task 4), `BootstrapService.waitForBootstrap()` (existing), `RetentionModule` (Task 4).
- Produces: daily cron `17 4 * * *` wired into the app.

- [ ] **Step 1: Write the failing tests**

Create `retention.job.spec.ts` (mirrors `dispatch.job.spec.ts`):

```ts
import { Logger } from "@nestjs/common";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { RetentionService } from "@/features/retention/retention.service";
import type { BootstrapService } from "./bootstrap.service";
import { RetentionJob } from "./retention.job";

describe("RetentionJob", () => {
  let job: RetentionJob;
  let loggerErrorSpy: MockInstance;

  const retentionMock = { prune: vi.fn() };
  const bootstrapMock = { waitForBootstrap: vi.fn() };

  beforeEach(() => {
    loggerErrorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});

    retentionMock.prune.mockReset();
    bootstrapMock.waitForBootstrap.mockReset();
    retentionMock.prune.mockResolvedValue(undefined);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);

    job = new RetentionJob(
      retentionMock as unknown as RetentionService,
      bootstrapMock as unknown as BootstrapService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prunes when bootstrap is complete", async () => {
    await job.run();

    expect(retentionMock.prune).toHaveBeenCalledTimes(1);
  });

  it("skips the run without throwing when bootstrap times out", async () => {
    bootstrapMock.waitForBootstrap.mockRejectedValue(
      new Error("Bootstrap timed out after 5 minutes"),
    );

    await expect(job.run()).resolves.toBeUndefined();

    expect(retentionMock.prune).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("logs instead of throwing when pruning fails", async () => {
    retentionMock.prune.mockRejectedValue(new Error("db unreachable"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Retention run failed"),
      expect.stringContaining("db unreachable"),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/jobs/retention.job.spec.ts`
Expected: FAIL — cannot resolve `./retention.job`.

- [ ] **Step 3: Implement the job and wire the module**

Create `retention.job.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { RetentionService } from "@/features/retention/retention.service";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  /**
   * Daily at 04:17 — an arbitrary quiet minute, off the top of the hour.
   * No in-flight guard: daily cadence cannot self-overlap, and the prunes
   * are idempotent regardless.
   */
  @Cron("17 4 * * *")
  async run() {
    try {
      await this.bootstrapService.waitForBootstrap();
      await this.retention.prune();
    } catch (err) {
      this.logger.error(
        `Retention run failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
```

Modify `jobs.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DispatchModule } from "../dispatch/dispatch.module";
import { HealthModule } from "../health/health.module";
import { IngestModule } from "../ingest/ingest.module";
import { RetentionModule } from "../retention/retention.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { IngestJob } from "./ingest.job";
import { RetentionJob } from "./retention.job";

@Module({
  imports: [
    DispatchModule,
    HealthModule,
    IngestModule,
    RetentionModule,
    SourcesModule,
  ],
  providers: [BootstrapService, DispatchJob, IngestJob, RetentionJob],
})
export class JobsModule {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/jobs/`
Expected: PASS (retention, dispatch, ingest, bootstrap specs).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/
git commit -m "feat(scrubjay-discord): daily retention cron (backlog 2.3)"
```

---

### Task 6: Full verification + backlog update

**Files:**
- Modify: `.superpowers/notes/improvements.md:101-108` (repo root)

**Interfaces:**
- Consumes: everything above.
- Produces: green suite, updated backlog.

- [ ] **Step 1: Run the full gate**

From `apps/scrubjay-discord/`:

Run: `npm run check-types && npm run lint && npm run test`
Expected: types clean, lint clean (it auto-fixes — commit any fixes it makes with the Step 3 commit), every spec passes.

- [ ] **Step 2: Update the backlog entry**

In `.superpowers/notes/improvements.md`, replace the `### 2.3 No retention / unbounded growth` section (keep the heading style of the DONE entries above it):

```markdown
### 2.3 No retention / unbounded growth — DONE 2026-07-10
- Daily retention cron (04:17): observations pruned at createdAt < now-14d
  (floor set by eBird back=7 resurrection risk), deliveries at sentAt <
  now-30d, orphan locations last. Batched deletes, 10k per pass.
- Pending read now ORDER BY created_at, species_code, sub_id LIMIT 500;
  backfill and expired sweep deliberately stay unlimited.
- Added observations(species_code, location_id, observation_date) index
  for the recentlyConfirmed probe (migration 0006).
- Spec: docs/superpowers/specs/2026-07-10-retention-design.md
```

- [ ] **Step 3: Commit**

```bash
git add .superpowers/notes/improvements.md
git commit -m "docs(scrubjay-discord): mark backlog 2.3 done"
```
