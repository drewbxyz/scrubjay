# AlertQueue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the RSS feature end-to-end, then put all dispatch matching/dedup logic behind one deep module (`AlertQueue`) with integration tests against real Postgres.

**Architecture:** ScrubJay is two pipelines (ingest, dispatch) communicating only through Postgres. This plan removes the dead RSS pipeline (code + tables), collapses the now-pointless dispatcher routing layer, and moves the 5-table pending-alerts join, confirmed-species logic, and delivery recording into a single injectable `AlertQueue` class tested via testcontainers.

**Tech Stack:** NestJS 11, Drizzle ORM (node-postgres), Postgres 17, Jest 29 + ts-jest, `@testcontainers/postgresql`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-06-alert-queue-design.md`

## Global Constraints

- All commands run from `apps/scrubjay-discord/` unless a path is shown.
- Before every commit: run `pnpm format-and-lint:fix` from the **repo root** (biome), then re-run the task's tests if it changed anything.
- `pnpm test` requires Docker running (testcontainers starts `postgres:17`) from Task 2 onward.
- Never edit migrations `0000`–`0003`. Migration `0004` may be edited only before it is first committed.
- Only new dependency allowed: `@testcontainers/postgresql` (dev). Remove `rss-parser`. No other dependency changes.
- Only `alert-queue.spec.ts` may write to test-database tables; `migrations.spec.ts` may only read `information_schema`. (Jest runs spec files in parallel workers against the one shared container — writes in a second file would race.)
- The `deliveries.alert_kind` column and `deliveries_unique_idx` are load-bearing; do not drop or rename them.
- Alert identity is `` `${speciesCode}:${subId}` `` with kind `'ebird'`. After Task 6, only `AlertQueue.markSent` is allowed to build that string.
- Commit messages follow the repo's conventional style (`feat:`, `chore:`, `refactor:`, `test:`).

---

### Task 1: Delete the RSS pipeline and collapse dispatcher routing

Everything RSS except the database schema (that's Task 3), plus the routing layer that only existed to choose between two dispatchers.

**Files:**
- Delete: `src/features/rss/` (entire directory, including `__tests__/`)
- Delete: `src/features/jobs/rss-ingest.job.ts`
- Delete: `src/features/dispatcher/dispatchers/rss-dispatcher.service.ts`
- Delete: `src/features/dispatcher/dispatcher.service.ts`
- Delete: `src/features/dispatcher/dispatcher.interface.ts`
- Delete: `src/features/dispatcher/__tests__/dispatcher.service.spec.ts`
- Modify: `src/features/dispatcher/dispatcher.repository.ts`
- Modify: `src/features/dispatcher/dispatcher.schema.ts`
- Modify: `src/features/dispatcher/dispatcher.module.ts`
- Modify: `src/features/dispatcher/dispatchers/ebird-dispatcher.service.ts`
- Modify: `src/features/jobs/dispatch.job.ts`
- Modify: `src/features/jobs/bootstrap.service.ts`
- Modify: `src/features/jobs/jobs.module.ts`
- Modify: `src/features/sources/sources.service.ts`
- Modify: `src/features/sources/sources.repository.ts`
- Modify: `src/features/subscriptions/subscriptions.repository.ts`
- Modify: `src/features/subscriptions/__tests__/subscriptions.repository.spec.ts`
- Modify: `package.json` (via `pnpm remove rss-parser`)

**Interfaces:**
- Consumes: nothing from other tasks (first task).
- Produces: `EBirdDispatcherService` exported from `DispatcherModule`, still with `dispatchSince(since?: Date)` and `getUndeliveredSinceDate(since?: Date)`. `BootstrapService` and `DispatchJob` depend on it directly. Tasks 2–6 don't touch these; Task 7 replaces them.

- [ ] **Step 1: Delete the RSS-only files**

```bash
git rm -r src/features/rss
git rm src/features/jobs/rss-ingest.job.ts
git rm src/features/dispatcher/dispatchers/rss-dispatcher.service.ts
git rm src/features/dispatcher/dispatcher.service.ts
git rm src/features/dispatcher/dispatcher.interface.ts
git rm src/features/dispatcher/__tests__/dispatcher.service.spec.ts
```

- [ ] **Step 2: Trim the dispatcher repository to eBird only**

Replace the entire contents of `src/features/dispatcher/dispatcher.repository.ts` with:

```ts
import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

@Injectable()
export class DispatcherRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async getConfirmedSinceDate(since: Date) {
    return this.drizzle.db
      .selectDistinct({
        locId: observations.locId,
        speciesCode: observations.speciesCode,
      })
      .from(observations)
      .where(
        and(
          gt(observations.obsDt, since),
          eq(observations.obsValid, true),
          eq(observations.obsReviewed, true),
        ),
      );
  }

  async getUndeliveredObservationsSinceDate(since?: Date) {
    return this.drizzle.db
      .select({
        audioCount: observations.audioCount,
        channelId: channelEBirdSubscriptions.channelId,
        comName: observations.comName,

        county: locations.county,
        createdAt: observations.createdAt,
        howMany: observations.howMany,
        isPrivate: locations.isPrivate,
        locationName: locations.name,
        locId: observations.locId,
        obsDt: observations.obsDt,
        photoCount: observations.photoCount,
        sciName: observations.sciName,

        speciesCode: observations.speciesCode,
        state: locations.state,
        subId: observations.subId,
        videoCount: observations.videoCount,
      })
      .from(observations)
      .innerJoin(locations, eq(locations.id, observations.locId))
      .innerJoin(
        channelEBirdSubscriptions,
        and(
          eq(channelEBirdSubscriptions.active, true),
          eq(channelEBirdSubscriptions.stateCode, locations.stateCode),
          or(
            eq(channelEBirdSubscriptions.countyCode, locations.countyCode),
            eq(channelEBirdSubscriptions.countyCode, "*"),
          ),
        ),
      )
      .leftJoin(
        filteredSpecies,
        and(
          eq(filteredSpecies.channelId, channelEBirdSubscriptions.channelId),
          eq(filteredSpecies.commonName, observations.comName),
        ),
      )
      .leftJoin(
        deliveries,
        and(
          eq(deliveries.kind, "ebird"),
          eq(
            deliveries.alertId,
            sql`${observations.speciesCode} || ':' || ${observations.subId}`,
          ),
          eq(deliveries.channelId, channelEBirdSubscriptions.channelId),
        ),
      )
      .where(
        and(
          since ? gt(observations.createdAt, since) : undefined,
          isNull(filteredSpecies.channelId),
          isNull(deliveries.alertId),
        ),
      );
  }
}
```

(This is the current file minus `getUndeliveredRssItemsSinceDate` and the `rssItems`/`rssSources`/`channelRssSubscriptions` imports.)

- [ ] **Step 3: Trim `dispatcher.schema.ts`**

Replace the entire contents of `src/features/dispatcher/dispatcher.schema.ts` with:

```ts
import type { DispatcherRepository } from "./dispatcher.repository";

