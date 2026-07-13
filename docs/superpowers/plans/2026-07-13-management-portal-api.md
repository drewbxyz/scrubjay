# Management Portal API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the operator REST API (`/api/v1/*`) to `scrubjay-discord` plus the shared `@scrubjay/api-contracts` zod package, per the spec at `docs/superpowers/specs/2026-07-13-management-portal-design.md`. (The portal app itself is a separate follow-up plan.)

**Architecture:** New `packages/api-contracts` workspace package holds zod schemas for every endpoint. New `src/api` module in the NestJS bot exposes thin controllers on the existing Express server; they delegate to the existing services/repositories so slash commands and API writes share one domain path. The module registers only when `SCRUBJAY_API_TOKEN` is set — without it the bot behaves exactly as today.

**Tech Stack:** NestJS 11, drizzle-orm, zod 4, discord.js 14, vitest (+ testcontainers via existing global setup), pnpm + turborepo.

## Global Constraints

- Package manager is **pnpm**; run workspace commands from the repo root.
- zod is **v4** (`^4.4.3`) — use v4 APIs (`z.iso.datetime()`, `z.prettifyError`, `z.treeifyError`).
- Type checking in `scrubjay-discord` is `pnpm --filter scrubjay-discord check-types` (tsgo).
- Lint/format: run `pnpm format-and-lint:fix` from the root before every commit; biome expects alphabetized object keys (match surrounding code).
- Bot source imports use the `@/*` path alias (maps to `apps/scrubjay-discord/src/*`).
- Commit messages follow repo convention: `feat(api-contracts): …`, `feat(scrubjay-discord): …`, `chore: …`.
- The AlertQueue is the only reader/writer of Pending/Delivery semantics — the pending-alerts endpoint MUST go through `AlertQueue`, never its own query.
- Never push to main; work happens on a feature branch, PR at the end.
- DB-backed tests use the existing helpers in `apps/scrubjay-discord/src/testing/db-helpers.ts` (`createTestDb`, `truncateAll`, `seed*`); they require the vitest global setup already configured in the app.

---

### Task 1: `@scrubjay/api-contracts` package with common + subscription schemas

**Files:**
- Create: `packages/api-contracts/package.json`
- Create: `packages/api-contracts/tsconfig.json`
- Create: `packages/api-contracts/src/index.ts`
- Create: `packages/api-contracts/src/common.ts`
- Create: `packages/api-contracts/src/subscriptions.ts`
- Test: `packages/api-contracts/src/subscriptions.spec.ts`

**Interfaces:**
- Produces: `apiErrorSchema`, `paginationQuerySchema` (limit ≤ 200 default 50, offset default 0), `subscriptionSchema`, `listSubscriptionsQuerySchema`, `createSubscriptionBodySchema` (`{ channelId, regionCode }`), `subscriptionKeySchema` (`{ channelId, stateCode, countyCode }`), `updateSubscriptionBodySchema` (key + `active`), plus inferred types `ApiError`, `Subscription`, `SubscriptionKey`, etc. All exported from the package root `@scrubjay/api-contracts`.

- [ ] **Step 1: Scaffold the package**

`packages/api-contracts/package.json`:

```json
{
  "dependencies": {
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@scrubjay/typescript-config": "workspace:*",
    "typescript": "^5.9.3",
    "vitest": "^4.1.10"
  },
  "main": "dist/index.js",
  "name": "@scrubjay/api-contracts",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "types": "dist/index.d.ts",
  "version": "0.1.0"
}
```

`packages/api-contracts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist"
  },
  "exclude": ["dist", "node_modules"],
  "extends": "@scrubjay/typescript-config/base.json",
  "include": ["src/**/*"]
}
```

Run: `pnpm install`
Expected: lockfile updates, workspace links `@scrubjay/api-contracts`.

- [ ] **Step 2: Write the failing test**

`packages/api-contracts/src/subscriptions.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createSubscriptionBodySchema,
  listSubscriptionsQuerySchema,
  subscriptionSchema,
  updateSubscriptionBodySchema,
} from "./subscriptions";

describe("subscription contracts", () => {
  it("parses a wire-format subscription (dates as ISO strings)", () => {
    const parsed = subscriptionSchema.parse({
      active: true,
      channelId: "123",
      countyCode: "US-CA-085",
      lastUpdated: "2026-07-13T00:00:00.000Z",
      stateCode: "US-CA",
    });
    expect(parsed.countyCode).toBe("US-CA-085");
  });

  it("rejects a create body without regionCode", () => {
    expect(
      createSubscriptionBodySchema.safeParse({ channelId: "123" }).success,
    ).toBe(false);
  });

  it("defaults list query filters to absent", () => {
    expect(listSubscriptionsQuerySchema.parse({})).toEqual({});
  });

  it("requires the full composite key plus active on update", () => {
    expect(
      updateSubscriptionBodySchema.safeParse({
        active: false,
        channelId: "123",
        stateCode: "US-CA",
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @scrubjay/api-contracts test`
Expected: FAIL — cannot resolve `./subscriptions`.

- [ ] **Step 4: Implement the schemas**

`packages/api-contracts/src/common.ts`:

```ts
import { z } from "zod";

/** Every non-2xx API response uses this envelope. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z.unknown().optional(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
```

`packages/api-contracts/src/subscriptions.ts`:

```ts
import { z } from "zod";

export const subscriptionSchema = z.object({
  active: z.boolean(),
  channelId: z.string().min(1),
  countyCode: z.string().min(1),
  lastUpdated: z.iso.datetime(),
  stateCode: z.string().min(1),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const listSubscriptionsQuerySchema = z.object({
  channelId: z.string().min(1).optional(),
  stateCode: z.string().min(1).optional(),
});
export type ListSubscriptionsQuery = z.infer<
  typeof listSubscriptionsQuerySchema
>;

export const listSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
});
export type ListSubscriptionsResponse = z.infer<
  typeof listSubscriptionsResponseSchema
>;

/** Mirrors the /subscribe slash command: region parsing happens server-side. */
export const createSubscriptionBodySchema = z.object({
  channelId: z.string().min(1),
  regionCode: z.string().min(1),
});
export type CreateSubscriptionBody = z.infer<
  typeof createSubscriptionBodySchema
>;

export const createSubscriptionResponseSchema = z.object({
  created: z.boolean(),
});
export type CreateSubscriptionResponse = z.infer<
  typeof createSubscriptionResponseSchema
>;

/** Subscriptions have no surrogate id; the composite key addresses them. */
export const subscriptionKeySchema = z.object({
  channelId: z.string().min(1),
  countyCode: z.string().min(1),
  stateCode: z.string().min(1),
});
export type SubscriptionKey = z.infer<typeof subscriptionKeySchema>;

export const updateSubscriptionBodySchema = subscriptionKeySchema.extend({
  active: z.boolean(),
});
export type UpdateSubscriptionBody = z.infer<
  typeof updateSubscriptionBodySchema
>;
```

`packages/api-contracts/src/index.ts`:

```ts
export * from "./common";
export * from "./subscriptions";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @scrubjay/api-contracts test`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify build and types, then commit**

Run: `pnpm --filter @scrubjay/api-contracts build && pnpm --filter @scrubjay/api-contracts check-types && pnpm format-and-lint:fix`
Expected: `dist/index.js` + `.d.ts` emitted, no type errors.

```bash
git add packages/api-contracts pnpm-lock.yaml
git commit -m "feat(api-contracts): add contracts package with subscription schemas"
```

---

### Task 2: Remaining contract schemas

