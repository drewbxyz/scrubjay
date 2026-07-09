# Honest eBird Fetcher Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eBird fetcher validate its payload at runtime (per-item safeParse, log-and-skip), unify its two error channels into one, collapse the triple-transcribed location mapping, and delete the eBird-adjacent pass-throughs (`SourcesService`, the dead eBird chain, dead types).

**Architecture:** `EBirdFetcher.fetchRareObservations` becomes the single untrusted→trusted boundary: it throws on HTTP/network failure and returns only zod-validated observations. Downstream, `upsertLocation` reads location fields directly off the transformed observation (one mapping instead of three), `SourcesService` dies (callers inject `SourcesRepository`), and `EBirdIngestJob.run` gets the same whole-body try/catch `DispatchJob.run` already has.

**Tech Stack:** NestJS 11, Necord, zod v4 (`z.prettifyError` is available), drizzle-orm, Jest (real-Postgres specs need Docker running).

**Spec:** `docs/superpowers/specs/2026-07-08-ebird-seam-design.md`

## Global Constraints

- Branch: `refactor/ebird-seam` (already created; spec committed on it).
- Exact error/log strings (verbatim, tests assert them):
  - throw: `` `eBird API returned ${response.status} ${response.statusText}` ``
  - throw: `eBird API returned a non-array payload`
  - warn: `` `Skipping malformed observation at index ${index}: ${z.prettifyError(result.error)}` ``
  - log: `` `Fetched ${valid.length} observations (${skipped} skipped)` `` when skipped > 0, else `` `Fetched ${valid.length} observations` ``
  - error (ingest job): `` `Ingest tick failed: ${err}` ``
- Run Jest from `apps/scrubjay-discord/` as `./node_modules/.bin/jest <args>`. NEVER `pnpm run test -- <args>` (the `--` breaks turbo). `ebird.repository.spec.ts` hits real Postgres — Docker must be running.
- From repo root after all code tasks: `pnpm run format-and-lint:fix` (Biome enforces sorted object keys and import order — run it before every commit and include any files it fixes) and `pnpm run check-types` (2 turbo tasks).
- Conventional commit messages.
- The binding test requirement is: everything green and the named cases exist. Total suite/test counts in this plan are approximations — do not chase exact counts.
- No schema/migration changes. No changes to `features/dispatch/` or `features/filters/`.

---

## File structure

| File | Fate |
|---|---|
| `src/features/ebird/ebird.fetcher.ts` | rewrite: throw on !ok / non-array; safeParse loop |
| `src/features/ebird/ebird.schema.ts` | delete `EBirdObservationResponse`, `EBirdLocation` |
| `src/features/ebird/ebird.transformer.ts` | delete `extractLocation` |
| `src/features/ebird/ebird.repository.ts` | `upsertLocation` takes `TransformedEBirdObservation`; delete `getAlertsCreatedSinceDate` |
| `src/features/ebird/ebird.service.ts` | `ingestObservation` drops `extractLocation`; delete `getObservationsSinceCreatedDate` |
| `src/features/sources/sources.service.ts` | **delete** |
| `src/features/sources/sources.module.ts` | provide + export `SourcesRepository` |
| `src/features/jobs/bootstrap.service.ts` | inject `SourcesRepository` |
| `src/features/jobs/ebird-ingest.job.ts` | inject `SourcesRepository`; whole-body try/catch |
| `.changeset/ebird-seam.md` | new (patch) |

All paths below are relative to `apps/scrubjay-discord/` unless they start with `.changeset/` or `docs/`.

---

### Task 1: Fetcher seam — validate or throw

**Files:**
- Modify: `src/features/ebird/ebird.fetcher.ts`
- Test: `src/features/ebird/__tests__/ebird.fetcher.spec.ts`