export type DispatchableObservation = Awaited<
  ReturnType<DispatcherRepository["getUndeliveredObservationsSinceDate"]>
>[number];
```

- [ ] **Step 4: Rewrite `dispatcher.module.ts`**

Replace the entire contents of `src/features/dispatcher/dispatcher.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { DeliveriesModule } from "@/features/deliveries/deliveries.module";
import { DispatcherRepository } from "./dispatcher.repository";
import { EBirdDispatcherService } from "./dispatchers/ebird-dispatcher.service";

@Module({
  exports: [EBirdDispatcherService],
  imports: [DeliveriesModule, DiscordModule],
  providers: [DispatcherRepository, EBirdDispatcherService],
})
export class DispatcherModule {}
```

- [ ] **Step 5: Remove the interface from `EBirdDispatcherService`**

In `src/features/dispatcher/dispatchers/ebird-dispatcher.service.ts`, delete the line `import type { Dispatcher } from "../dispatcher.interface";` and change the class declaration:

```ts
// before
export class EBirdDispatcherService
  implements Dispatcher<DispatchableObservation[]>
{
// after
export class EBirdDispatcherService {
```

Nothing else in the file changes.

- [ ] **Step 6: Rewrite `dispatch.job.ts`**

Replace the entire contents of `src/features/jobs/dispatch.job.ts` with:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { EBirdDispatcherService } from "@/features/dispatcher/dispatchers/ebird-dispatcher.service";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class DispatchJob {
  private readonly logger = new Logger(DispatchJob.name);

  constructor(
    private readonly ebirdDispatcher: EBirdDispatcherService,
    private readonly bootstrapService: BootstrapService,
  ) {}

  @Cron("*/1 * * * *")
  async run() {
    // Wait for bootstrap to complete before running
    await this.bootstrapService.waitForBootstrap();

    const since = new Date(Date.now() - 15 * 60 * 1000);
    this.logger.debug(
      `Running dispatch job for alerts since ${since.toISOString()}`,
    );
    await this.ebirdDispatcher.dispatchSince(since);
  }
}
```

- [ ] **Step 7: Rewrite `bootstrap.service.ts`**

Replace the entire contents of `src/features/jobs/bootstrap.service.ts` with:

```ts
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DeliveriesService } from "@/features/deliveries/deliveries.service";
import { EBirdDispatcherService } from "@/features/dispatcher/dispatchers/ebird-dispatcher.service";
import { EBirdService } from "@/features/ebird/ebird.service";
import { SourcesService } from "@/features/sources/sources.service";

/**
 * Populates DB on startup without triggering any Discord messages.
 * Also coordinates with scheduled jobs to ensure bootstrap completes first.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  private bootstrapComplete = false;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly ebirdService: EBirdService,
    private readonly ebirdDispatcher: EBirdDispatcherService,
    private readonly deliveries: DeliveriesService,
    private readonly sources: SourcesService,
  ) {}

  /**
   * Wait for bootstrap to complete. Jobs should call this before running.
   */
  async waitForBootstrap(): Promise<void> {
    if (this.bootstrapComplete) {
      return;
    }

    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    // Wait up to 5 minutes for bootstrap to complete
    this.bootstrapPromise = new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.bootstrapComplete) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(
        () => {
          clearInterval(checkInterval);
          if (!this.bootstrapComplete) {
            this.logger.warn(
              "Bootstrap did not complete within timeout, rejecting attempt",
            );
          }
          reject();
        },
        5 * 60 * 1000,
      );
    });

    return this.bootstrapPromise;
  }

  async onModuleInit() {
    this.logger.log("Running startup population job...");

    const regions = await this.sources.getEBirdSources();

    try {
      for (const region of regions) {
        try {
          const count = await this.ebirdService.ingestRegion(region);
          this.logger.log(`Populated ${count} observations for ${region}`);
        } catch (err) {
          this.logger.error(`Population failed for ${region}: ${err}`);
        }
      }

      const undelivered = await this.ebirdDispatcher.getUndeliveredSinceDate();
      await this.deliveries.recordDeliveries(
        undelivered.map((obs) => ({
          alertId: `${obs.speciesCode}:${obs.subId}`,
          alertKind: "ebird" as const,
          channelId: obs.channelId,
        })),
      );
      this.logger.log(
        `Marked ${undelivered.length} deliveries as sent (bootstrap mode).`,
      );

      this.logger.log("Startup population complete.");
    } finally {
      // Always mark bootstrap as complete, even if there were errors
      this.bootstrapComplete = true;
    }
  }
}
```

- [ ] **Step 8: Rewrite `jobs.module.ts`**

Replace the entire contents of `src/features/jobs/jobs.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DeliveriesModule } from "../deliveries/deliveries.module";
import { DispatcherModule } from "../dispatcher/dispatcher.module";
import { EBirdModule } from "../ebird/ebird.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { EBirdIngestJob } from "./ebird-ingest.job";

@Module({
  imports: [
    EBirdModule,
    ScheduleModule,
    DispatcherModule,
    DeliveriesModule,
    SourcesModule,
  ],
  providers: [BootstrapService, EBirdIngestJob, DispatchJob],
})
export class JobsModule {}
```

- [ ] **Step 9: Trim sources to eBird only**

Replace the entire contents of `src/features/sources/sources.service.ts` with:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { SourcesRepository } from "./sources.repository";

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(private readonly repo: SourcesRepository) {}

  /**
   * Returns a list of state codes that channels are currently subscribed to.
   */
  async getEBirdSources() {
    try {
      return this.repo.getEBirdSources();
    } catch (err) {
      this.logger.error(`Error fetching eBird sources: ${err}`);
      return [];
    }
  }
}
```

Replace the entire contents of `src/features/sources/sources.repository.ts` with:

```ts
import { Injectable } from "@nestjs/common";
import { channelEBirdSubscriptions } from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

@Injectable()
export class SourcesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async getEBirdSources() {
    const vals = await this.drizzle.db
      .selectDistinct({
        stateCode: channelEBirdSubscriptions.stateCode,
      })
      .from(channelEBirdSubscriptions);

    return vals.map((row) => row.stateCode);
  }
}
```

- [ ] **Step 10: Remove `insertRssSubscription` from the subscriptions repository**

In `src/features/subscriptions/subscriptions.repository.ts`:
- Delete the entire `insertRssSubscription` method (lines 91–99, from `async insertRssSubscription(` through its closing `}`).
- Remove `channelRssSubscriptions,` from the schema import at the top.

In `src/features/subscriptions/__tests__/subscriptions.repository.spec.ts`:
- Delete the entire `describe("insertRssSubscription", ...)` block (starts at line 216, runs to the closing `});` of that describe — the last block in the file).

- [ ] **Step 11: Remove the `rss-parser` dependency**

```bash
pnpm remove rss-parser
```

- [ ] **Step 12: Verify build and tests**

```bash
pnpm build
pnpm test
```

Expected: build succeeds; jest runs remaining suites (filters, subscriptions) and passes. If the build reports a leftover RSS import, that file was missed — fix it before committing.

Confirm nothing references RSS anymore (matches inside words like "Filte**rsS**ervice" are fine — look for real ones):

```bash
grep -rn "Rss\|rss_" src/ --include="*.ts" | grep -v drizzle
```

Expected: only `src/core/drizzle/drizzle.schema.ts` matches remain (handled in Task 3).

- [ ] **Step 13: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "refactor: delete RSS pipeline and collapse dispatcher routing"
```

