# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bot a real `GET /health` endpoint (terminus), in-memory ingest/dispatch freshness tracking, a visible log when ingest has no sources, and a Docker `HEALTHCHECK` — backlog item 2.1.

**Architecture:** Everything lives in `features/health`. Jobs write into an in-memory `HealthStateService`; three terminus indicators read from it (plus one grouped query over `deliveries`). Only the `database` indicator can fail the check (503 → Docker restart); `ingest` and `dispatch` are always-up detail carriers. Spec: `docs/superpowers/specs/2026-07-09-observability-design.md`.

**Tech Stack:** NestJS 11, `@nestjs/terminus` (new dependency; current `HealthIndicatorService` API — the `HealthIndicator` base class is deprecated), drizzle-orm/pg, vitest (unit + testcontainers for repositories).

## Global Constraints

- **Pre-flight:** the dispatch-semantics work must be committed before starting (this plan's dispatch indicator reads `deliveries.status`). Verify `git status` shows a clean tree in `src/features/dispatch/`.
- All commands run from `apps/scrubjay-discord/` unless noted. Tests: `pnpm vitest run <file>`; full gate: `pnpm test && pnpm check-types && pnpm lint`.
- Only the `database` indicator may fail the health check. `ingest`/`dispatch` indicators always report up (spec decision 2).
- No `@nestjs/axios`. No persistence of freshness state.
- Repo style: alphabetized object keys / providers arrays (see existing modules), path alias `@/` = `src/`, comments only for non-obvious constraints.
- Commit messages end with:
  `Claude-Session: https://claude.ai/code/session_01K4zVVKgP6NuoPuH4yM1j5C`

---

### Task 1: `HealthStateService` — in-memory freshness recorder

**Files:**
- Create: `src/features/health/health-state.service.ts`
- Test: `src/features/health/health-state.service.spec.ts`

**Interfaces:**
- Consumes: nothing (pure in-memory).
- Produces (used by Tasks 3 and 5):
  - `INGEST_STALE_AFTER_MS: number` (exported const, `45 * 60 * 1000`)
  - `class HealthStateService` with:
    - `recordIngestTick(regions: string[]): void`
    - `recordIngestSuccess(region: string): void`
    - `recordDispatchTick(): void`
    - `snapshot(): HealthSnapshot` where
      ```ts
      interface RegionHealth { lastSuccessAt: string | null; stale: boolean }
      interface HealthSnapshot {
        dispatch: { lastTickAt: string | null };
        ingest: {
          lastTickAt: string | null;
          noSources: boolean;
          regions: Record<string, RegionHealth>;
          sources: string[];
        };
      }
      ```

- [ ] **Step 1: Write the failing test**

`src/features/health/health-state.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HealthStateService,
  INGEST_STALE_AFTER_MS,
} from "./health-state.service";

describe("HealthStateService", () => {
  let service: HealthStateService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00Z"));
    service = new HealthStateService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty snapshot", () => {
    expect(service.snapshot()).toEqual({
      dispatch: { lastTickAt: null },
      ingest: {
        lastTickAt: null,
        noSources: false,
        regions: {},
        sources: [],
      },
    });
  });

  it("records ingest ticks and per-region successes", () => {
    service.recordIngestTick(["US-CA", "US-WA"]);
    service.recordIngestSuccess("US-CA");

    const { ingest } = service.snapshot();
    expect(ingest.lastTickAt).toBe("2026-07-09T12:00:00.000Z");
    expect(ingest.sources).toEqual(["US-CA", "US-WA"]);
    expect(ingest.regions["US-CA"]).toEqual({
      lastSuccessAt: "2026-07-09T12:00:00.000Z",
      stale: false,
    });
    expect(ingest.regions["US-WA"]).toEqual({
      lastSuccessAt: null,
      stale: false,
    });
  });

  it("marks a region stale after INGEST_STALE_AFTER_MS without success", () => {
    service.recordIngestTick(["US-CA"]);
    service.recordIngestSuccess("US-CA");

    vi.advanceTimersByTime(INGEST_STALE_AFTER_MS + 1);

    expect(service.snapshot().ingest.regions["US-CA"]!.stale).toBe(true);
  });

  it("measures never-succeeded regions from boot, not epoch", () => {
    service.recordIngestTick(["US-NM"]);

    // Just under the threshold since construction: not yet stale.
    vi.advanceTimersByTime(INGEST_STALE_AFTER_MS - 1);
    expect(service.snapshot().ingest.regions["US-NM"]!.stale).toBe(false);

    // Past it: stale.
    vi.advanceTimersByTime(2);
    expect(service.snapshot().ingest.regions["US-NM"]!.stale).toBe(true);
  });

  it("flags noSources only after a tick reports an empty list", () => {
    expect(service.snapshot().ingest.noSources).toBe(false);

    service.recordIngestTick([]);
    expect(service.snapshot().ingest.noSources).toBe(true);

    service.recordIngestTick(["US-CA"]);
    expect(service.snapshot().ingest.noSources).toBe(false);
  });

  it("records dispatch ticks", () => {
    service.recordDispatchTick();
    expect(service.snapshot().dispatch.lastTickAt).toBe(
      "2026-07-09T12:00:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/health/health-state.service.spec.ts`
Expected: FAIL — cannot resolve `./health-state.service`.

- [ ] **Step 3: Write the implementation**

`src/features/health/health-state.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

// Three missed ticks of the 15-minute ingest cron. (Not a doc comment: the
// cron literal "*/15" would terminate a block comment early.)
export const INGEST_STALE_AFTER_MS = 45 * 60 * 1000;

export interface RegionHealth {
  lastSuccessAt: string | null;
  stale: boolean;
}

export interface HealthSnapshot {
  dispatch: { lastTickAt: string | null };
  ingest: {
    lastTickAt: string | null;
    noSources: boolean;
    regions: Record<string, RegionHealth>;
    sources: string[];
  };
}

/**
 * In-memory freshness state written by the cron jobs and read by the health
 * indicators. Deliberately not persisted: single process, informational-only,
 * reconstructible within one ingest tick (spec decision 3).
 */
@Injectable()
export class HealthStateService {
  // Never-succeeded regions measure staleness from boot so a fresh restart
  // doesn't report every region stale until the first tick (spec §2).
  private readonly bootedAt = Date.now();
  private lastDispatchTickAt: Date | null = null;
  private lastIngestTickAt: Date | null = null;
  private sources: string[] = [];
  private readonly successes = new Map<string, Date>();

  recordDispatchTick(): void {
    this.lastDispatchTickAt = new Date();
  }

  recordIngestSuccess(region: string): void {
    this.successes.set(region, new Date());
  }

  recordIngestTick(regions: string[]): void {
    this.lastIngestTickAt = new Date();
    this.sources = [...regions];
  }

  snapshot(): HealthSnapshot {
    const now = Date.now();
    const regions: Record<string, RegionHealth> = {};
    for (const region of this.sources) {
      const lastSuccess = this.successes.get(region) ?? null;
      const staleClockStart = lastSuccess?.getTime() ?? this.bootedAt;
      regions[region] = {
        lastSuccessAt: lastSuccess?.toISOString() ?? null,
        stale: now - staleClockStart > INGEST_STALE_AFTER_MS,
      };
    }
    return {
      dispatch: {
        lastTickAt: this.lastDispatchTickAt?.toISOString() ?? null,
      },
      ingest: {
        lastTickAt: this.lastIngestTickAt?.toISOString() ?? null,
        noSources: this.lastIngestTickAt !== null && this.sources.length === 0,
        regions,
        sources: [...this.sources],
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/health/health-state.service.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/health/health-state.service.ts src/features/health/health-state.service.spec.ts
git commit -m "feat(scrubjay-discord): in-memory health state service"
```

---

### Task 2: `HealthRepository` — trailing-24h delivery counts

**Files:**
- Create: `src/features/health/health.repository.ts`
- Test: `src/features/health/health.repository.spec.ts`

**Interfaces:**
- Consumes: `DrizzleService` (`@/core/drizzle/drizzle.service`), `deliveries` + `DeliveryStatus` (`@/core/drizzle/drizzle.schema`), test helpers `createTestDb`, `seedDelivery`, `truncateAll` (`@/testing/db-helpers`).
- Produces (used by Task 3):
  - `type DeliveryCounts = Record<DeliveryStatus, number>` (always all four keys, zero-filled)
  - `class HealthRepository` with `recentDeliveryCounts(): Promise<DeliveryCounts>`

- [ ] **Step 1: Write the failing test**

`src/features/health/health.repository.spec.ts` (testcontainers pattern, same as `alert-queue.repository.spec.ts` — requires Docker running locally):

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { createTestDb, seedDelivery, truncateAll } from "@/testing/db-helpers";
import { HealthRepository } from "./health.repository";

describe("HealthRepository", () => {
  let db: DrizzleService;
  let pool: Pool;
  let repository: HealthRepository;

  beforeAll(async () => {
    ({ db, pool } = await createTestDb());
    repository = new HealthRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("zero-fills every status when there are no deliveries", async () => {
    await expect(repository.recentDeliveryCounts()).resolves.toEqual({
      expired: 0,
      failed: 0,
      sent: 0,
      suppressed: 0,
    });
  });

  it("counts recent deliveries grouped by status", async () => {
    await seedDelivery(db, { alertId: "a:1", status: "sent" });
    await seedDelivery(db, { alertId: "a:2", status: "sent" });
    await seedDelivery(db, { alertId: "a:3", status: "failed" });
    await seedDelivery(db, { alertId: "a:4", status: "expired" });

    await expect(repository.recentDeliveryCounts()).resolves.toEqual({
      expired: 1,
      failed: 1,
      sent: 2,
      suppressed: 0,
    });
  });

  it("excludes deliveries older than 24 hours", async () => {
    await seedDelivery(db, {
      alertId: "old:1",
      sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      status: "sent",
    });
    await seedDelivery(db, { alertId: "new:1", status: "sent" });

    const counts = await repository.recentDeliveryCounts();
    expect(counts.sent).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/health/health.repository.spec.ts`
Expected: FAIL — cannot resolve `./health.repository`.

- [ ] **Step 3: Write the implementation**

`src/features/health/health.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { count, gte } from "drizzle-orm";
import {
  deliveries,
  type DeliveryStatus,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

export const DELIVERY_COUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeliveryCounts = Record<DeliveryStatus, number>;

/**
 * Read-only health queries. Lives here (not features/dispatch) so HealthModule
 * depends only on core/drizzle — no cross-feature import (spec §1).
 */
@Injectable()
export class HealthRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async recentDeliveryCounts(): Promise<DeliveryCounts> {
    const since = new Date(Date.now() - DELIVERY_COUNT_WINDOW_MS);
    const rows = await this.drizzle.db
      .select({ n: count(), status: deliveries.status })
      .from(deliveries)
      .where(gte(deliveries.sentAt, since))
      .groupBy(deliveries.status);

    const counts: DeliveryCounts = {
      expired: 0,
      failed: 0,
      sent: 0,
      suppressed: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.n;
    }
    return counts;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/health/health.repository.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/health/health.repository.ts src/features/health/health.repository.spec.ts
git commit -m "feat(scrubjay-discord): health repository for delivery outcome counts"
```

---

### Task 3: Terminus indicators (`database`, `ingest`, `dispatch`)

**Files:**
- Modify: `package.json` (add `@nestjs/terminus`)
- Create: `src/features/health/indicators/database.health.ts`
- Create: `src/features/health/indicators/ingest.health.ts`
- Create: `src/features/health/indicators/dispatch.health.ts`
- Test: `src/features/health/indicators/database.health.spec.ts`
- Test: `src/features/health/indicators/ingest.health.spec.ts`
- Test: `src/features/health/indicators/dispatch.health.spec.ts`

**Interfaces:**
- Consumes: `HealthStateService.snapshot()` (Task 1), `HealthRepository.recentDeliveryCounts()` (Task 2), `DrizzleService`, terminus `HealthIndicatorService`.
- Produces (used by Task 4): three injectable classes, each exposing `isHealthy(key: string)` returning a terminus `HealthIndicatorResult` (async for `database`/`dispatch`, sync for `ingest`).

- [ ] **Step 1: Install @nestjs/terminus**

Run from `apps/scrubjay-discord/`: `pnpm add @nestjs/terminus`
Expected: resolves a version compatible with `@nestjs/common@^11` (v11.x). Do NOT add `@nestjs/axios`.

- [ ] **Step 2: Write the failing tests**

The specs construct a real `HealthIndicatorService` (parameterless terminus class) — mocking it would only test the mock.

`src/features/health/indicators/database.health.spec.ts`:

```ts
import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { DatabaseHealthIndicator } from "./database.health";

describe("DatabaseHealthIndicator", () => {
  const makeIndicator = (execute: ReturnType<typeof vi.fn>) =>
    new DatabaseHealthIndicator(
      new HealthIndicatorService(),
      { db: { execute } } as unknown as DrizzleService,
    );

  it("reports up when SELECT 1 succeeds", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const result = await makeIndicator(execute).isHealthy("database");

    expect(result).toEqual({ database: { status: "up" } });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reports down with the error message when the query throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("connection refused"));
    const result = await makeIndicator(execute).isHealthy("database");

    expect(result).toEqual({
      database: { message: "connection refused", status: "down" },
    });
  });
});
```

`src/features/health/indicators/ingest.health.spec.ts`:

```ts
import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it } from "vitest";
import { HealthStateService } from "../health-state.service";
import { IngestHealthIndicator } from "./ingest.health";

describe("IngestHealthIndicator", () => {
  it("is always up and carries the ingest snapshot as details", () => {
    const state = new HealthStateService();
    state.recordIngestTick([]);
    const indicator = new IngestHealthIndicator(
      new HealthIndicatorService(),
      state,
    );

    const result = indicator.isHealthy("ingest");

    expect(result["ingest"]).toMatchObject({
      noSources: true,
      sources: [],
      status: "up",
    });
  });
});
```

`src/features/health/indicators/dispatch.health.spec.ts`:

```ts
import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it, vi } from "vitest";
import { HealthStateService } from "../health-state.service";
import type { HealthRepository } from "../health.repository";
import { DispatchHealthIndicator } from "./dispatch.health";

describe("DispatchHealthIndicator", () => {
  it("is up with last tick and 24h outcome counts as details", async () => {
    const state = new HealthStateService();
    state.recordDispatchTick();
    const counts = { expired: 0, failed: 1, sent: 5, suppressed: 2 };
    const repository = {
      recentDeliveryCounts: vi.fn().mockResolvedValue(counts),
    };
    const indicator = new DispatchHealthIndicator(
      new HealthIndicatorService(),
      state,
      repository as unknown as HealthRepository,
    );

    const result = await indicator.isHealthy("dispatch");

    expect(result["dispatch"]).toMatchObject({
      last24h: counts,
      status: "up",
    });
    expect(result["dispatch"]!.lastTickAt).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/features/health/indicators/`
Expected: FAIL — the three `./\*.health` modules don't exist.

- [ ] **Step 4: Write the implementations**

`src/features/health/indicators/database.health.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

/** The only indicator allowed to fail the check (spec decision 2). */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly drizzle: DrizzleService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.health.check(key);
    try {
      // Pool-level connect/statement timeouts bound this; no extra timeout.
      await this.drizzle.db.execute(sql`select 1`);
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```

`src/features/health/indicators/ingest.health.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { HealthStateService } from "../health-state.service";

/**
 * Always "up": ingest staleness must never 503 the check — a container
 * restart cannot fix an eBird outage (spec decision 2). Details carry the
 * freshness data for humans and `docker inspect`.
 */
@Injectable()
export class IngestHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly state: HealthStateService,
  ) {}

  isHealthy(key: string) {
    return this.health.check(key).up(this.state.snapshot().ingest);
  }
}
```

`src/features/health/indicators/dispatch.health.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { HealthStateService } from "../health-state.service";
import { HealthRepository } from "../health.repository";

/**
 * Always "up" by design; the DB query can still throw, but in that scenario
 * the database indicator already fails the check (spec §3 caveat).
 */
@Injectable()
export class DispatchHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly state: HealthStateService,
    private readonly repository: HealthRepository,
  ) {}

  async isHealthy(key: string) {
    const last24h = await this.repository.recentDeliveryCounts();
    return this.health.check(key).up({
      ...this.state.snapshot().dispatch,
      last24h,
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/health/indicators/`
Expected: PASS (4 tests across 3 files). If `new HealthIndicatorService()` fails to construct (API drift), check the installed signature with `grep -n "class HealthIndicatorService" -A 5 node_modules/@nestjs/terminus/dist/health-indicator/health-indicator.service.d.ts` and adjust construction in the specs only — the production classes just inject it.

- [ ] **Step 6: Commit**

```bash
git add package.json ../../pnpm-lock.yaml src/features/health/indicators/
git commit -m "feat(scrubjay-discord): terminus health indicators for db, ingest, dispatch"
```

---

### Task 4: `HealthController` + module wiring

**Files:**
- Create: `src/features/health/health.controller.ts`
- Modify: `src/features/health/health.module.ts`
- Test: `src/features/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: the three indicators (Task 3), `HealthStateService` (Task 1), `HealthRepository` (Task 2), terminus `TerminusModule` / `HealthCheckService` / `@HealthCheck()`.
- Produces: `GET /health` → 200 with `info.database/ingest/dispatch` when healthy, 503 when the DB ping fails. `HealthModule` exports `HealthStateService` (consumed by Task 5).

- [ ] **Step 1: Write the failing test**

The spec boots a real Nest app on an ephemeral port and asserts over HTTP — the 200/503 conversion is terminus behavior we want observed, not mocked. Only `DrizzleService` and `HealthRepository` are stubbed.

`src/features/health/health.controller.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleService } from "@/core/drizzle/drizzle.service";
import { HealthStateService } from "./health-state.service";
import { HealthController } from "./health.controller";
import { HealthRepository } from "./health.repository";
import { DatabaseHealthIndicator } from "./indicators/database.health";
import { DispatchHealthIndicator } from "./indicators/dispatch.health";
import { IngestHealthIndicator } from "./indicators/ingest.health";

describe("HealthController", () => {
  let app: INestApplication;
  const executeMock = vi.fn();

  const startApp = async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      imports: [TerminusModule],
      providers: [
        DatabaseHealthIndicator,
        DispatchHealthIndicator,
        HealthStateService,
        IngestHealthIndicator,
        { provide: DrizzleService, useValue: { db: { execute: executeMock } } },
        {
          provide: HealthRepository,
          useValue: {
            recentDeliveryCounts: vi.fn().mockResolvedValue({
              expired: 0,
              failed: 0,
              sent: 0,
              suppressed: 0,
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
    return app.getUrl();
  };

  beforeEach(() => {
    executeMock.mockReset();
    // Terminus logs failed checks; keep test output quiet.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("returns 200 with all indicators when the DB is reachable", async () => {
    executeMock.mockResolvedValue([]);
    const url = await startApp();

    const res = await fetch(`${url}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.info.database.status).toBe("up");
    expect(body.info.ingest.status).toBe("up");
    expect(body.info.dispatch.last24h).toEqual({
      expired: 0,
      failed: 0,
      sent: 0,
      suppressed: 0,
    });
  });

  it("returns 503 when the DB ping fails", async () => {
    executeMock.mockRejectedValue(new Error("connection refused"));
    const url = await startApp();

    const res = await fetch(`${url}/health`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.error.database.status).toBe("down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/health/health.controller.spec.ts`
Expected: FAIL — cannot resolve `./health.controller`.

- [ ] **Step 3: Write the controller and rewire the module**

`src/features/health/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./indicators/database.health";
import { DispatchHealthIndicator } from "./indicators/dispatch.health";
import { IngestHealthIndicator } from "./indicators/ingest.health";

@Controller("health")
export class HealthController {
  constructor(
    private readonly database: DatabaseHealthIndicator,
    private readonly dispatch: DispatchHealthIndicator,
    private readonly health: HealthCheckService,
    private readonly ingest: IngestHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.database.isHealthy("database"),
      () => this.ingest.isHealthy("ingest"),
      () => this.dispatch.isHealthy("dispatch"),
    ]);
  }
}
```

`src/features/health/health.module.ts` (full replacement):

```ts
import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthStateService } from "./health-state.service";
import { HealthCommands } from "./health.commands";
import { HealthController } from "./health.controller";
import { HealthRepository } from "./health.repository";
import { DatabaseHealthIndicator } from "./indicators/database.health";
import { DispatchHealthIndicator } from "./indicators/dispatch.health";
import { IngestHealthIndicator } from "./indicators/ingest.health";

@Module({
  controllers: [HealthController],
  exports: [HealthStateService],
  imports: [TerminusModule],
  providers: [
    DatabaseHealthIndicator,
    DispatchHealthIndicator,
    HealthCommands,
    HealthRepository,
    HealthStateService,
    IngestHealthIndicator,
  ],
})
export class HealthModule {}
```

(`AppModule` already imports `HealthModule` — no change there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/health/health.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/health/health.controller.ts src/features/health/health.controller.spec.ts src/features/health/health.module.ts
git commit -m "feat(scrubjay-discord): GET /health terminus endpoint"
```

---

### Task 5: Job wiring — record freshness, warn on empty sources

**Files:**
- Modify: `src/features/jobs/ingest.job.ts`
- Modify: `src/features/jobs/dispatch.job.ts`
- Modify: `src/features/jobs/jobs.module.ts`
- Test: `src/features/jobs/ingest.job.spec.ts` (additions + constructor update)
- Test: `src/features/jobs/dispatch.job.spec.ts` (additions + constructor update)

**Interfaces:**
- Consumes: `HealthStateService` (`recordIngestTick` / `recordIngestSuccess` / `recordDispatchTick`) exported by `HealthModule`.
- Produces: nothing new — behavior change only.

- [ ] **Step 1: Write the failing tests**

In `src/features/jobs/ingest.job.spec.ts`, add a health mock and a warn spy, and update the constructor call. The `beforeEach` block becomes:

```ts
  const ebirdMock = { ingestRegion: vi.fn() };
  const bootstrapMock = { waitForBootstrap: vi.fn() };
  const sourcesMock = { getEBirdSources: vi.fn() };
  const healthStateMock = {
    recordIngestSuccess: vi.fn(),
    recordIngestTick: vi.fn(),
  };
  let loggerWarnSpy: MockInstance;

  beforeEach(() => {
    loggerErrorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    loggerWarnSpy = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

    ebirdMock.ingestRegion.mockReset();
    bootstrapMock.waitForBootstrap.mockReset();
    sourcesMock.getEBirdSources.mockReset();
    healthStateMock.recordIngestSuccess.mockReset();
    healthStateMock.recordIngestTick.mockReset();

    ebirdMock.ingestRegion.mockResolvedValue(2);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA", "US-WA"]);

    job = new IngestJob(
      ebirdMock as unknown as IngestService,
      bootstrapMock as unknown as BootstrapService,
      sourcesMock as unknown as SourcesRepository,
      healthStateMock as unknown as HealthStateService,
    );
  });
```

Add the import: `import type { HealthStateService } from "@/features/health/health-state.service";`

New tests (append inside the `describe`):

```ts
  it("records the tick and per-region successes in health state", async () => {
    await job.run();

    expect(healthStateMock.recordIngestTick).toHaveBeenCalledWith([
      "US-CA",
      "US-WA",
    ]);
    expect(healthStateMock.recordIngestSuccess).toHaveBeenCalledWith("US-CA");
    expect(healthStateMock.recordIngestSuccess).toHaveBeenCalledWith("US-WA");
  });

  it("does not record success for a failed region", async () => {
    ebirdMock.ingestRegion.mockRejectedValueOnce(new Error("eBird 500"));

    await job.run();

    expect(healthStateMock.recordIngestSuccess).not.toHaveBeenCalledWith(
      "US-CA",
    );
    expect(healthStateMock.recordIngestSuccess).toHaveBeenCalledWith("US-WA");
  });

  it("warns when no sources are configured", async () => {
    sourcesMock.getEBirdSources.mockResolvedValue([]);

    await job.run();

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      "No eBird sources configured; ingest is a no-op",
    );
    expect(healthStateMock.recordIngestTick).toHaveBeenCalledWith([]);
    expect(ebirdMock.ingestRegion).not.toHaveBeenCalled();
  });
```

In `src/features/jobs/dispatch.job.spec.ts`, add to the mocks and constructor the same way:

```ts
  const healthStateMock = { recordDispatchTick: vi.fn() };
```

Reset it in `beforeEach` (`healthStateMock.recordDispatchTick.mockReset();`), pass it as the third constructor argument (`healthStateMock as unknown as HealthStateService`), import the type, and append:

```ts
  it("records a dispatch tick in health state", async () => {
    await job.run();

    expect(healthStateMock.recordDispatchTick).toHaveBeenCalledOnce();
  });

  it("does not record a tick when bootstrap fails", async () => {
    bootstrapMock.waitForBootstrap.mockRejectedValue(new Error("timeout"));

    await job.run();

    expect(healthStateMock.recordDispatchTick).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/jobs/ingest.job.spec.ts src/features/jobs/dispatch.job.spec.ts`
Expected: FAIL — new assertions unmet (constructor accepts the extra arg silently; the record/warn expectations fail).

- [ ] **Step 3: Implement the job changes**

`src/features/jobs/ingest.job.ts` — add the import and constructor param, and rework the body of `run()`'s `try` block:

```ts
import { HealthStateService } from "@/features/health/health-state.service";
```

```ts
  constructor(
    private readonly ingest: IngestService,
    private readonly bootstrapService: BootstrapService,
    private readonly sources: SourcesRepository,
    private readonly healthState: HealthStateService,
  ) {}
```

```ts
      const regions = await this.sources.getEBirdSources();
      this.healthState.recordIngestTick(regions);
      if (regions.length === 0) {
        // Zero subscriptions makes every tick a silent no-op; say so.
        this.logger.warn("No eBird sources configured; ingest is a no-op");
      }

      for (const region of regions) {
        try {
          const inserted = await this.ingest.ingestRegion(region);
          this.healthState.recordIngestSuccess(region);
          this.logger.log(`Region ${region}: ${inserted} alerts ingested`);
        } catch (err) {
          this.logger.error(
            `Failed to ingest ${region}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
```

`src/features/jobs/dispatch.job.ts` — same pattern: import `HealthStateService`, add `private readonly healthState: HealthStateService` as the third constructor parameter, and inside `run()` add one line after `await this.bootstrapService.waitForBootstrap();`:

```ts
      this.healthState.recordDispatchTick();
```

`src/features/jobs/jobs.module.ts` — add `HealthModule` to imports:

```ts
import { Module } from "@nestjs/common";
import { DispatchModule } from "../dispatch/dispatch.module";
import { HealthModule } from "../health/health.module";
import { IngestModule } from "../ingest/ingest.module";
import { SourcesModule } from "../sources/sources.module";
import { BootstrapService } from "./bootstrap.service";
import { DispatchJob } from "./dispatch.job";
import { IngestJob } from "./ingest.job";

@Module({
  imports: [DispatchModule, HealthModule, IngestModule, SourcesModule],
  providers: [BootstrapService, DispatchJob, IngestJob],
})
export class JobsModule {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/jobs/`
Expected: PASS (all existing + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/
git commit -m "feat(scrubjay-discord): jobs record health state; warn on empty sources"
```

---

### Task 6: Dockerfile HEALTHCHECK + final gate

**Files:**
- Modify: `apps/scrubjay-discord/Dockerfile` (runner stage)
- Modify: `.superpowers/notes/improvements.md` (mark 2.1 done)

**Interfaces:**
- Consumes: `GET /health` (Task 4); container env `PORT` (defaults to 3000 in config).
- Produces: Docker-native health status for the running container.

- [ ] **Step 1: Add the HEALTHCHECK**

In `apps/scrubjay-discord/Dockerfile`, insert between `WORKDIR /usr/src/app/apps/scrubjay-discord` and `CMD`:

```dockerfile
# Single quotes are load-bearing: backticks or ${...} in double quotes would
# be expanded by /bin/sh before node runs. start-period covers migrations +
# Discord login. Alpine has no curl; node 22's global fetch does the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT ?? 3000) + "/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
```

- [ ] **Step 2: Verify the image builds and carries the healthcheck**

Run from the repo root:

```bash
docker build -f apps/scrubjay-discord/Dockerfile -t scrubjay-discord:health-plan .
docker inspect --format '{{json .Config.Healthcheck}}' scrubjay-discord:health-plan
```

Expected: build succeeds; inspect prints a JSON object with `"Test": ["CMD-SHELL", "node -e '..."]`, `"Interval": 30000000000`, `"StartPeriod": 60000000000`.

- [ ] **Step 3: Run the full gate**

Run from `apps/scrubjay-discord/`: `pnpm test && pnpm check-types && pnpm lint`
Expected: all pass. (`pnpm test` includes the testcontainers specs — Docker must be running.)

- [ ] **Step 4: Update the backlog**

In `.superpowers/notes/improvements.md` §2.1, replace the section body's `- Fix: ...` lines with a status note:

```markdown
### 2.1 Observability — DONE 2026-07-09
- Log-stack sweep landed earlier in f22d77d.
- GET /health (terminus): DB ping fails the check; ingest freshness + dispatch
  outcome counts as info-only details. Dockerfile HEALTHCHECK wired.
- Empty getEBirdSources() now logs a warning every tick.
- Spec: docs/superpowers/specs/2026-07-09-observability-design.md
```

Keep the original bullet text beneath it only if other sections reference it; otherwise replace.

- [ ] **Step 5: Commit**

```bash
git add apps/scrubjay-discord/Dockerfile .superpowers/notes/improvements.md
git commit -m "feat(scrubjay-discord): Docker HEALTHCHECK against /health"
```