**Interfaces:**
- Consumes: `RawEBirdObservationSchema`, `EBirdObservation` from `./ebird.schema` (existing).
- Produces: `fetchRareObservations(regionCode: string): Promise<EBirdObservation[]>` — same signature, new contract: returns **validated** observations; **throws** on HTTP failure or non-array payload; logs and skips malformed rows. Task 3's service-spec expectations rely on the throw behavior already being handled by `ingestRegion`'s existing catch (no service change needed here).

- [ ] **Step 1: Rewrite the fetcher spec with the new contract (failing tests)**

Replace the entire contents of `src/features/ebird/__tests__/ebird.fetcher.spec.ts` with:

```ts
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { EBirdFetcher } from "../ebird.fetcher";
import type { EBirdObservation } from "../ebird.schema";

const validObservation: EBirdObservation = {
  checklistId: "cl1",
  comName: "Common Loon",
  countryCode: "US",
  countryName: "United States",
  evidence: "P",
  firstName: "",
  hasComments: false,
  hasRichMedia: false,
  howMany: 2,
  lastName: "",
  lat: 47.6062,
  lng: -122.3321,
  locationPrivate: false,
  locId: "loc-1",
  locName: "Lake Union",
  obsDt: "2024-01-01T10:00:00Z",
  obsId: "obs-1",
  obsReviewed: true,
  obsValid: true,
  presenceNoted: false,
  sciName: "Gavia immer",
  speciesCode: "comloo",
  subId: "sub-1",
  subnational1Code: "US-WA",
  subnational1Name: "Washington",
  subnational2Code: "US-WA-033",
  subnational2Name: "King",
  userDisplayName: "",
};

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue(body),
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
  }) as unknown as typeof fetch;
}

describe("EBirdFetcher", () => {
  let fetcher: EBirdFetcher;
  let warnSpy: jest.SpyInstance;
  const originalFetch = global.fetch;
  const configServiceMock = {
    get: jest.fn(),
  } as unknown as ConfigService<never, true>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: EBirdFetcher,
          useFactory: () => new EBirdFetcher(configServiceMock),
        },
      ],
    }).compile();
    fetcher = module.get<EBirdFetcher>(EBirdFetcher);

    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    (configServiceMock.get as unknown as jest.Mock).mockImplementation(
      (key: string) => {
        if (key === "EBIRD_BASE_URL") return "https://api.ebird.org";
        if (key === "EBIRD_TOKEN") return "token";
        throw new Error("unexpected key");
      },
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("sends a request with configured base URL and token and returns validated rows", async () => {
    mockFetchResponse([validObservation]);

    const result = await fetcher.fetchRareObservations("US-WA");

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url.toString()).toBe(
      "https://api.ebird.org/v2/data/obs/US-WA/recent/notable?back=7&detail=full",
    );
    expect(options).toMatchObject({
      headers: { "X-eBirdApiToken": "token" },
    });
    expect(result).toEqual([validObservation]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("throws with status and statusText when the request fails", async () => {
    mockFetchResponse(null, false, 500);

    await expect(fetcher.fetchRareObservations("US-CA")).rejects.toThrow(
      "eBird API returned 500 Internal Server Error",
    );
  });

  it("throws when the payload is not an array", async () => {
    mockFetchResponse({ error: "quota exceeded" });

    await expect(fetcher.fetchRareObservations("US-CA")).rejects.toThrow(
      "eBird API returned a non-array payload",
    );
  });

  it("skips malformed rows, logs them, and returns the valid ones", async () => {
    const malformed = { ...validObservation, lat: "not-a-number" };
    mockFetchResponse([validObservation, malformed]);

    const result = await fetcher.fetchRareObservations("US-WA");

    expect(result).toEqual([validObservation]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping malformed observation at index 1"),
    );
  });
});
```

- [ ] **Step 2: Run the spec to verify the new cases fail**

Run (from `apps/scrubjay-discord/`): `./node_modules/.bin/jest src/features/ebird/__tests__/ebird.fetcher.spec.ts`
Expected: FAIL — "throws with status and statusText" gets `[]` instead of a rejection; "skips malformed rows" returns both rows.