---

### Task 2: Testcontainers integration-test infrastructure

Every `pnpm test` run gets a throwaway Postgres 17 with all migrations applied, verified by a smoke spec.

**Files:**
- Create: `src/testing/global-setup.ts`
- Create: `src/testing/global-teardown.ts`
- Create: `src/testing/db-helpers.ts`
- Create: `src/core/drizzle/__tests__/migrations.spec.ts`
- Modify: `package.json` (dev dep + jest config)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `createTestDb(): { db: DrizzleService; pool: Pool }` and `truncateAll(db: DrizzleService): Promise<void>` from `@/testing/db-helpers`; `process.env.TEST_DATABASE_URL` set for all workers. Tasks 3–6 and 9 build on these.

- [ ] **Step 1: Check Docker is available**

```bash
docker info --format '{{.ServerVersion}}'
```

Expected: a version number. If this fails, stop — testcontainers cannot run.

- [ ] **Step 2: Install the dependency**

```bash
pnpm add -D @testcontainers/postgresql
```

- [ ] **Step 3: Write the global setup/teardown**

Create `src/testing/global-setup.ts`:

```ts
import { join } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const globalWithContainer = globalThis as typeof globalThis & {
  __PG_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalSetup() {
  const container = await new PostgreSqlContainer("postgres:17").start();
  globalWithContainer.__PG_CONTAINER__ = container;
  process.env.TEST_DATABASE_URL = container.getConnectionUri();

  // Same migration path production takes in main.ts.
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: join(__dirname, "..", "drizzle"),
    });
  } finally {
    await pool.end();
  }
}
```

Create `src/testing/global-teardown.ts`:

```ts
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const globalWithContainer = globalThis as typeof globalThis & {
  __PG_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalTeardown() {
  await globalWithContainer.__PG_CONTAINER__?.stop();
}
```

- [ ] **Step 4: Write the DB helpers**

Create `src/testing/db-helpers.ts`:

```ts
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

export function createTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL not set — is global-setup configured?");
  }
  const pool = new Pool({ connectionString: url });
  const db = new DrizzleService(drizzle(pool, { schema }));
  return { db, pool };
}

export async function truncateAll(db: DrizzleService) {
  await db.db.execute(
    sql`TRUNCATE observations, locations, channel_ebird_subscriptions, filtered_species, deliveries CASCADE`,
  );
}
```

- [ ] **Step 5: Register setup/teardown in the jest config**

In `package.json`, add two keys to the existing `"jest"` object (alongside `"rootDir": "src"`):

```json
"globalSetup": "<rootDir>/testing/global-setup.ts",
"globalTeardown": "<rootDir>/testing/global-teardown.ts",
```

- [ ] **Step 6: Write the failing smoke spec**

Create `src/core/drizzle/__tests__/migrations.spec.ts`:

```ts
import { sql } from "drizzle-orm";
import { createTestDb } from "@/testing/db-helpers";

describe("migrations", () => {
  it("creates the expected tables", async () => {
    const { db, pool } = createTestDb();
    try {
      const result = await db.db.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tables = result.rows.map((row) => row.table_name);

      expect(tables).toEqual(
        expect.arrayContaining([
          "observations",
          "locations",
          "channel_ebird_subscriptions",
          "filtered_species",
          "deliveries",
        ]),
      );
    } finally {
      await pool.end();
    }
  });
});
```

- [ ] **Step 7: Run the suite**

```bash
pnpm test
```

Expected: a `postgres:17` container starts (first run pulls the image), migrations apply, all suites pass including `migrations.spec.ts`. Whole run should take under ~60s after the image is cached.