**Files:**
- Create: `packages/api-contracts/src/filters.ts`
- Create: `packages/api-contracts/src/guilds.ts`
- Create: `packages/api-contracts/src/regions.ts`
- Create: `packages/api-contracts/src/observations.ts`
- Create: `packages/api-contracts/src/deliveries.ts`
- Create: `packages/api-contracts/src/alerts.ts`
- Create: `packages/api-contracts/src/ebird.ts`
- Modify: `packages/api-contracts/src/index.ts`
- Test: `packages/api-contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: `subscriptionSchema`, `paginationQuerySchema` from Task 1.
- Produces: `channelFilterSchema`, `listFiltersResponseSchema`, `addFilterBodySchema` (`{ commonName }`), `guildSchema`/`guildsResponseSchema`, `regionsResponseSchema`, `observationSchema`/`listObservationsQuerySchema`/`listObservationsResponseSchema` (paginated, `hasMore` flag), `deliverySchema`/`listDeliveriesQuerySchema`/`listDeliveriesResponseSchema`, `pendingAlertSchema`/`pendingAlertsResponseSchema`, `countySchema`/`countiesResponseSchema`, `stateCodeSchema`. `deliveryStatusSchema` is `z.enum(["sent", "failed", "expired", "suppressed"])`.

- [ ] **Step 1: Write the failing test**

`packages/api-contracts/src/contracts.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pendingAlertSchema } from "./alerts";
import { listDeliveriesQuerySchema } from "./deliveries";
import { stateCodeSchema } from "./ebird";
import { addFilterBodySchema } from "./filters";
import { guildsResponseSchema } from "./guilds";
import { listObservationsQuerySchema } from "./observations";
import { regionsResponseSchema } from "./regions";