- [ ] **Step 3: Rewrite the fetcher**

Replace the entire contents of `src/features/ebird/ebird.fetcher.ts` with:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { AppConfig } from "@/core/config/config.schema";
import {
  type EBirdObservation,
  RawEBirdObservationSchema,
} from "./ebird.schema";

@Injectable()
export class EBirdFetcher {
  private readonly logger = new Logger(EBirdFetcher.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /**
   * Fetches notable observations for a region. Returns validated
   * observations; throws on HTTP or network failure. Malformed rows are
   * logged and skipped rather than failing the batch.
   */
  async fetchRareObservations(
    regionCode: string,
  ): Promise<EBirdObservation[]> {
    const url = new URL(
      `/v2/data/obs/${regionCode}/recent/notable?back=7&detail=full`,
      this.configService.get("EBIRD_BASE_URL", { infer: true }),
    );

    const response = await fetch(url, {
      headers: {
        "X-eBirdApiToken": this.configService.get("EBIRD_TOKEN", {
          infer: true,
        }),
      },
    });
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
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `./node_modules/.bin/jest src/features/ebird/__tests__/ebird.fetcher.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite, lint, and commit**

From `apps/scrubjay-discord/`: `./node_modules/.bin/jest` — everything green (Docker must be running).
From repo root: `pnpm run format-and-lint:fix` — clean (commit any files it fixes).

```bash
git add apps/scrubjay-discord/src/features/ebird/ebird.fetcher.ts apps/scrubjay-discord/src/features/ebird/__tests__/ebird.fetcher.spec.ts
git commit -m "refactor(ebird): validate observations at the fetcher seam, throw on HTTP failure"
```

---

### Task 2: Collapse the location mapping

**Files:**
- Modify: `src/features/ebird/ebird.schema.ts` (delete `EBirdLocation`, `EBirdObservationResponse`)
- Modify: `src/features/ebird/ebird.transformer.ts` (delete `extractLocation`)
- Modify: `src/features/ebird/ebird.repository.ts:14` (`upsertLocation` signature)
- Modify: `src/features/ebird/ebird.service.ts:50-54` (`ingestObservation`)
- Test: `src/features/ebird/__tests__/ebird.transformer.spec.ts`, `__tests__/ebird.repository.spec.ts`, `__tests__/ebird.service.spec.ts`

**Interfaces:**
- Consumes: `TransformedEBirdObservation` (unchanged).
- Produces: `EBirdRepository.upsertLocation(data: TransformedEBirdObservation)` — the location fields (`locId`, `locName`, `subnational1Code/Name`, `subnational2Code/Name`, `locationPrivate`, `lat`, `lng`) are read directly off the observation; the body's insert `values` and conflict `set` are **unchanged**. `EBirdLocation` and `EBirdObservationResponse` no longer exist — nothing may import them after this task.

- [ ] **Step 1: Update the three specs (failing)**

In `src/features/ebird/__tests__/ebird.transformer.spec.ts`: delete the entire `it("extracts location details from an observation", ...)` block (lines 70–86).

In `src/features/ebird/__tests__/ebird.repository.spec.ts`: replace the import block and `baseLocation` fixture (lines 1–24) with:

```ts
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { locations, observations } from "@/core/drizzle/drizzle.schema";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import { createTestDb, seedLocation, truncateAll } from "@/testing/db-helpers";
import { EBirdRepository } from "../ebird.repository";
import type { TransformedEBirdObservation } from "../ebird.schema";
```

and replace the `upsertLocation` describe block's use of `baseLocation` by deriving it from `baseObservation` (which stays exactly as it is — keep it defined above the describe):

```ts
  describe("upsertLocation", () => {
    it("propagates renames and privacy changes on conflict", async () => {
      const observationAtL100: TransformedEBirdObservation = {
        ...baseObservation,
        locId: "L100",
        locName: "Old Name",
      };
      await repository.upsertLocation(observationAtL100);
      await repository.upsertLocation({
        ...observationAtL100,
        locationPrivate: true,
        locName: "New Name",
      });

      const row = await db.db.query.locations.findFirst({
        where: eq(locations.id, "L100"),
      });
      expect(row?.name).toBe("New Name");
      expect(row?.isPrivate).toBe(true);
    });
  });
```

In `src/features/ebird/__tests__/ebird.service.spec.ts`:
- In `transformerMock` (lines 18–21), delete the `extractLocation: jest.fn(),` line.
- Replace the `it("writes a single observation to both location and observation tables", ...)` block (lines 121–147) with:

```ts
  it("writes a single observation to both location and observation tables", async () => {
    await service.ingestObservation(transformedObservation);

    expect(repoMock.upsertLocation).toHaveBeenCalledWith(
      transformedObservation,
    );
    expect(repoMock.upsertObservation).toHaveBeenCalledWith(
      transformedObservation,
    );
  });
```

- [ ] **Step 2: Run the three specs to verify current state**

Run: `./node_modules/.bin/jest src/features/ebird`
Expected: `ebird.service.spec.ts` FAILS ("writes a single observation" — `upsertLocation` receives the extracted location object, not the observation). Transformer and repository specs still pass (TS structural typing accepts the wider object at runtime; the type-level break comes when `EBirdLocation` is deleted).

- [ ] **Step 3: Make the source changes**

In `src/features/ebird/ebird.schema.ts`, delete the `EBirdObservationResponse` type (lines 36–38) and the `EBirdLocation` type (lines 49–62). The file ends after `TransformedEBirdObservation`.

Replace the entire contents of `src/features/ebird/ebird.transformer.ts` with:

```ts
import { Injectable } from "@nestjs/common";
import type {
  EBirdObservation,
  TransformedEBirdObservation,
} from "./ebird.schema";

@Injectable()
export class EBirdTransformer {
  private countMedia(observation: EBirdObservation) {
    return {
      audioCount: observation.evidence === "A" ? 1 : 0,
      photoCount: observation.evidence === "P" ? 1 : 0,
      videoCount: observation.evidence === "V" ? 1 : 0,
    };
  }

  private isPresenceNoted(curr: boolean, acc: boolean) {
    return curr || acc;
  }

  transformObservations(raw: EBirdObservation[]) {
    const reduced = raw.reduce((acc, observation) => {
      const key = `${observation.speciesCode}-${observation.subId}`;
      const mediaCounts = this.countMedia(observation);

      const existing = acc.get(key);
      if (existing) {
        acc.set(key, {
          ...existing,
          audioCount: existing.audioCount + mediaCounts.audioCount,
          photoCount: existing.photoCount + mediaCounts.photoCount,
          presenceNoted: this.isPresenceNoted(
            existing.presenceNoted,
            observation.presenceNoted,
          ),
          videoCount: existing.videoCount + mediaCounts.videoCount,
        });
      } else {
        acc.set(key, {
          ...observation,
          ...mediaCounts,
        });
      }

      return acc;
    }, new Map<string, TransformedEBirdObservation>());
    return Array.from(reduced.values());
  }
}
```

In `src/features/ebird/ebird.repository.ts`: change the import and `upsertLocation` signature — the body (both `values` and `set`) stays byte-identical:

```ts
import type { TransformedEBirdObservation } from "./ebird.schema";
```

```ts
  async upsertLocation(data: TransformedEBirdObservation) {
```

In `src/features/ebird/ebird.service.ts`, replace `ingestObservation` (lines 50–54) with:

```ts
  async ingestObservation(observation: TransformedEBirdObservation) {
    await this.repo.upsertLocation(observation);
    await this.repo.upsertObservation(observation);
  }
```

- [ ] **Step 4: Run the eBird specs and typecheck**

Run: `./node_modules/.bin/jest src/features/ebird`
Expected: PASS.
From repo root: `pnpm run check-types`
Expected: 2/2 successful — this proves nothing else imported `EBirdLocation`/`EBirdObservationResponse`.

- [ ] **Step 5: Lint and commit**

From repo root: `pnpm run format-and-lint:fix` — clean.

```bash
git add apps/scrubjay-discord/src/features/ebird
git commit -m "refactor(ebird): collapse location mapping into upsertLocation, delete dead types"
```

---

### Task 3: Delete the dead eBird chain

**Files:**
- Modify: `src/features/ebird/ebird.service.ts` (delete `getObservationsSinceCreatedDate`, lines 56–58)
- Modify: `src/features/ebird/ebird.repository.ts` (delete `getAlertsCreatedSinceDate` and the now-unused `gt` import and `observations`-only usage check)
- Test: `src/features/ebird/__tests__/ebird.service.spec.ts` (delete the `getAlertsCreatedSinceDate: jest.fn(),` stub from `repoMock`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EBirdService` no longer has `getObservationsSinceCreatedDate`; `EBirdRepository` no longer has `getAlertsCreatedSinceDate`. Verified callers: none in production code (the repo method's only reference is the jest mock stub being deleted here).

- [ ] **Step 1: Delete the code**

In `src/features/ebird/ebird.service.ts`, delete:

```ts
  async getObservationsSinceCreatedDate(since: Date) {
    return this.repo.getAlertsCreatedSinceDate(since);
  }
```

In `src/features/ebird/ebird.repository.ts`, delete:

```ts
  async getAlertsCreatedSinceDate(since: Date) {
    return this.drizzle.db.query.observations.findMany({
      where: gt(observations.createdAt, since),
    });
  }
```

and delete the whole `import { gt } from "drizzle-orm";` line (`gt` was its only named import; the separate `@/core/drizzle/drizzle.schema` import stays — `locations` and `observations` are still used by the upserts).

In `src/features/ebird/__tests__/ebird.service.spec.ts`, delete the `getAlertsCreatedSinceDate: jest.fn(),` line from `repoMock`.

- [ ] **Step 2: Verify green and commit**

Run: `./node_modules/.bin/jest src/features/ebird` — PASS.
From repo root: `pnpm run check-types` — 2/2 (proves no production caller existed).
From repo root: `pnpm run format-and-lint:fix` — clean (it will flag the unused `gt` import if you missed it).

```bash
git add apps/scrubjay-discord/src/features/ebird
git commit -m "refactor(ebird): delete dead getObservationsSinceCreatedDate chain"
```

---

### Task 4: Delete SourcesService; callers use the repository

**Files:**
- Delete: `src/features/sources/sources.service.ts`
- Modify: `src/features/sources/sources.module.ts`
- Modify: `src/features/jobs/bootstrap.service.ts:4,20` (inject `SourcesRepository`)
- Modify: `src/features/jobs/ebird-ingest.job.ts:4,14,24` (inject `SourcesRepository`)
- Test: `src/features/jobs/__tests__/bootstrap.service.spec.ts` (type-import swap only)

**Interfaces:**
- Consumes: `SourcesRepository.getEBirdSources(): Promise<string[]>` (existing, unchanged).
- Produces: `SourcesModule` provides and exports `SourcesRepository`. `BootstrapService`'s constructor param stays named `sources`, now typed `SourcesRepository`. `EBirdIngestJob`'s param is renamed `sourcesService` → `sources`, typed `SourcesRepository` (Task 5's full-file rewrite assumes this name).
- Behavior note (spec §3): `SourcesService`'s catch-log-return-`[]` swallow is deliberately NOT recreated. In `BootstrapService.onModuleInit` a DB failure now crashes startup (fail-fast, consistent with the B6 comment). The ingest job's protection arrives in Task 5.

- [ ] **Step 1: Make the changes**

Delete `src/features/sources/sources.service.ts`.

Replace the contents of `src/features/sources/sources.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { SourcesRepository } from "./sources.repository";

@Module({
  exports: [SourcesRepository],
  imports: [],
  providers: [SourcesRepository],
})
export class SourcesModule {}
```

In `src/features/jobs/bootstrap.service.ts`:
- line 4: `import { SourcesRepository } from "@/features/sources/sources.repository";`
- line 20: `private readonly sources: SourcesRepository,`
(the call site `this.sources.getEBirdSources()` at line 64 is unchanged)

In `src/features/jobs/ebird-ingest.job.ts`:
- line 4: `import { SourcesRepository } from "@/features/sources/sources.repository";`
- line 14: `private readonly sources: SourcesRepository,`
- line 24: `const regions = await this.sources.getEBirdSources();`

In `src/features/jobs/__tests__/bootstrap.service.spec.ts`:
- line 4: `import type { SourcesRepository } from "@/features/sources/sources.repository";`
- line 27: `sourcesMock as unknown as SourcesRepository,`
(the mock object shape `{ getEBirdSources: jest.fn() }` already matches the repository)

- [ ] **Step 2: Verify green and commit**

Run: `./node_modules/.bin/jest` (full suite, from `apps/scrubjay-discord/`) — PASS; the jobs specs prove the DI swap.
From repo root: `pnpm run check-types` — 2/2 (proves nothing else imported `SourcesService`).
From repo root: `pnpm run format-and-lint:fix` — clean.

```bash
git add apps/scrubjay-discord/src/features/sources apps/scrubjay-discord/src/features/jobs
git commit -m "refactor(sources): delete pass-through SourcesService, inject the repository"
```

---

### Task 5: Harden EBirdIngestJob with a whole-body try/catch

**Files:**
- Modify: `src/features/jobs/ebird-ingest.job.ts`
- Test: Create `src/features/jobs/__tests__/ebird-ingest.job.spec.ts`

**Interfaces:**
- Consumes: `EBirdService.ingestRegion(region: string): Promise<number>`, `BootstrapService.waitForBootstrap(): Promise<void>`, `SourcesRepository.getEBirdSources(): Promise<string[]>` (param named `sources` after Task 4).
- Produces: `EBirdIngestJob.run(): Promise<void>` never rejects — mirrors `DispatchJob.run` (see `src/features/jobs/dispatch.job.ts:16-29` for the pattern being matched).

- [ ] **Step 1: Write the failing spec**

Create `src/features/jobs/__tests__/ebird-ingest.job.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import type { EBirdService } from "@/features/ebird/ebird.service";
import type { SourcesRepository } from "@/features/sources/sources.repository";
import type { BootstrapService } from "../bootstrap.service";
import { EBirdIngestJob } from "../ebird-ingest.job";

describe("EBirdIngestJob", () => {
  let job: EBirdIngestJob;
  let loggerErrorSpy: jest.SpyInstance;

  const ebirdMock = { ingestRegion: jest.fn() };
  const bootstrapMock = { waitForBootstrap: jest.fn() };
  const sourcesMock = { getEBirdSources: jest.fn() };

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    ebirdMock.ingestRegion.mockReset();
    bootstrapMock.waitForBootstrap.mockReset();
    sourcesMock.getEBirdSources.mockReset();

    ebirdMock.ingestRegion.mockResolvedValue(2);
    bootstrapMock.waitForBootstrap.mockResolvedValue(undefined);
    sourcesMock.getEBirdSources.mockResolvedValue(["US-CA", "US-WA"]);

    job = new EBirdIngestJob(
      ebirdMock as unknown as EBirdService,
      bootstrapMock as unknown as BootstrapService,
      sourcesMock as unknown as SourcesRepository,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ingests every subscribed region", async () => {
    await job.run();

    expect(ebirdMock.ingestRegion).toHaveBeenCalledTimes(2);
    expect(ebirdMock.ingestRegion).toHaveBeenCalledWith("US-CA");
    expect(ebirdMock.ingestRegion).toHaveBeenCalledWith("US-WA");
  });

  it("continues past a per-region failure", async () => {
    ebirdMock.ingestRegion.mockRejectedValueOnce(new Error("eBird 500"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(ebirdMock.ingestRegion).toHaveBeenCalledTimes(2);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to ingest US-CA"),
    );
  });

  it("skips the tick without throwing when the region query fails", async () => {
    sourcesMock.getEBirdSources.mockRejectedValue(new Error("db down"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(ebirdMock.ingestRegion).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ingest tick failed"),
    );
  });

  it("skips the tick without throwing when bootstrap times out", async () => {
    bootstrapMock.waitForBootstrap.mockRejectedValue(
      new Error("Bootstrap timed out after 5 minutes"),
    );

    await expect(job.run()).resolves.toBeUndefined();

    expect(sourcesMock.getEBirdSources).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ingest tick failed"),
    );
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `./node_modules/.bin/jest src/features/jobs/__tests__/ebird-ingest.job.spec.ts`
Expected: FAIL — "skips the tick" cases reject instead of resolving.

- [ ] **Step 3: Add the whole-body try/catch**

Replace the contents of `src/features/jobs/ebird-ingest.job.ts` with:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { EBirdService } from "@/features/ebird/ebird.service";
import { SourcesRepository } from "@/features/sources/sources.repository";
import { BootstrapService } from "./bootstrap.service";

@Injectable()
export class EBirdIngestJob {
  private readonly logger = new Logger(EBirdIngestJob.name);

  constructor(
    private readonly ebird: EBirdService,
    private readonly bootstrapService: BootstrapService,
    private readonly sources: SourcesRepository,
  ) {}

  @Cron("*/15 * * * *")
  async run() {
    try {
      // Wait for bootstrap to complete before running
      await this.bootstrapService.waitForBootstrap();

      this.logger.debug("Starting eBird ingestion job...");

      const regions = await this.sources.getEBirdSources();

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
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `./node_modules/.bin/jest src/features/jobs/__tests__/ebird-ingest.job.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite, lint, commit**

From `apps/scrubjay-discord/`: `./node_modules/.bin/jest` — green.
From repo root: `pnpm run format-and-lint:fix` — clean.

```bash
git add apps/scrubjay-discord/src/features/jobs
git commit -m "fix(jobs): whole-body try/catch in EBirdIngestJob.run, matching DispatchJob"
```

---

### Task 6: Changeset and final battery

**Files:**
- Create: `.changeset/ebird-seam.md`

**Interfaces:** none.

- [ ] **Step 1: Write the changeset**

Create `.changeset/ebird-seam.md`:

```markdown
---
"scrubjay-discord": patch
---

Make the eBird fetcher seam honest (§6): `fetchRareObservations` now
validates every row against `RawEBirdObservationSchema` (malformed rows are
logged and skipped) and throws on HTTP failure instead of silently
returning an empty batch. The location shape is mapped in one place
(`upsertLocation` reads it off the observation; `extractLocation` and the
`EBirdLocation`/`EBirdObservationResponse` types are gone). Pass-through
`SourcesService` and the dead `getObservationsSinceCreatedDate` chain are
deleted (§4). `EBirdIngestJob.run` gets the same whole-body try/catch as
`DispatchJob.run`; a DB failure during startup bootstrap now fails fast
instead of booting with zero regions.
```

- [ ] **Step 2: Final battery**

From `apps/scrubjay-discord/`: `./node_modules/.bin/jest` — everything green.
From repo root: `pnpm run check-types` — 2/2 successful.
From repo root: `pnpm run format-and-lint:fix` — clean, no fixes.

- [ ] **Step 3: Commit**

```bash
git add .changeset/ebird-seam.md
git commit -m "chore: changeset for eBird seam refactor"
```