- [ ] **Step 8: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "test: add testcontainers-backed integration test infrastructure"
```

---

### Task 3: Migration 0004 — drop the RSS tables

**Files:**
- Modify: `src/core/drizzle/drizzle.schema.ts`
- Modify: `src/core/drizzle/__tests__/migrations.spec.ts`
- Create: `src/drizzle/0004_drop_rss.sql` (generated, then edited)
- Modify: `src/drizzle/meta/*` (generated)

**Interfaces:**
- Consumes: test infra from Task 2.
- Produces: a schema with no RSS tables; `deliveries` untouched. All later tasks assume this schema.

- [ ] **Step 1: Extend the smoke spec to fail**

In `src/core/drizzle/__tests__/migrations.spec.ts`, add three assertions after the `arrayContaining` expect:

```ts
      expect(tables).not.toContain("rss_items");
      expect(tables).not.toContain("rss_sources");
      expect(tables).not.toContain("channel_rss_subscriptions");
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test -- migrations
```

Expected: FAIL — the RSS tables still exist.

- [ ] **Step 3: Remove RSS tables from the drizzle schema**

In `src/core/drizzle/drizzle.schema.ts`:
- Delete the `rssItems`, `rssSources`, and `channelRssSubscriptions` table definitions (three `pgTable` blocks).
- Delete the `rssSourceRelations` and `channelRssSubscriptionRelations` relation blocks.
- Update the comment on the deliveries `kind` column from `// 'ebird' | 'rss'` to `// 'ebird' (rss existed historically; rows purged in 0004)`.

- [ ] **Step 4: Generate migration 0004**

`drizzle.config.ts` zod-parses `DATABASE_URL` even though `generate` never connects, so pass a dummy:

```bash
DATABASE_URL="postgresql://x:x@localhost:5432/x" pnpm drizzle-kit generate --name drop_rss
```

Expected: creates `src/drizzle/0004_drop_rss.sql` containing `DROP TABLE` statements for the three tables (order/`CASCADE` as the generator chooses) and updates `src/drizzle/meta/`.

- [ ] **Step 5: Append the deliveries purge**

At the end of `src/drizzle/0004_drop_rss.sql`, append:

```sql
--> statement-breakpoint
DELETE FROM "deliveries" WHERE "alert_kind" = 'rss';
```

- [ ] **Step 6: Run the full suite**

```bash
pnpm test
```

Expected: PASS. The global setup applies the whole chain `0000 → 0004` against a fresh Postgres, so this run *is* the migration verification.

- [ ] **Step 7: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "feat: drop RSS tables and purge rss deliveries (migration 0004)"
```

---

### Task 4: `AlertQueue.pendingEBirdAlerts` — matching semantics

The deep module begins. TDD against real Postgres: county match, wildcard, inactive, filtered, delivered, `since` cutoff.

**Files:**
- Create: `src/features/dispatch/alert-queue.ts`
- Create: `src/features/dispatch/__tests__/alert-queue.spec.ts`
- Modify: `src/testing/db-helpers.ts` (add seed helpers)

**Interfaces:**
- Consumes: `createTestDb`, `truncateAll` from `@/testing/db-helpers` (Task 2).
- Produces:
  - `AlertQueue` class with `pendingEBirdAlerts(since?: Date): Promise<PendingEBirdAlert[]>`
  - `PendingEBirdAlert` type (`recentlyConfirmed` field arrives in Task 5, `markSent` in Task 6)
  - `pendingEBirdAlertsQuery(db, since?)` — exported query builder (Task 9 EXPLAINs it)
  - Seed helpers `seedLocation`, `seedObservation`, `seedSubscription`, `seedFilter`, `seedDelivery`, each `(db: DrizzleService, overrides?: Partial<Insert>) => Promise<insertedRow>` with defaults: location `L001`/`US-CA-085`/`US-CA`, observation `verfly`/`S001`/"Vermilion Flycatcher" at `L001`, subscription `CH1`→`US-CA-085`, filter `CH1`/"Vermilion Flycatcher", delivery `verfly:S001`→`CH1`.

- [ ] **Step 1: Add seed helpers**

Append to `src/testing/db-helpers.ts` (the named-table import goes at the top with the others; `pnpm format-and-lint:fix` will organize it):

```ts
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";

export async function seedLocation(
  db: DrizzleService,
  overrides: Partial<typeof locations.$inferInsert> = {},
) {
  const row = {
    county: "Santa Clara",
    countyCode: "US-CA-085",
    id: "L001",
    isPrivate: false,
    lat: 37.3,
    lng: -122.0,
    name: "Test Hotspot",
    state: "California",
    stateCode: "US-CA",
    ...overrides,
  };
  await db.db.insert(locations).values(row).onConflictDoNothing();
  return row;
}

export async function seedObservation(
  db: DrizzleService,
  overrides: Partial<typeof observations.$inferInsert> = {},
) {
  const row = {
    audioCount: 0,
    comName: "Vermilion Flycatcher",
    createdAt: new Date(),
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
    subId: "S001",
    videoCount: 0,
    ...overrides,
  };
  await db.db.insert(observations).values(row);
  return row;
}

export async function seedSubscription(
  db: DrizzleService,
  overrides: Partial<typeof channelEBirdSubscriptions.$inferInsert> = {},
) {
  const row = {
    active: true,
    channelId: "CH1",
    countyCode: "US-CA-085",
    stateCode: "US-CA",
    ...overrides,
  };
  await db.db.insert(channelEBirdSubscriptions).values(row);
  return row;
}

export async function seedFilter(
  db: DrizzleService,
  overrides: Partial<typeof filteredSpecies.$inferInsert> = {},
) {
  const row = {
    channelId: "CH1",
    commonName: "Vermilion Flycatcher",
    ...overrides,
  };
  await db.db.insert(filteredSpecies).values(row);
  return row;
}

export async function seedDelivery(
  db: DrizzleService,
  overrides: Partial<typeof deliveries.$inferInsert> = {},
) {
  const row = {
    alertId: "verfly:S001",
    channelId: "CH1",
    kind: "ebird",
    ...overrides,
  };
  await db.db.insert(deliveries).values(row);
  return row;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/features/dispatch/__tests__/alert-queue.spec.ts`:

```ts
import type { Pool } from "pg";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedDelivery,
  seedFilter,
  seedLocation,
  seedObservation,
  seedSubscription,
  truncateAll,
} from "@/testing/db-helpers";
import { AlertQueue } from "../alert-queue";

describe("AlertQueue", () => {
  let db: DrizzleService;
  let pool: Pool;
  let queue: AlertQueue;

  beforeAll(() => {
    ({ db, pool } = createTestDb());
    queue = new AlertQueue(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe("pendingEBirdAlerts", () => {
    it("returns an alert when an observation matches an active county subscription", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db);

      const pending = await queue.pendingEBirdAlerts();

      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        channelId: "CH1",
        comName: "Vermilion Flycatcher",
        county: "Santa Clara",
        speciesCode: "verfly",
        subId: "S001",
      });
    });

    it("does not match a subscription for a different county", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { countyCode: "US-CA-001" });

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });

    it("matches any county in the state for a wildcard subscription", async () => {
      await seedLocation(db, { county: "Elsewhere", countyCode: "US-CA-999" });
      await seedObservation(db);
      await seedSubscription(db, { countyCode: "*" });

      expect(await queue.pendingEBirdAlerts()).toHaveLength(1);
    });

    it("does not match a wildcard subscription in a different state", async () => {
      await seedLocation(db, { state: "Oregon", stateCode: "US-OR" });
      await seedObservation(db);
      await seedSubscription(db, { countyCode: "*" }); // US-CA

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });

    it("ignores inactive subscriptions", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { active: false });

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });

    it("excludes species filtered on that channel but not on others", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { channelId: "CH1" });
      await seedSubscription(db, { channelId: "CH2" });
      await seedFilter(db, { channelId: "CH1" });

      const pending = await queue.pendingEBirdAlerts();

      expect(pending.map((alert) => alert.channelId)).toEqual(["CH2"]);
    });

    it("excludes alerts already delivered to that channel but not to others", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db, { channelId: "CH1" });
      await seedSubscription(db, { channelId: "CH2" });
      await seedDelivery(db, { channelId: "CH1" });

      const pending = await queue.pendingEBirdAlerts();

      expect(pending.map((alert) => alert.channelId)).toEqual(["CH2"]);
    });

    it("applies the since cutoff to ingest time, not observation time", async () => {
      await seedLocation(db);
      // Old sighting ingested just now: still alerts.
      await seedObservation(db, {
        createdAt: new Date(),
        obsDt: new Date("2026-01-01"),
        subId: "S001",
      });
      // Recent sighting ingested an hour ago: outside the window.
      await seedObservation(db, {
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        obsDt: new Date(),
        subId: "S002",
      });
      await seedSubscription(db);

      const pending = await queue.pendingEBirdAlerts(
        new Date(Date.now() - 15 * 60 * 1000),
      );

      expect(pending.map((alert) => alert.subId)).toEqual(["S001"]);
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm test -- alert-queue
```

Expected: FAIL — `Cannot find module '../alert-queue'`.

- [ ] **Step 4: Implement `AlertQueue`**

Create `src/features/dispatch/alert-queue.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/core/drizzle/drizzle.schema";
import {
  channelEBirdSubscriptions,
  deliveries,
  filteredSpecies,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

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
};

/**
 * Exported for the EXPLAIN smoke test. Production code goes through AlertQueue.
 */