describe("api contracts", () => {
  it("trims and requires a non-empty filter common name", () => {
    expect(addFilterBodySchema.parse({ commonName: " Verdin " })).toEqual({
      commonName: "Verdin",
    });
    expect(addFilterBodySchema.safeParse({ commonName: "  " }).success).toBe(
      false,
    );
  });

  it("parses a guilds response", () => {
    const parsed = guildsResponseSchema.parse({
      guilds: [
        { channels: [{ id: "2", name: "birds" }], id: "1", name: "Guild" },
      ],
    });
    expect(parsed.guilds[0]?.channels[0]?.name).toBe("birds");
  });

  it("applies pagination defaults to observation queries", () => {
    const parsed = listObservationsQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
  });

  it("rejects an unknown delivery status filter", () => {
    expect(
      listDeliveriesQuerySchema.safeParse({ status: "lost" }).success,
    ).toBe(false);
  });

  it("parses a pending alert with ISO dates", () => {
    const parsed = pendingAlertSchema.parse({
      audioCount: 0,
      channelId: "CH1",
      comName: "Vermilion Flycatcher",
      county: "Santa Clara",
      createdAt: "2026-07-13T00:00:00.000Z",
      howMany: 1,
      isPrivate: false,
      locationName: "Test Hotspot",
      locId: "L001",
      obsDt: "2026-07-13T00:00:00.000Z",
      photoCount: 0,
      recentlyConfirmed: false,
      sciName: "Pyrocephalus rubinus",
      speciesCode: "verfly",
      state: "California",
      subId: "S001",
      videoCount: 0,
    });
    expect(parsed.speciesCode).toBe("verfly");
  });

  it("accepts state codes like US-CA and rejects bare countries", () => {
    expect(stateCodeSchema.safeParse("US-CA").success).toBe(true);
    expect(stateCodeSchema.safeParse("US").success).toBe(false);
  });

  it("groups subscriptions under regions", () => {
    const parsed = regionsResponseSchema.parse({
      regions: [
        {
          stateCode: "US-CA",
          subscriptions: [
            {
              active: true,
              channelId: "CH1",
              countyCode: "*",
              lastUpdated: "2026-07-13T00:00:00.000Z",
              stateCode: "US-CA",
            },
          ],
        },
      ],
    });
    expect(parsed.regions[0]?.stateCode).toBe("US-CA");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scrubjay/api-contracts test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the schemas**

`packages/api-contracts/src/filters.ts`:

```ts
import { z } from "zod";

export const channelFilterSchema = z.object({
  channelId: z.string().min(1),
  commonName: z.string().min(1),
});
export type ChannelFilter = z.infer<typeof channelFilterSchema>;

export const listFiltersResponseSchema = z.object({
  filters: z.array(channelFilterSchema),
});
export type ListFiltersResponse = z.infer<typeof listFiltersResponseSchema>;

/** Free-text common name, matching the 👎 reaction semantics. */
export const addFilterBodySchema = z.object({
  commonName: z.string().trim().min(1),
});
export type AddFilterBody = z.infer<typeof addFilterBodySchema>;
```

`packages/api-contracts/src/guilds.ts`:

```ts
import { z } from "zod";

export const guildChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});
export type GuildChannel = z.infer<typeof guildChannelSchema>;

/** Only text channels where the bot can view + send are included. */
export const guildSchema = z.object({
  channels: z.array(guildChannelSchema),
  id: z.string().min(1),
  name: z.string(),
});
export type Guild = z.infer<typeof guildSchema>;

export const guildsResponseSchema = z.object({
  guilds: z.array(guildSchema),
});
export type GuildsResponse = z.infer<typeof guildsResponseSchema>;
```

`packages/api-contracts/src/regions.ts`:

```ts
import { z } from "zod";
import { subscriptionSchema } from "./subscriptions";

/** Read-only: ingest regions stay derived from subscriptions (spec). */
export const regionSchema = z.object({
  stateCode: z.string().min(1),
  subscriptions: z.array(subscriptionSchema),
});
export type Region = z.infer<typeof regionSchema>;

export const regionsResponseSchema = z.object({
  regions: z.array(regionSchema),
});
export type RegionsResponse = z.infer<typeof regionsResponseSchema>;
```

`packages/api-contracts/src/observations.ts`:

```ts
import { z } from "zod";
import { paginationQuerySchema } from "./common";

export const observationSchema = z.object({
  audioCount: z.number().int(),
  comName: z.string(),
  county: z.string(),
  countyCode: z.string(),
  createdAt: z.iso.datetime(),
  howMany: z.number().int(),
  locationName: z.string(),
  locId: z.string(),
  obsDt: z.iso.datetime(),
  obsReviewed: z.boolean(),
  obsValid: z.boolean(),
  photoCount: z.number().int(),
  sciName: z.string(),
  speciesCode: z.string(),
  state: z.string(),
  stateCode: z.string(),
  subId: z.string(),
  videoCount: z.number().int(),
});
export type Observation = z.infer<typeof observationSchema>;

export const listObservationsQuerySchema = paginationQuerySchema.extend({
  countyCode: z.string().min(1).optional(),
  since: z.iso.datetime().optional(),
  speciesCode: z.string().min(1).optional(),
  stateCode: z.string().min(1).optional(),
});
export type ListObservationsQuery = z.infer<
  typeof listObservationsQuerySchema
>;

export const listObservationsResponseSchema = z.object({
  hasMore: z.boolean(),
  observations: z.array(observationSchema),
});
export type ListObservationsResponse = z.infer<
  typeof listObservationsResponseSchema
>;
```

`packages/api-contracts/src/deliveries.ts`:

```ts
import { z } from "zod";
import { paginationQuerySchema } from "./common";

export const deliveryStatusSchema = z.enum([
  "sent",
  "failed",
  "expired",
  "suppressed",
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const deliverySchema = z.object({
  alertId: z.string(),
  channelId: z.string(),
  detail: z.string().nullable(),
  id: z.number().int(),
  kind: z.string(),
  sentAt: z.iso.datetime().nullable(),
  status: deliveryStatusSchema,
});
export type Delivery = z.infer<typeof deliverySchema>;

export const listDeliveriesQuerySchema = paginationQuerySchema.extend({
  channelId: z.string().min(1).optional(),
  status: deliveryStatusSchema.optional(),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;

export const listDeliveriesResponseSchema = z.object({
  deliveries: z.array(deliverySchema),
  hasMore: z.boolean(),
});
export type ListDeliveriesResponse = z.infer<
  typeof listDeliveriesResponseSchema
>;
```

`packages/api-contracts/src/alerts.ts`:

```ts
import { z } from "zod";

/** Wire shape of AlertQueue's PendingEBirdAlert (dates as ISO strings). */
export const pendingAlertSchema = z.object({
  audioCount: z.number().int(),
  channelId: z.string(),
  comName: z.string(),
  county: z.string(),
  createdAt: z.iso.datetime(),
  howMany: z.number().int(),
  isPrivate: z.boolean(),
  locationName: z.string(),
  locId: z.string(),
  obsDt: z.iso.datetime(),
  photoCount: z.number().int(),
  recentlyConfirmed: z.boolean(),
  sciName: z.string(),
  speciesCode: z.string(),
  state: z.string(),
  subId: z.string(),
  videoCount: z.number().int(),
});
export type PendingAlert = z.infer<typeof pendingAlertSchema>;

export const pendingAlertsResponseSchema = z.object({
  alerts: z.array(pendingAlertSchema),
});
export type PendingAlertsResponse = z.infer<typeof pendingAlertsResponseSchema>;
```

`packages/api-contracts/src/ebird.ts`:

```ts
import { z } from "zod";

/** eBird subnational1 code: country-state, e.g. US-CA. */
export const stateCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]+$/, "expected a code like US-CA");

export const countySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});
export type County = z.infer<typeof countySchema>;

export const countiesResponseSchema = z.object({
  counties: z.array(countySchema),
});
export type CountiesResponse = z.infer<typeof countiesResponseSchema>;
```

`packages/api-contracts/src/index.ts` (full replacement):

```ts
export * from "./alerts";
export * from "./common";
export * from "./deliveries";
export * from "./ebird";
export * from "./filters";
export * from "./guilds";
export * from "./observations";
export * from "./regions";
export * from "./subscriptions";
```

- [ ] **Step 4: Run tests, build, commit**

Run: `pnpm --filter @scrubjay/api-contracts test && pnpm --filter @scrubjay/api-contracts build && pnpm format-and-lint:fix`
Expected: all tests PASS, build clean.

```bash
git add packages/api-contracts
git commit -m "feat(api-contracts): add filter, guild, region, ops, and ebird schemas"
```

---

### Task 3: `SCRUBJAY_API_TOKEN` config + bearer-token guard

**Files:**
- Modify: `apps/scrubjay-discord/src/core/config/config.schema.ts`
- Create: `apps/scrubjay-discord/src/api/api-token.guard.ts`
- Test: `apps/scrubjay-discord/src/api/api-token.guard.spec.ts`
- Test: `apps/scrubjay-discord/src/core/config/config.schema.spec.ts` (extend)

**Interfaces:**
- Produces: `AppConfig` gains optional `SCRUBJAY_API_TOKEN: string` (min 32 chars when present). `ApiTokenGuard` (NestJS `CanActivate`) — rejects with 401 unless `Authorization: Bearer <token>` matches config, using a timing-safe comparison.

- [ ] **Step 1: Write the failing tests**

Add to `apps/scrubjay-discord/src/core/config/config.schema.spec.ts` (inside the existing describe block; reuse the file's existing valid-env fixture pattern):

```ts
it("accepts a missing SCRUBJAY_API_TOKEN", () => {
  const result = configSchema.safeParse(validEnv);
  expect(result.success).toBe(true);
  expect(result.data?.SCRUBJAY_API_TOKEN).toBeUndefined();
});

it("rejects a short SCRUBJAY_API_TOKEN", () => {
  expect(
    configSchema.safeParse({ ...validEnv, SCRUBJAY_API_TOKEN: "short" })
      .success,
  ).toBe(false);
});
```

(If the existing spec names its fixture differently, use that name — do not introduce a second fixture.)

`apps/scrubjay-discord/src/api/api-token.guard.spec.ts`:

```ts
import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/core/config/config.schema";
import { ApiTokenGuard } from "./api-token.guard";

const TOKEN = "a".repeat(32);

function contextWithAuth(header?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: header } }),
    }),
  } as unknown as ExecutionContext;
}

function guardWithToken(token?: string): ApiTokenGuard {
  const config = {
    get: () => token,
  } as unknown as ConfigService<AppConfig, true>;
  return new ApiTokenGuard(config);
}

describe("ApiTokenGuard", () => {
  it("allows a matching bearer token", () => {
    expect(
      guardWithToken(TOKEN).canActivate(contextWithAuth(`Bearer ${TOKEN}`)),
    ).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(() =>
      guardWithToken(TOKEN).canActivate(contextWithAuth("Bearer nope")),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a missing Authorization header", () => {
    expect(() => guardWithToken(TOKEN).canActivate(contextWithAuth())).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects everything when no token is configured", () => {
    expect(() =>
      guardWithToken(undefined).canActivate(contextWithAuth(`Bearer ${TOKEN}`)),
    ).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter scrubjay-discord test -- api-token.guard config.schema`
Expected: FAIL — `./api-token.guard` not found; config schema rejects/strips the new key.

- [ ] **Step 3: Implement**

In `config.schema.ts`, add to `configSchema` (alphabetical position, after `PORT`):

```ts
  // Enables the operator REST API when set; the api module is not
  // registered at all without it.
  SCRUBJAY_API_TOKEN: z.string().min(32).optional(),
```

`apps/scrubjay-discord/src/api/api-token.guard.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { AppConfig } from "@/core/config/config.schema";

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get("SCRUBJAY_API_TOKEN", {
      infer: true,
    });
    if (!expected) throw new UnauthorizedException();

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

    // Hash both sides so timingSafeEqual gets equal-length buffers and the
    // comparison leaks nothing about token length or prefix.
    const presentedDigest = createHash("sha256").update(presented).digest();
    const expectedDigest = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(presentedDigest, expectedDigest)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter scrubjay-discord test -- api-token.guard config.schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord/src/core/config apps/scrubjay-discord/src/api
git commit -m "feat(scrubjay-discord): add SCRUBJAY_API_TOKEN config and bearer guard"
```

---

### Task 4: Zod validation pipe, error envelope filter, ApiModule skeleton

**Files:**
- Create: `apps/scrubjay-discord/src/api/zod-validation.pipe.ts`
- Create: `apps/scrubjay-discord/src/api/api-exception.filter.ts`
- Create: `apps/scrubjay-discord/src/api/api.module.ts`
- Modify: `apps/scrubjay-discord/src/app.module.ts`
- Modify: `apps/scrubjay-discord/package.json` (add `"@scrubjay/api-contracts": "workspace:*"` dependency)
- Test: `apps/scrubjay-discord/src/api/zod-validation.pipe.spec.ts`
- Test: `apps/scrubjay-discord/src/api/api-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `apiErrorSchema` envelope shape from Task 1; `ApiTokenGuard` from Task 3.
- Produces: `new ZodValidationPipe(schema)` — parses body/query, throws `BadRequestException({ code: "VALIDATION", details, message })` on failure, returns the **parsed** value (defaults applied). `ApiExceptionFilter` — renders every error as `{ error: { code, message, details? } }`. `ApiModule` — empty controller list for now; later tasks add controllers. `AppModule` registers `ApiModule` only when `process.env.SCRUBJAY_API_TOKEN` is set.

- [ ] **Step 1: Write the failing tests**

`apps/scrubjay-discord/src/api/zod-validation.pipe.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

const schema = z.object({ limit: z.coerce.number().int().default(50) });

describe("ZodValidationPipe", () => {
  it("returns the parsed value with defaults applied", () => {
    expect(new ZodValidationPipe(schema).transform({})).toEqual({ limit: 50 });
  });

  it("coerces string query params", () => {
    expect(new ZodValidationPipe(schema).transform({ limit: "5" })).toEqual({
      limit: 5,
    });
  });

  it("throws BadRequestException with a VALIDATION code on failure", () => {
    try {
      new ZodValidationPipe(schema).transform({ limit: "not-a-number" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("VALIDATION");
    }
  });
});
```

`apps/scrubjay-discord/src/api/api-exception.filter.spec.ts`:

```ts
import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter";

function hostWithResponse() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe("ApiExceptionFilter", () => {
  it("wraps HttpExceptions in the error envelope", () => {
    const { host, json, status } = hostWithResponse();
    new ApiExceptionFilter().catch(new NotFoundException("no such row"), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: "NOT_FOUND", details: undefined, message: "no such row" },
    });
  });

  it("preserves custom codes and details from exception bodies", () => {
    const { host, json } = hostWithResponse();
    new ApiExceptionFilter().catch(
      new BadRequestException({
        code: "VALIDATION",
        details: { limit: ["bad"] },
        message: "Invalid request",
      }),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "VALIDATION",
        details: { limit: ["bad"] },
        message: "Invalid request",
      },
    });
  });

  it("maps unknown errors to a 500 INTERNAL envelope", () => {
    const { host, json, status } = hostWithResponse();
    new ApiExceptionFilter().catch(new Error("boom"), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL",
        details: undefined,
        message: "Internal server error",
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter scrubjay-discord test -- zod-validation.pipe api-exception.filter`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/scrubjay-discord/src/api/zod-validation.pipe.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import { z, type ZodType } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION",
        details: z.treeifyError(result.error),
        message: "Invalid request",
      });
    }
    return result.data;
  }
}
```

`apps/scrubjay-discord/src/api/api-exception.filter.ts`:

```ts
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

/** Renders every api/v1 error as the contracts' `{ error: {...} }` envelope. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      response.status(status).json({
        error: {
          code:
            typeof payload.code === "string"
              ? payload.code
              : (HttpStatus[status] ?? "ERROR"),
          details: payload.details,
          message:
            typeof payload.message === "string"
              ? payload.message
              : exception.message,
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: "INTERNAL",
        details: undefined,
        message: "Internal server error",
      },
    });
  }
}
```

`apps/scrubjay-discord/src/api/api.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DispatchModule } from "@/features/dispatch/dispatch.module";
import { FiltersModule } from "@/features/filters/filters.module";
import { SubscriptionsModule } from "@/features/subscriptions/subscriptions.module";

/**
 * Operator REST API. Registered by AppModule only when SCRUBJAY_API_TOKEN is
 * set — a bot without a portal runs with no HTTP surface beyond /health.
 */
@Module({
  controllers: [],
  imports: [DispatchModule, FiltersModule, SubscriptionsModule],
  providers: [],
})
export class ApiModule {}
```

In `app.module.ts`, add the import and register conditionally (the env var is read directly because module composition happens before ConfigModule validation):

```ts
import { ApiModule } from "@/api/api.module";

// ...inside @Module imports array, after JobsModule:
    ...(process.env.SCRUBJAY_API_TOKEN ? [ApiModule] : []),
```

In `apps/scrubjay-discord/package.json` dependencies, add (alphabetical position, first entry):

```json
    "@scrubjay/api-contracts": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 4: Run tests and the app gate**

Run: `pnpm --filter scrubjay-discord test -- zod-validation.pipe api-exception.filter && pnpm --filter scrubjay-discord check-types`
Expected: PASS, no type errors. (Note: `check-types` and `nest build` resolve `@scrubjay/api-contracts` from its `dist` — run `pnpm --filter @scrubjay/api-contracts build` first if `dist` is missing.)

- [ ] **Step 5: Commit**

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord pnpm-lock.yaml
git commit -m "feat(scrubjay-discord): add api module skeleton with validation pipe and error envelope"
```

---

### Task 5: Subscriptions endpoints

**Files:**
- Modify: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.repository.ts`
- Modify: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.module.ts` (add `exports`)
- Create: `apps/scrubjay-discord/src/api/subscriptions.controller.ts`
- Modify: `apps/scrubjay-discord/src/api/api.module.ts` (register controller)
- Test: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.repository.spec.ts` (extend)
- Test: `apps/scrubjay-discord/src/api/subscriptions.controller.spec.ts`

**Interfaces:**
- Consumes: `SubscriptionsService.subscribe/unsubscribe(channelId, regionCode)`, `SubscriptionsRepository`, `InvalidRegionError`, contracts from Task 1, pipe/filter/guard from Tasks 3–4.
- Produces: `SubscriptionsRepository.listSubscriptions(filter?: { channelId?: string; stateCode?: string })` → full rows ordered by channelId, stateCode, countyCode. `SubscriptionsRepository.setSubscriptionActive(key: { channelId; stateCode; countyCode }, active: boolean)` → `Promise<boolean>` (row existed). Routes: `GET/POST/PATCH/DELETE /api/v1/subscriptions`. `SubscriptionsModule` now exports `SubscriptionsRepository` and `SubscriptionsService`.

- [ ] **Step 1: Write the failing repository tests**

Extend `subscriptions.repository.spec.ts`, following that file's existing setup (it builds the repository against `createTestDb()` with an AlertQueue stub — reuse whatever setup already exists rather than duplicating it):

```ts
describe("listSubscriptions", () => {
  it("returns all subscriptions when no filter is given", async () => {
    await seedSubscription(db, { channelId: "CH1" });
    await seedSubscription(db, { channelId: "CH2", stateCode: "US-AZ" });
    const all = await repo.listSubscriptions();
    expect(all).toHaveLength(2);
  });

  it("filters by channelId and stateCode", async () => {
    await seedSubscription(db, { channelId: "CH1", stateCode: "US-CA" });
    await seedSubscription(db, { channelId: "CH2", stateCode: "US-AZ" });
    expect(await repo.listSubscriptions({ channelId: "CH1" })).toHaveLength(1);
    expect(await repo.listSubscriptions({ stateCode: "US-AZ" })).toHaveLength(
      1,
    );
  });
});

describe("setSubscriptionActive", () => {
  it("toggles active and reports whether the row existed", async () => {
    const sub = await seedSubscription(db, { active: true });
    const key = {
      channelId: sub.channelId,
      countyCode: sub.countyCode,
      stateCode: sub.stateCode,
    };
    expect(await repo.setSubscriptionActive(key, false)).toBe(true);
    const [row] = await repo.listSubscriptions({ channelId: sub.channelId });
    expect(row?.active).toBe(false);
    expect(
      await repo.setSubscriptionActive({ ...key, channelId: "NOPE" }, true),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter scrubjay-discord test -- subscriptions.repository`
Expected: FAIL — `listSubscriptions` / `setSubscriptionActive` are not functions.

- [ ] **Step 3: Implement the repository methods**

Add to `SubscriptionsRepository`:

```ts
  async listSubscriptions(
    filter: { channelId?: string; stateCode?: string } = {},
  ) {
    const conditions = [
      filter.channelId
        ? eq(channelEBirdSubscriptions.channelId, filter.channelId)
        : undefined,
      filter.stateCode
        ? eq(channelEBirdSubscriptions.stateCode, filter.stateCode)
        : undefined,
    ].filter((c) => c !== undefined);

    return this.drizzle.db
      .select()
      .from(channelEBirdSubscriptions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        channelEBirdSubscriptions.channelId,
        channelEBirdSubscriptions.stateCode,
        channelEBirdSubscriptions.countyCode,
      );
  }

  /** Returns whether a Subscription existed at that composite key. */
  async setSubscriptionActive(
    key: { channelId: string; stateCode: string; countyCode: string },
    active: boolean,
  ): Promise<boolean> {
    const rows = await this.drizzle.db
      .update(channelEBirdSubscriptions)
      .set({ active })
      .where(
        and(
          eq(channelEBirdSubscriptions.channelId, key.channelId),
          eq(channelEBirdSubscriptions.stateCode, key.stateCode),
          eq(channelEBirdSubscriptions.countyCode, key.countyCode),
        ),
      )
      .returning({ channelId: channelEBirdSubscriptions.channelId });
    return rows.length > 0;
  }
```

Add `exports` to `SubscriptionsModule`:

```ts
@Module({
  exports: [SubscriptionsRepository, SubscriptionsService],
  imports: [DispatchModule],
  providers: [
    SubscriptionsCommands,
    SubscriptionsRepository,
    SubscriptionsService,
  ],
})
```

Run: `pnpm --filter scrubjay-discord test -- subscriptions.repository`
Expected: PASS.

- [ ] **Step 4: Write the failing controller test**

`apps/scrubjay-discord/src/api/subscriptions.controller.spec.ts` (pure unit test — stub the service and repository):

```ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { listSubscriptionsResponseSchema } from "@scrubjay/api-contracts";
import { describe, expect, it, vi } from "vitest";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import type { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import type { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import { SubscriptionsController } from "./subscriptions.controller";

const row = {
  active: true,
  channelId: "CH1",
  countyCode: "*",
  lastUpdated: new Date("2026-07-13T00:00:00.000Z"),
  stateCode: "US-CA",
};

function build(overrides: {
  repo?: Partial<SubscriptionsRepository>;
  service?: Partial<SubscriptionsService>;
}) {
  return new SubscriptionsController(
    overrides.repo as SubscriptionsRepository,
    overrides.service as SubscriptionsService,
  );
}

describe("SubscriptionsController", () => {
  it("lists subscriptions in the contract wire shape", async () => {
    const controller = build({
      repo: { listSubscriptions: vi.fn().mockResolvedValue([row]) },
    });
    const result = await controller.list({});
    const parsed = listSubscriptionsResponseSchema.parse(
      JSON.parse(JSON.stringify(result)),
    );
    expect(parsed.subscriptions[0]?.channelId).toBe("CH1");
  });

  it("creates via SubscriptionsService and reports created=false on dupes", async () => {
    const subscribe = vi.fn().mockResolvedValue(false);
    const controller = build({ service: { subscribe } });
    const result = await controller.create({
      channelId: "CH1",
      regionCode: "us-ca",
    });
    expect(subscribe).toHaveBeenCalledWith("CH1", "us-ca");
    expect(result).toEqual({ created: false });
  });

  it("maps InvalidRegionError to a 400 INVALID_REGION", async () => {
    const controller = build({
      service: {
        subscribe: vi.fn().mockRejectedValue(new InvalidRegionError("nope")),
      },
    });
    await expect(
      controller.create({ channelId: "CH1", regionCode: "nope" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("404s a PATCH against a missing composite key", async () => {
    const controller = build({
      repo: { setSubscriptionActive: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      controller.update({
        active: false,
        channelId: "CH1",
        countyCode: "*",
        stateCode: "US-CA",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("deletes via SubscriptionsService.unsubscribe using the county code as region", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const controller = build({ service: { unsubscribe } });
    await controller.remove({
      channelId: "CH1",
      countyCode: "US-CA-085",
      stateCode: "US-CA",
    });
    expect(unsubscribe).toHaveBeenCalledWith("CH1", "US-CA-085");
  });

  it("deletes a statewide subscription via the state code", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const controller = build({ service: { unsubscribe } });
    await controller.remove({
      channelId: "CH1",
      countyCode: "*",
      stateCode: "US-CA",
    });
    expect(unsubscribe).toHaveBeenCalledWith("CH1", "US-CA");
  });
});
```

Run: `pnpm --filter scrubjay-discord test -- subscriptions.controller`
Expected: FAIL — controller not found.

- [ ] **Step 5: Implement the controller**

`apps/scrubjay-discord/src/api/subscriptions.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  type CreateSubscriptionBody,
  createSubscriptionBodySchema,
  type CreateSubscriptionResponse,
  type ListSubscriptionsQuery,
  listSubscriptionsQuerySchema,
  type ListSubscriptionsResponse,
  type SubscriptionKey,
  subscriptionKeySchema,
  type UpdateSubscriptionBody,
  updateSubscriptionBodySchema,
} from "@scrubjay/api-contracts";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { ZodValidationPipe } from "./zod-validation.pipe";

/** SubscriptionsService takes one region code; the key stores it split. */
function regionCodeOf(key: SubscriptionKey): string {
  return key.countyCode === "*" ? key.stateCode : key.countyCode;
}

@Controller("api/v1/subscriptions")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class SubscriptionsController {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly service: SubscriptionsService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listSubscriptionsQuerySchema))
    query: ListSubscriptionsQuery,
  ): Promise<{ subscriptions: Awaited<ReturnType<SubscriptionsRepository["listSubscriptions"]>> }> {
    return { subscriptions: await this.repo.listSubscriptions(query) };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createSubscriptionBodySchema))
    body: CreateSubscriptionBody,
  ): Promise<CreateSubscriptionResponse> {
    try {
      const created = await this.service.subscribe(
        body.channelId,
        body.regionCode,
      );
      return { created };
    } catch (err) {
      if (err instanceof InvalidRegionError) {
        throw new BadRequestException({
          code: "INVALID_REGION",
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Patch()
  async update(
    @Body(new ZodValidationPipe(updateSubscriptionBodySchema))
    body: UpdateSubscriptionBody,
  ): Promise<{ updated: true }> {
    const { active, ...key } = body;
    const existed = await this.repo.setSubscriptionActive(key, active);
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No subscription at that key",
      });
    }
    return { updated: true };
  }

  @Delete()
  async remove(
    @Query(new ZodValidationPipe(subscriptionKeySchema)) key: SubscriptionKey,
  ): Promise<{ deleted: true }> {
    const existed = await this.service.unsubscribe(
      key.channelId,
      regionCodeOf(key),
    );
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No subscription at that key",
      });
    }
    return { deleted: true };
  }
}
```

Register in `api.module.ts`: `controllers: [SubscriptionsController]` (import it).

Note the list response uses the repository row type directly — `lastUpdated` is a `Date` that Express serializes to the ISO string the contract expects. The controller test's `JSON.parse(JSON.stringify(...))` round-trip proves that.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter scrubjay-discord test -- subscriptions && pnpm --filter scrubjay-discord check-types`
Expected: PASS (repository + controller + existing command specs).

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord/src
git commit -m "feat(scrubjay-discord): subscriptions REST endpoints"
```

---

### Task 6: Filters endpoints

**Files:**
- Modify: `apps/scrubjay-discord/src/features/filters/filters.repository.ts`
- Modify: `apps/scrubjay-discord/src/features/filters/filters.module.ts` (add `exports: [FiltersRepository]`)
- Create: `apps/scrubjay-discord/src/api/filters.controller.ts`
- Modify: `apps/scrubjay-discord/src/api/api.module.ts` (register controller)
- Test: `apps/scrubjay-discord/src/features/filters/filters.repository.spec.ts` (extend)
- Test: `apps/scrubjay-discord/src/api/filters.controller.spec.ts`

**Interfaces:**
- Consumes: `FiltersRepository.addChannelFilter(channelId, commonName)` (existing), contracts/pipe/filter/guard from earlier tasks.
- Produces: `FiltersRepository.channelFilters(channelId)` → rows ordered by commonName; `FiltersRepository.removeChannelFilter(channelId, commonName)` → `Promise<boolean>`. Routes: `GET|POST /api/v1/channels/:channelId/filters`, `DELETE /api/v1/channels/:channelId/filters?commonName=…`.

- [ ] **Step 1: Write the failing repository tests**

Extend `filters.repository.spec.ts` (reuse its existing `createTestDb` setup):

```ts
describe("channelFilters / removeChannelFilter", () => {
  it("lists a channel's filters ordered by common name", async () => {
    await seedFilter(db, { channelId: "CH1", commonName: "Verdin" });
    await seedFilter(db, { channelId: "CH1", commonName: "Anhinga" });
    await seedFilter(db, { channelId: "CH2", commonName: "Sora" });
    const filters = await repo.channelFilters("CH1");
    expect(filters.map((f) => f.commonName)).toEqual(["Anhinga", "Verdin"]);
  });

  it("removes a filter and reports whether it existed", async () => {
    await seedFilter(db, { channelId: "CH1", commonName: "Verdin" });
    expect(await repo.removeChannelFilter("CH1", "Verdin")).toBe(true);
    expect(await repo.removeChannelFilter("CH1", "Verdin")).toBe(false);
    expect(await repo.channelFilters("CH1")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter scrubjay-discord test -- filters.repository`
Expected: FAIL — methods not functions.

- [ ] **Step 3: Implement repository methods**

Add to `FiltersRepository` (also add `and` to the drizzle-orm import):

```ts
  async channelFilters(channelId: string) {
    return this.drizzle.db
      .select()
      .from(filteredSpecies)
      .where(eq(filteredSpecies.channelId, channelId))
      .orderBy(filteredSpecies.commonName);
  }

  /** Returns whether a filter row existed to remove. */
  async removeChannelFilter(
    channelId: string,
    commonName: string,
  ): Promise<boolean> {
    const rows = await this.drizzle.db
      .delete(filteredSpecies)
      .where(
        and(
          eq(filteredSpecies.channelId, channelId),
          eq(filteredSpecies.commonName, commonName),
        ),
      )
      .returning({ channelId: filteredSpecies.channelId });
    return rows.length > 0;
  }
```

Add exports to `FiltersModule`:

```ts
@Module({
  exports: [FiltersRepository],
  providers: [FiltersReactions, FiltersRepository],
})
```

Run: `pnpm --filter scrubjay-discord test -- filters.repository`
Expected: PASS.

- [ ] **Step 4: Write the failing controller test**

`apps/scrubjay-discord/src/api/filters.controller.spec.ts`:

```ts
import { NotFoundException } from "@nestjs/common";
import { listFiltersResponseSchema } from "@scrubjay/api-contracts";
import { describe, expect, it, vi } from "vitest";
import type { FiltersRepository } from "@/features/filters/filters.repository";
import { FiltersController } from "./filters.controller";

describe("FiltersController", () => {
  it("lists filters in the contract shape", async () => {
    const repo = {
      channelFilters: vi
        .fn()
        .mockResolvedValue([{ channelId: "CH1", commonName: "Verdin" }]),
    } as unknown as FiltersRepository;
    const result = await new FiltersController(repo).list("CH1");
    expect(listFiltersResponseSchema.parse(result).filters).toHaveLength(1);
    expect(repo.channelFilters).toHaveBeenCalledWith("CH1");
  });

  it("adds a filter", async () => {
    const repo = {
      addChannelFilter: vi.fn().mockResolvedValue([]),
    } as unknown as FiltersRepository;
    await new FiltersController(repo).add("CH1", { commonName: "Verdin" });
    expect(repo.addChannelFilter).toHaveBeenCalledWith("CH1", "Verdin");
  });

  it("404s removing a filter that does not exist", async () => {
    const repo = {
      removeChannelFilter: vi.fn().mockResolvedValue(false),
    } as unknown as FiltersRepository;
    await expect(
      new FiltersController(repo).remove("CH1", { commonName: "Verdin" }),
    ).rejects.toThrow(NotFoundException);
  });
});
```

Run: `pnpm --filter scrubjay-discord test -- filters.controller`
Expected: FAIL — controller not found.

- [ ] **Step 5: Implement the controller**

`apps/scrubjay-discord/src/api/filters.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  type AddFilterBody,
  addFilterBodySchema,
  type ListFiltersResponse,
} from "@scrubjay/api-contracts";
import { FiltersRepository } from "@/features/filters/filters.repository";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller("api/v1/channels/:channelId/filters")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class FiltersController {
  constructor(private readonly repo: FiltersRepository) {}

  @Get()
  async list(@Param("channelId") channelId: string): Promise<ListFiltersResponse> {
    return { filters: await this.repo.channelFilters(channelId) };
  }

  @Post()
  async add(
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(addFilterBodySchema)) body: AddFilterBody,
  ): Promise<{ added: true }> {
    await this.repo.addChannelFilter(channelId, body.commonName);
    return { added: true };
  }

  @Delete()
  async remove(
    @Param("channelId") channelId: string,
    @Query(new ZodValidationPipe(addFilterBodySchema)) query: AddFilterBody,
  ): Promise<{ deleted: true }> {
    const existed = await this.repo.removeChannelFilter(
      channelId,
      query.commonName,
    );
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No such filter on that channel",
      });
    }
    return { deleted: true };
  }
}
```

Register `FiltersController` in `api.module.ts` controllers.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter scrubjay-discord test -- filters && pnpm --filter scrubjay-discord check-types`
Expected: PASS.

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord/src
git commit -m "feat(scrubjay-discord): channel filter REST endpoints"
```

---

### Task 7: Guilds endpoint

**Files:**
- Create: `apps/scrubjay-discord/src/api/guilds.service.ts`
- Create: `apps/scrubjay-discord/src/api/guilds.controller.ts`
- Modify: `apps/scrubjay-discord/src/api/api.module.ts` (register controller + provider)
- Test: `apps/scrubjay-discord/src/api/guilds.service.spec.ts`

**Interfaces:**
- Consumes: discord.js `Client` (injectable app-wide because Necord registers it at the root — see `MessageSenderService` for the pattern).
- Produces: `GuildsService.listGuilds(): Promise<GuildsResponse>` — guilds sorted by name, each with text channels (sorted by name) where the bot has ViewChannel + SendMessages. Route: `GET /api/v1/guilds`.

- [ ] **Step 1: Write the failing service test**

`apps/scrubjay-discord/src/api/guilds.service.spec.ts` (fake the discord.js object graph — no network):

```ts
import { ChannelType } from "discord.js";
import type { Client } from "discord.js";
import { describe, expect, it } from "vitest";
import { GuildsService } from "./guilds.service";

type FakeChannel = {
  id: string;
  name: string;
  type: ChannelType;
  permissionsFor: (member: unknown) => { has: (perms: bigint[]) => boolean };
};

function fakeChannel(
  id: string,
  name: string,
  opts: { sendable?: boolean; type?: ChannelType } = {},
): FakeChannel {
  return {
    id,
    name,
    permissionsFor: () => ({ has: () => opts.sendable ?? true }),
    type: opts.type ?? ChannelType.GuildText,
  };
}

function fakeClient(guilds: Array<{
  channels: FakeChannel[];
  id: string;
  name: string;
}>): Client {
  return {
    guilds: {
      cache: new Map(
        guilds.map((g) => [
          g.id,
          {
            channels: {
              fetch: async () => new Map(g.channels.map((c) => [c.id, c])),
            },
            id: g.id,
            members: { me: {} },
            name: g.name,
          },
        ]),
      ),
    },
  } as unknown as Client;
}

describe("GuildsService", () => {
  it("lists text channels the bot can post in, sorted by name", async () => {
    const client = fakeClient([
      {
        channels: [
          fakeChannel("2", "zebra-birds"),
          fakeChannel("3", "alpha-birds"),
          fakeChannel("4", "no-perms", { sendable: false }),
          fakeChannel("5", "a-voice", { type: ChannelType.GuildVoice }),
        ],
        id: "1",
        name: "Guild",
      },
    ]);
    const result = await new GuildsService(client).listGuilds();
    expect(result.guilds[0]?.channels.map((c) => c.name)).toEqual([
      "alpha-birds",
      "zebra-birds",
    ]);
  });

  it("sorts guilds by name", async () => {
    const client = fakeClient([
      { channels: [], id: "1", name: "Zeta" },
      { channels: [], id: "2", name: "Alpha" },
    ]);
    const result = await new GuildsService(client).listGuilds();
    expect(result.guilds.map((g) => g.name)).toEqual(["Alpha", "Zeta"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter scrubjay-discord test -- guilds.service`
Expected: FAIL — service not found.

- [ ] **Step 3: Implement**

`apps/scrubjay-discord/src/api/guilds.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { GuildsResponse } from "@scrubjay/api-contracts";
import { ChannelType, Client, PermissionFlagsBits } from "discord.js";

@Injectable()
export class GuildsService {
  constructor(private readonly client: Client) {}

  /** Guilds the bot is in, with the text channels it can actually post to. */
  async listGuilds(): Promise<GuildsResponse> {
    const guilds: GuildsResponse["guilds"] = [];
    for (const guild of this.client.guilds.cache.values()) {
      const me = guild.members.me;
      const channels = await guild.channels.fetch();
      const sendable = [...channels.values()]
        .filter((channel) => channel !== null)
        .filter((channel) => channel.type === ChannelType.GuildText)
        .filter(
          (channel) =>
            channel
              .permissionsFor(me)
              ?.has([
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ViewChannel,
              ]) ?? false,
        )
        .map((channel) => ({ id: channel.id, name: channel.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      guilds.push({ channels: sendable, id: guild.id, name: guild.name });
    }
    guilds.sort((a, b) => a.name.localeCompare(b.name));
    return { guilds };
  }
}
```

(If `permissionsFor(me)` needs a non-null member type, adjust with a null check on `me` returning `false` — keep the behavior "no member resolved → channel excluded".)

`apps/scrubjay-discord/src/api/guilds.controller.ts`:

```ts
import { Controller, Get, UseFilters, UseGuards } from "@nestjs/common";
import type { GuildsResponse } from "@scrubjay/api-contracts";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { GuildsService } from "./guilds.service";

@Controller("api/v1/guilds")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class GuildsController {
  constructor(private readonly guilds: GuildsService) {}

  @Get()
  list(): Promise<GuildsResponse> {
    return this.guilds.listGuilds();
  }
}
```

Register `GuildsController` (controllers) and `GuildsService` (providers) in `api.module.ts`.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter scrubjay-discord test -- guilds && pnpm --filter scrubjay-discord check-types`
Expected: PASS.

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord/src
git commit -m "feat(scrubjay-discord): guild/channel browse endpoint"
```

---

### Task 8: Regions, observations, deliveries, pending-alerts endpoints

**Files:**
- Create: `apps/scrubjay-discord/src/api/ops.repository.ts`
- Create: `apps/scrubjay-discord/src/api/ops.controller.ts`
- Modify: `apps/scrubjay-discord/src/api/api.module.ts` (register)
- Test: `apps/scrubjay-discord/src/api/ops.repository.spec.ts`
- Test: `apps/scrubjay-discord/src/api/ops.controller.spec.ts`

**Interfaces:**
- Consumes: `AlertQueue.pendingEBirdAlerts(since?)` (exported by `DispatchModule`), `SubscriptionsRepository.listSubscriptions()` from Task 5, drizzle schema tables, `ListObservationsQuery`/`ListDeliveriesQuery` types from Task 2.
- Produces: `OpsRepository.listObservations(query)` → `{ hasMore, observations }` (joined with locations, newest `createdAt` first); `OpsRepository.listDeliveries(query)` → `{ deliveries, hasMore }` (newest `sentAt` first). Routes: `GET /api/v1/regions`, `GET /api/v1/observations`, `GET /api/v1/deliveries`, `GET /api/v1/alerts/pending`.

- [ ] **Step 1: Write the failing repository tests**

`apps/scrubjay-discord/src/api/ops.repository.spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleService } from "@/core/drizzle/drizzle.service";
import {
  createTestDb,
  seedDelivery,
  seedLocation,
  seedObservation,
  truncateAll,
} from "@/testing/db-helpers";
import { OpsRepository } from "./ops.repository";

let db: DrizzleService;
let pool: { end: () => Promise<void> };
let repo: OpsRepository;

beforeEach(async () => {
  ({ db, pool } = await createTestDb());
  await truncateAll(db);
  repo = new OpsRepository(db);
});

afterAll(async () => {
  await pool.end();
});

describe("listObservations", () => {
  it("joins locations and filters by state", async () => {
    await seedLocation(db);
    await seedLocation(db, { id: "L002", stateCode: "US-AZ" });
    await seedObservation(db, { locId: "L001", subId: "S1" });
    await seedObservation(db, { locId: "L002", subId: "S2" });
    const result = await repo.listObservations({
      limit: 50,
      offset: 0,
      stateCode: "US-AZ",
    });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.stateCode).toBe("US-AZ");
    expect(result.hasMore).toBe(false);
  });

  it("paginates with hasMore", async () => {
    await seedLocation(db);
    await seedObservation(db, { subId: "S1" });
    await seedObservation(db, { subId: "S2" });
    const page = await repo.listObservations({ limit: 1, offset: 0 });
    expect(page.observations).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });
});

describe("listDeliveries", () => {
  it("filters by status and channel", async () => {
    await seedDelivery(db, { alertId: "a:1", channelId: "CH1" });
    await seedDelivery(db, {
      alertId: "a:2",
      channelId: "CH2",
      status: "failed",
    });
    const failed = await repo.listDeliveries({
      limit: 50,
      offset: 0,
      status: "failed",
    });
    expect(failed.deliveries).toHaveLength(1);
    expect(failed.deliveries[0]?.channelId).toBe("CH2");
  });
});
```

Run: `pnpm --filter scrubjay-discord test -- ops.repository`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the repository**

`apps/scrubjay-discord/src/api/ops.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type {
  ListDeliveriesQuery,
  ListObservationsQuery,
} from "@scrubjay/api-contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  deliveries,
  locations,
  observations,
} from "@/core/drizzle/drizzle.schema";
import { DrizzleService } from "@/core/drizzle/drizzle.service";

/**
 * Read-only queries for the operator API's ops views. Pending/Delivery
 * *semantics* stay in AlertQueue — this repository only pages raw rows.
 */
@Injectable()
export class OpsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async listObservations(query: ListObservationsQuery) {
    const conditions = [
      query.stateCode ? eq(locations.stateCode, query.stateCode) : undefined,
      query.countyCode ? eq(locations.countyCode, query.countyCode) : undefined,
      query.speciesCode
        ? eq(observations.speciesCode, query.speciesCode)
        : undefined,
      query.since ? gt(observations.createdAt, new Date(query.since)) : undefined,
    ].filter((c) => c !== undefined);

    const rows = await this.drizzle.db
      .select({
        audioCount: observations.audioCount,
        comName: observations.comName,
        county: locations.county,
        countyCode: locations.countyCode,
        createdAt: observations.createdAt,
        howMany: observations.howMany,
        locationName: locations.name,
        locId: observations.locId,
        obsDt: observations.obsDt,
        obsReviewed: observations.obsReviewed,
        obsValid: observations.obsValid,
        photoCount: observations.photoCount,
        sciName: observations.sciName,
        speciesCode: observations.speciesCode,
        state: locations.state,
        stateCode: locations.stateCode,
        subId: observations.subId,
        videoCount: observations.videoCount,
      })
      .from(observations)
      .innerJoin(locations, eq(locations.id, observations.locId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(observations.createdAt))
      .limit(query.limit + 1)
      .offset(query.offset);

    return {
      hasMore: rows.length > query.limit,
      observations: rows.slice(0, query.limit),
    };
  }

  async listDeliveries(query: ListDeliveriesQuery) {
    const conditions = [
      query.channelId ? eq(deliveries.channelId, query.channelId) : undefined,
      query.status ? eq(deliveries.status, query.status) : undefined,
    ].filter((c) => c !== undefined);

    const rows = await this.drizzle.db
      .select()
      .from(deliveries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(deliveries.sentAt), desc(deliveries.id))
      .limit(query.limit + 1)
      .offset(query.offset);

    return {
      deliveries: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
    };
  }
}
```

Run: `pnpm --filter scrubjay-discord test -- ops.repository`
Expected: PASS.

- [ ] **Step 3: Write the failing controller test**

`apps/scrubjay-discord/src/api/ops.controller.spec.ts`:

```ts
import { regionsResponseSchema } from "@scrubjay/api-contracts";
import { describe, expect, it, vi } from "vitest";
import type { AlertQueue } from "@/features/dispatch/alert-queue.service";
import type { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { OpsController } from "./ops.controller";
import type { OpsRepository } from "./ops.repository";

const sub = (stateCode: string, channelId: string) => ({
  active: true,
  channelId,
  countyCode: "*",
  lastUpdated: new Date("2026-07-13T00:00:00.000Z"),
  stateCode,
});

describe("OpsController", () => {
  it("groups subscriptions into regions by state", async () => {
    const subsRepo = {
      listSubscriptions: vi
        .fn()
        .mockResolvedValue([
          sub("US-AZ", "CH2"),
          sub("US-CA", "CH1"),
          sub("US-CA", "CH3"),
        ]),
    } as unknown as SubscriptionsRepository;
    const controller = new OpsController(
      {} as AlertQueue,
      {} as OpsRepository,
      subsRepo,
    );
    const result = await controller.regions();
    const parsed = regionsResponseSchema.parse(
      JSON.parse(JSON.stringify(result)),
    );
    expect(parsed.regions.map((r) => r.stateCode)).toEqual(["US-AZ", "US-CA"]);
    expect(parsed.regions[1]?.subscriptions).toHaveLength(2);
  });

  it("serves pending alerts through the AlertQueue", async () => {
    const pendingEBirdAlerts = vi.fn().mockResolvedValue([]);
    const controller = new OpsController(
      { pendingEBirdAlerts } as unknown as AlertQueue,
      {} as OpsRepository,
      {} as SubscriptionsRepository,
    );
    expect(await controller.pendingAlerts()).toEqual({ alerts: [] });
    expect(pendingEBirdAlerts).toHaveBeenCalledWith();
  });
});
```

Run: `pnpm --filter scrubjay-discord test -- ops.controller`
Expected: FAIL — controller not found.

- [ ] **Step 4: Implement the controller**

`apps/scrubjay-discord/src/api/ops.controller.ts`:

```ts
import { Controller, Get, Query, UseFilters, UseGuards } from "@nestjs/common";
import {
  type ListDeliveriesQuery,
  listDeliveriesQuerySchema,
  type ListObservationsQuery,
  listObservationsQuerySchema,
} from "@scrubjay/api-contracts";
import { AlertQueue } from "@/features/dispatch/alert-queue.service";
import { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { OpsRepository } from "./ops.repository";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller("api/v1")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class OpsController {
  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly ops: OpsRepository,
    private readonly subscriptions: SubscriptionsRepository,
  ) {}

  /** Ingest regions stay derived from subscriptions; this is the read view. */
  @Get("regions")
  async regions() {
    const subs = await this.subscriptions.listSubscriptions();
    const byState = new Map<string, typeof subs>();
    for (const sub of subs) {
      const bucket = byState.get(sub.stateCode) ?? [];
      bucket.push(sub);
      byState.set(sub.stateCode, bucket);
    }
    return {
      regions: [...byState.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([stateCode, subscriptions]) => ({ stateCode, subscriptions })),
    };
  }

  @Get("observations")
  async observations(
    @Query(new ZodValidationPipe(listObservationsQuerySchema))
    query: ListObservationsQuery,
  ) {
    return this.ops.listObservations(query);
  }

  @Get("deliveries")
  async deliveries(
    @Query(new ZodValidationPipe(listDeliveriesQuerySchema))
    query: ListDeliveriesQuery,
  ) {
    return this.ops.listDeliveries(query);
  }

  /** Diagnostic view; semantics live in AlertQueue (see CONTEXT.md). */
  @Get("alerts/pending")
  async pendingAlerts() {
    return { alerts: await this.alertQueue.pendingEBirdAlerts() };
  }
}
```

Register `OpsController` (controllers) and `OpsRepository` (providers) in `api.module.ts`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter scrubjay-discord test -- ops && pnpm --filter scrubjay-discord check-types`
Expected: PASS.

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord/src
git commit -m "feat(scrubjay-discord): regions, observations, deliveries, pending-alert endpoints"
```

---

### Task 9: eBird counties proxy

**Files:**
- Create: `apps/scrubjay-discord/src/api/ebird-regions.service.ts`
- Create: `apps/scrubjay-discord/src/api/ebird-regions.controller.ts`
- Modify: `apps/scrubjay-discord/src/api/api.module.ts` (register)
- Test: `apps/scrubjay-discord/src/api/ebird-regions.service.spec.ts`

**Interfaces:**
- Consumes: `EBIRD_BASE_URL` / `EBIRD_TOKEN` from `AppConfig` (already required); `stateCodeSchema`, `CountiesResponse` from Task 2.
- Produces: `EBirdRegionsService.countiesForState(stateCode): Promise<CountiesResponse>`, cached in-memory per state for 24h. Route: `GET /api/v1/ebird/regions/:stateCode/counties`. Upstream failure → 502 `UPSTREAM` envelope.

- [ ] **Step 1: Write the failing service test**

`apps/scrubjay-discord/src/api/ebird-regions.service.spec.ts`:

```ts
import { BadGatewayException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/core/config/config.schema";
import { EBirdRegionsService } from "./ebird-regions.service";

const config = {
  get: (key: string) =>
    key === "EBIRD_BASE_URL" ? "https://api.ebird.org/" : "test-token",
} as unknown as ConfigService<AppConfig, true>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EBirdRegionsService", () => {
  it("fetches, validates, and caches counties per state", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ code: "US-CA-085", name: "Santa Clara" }]),
        ),
      );
    const service = new EBirdRegionsService(config);
    const first = await service.countiesForState("US-CA");
    const second = await service.countiesForState("US-CA");
    expect(first.counties[0]?.name).toBe("Santa Clara");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/v2/ref/region/list/subnational2/US-CA");
  });

  it("maps upstream failures to BadGatewayException", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    await expect(
      new EBirdRegionsService(config).countiesForState("US-CA"),
    ).rejects.toThrow(BadGatewayException);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter scrubjay-discord test -- ebird-regions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/scrubjay-discord/src/api/ebird-regions.service.ts`:

```ts
import { BadGatewayException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type CountiesResponse, countySchema } from "@scrubjay/api-contracts";
import { z } from "zod";
import type { AppConfig } from "@/core/config/config.schema";

/** County lists are effectively static; refresh daily at most. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const upstreamSchema = z.array(countySchema);

@Injectable()
export class EBirdRegionsService {
  private readonly cache = new Map<
    string,
    { counties: CountiesResponse["counties"]; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async countiesForState(stateCode: string): Promise<CountiesResponse> {
    const cached = this.cache.get(stateCode);
    if (cached && cached.expiresAt > Date.now()) {
      return { counties: cached.counties };
    }

    const url = new URL(
      `/v2/ref/region/list/subnational2/${encodeURIComponent(stateCode)}?fmt=json`,
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
      throw new BadGatewayException({
        code: "UPSTREAM",
        message: `eBird returned ${response.status} for ${stateCode}`,
      });
    }

    const parsed = upstreamSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new BadGatewayException({
        code: "UPSTREAM",
        message: "eBird returned an unexpected region payload",
      });
    }

    this.cache.set(stateCode, {
      counties: parsed.data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return { counties: parsed.data };
  }
}
```

`apps/scrubjay-discord/src/api/ebird-regions.controller.ts`:

```ts
import { Controller, Get, Param, UseFilters, UseGuards } from "@nestjs/common";
import {
  type CountiesResponse,
  stateCodeSchema,
} from "@scrubjay/api-contracts";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { EBirdRegionsService } from "./ebird-regions.service";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller("api/v1/ebird/regions")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class EBirdRegionsController {
  constructor(private readonly ebird: EBirdRegionsService) {}

  @Get(":stateCode/counties")
  counties(
    @Param("stateCode", new ZodValidationPipe(stateCodeSchema))
    stateCode: string,
  ): Promise<CountiesResponse> {
    return this.ebird.countiesForState(stateCode);
  }
}
```

Register `EBirdRegionsController` (controllers) and `EBirdRegionsService` (providers) in `api.module.ts`.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter scrubjay-discord test -- ebird-regions && pnpm --filter scrubjay-discord check-types`
Expected: PASS.

```bash
pnpm format-and-lint:fix
git add apps/scrubjay-discord/src
git commit -m "feat(scrubjay-discord): eBird county reference proxy"
```

---

### Task 10: Full gate, changeset, live smoke test

**Files:**
- Create: `.changeset/management-portal-api.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a green workspace and a changeset; ready for PR.

- [ ] **Step 1: Run the full workspace gate**

Run from the repo root:

```bash
pnpm format-and-lint && pnpm check-types && pnpm test && pnpm build
```

Expected: all four green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Add the changeset**

`.changeset/management-portal-api.md`:

```markdown
---
"@scrubjay/api-contracts": minor
"scrubjay-discord": minor
---

Add the operator REST API (`/api/v1`) behind `SCRUBJAY_API_TOKEN`: guild/channel
browsing, subscriptions and filters CRUD, read-only regions/observations/
deliveries/pending-alert views, and an eBird county reference proxy. Adds the
shared `@scrubjay/api-contracts` zod package.
```

- [ ] **Step 3: Live smoke test (requires local Postgres + Discord token)**

With `docker compose up -d postgres` and a `.env` containing a real `DISCORD_TOKEN`, `EBIRD_TOKEN`, `DATABASE_URL`, plus `SCRUBJAY_API_TOKEN=$(openssl rand -hex 32)`:

```bash
pnpm --filter scrubjay-discord dev
# in another shell (replace $TOKEN):
curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/guilds | head -c 400
curl -s localhost:3000/api/v1/guilds   # expect the 401 envelope
curl -s -H "Authorization: Bearer $TOKEN" "localhost:3000/api/v1/subscriptions"
```

Expected: guilds JSON with real guild/channel names; unauthenticated call returns `{"error":{"code":...}}` with 401; subscriptions lists existing rows. Also start once **without** `SCRUBJAY_API_TOKEN` and confirm `curl localhost:3000/api/v1/guilds` 404s (module not registered) while `/health` still responds.

- [ ] **Step 4: Commit and open the PR**

```bash
git add .changeset
git commit -m "chore: changeset for operator API"
git push -u origin HEAD
gh pr create --title "feat: operator REST API + api-contracts package" --body "Implements the API half of docs/superpowers/specs/2026-07-13-management-portal-design.md"
```

Then watch PR CI to green per the repo workflow.