export function pendingEBirdAlertsQuery(
  db: NodePgDatabase<typeof schema>,
  since?: Date,
) {
  return db
    .select({
      audioCount: observations.audioCount,
      channelId: channelEBirdSubscriptions.channelId,
      comName: observations.comName,
      county: locations.county,
      createdAt: observations.createdAt,
      howMany: observations.howMany,
      isPrivate: locations.isPrivate,
      locationName: locations.name,
      locId: observations.locId,
      obsDt: observations.obsDt,
      photoCount: observations.photoCount,
      sciName: observations.sciName,
      speciesCode: observations.speciesCode,
      state: locations.state,
      subId: observations.subId,
      videoCount: observations.videoCount,
    })
    .from(observations)
    .innerJoin(locations, eq(locations.id, observations.locId))
    .innerJoin(
      channelEBirdSubscriptions,
      and(
        eq(channelEBirdSubscriptions.active, true),
        eq(channelEBirdSubscriptions.stateCode, locations.stateCode),
        or(
          eq(channelEBirdSubscriptions.countyCode, locations.countyCode),
          eq(channelEBirdSubscriptions.countyCode, "*"),
        ),
      ),
    )
    .leftJoin(
      filteredSpecies,
      and(
        eq(filteredSpecies.channelId, channelEBirdSubscriptions.channelId),
        eq(filteredSpecies.commonName, observations.comName),
      ),
    )
    .leftJoin(
      deliveries,
      and(
        eq(deliveries.kind, "ebird"),
        eq(
          deliveries.alertId,
          sql`${observations.speciesCode} || ':' || ${observations.subId}`,
        ),
        eq(deliveries.channelId, channelEBirdSubscriptions.channelId),
      ),
    )
    .where(
      and(
        since ? gt(observations.createdAt, since) : undefined,
        isNull(filteredSpecies.channelId),
        isNull(deliveries.alertId),
      ),
    );
}

/**
 * The dispatch module's seam: decides which alerts are pending and records
 * which were sent. An alert is pending for a channel when the observation
 * matches an active subscription, the species is not filtered on that
 * channel, and no delivery exists yet.
 */
@Injectable()
export class AlertQueue {
  constructor(private readonly drizzle: DrizzleService) {}

  async pendingEBirdAlerts(since?: Date): Promise<PendingEBirdAlert[]> {
    return pendingEBirdAlertsQuery(this.drizzle.db, since);
  }
}
```

- [ ] **Step 5: Run to verify pass**

```bash
pnpm test -- alert-queue
```

Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "feat: add AlertQueue.pendingEBirdAlerts with integration tests"
```

---

### Task 5: `recentlyConfirmed` on pending alerts

**Files:**
- Modify: `src/features/dispatch/alert-queue.ts`
- Modify: `src/features/dispatch/__tests__/alert-queue.spec.ts`

**Interfaces:**
- Consumes: Task 4's `AlertQueue`, seed helpers.
- Produces: `PendingEBirdAlert.recentlyConfirmed: boolean` — true iff a valid+reviewed observation of the same species×location exists with `obsDt` in the last 7 days. Task 7's dispatcher reads this instead of computing a confirmed set.

- [ ] **Step 1: Write the failing tests**

Add inside the `describe("AlertQueue", ...)` block (sibling of `describe("pendingEBirdAlerts", ...)`):

```ts
  describe("recentlyConfirmed", () => {
    it("is true when a valid+reviewed observation of the same species and location is within 7 days", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, {
        obsDt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        obsReviewed: true,
        obsValid: true,
        subId: "S002",
      });

      const pending = await queue.pendingEBirdAlerts();
      const alert = pending.find((a) => a.subId === "S001");

      expect(alert?.recentlyConfirmed).toBe(true);
    });

    it("is false when the confirming observation is older than 7 days", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, {
        obsDt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        obsReviewed: true,
        obsValid: true,
        subId: "S002",
      });

      const pending = await queue.pendingEBirdAlerts();
      const alert = pending.find((a) => a.subId === "S001");

      expect(alert?.recentlyConfirmed).toBe(false);
    });

    it("is false when the observation is valid but not reviewed", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      await seedObservation(db, { subId: "S001" });
      await seedObservation(db, {
        obsDt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        obsReviewed: false,
        obsValid: true,
        subId: "S002",
      });

      const pending = await queue.pendingEBirdAlerts();
      const alert = pending.find((a) => a.subId === "S001");

      expect(alert?.recentlyConfirmed).toBe(false);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test -- alert-queue
```

Expected: FAIL — `recentlyConfirmed` is `undefined` (TypeScript may fail compilation first; same signal).

- [ ] **Step 3: Implement**

In `src/features/dispatch/alert-queue.ts`:

Add below the imports:

```ts
const CONFIRMED_WINDOW_DAYS = 7;
```

Add to the `PendingEBirdAlert` type:

```ts
  recentlyConfirmed: boolean;
```

Add to the `select({...})` in `pendingEBirdAlertsQuery` (keep alphabetical position after `photoCount`):

```ts
      recentlyConfirmed: sql<boolean>`exists (
        select 1
        from observations as confirmed_obs
        where confirmed_obs.species_code = ${observations.speciesCode}
          and confirmed_obs.location_id = ${observations.locId}
          and confirmed_obs.observation_valid = true
          and confirmed_obs.observation_reviewed = true
          and confirmed_obs.observation_date > now() - make_interval(days => ${CONFIRMED_WINDOW_DAYS})
      )`,
```

(Raw column names — `species_code`, `location_id`, `observation_valid`, `observation_reviewed`, `observation_date` — are the snake_case DB names from `drizzle.schema.ts`; the `${observations.x}` interpolations refer to the outer row.)

- [ ] **Step 4: Run to verify pass**

```bash
pnpm test -- alert-queue
```

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "feat: fold confirmed-species check into pending alerts as recentlyConfirmed"
```

---

### Task 6: `AlertQueue.markSent`

**Files:**
- Modify: `src/features/dispatch/alert-queue.ts`
- Modify: `src/features/dispatch/__tests__/alert-queue.spec.ts`

**Interfaces:**
- Consumes: Task 4/5 `AlertQueue`.
- Produces: `SentAlert = { speciesCode: string; subId: string; channelId: string }` and `markSent(alerts: SentAlert[]): Promise<void>` — idempotent, batched at 100, builds `alertId` internally, always kind `'ebird'`. Note `PendingEBirdAlert` is structurally assignable to `SentAlert`, so `markSent(await pendingEBirdAlerts())` is valid — Task 7's bootstrap relies on that.

- [ ] **Step 1: Write the failing tests**

Add to the spec's imports:

```ts
import { deliveries } from "@/core/drizzle/drizzle.schema";
```

Add inside `describe("AlertQueue", ...)`:

```ts
  describe("markSent", () => {
    it("records a delivery with alertId speciesCode:subId and kind ebird", async () => {
      await queue.markSent([
        { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
      ]);

      const rows = await db.db.select().from(deliveries);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        alertId: "verfly:S001",
        channelId: "CH1",
        kind: "ebird",
      });
    });

    it("is idempotent", async () => {
      const alerts = [
        { channelId: "CH1", speciesCode: "verfly", subId: "S001" },
      ];

      await queue.markSent(alerts);
      await queue.markSent(alerts);

      expect(await db.db.select().from(deliveries)).toHaveLength(1);
    });

    it("handles more alerts than one batch", async () => {
      const alerts = Array.from({ length: 250 }, (_, i) => ({
        channelId: "CH1",
        speciesCode: "verfly",
        subId: `S${i}`,
      }));

      await queue.markSent(alerts);

      expect(await db.db.select().from(deliveries)).toHaveLength(250);
    });

    it("marked alerts stop being pending", async () => {
      await seedLocation(db);
      await seedObservation(db);
      await seedSubscription(db);

      await queue.markSent(await queue.pendingEBirdAlerts());

      expect(await queue.pendingEBirdAlerts()).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test -- alert-queue
```

Expected: FAIL — `queue.markSent is not a function` (or compile error).

- [ ] **Step 3: Implement**

In `src/features/dispatch/alert-queue.ts`, add below `CONFIRMED_WINDOW_DAYS`:

```ts
const MARK_SENT_BATCH_SIZE = 100;
```

Add below the `PendingEBirdAlert` type:

```ts
export type SentAlert = {
  speciesCode: string;
  subId: string;
  channelId: string;
};
```

Add the method to the `AlertQueue` class:

```ts
  /**
   * Record alerts as sent. Idempotent (unique on kind+alertId+channelId);
   * owns the alertId format — callers never build it.
   */
  async markSent(alerts: SentAlert[]): Promise<void> {
    for (let i = 0; i < alerts.length; i += MARK_SENT_BATCH_SIZE) {
      const batch = alerts.slice(i, i + MARK_SENT_BATCH_SIZE).map((alert) => ({
        alertId: `${alert.speciesCode}:${alert.subId}`,
        channelId: alert.channelId,
        kind: "ebird" as const,
      }));
      await this.drizzle.db
        .insert(deliveries)
        .values(batch)
        .onConflictDoNothing();
    }
  }
```

- [ ] **Step 4: Run to verify pass**

```bash
pnpm test -- alert-queue
```

Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "feat: add AlertQueue.markSent owning alert identity"
```

---

### Task 7: Rewire the dispatch slice onto AlertQueue

The dispatcher keeps only the Discord-facing half (grouping, embeds, sending); everything else goes through `AlertQueue`. The old `features/dispatcher/` directory disappears.

**Files:**
- Create: `src/features/dispatch/dispatch.module.ts`
- Create: `src/features/dispatch/ebird-dispatcher.service.ts` (rewritten move of `src/features/dispatcher/dispatchers/ebird-dispatcher.service.ts`)
- Delete: `src/features/dispatcher/` (entire directory: `dispatcher.repository.ts`, `dispatcher.schema.ts`, `dispatcher.module.ts`, `dispatchers/ebird-dispatcher.service.ts`)
- Modify: `src/features/jobs/dispatch.job.ts`
- Modify: `src/features/jobs/bootstrap.service.ts`
- Modify: `src/features/jobs/jobs.module.ts`

**Interfaces:**
- Consumes: `AlertQueue` (`pendingEBirdAlerts`, `markSent`, `PendingEBirdAlert`, `SentAlert`) from Tasks 4–6; `DiscordHelper.sendEmbedToChannel(channelId, embed)` (unchanged).
- Produces: `DispatchModule` exporting `AlertQueue` and `EBirdDispatcherService` (which now exposes only `dispatchSince(since?: Date)`). `BootstrapService` no longer touches `DeliveriesService` — Task 8 depends on that.

- [ ] **Step 1: Create the new dispatcher**

Create `src/features/dispatch/ebird-dispatcher.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { EmbedBuilder } from "discord.js";
import { DiscordHelper } from "@/discord/discord.helper";
import {
  AlertQueue,
  type PendingEBirdAlert,
  type SentAlert,
} from "./alert-queue";

@Injectable()
export class EBirdDispatcherService {
  private readonly logger = new Logger(EBirdDispatcherService.name);

  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly discord: DiscordHelper,
  ) {}

  private groupAlerts(alerts: PendingEBirdAlert[]) {
    const channels = new Map<
      string,
      Map<string, Map<string, PendingEBirdAlert[]>>
    >();

    for (const alert of alerts) {
      let speciesMap = channels.get(alert.channelId);
      if (!speciesMap) {
        speciesMap = new Map();
        channels.set(alert.channelId, speciesMap);
      }

      let locMap = speciesMap.get(alert.speciesCode);
      if (!locMap) {
        locMap = new Map();
        speciesMap.set(alert.speciesCode, locMap);
      }

      let list = locMap.get(alert.locId);
      if (!list) {
        list = [];
        locMap.set(alert.locId, list);
      }

      list.push(alert);
    }

    return channels;
  }

  private getAggregatedStats(alerts: PendingEBirdAlert[]) {
    return alerts.reduce(
      (acc, alert) => {
        acc.totalReports += 1;
        acc.totalPhotos += alert.photoCount;
        acc.totalVideos += alert.videoCount;
        acc.totalAudio += alert.audioCount;
        acc.howMany = Math.max(acc.howMany, alert.howMany);
        acc.latestReport =
          !acc.latestReport || alert.obsDt > acc.latestReport
            ? alert.obsDt
            : acc.latestReport;
        return acc;
      },
      {
        howMany: 0,
        latestReport: alerts[0]?.obsDt,
        totalAudio: 0,
        totalPhotos: 0,
        totalReports: 0,
        totalVideos: 0,
      },
    );
  }

  private async sendGroupedEBirdAlert(
    channelId: string,
    alerts: PendingEBirdAlert[],
  ) {
    if (alerts.length === 0) return;

    const stats = this.getAggregatedStats(alerts);
    const confirmed = alerts[0].recentlyConfirmed;

    const locationText = `Reported at ${
      alerts[0].isPrivate
        ? "a private location"
        : `[${alerts[0].locationName}](https://ebird.org/hotspot/${alerts[0].locId})`
    }`;

    const embed = new EmbedBuilder()
      .setTitle(`${alerts[0].comName} - ${alerts[0].county}`)
      .setURL(`https://ebird.org/checklist/${alerts[0].subId}`)
      .setDescription(
        `${locationText}\nLatest report: ${stats.latestReport.toLocaleString(
          "en-US",
          {
            day: "numeric",
            hour: "numeric",
            hour12: true,
            minute: "2-digit",
            month: "numeric",
            year: "numeric",
          },
        )}`,
      )
      .setColor(confirmed ? 0x2ecc71 : 0xf1c40f);

    let reportText = `👥 ${stats.totalReports} new report(s); ${
      confirmed
        ? "confirmed at location in the last week"
        : "unconfirmed at location in the last week"
    }`;

    const mediaTexts: string[] = [];
    if (stats.totalPhotos > 0)
      mediaTexts.push(`📷 ${stats.totalPhotos} photo(s)`);
    if (stats.totalAudio > 0) mediaTexts.push(`🔊 ${stats.totalAudio} audio`);
    if (stats.totalVideos > 0)
      mediaTexts.push(`🎥 ${stats.totalVideos} video(s)`);

    if (mediaTexts.length > 0) {
      reportText += `\n${mediaTexts.join(" • ")}`;
    }

    embed.addFields({ name: "Details", value: reportText });

    try {
      await this.discord.sendEmbedToChannel(channelId, embed);
    } catch (err) {
      this.logger.error(`Failed to send embed to channel: ${err}`);
    }
  }

  async dispatchSince(since?: Date) {
    const sinceDate = since ?? new Date(Date.now() - 15 * 60 * 1000);
    const pending = await this.alertQueue.pendingEBirdAlerts(sinceDate);

    if (pending.length === 0) {
      this.logger.debug(`No new alerts since ${sinceDate}`);
      return;
    }

    this.logger.debug(`Found ${pending.length} pending channel-alert pairs`);

    const sent: SentAlert[] = [];

    for (const [channelId, speciesMap] of this.groupAlerts(pending)) {
      for (const [, locMap] of speciesMap) {
        for (const [, alertList] of locMap) {
          await this.sendGroupedEBirdAlert(channelId, alertList);
          for (const alert of alertList) {
            sent.push({
              channelId,
              speciesCode: alert.speciesCode,
              subId: alert.subId,
            });
          }
        }
      }
    }

    await this.alertQueue.markSent(sent);

    this.logger.log(`Marked ${sent.length} alerts as delivered`);
  }
}
```

- [ ] **Step 2: Create `dispatch.module.ts`**

Create `src/features/dispatch/dispatch.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DiscordModule } from "@/discord/discord.module";
import { AlertQueue } from "./alert-queue";
import { EBirdDispatcherService } from "./ebird-dispatcher.service";

@Module({
  exports: [AlertQueue, EBirdDispatcherService],
  imports: [DiscordModule],
  providers: [AlertQueue, EBirdDispatcherService],
})
export class DispatchModule {}
```

- [ ] **Step 3: Delete the old dispatcher directory**

```bash
git rm -r src/features/dispatcher
```

- [ ] **Step 4: Update `dispatch.job.ts`**

In `src/features/jobs/dispatch.job.ts`, change the import:

```ts
// before
import { EBirdDispatcherService } from "@/features/dispatcher/dispatchers/ebird-dispatcher.service";
// after
import { EBirdDispatcherService } from "@/features/dispatch/ebird-dispatcher.service";
```

- [ ] **Step 5: Rewrite `bootstrap.service.ts`**

Replace the entire contents of `src/features/jobs/bootstrap.service.ts` with:

```ts
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { AlertQueue } from "@/features/dispatch/alert-queue";
import { EBirdService } from "@/features/ebird/ebird.service";
import { SourcesService } from "@/features/sources/sources.service";

/**
 * Populates DB on startup without triggering any Discord messages.
 * Also coordinates with scheduled jobs to ensure bootstrap completes first.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  private bootstrapComplete = false;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly ebirdService: EBirdService,
    private readonly alertQueue: AlertQueue,
    private readonly sources: SourcesService,
  ) {}

  /**
   * Wait for bootstrap to complete. Jobs should call this before running.
   */
  async waitForBootstrap(): Promise<void> {
    if (this.bootstrapComplete) {
      return;
    }

    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    // Wait up to 5 minutes for bootstrap to complete
    this.bootstrapPromise = new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.bootstrapComplete) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(
        () => {
          clearInterval(checkInterval);
          if (!this.bootstrapComplete) {
            this.logger.warn(
              "Bootstrap did not complete within timeout, rejecting attempt",
            );
          }
          reject();
        },
        5 * 60 * 1000,
      );
    });

    return this.bootstrapPromise;
  }

  async onModuleInit() {
    this.logger.log("Running startup population job...");

    const regions = await this.sources.getEBirdSources();

    try {
      for (const region of regions) {
        try {
          const count = await this.ebirdService.ingestRegion(region);
          this.logger.log(`Populated ${count} observations for ${region}`);
        } catch (err) {
          this.logger.error(`Population failed for ${region}: ${err}`);
        }
      }

      const pending = await this.alertQueue.pendingEBirdAlerts();
      await this.alertQueue.markSent(pending);
      this.logger.log(
        `Marked ${pending.length} pre-existing alerts as sent (bootstrap mode).`,
      );

      this.logger.log("Startup population complete.");
    } finally {
      // Always mark bootstrap as complete, even if there were errors
      this.bootstrapComplete = true;
    }
  }
}
```

- [ ] **Step 6: Rewrite `jobs.module.ts`**

Replace the entire contents of `src/features/jobs/jobs.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DispatchModule } from "../dispatch/dispatch.module";
import { EBirdModule } from "../ebird/ebird.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { EBirdIngestJob } from "./ebird-ingest.job";

@Module({
  imports: [EBirdModule, ScheduleModule, DispatchModule, SourcesModule],
  providers: [BootstrapService, EBirdIngestJob, DispatchJob],
})
export class JobsModule {}
```

- [ ] **Step 7: Verify build and tests**

```bash
pnpm build
pnpm test
```

Expected: build succeeds (nothing imports `features/dispatcher` anymore); all tests pass.

```bash
grep -rn "features/dispatcher" src/ --include="*.ts"
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "refactor: rewire dispatch slice onto AlertQueue"
```

---

### Task 8: Delete the deliveries feature

After Task 7, `features/deliveries/` has zero live callers.

**Files:**
- Delete: `src/features/deliveries/` (entire directory: module, service, repository)

**Interfaces:**
- Consumes: Task 7's rewiring (nothing imports deliveries anymore).
- Produces: nothing — pure deletion.

- [ ] **Step 1: Verify it's dead, then delete**

```bash
grep -rn "deliveries.service\|deliveries.module\|DeliveriesService\|DeliveriesModule\|DeliveriesRepository" src/ --include="*.ts" | grep -v "src/features/deliveries/"
```

Expected: no output. (If there is output, Task 7 missed a caller — fix that first.)

```bash
git rm -r src/features/deliveries
```

- [ ] **Step 2: Verify build and tests**

```bash
pnpm build
pnpm test
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "refactor: delete dead deliveries feature"
```

---

### Task 9: EXPLAIN smoke test on the pending-alerts query

Guards against the deliveries anti-join degrading to a per-row scan (the `alertId` is a computed string, so this is the plan shape worth watching).

**Files:**
- Modify: `src/features/dispatch/__tests__/alert-queue.spec.ts`

**Interfaces:**
- Consumes: `pendingEBirdAlertsQuery` (Task 4), `queue.markSent` (Task 6), seed helpers, the `pool` already opened in `beforeAll`.
- Produces: nothing new.

- [ ] **Step 1: Write the test**

Add to the spec's imports:

```ts
import { sql } from "drizzle-orm";
import { pendingEBirdAlertsQuery } from "../alert-queue";
```

Add inside `describe("AlertQueue", ...)`:

```ts
  describe("query plan", () => {
    it("anti-joins deliveries instead of scanning per row", async () => {
      await seedLocation(db);
      await seedSubscription(db);
      for (let i = 0; i < 200; i += 1) {
        await seedObservation(db, { subId: `S${i}` });
      }
      await queue.markSent(await queue.pendingEBirdAlerts());
      await db.db.execute(sql`ANALYZE`);

      // EXPLAIN is a utility statement and cannot take bind parameters,
      // so inline them (highest index first so $1 doesn't clobber $10).
      const { sql: text, params } = pendingEBirdAlertsQuery(db.db).toSQL();
      let inlined = text;
      for (let i = params.length; i >= 1; i -= 1) {
        const param = params[i - 1];
        const literal =
          typeof param === "number" || typeof param === "boolean"
            ? String(param)
            : `'${String(param)}'`;
        inlined = inlined.replaceAll(`$${i}`, literal);
      }

      const result = await pool.query(`EXPLAIN ${inlined}`);
      const plan = result.rows
        .map((row) => row["QUERY PLAN"])
        .join("\n");

      expect(plan).toMatch(/Anti Join/);
    });
  });
```

- [ ] **Step 2: Run to verify pass**

```bash
pnpm test -- alert-queue
```

Expected: PASS. If it fails, print the plan (`console.log(plan)`) and inspect: a `Hash Anti Join` on deliveries is the healthy shape. A failure here means Postgres chose a plan without an anti-join — investigate before "fixing" the assertion.

- [ ] **Step 3: Full suite, then commit**

```bash
pnpm test
cd ../.. && pnpm format-and-lint:fix && cd apps/scrubjay-discord
git add -A
git commit -m "test: EXPLAIN smoke test for pending-alerts anti-join"
```

---

## Final verification (after all tasks)

- [ ] `pnpm build && pnpm test` from `apps/scrubjay-discord` — green.
- [ ] `pnpm format-and-lint` from repo root — clean.
- [ ] `grep -rin "rss" apps/scrubjay-discord/src --include="*.ts" | grep -vi "filtersservice"` — only historical-comment matches (the 0004 note in `drizzle.schema.ts`), no live code.
- [ ] Sanity-check the checked-in migration `src/drizzle/0004_drop_rss.sql` contains the three `DROP TABLE`s and the `DELETE FROM "deliveries"`.

**Deployment note:** the first deploy after this lands runs migration 0004 automatically at startup (`main.ts`), dropping the RSS tables and purging `kind='rss'` delivery rows on the VPS database. That is intended and irreversible.

**Out of scope (tracked in the spec):** sharing the subscribe-time backfill query with `AlertQueue`; extracting grouping/embed logic; bootstrap timing bug B6; remaining §2 bug list in `docs/architecture-improvements.md`.
