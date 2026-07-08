# Zod Config Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Joi with zod inside `@nestjs/config`, type every env read, and eliminate raw `process.env` from `apps/scrubjay-discord/src/` (fixes B4 and B5).

**Architecture:** One zod schema (`src/core/config/config.schema.ts`) is the single source of truth for env vars, plugged into `ConfigModule.forRoot({ validate })`. Consumers inject `ConfigService<AppConfig, true>` and use `get("KEY", { infer: true })` for compile-time-checked reads. `main.ts` reorders to create → migrate → listen so migrations read the validated config.

**Tech Stack:** NestJS 11, `@nestjs/config` 4, zod 4 (already a dependency), Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-07-07-zod-config-seam-design.md`

## Global Constraints

- Work happens in `apps/scrubjay-discord/` on branch `refactor/zod-config` (already exists, contains the specs).
- All jest commands run from `apps/scrubjay-discord/` using the direct binary: `./node_modules/.bin/jest` (NOT `pnpm run test -- <args>` — pnpm swallows the flags). **Docker must be running** — jest's global setup boots a Postgres testcontainer for every invocation, even unit-only runs.
- Env var names (exact): `DATABASE_URL`, `PORT`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DEVELOPMENT_GUILD_ID`, `EBIRD_BASE_URL`, `EBIRD_TOKEN`. The old names `DEVELOPMENT_SERVER` and `DEVELOPMENT_SERVER_ID` must appear nowhere after this plan.
- `EBIRD_BASE_URL` default (exact): `https://api.ebird.org/`. `PORT` default: `3000`.
- Biome enforces alphabetically sorted object keys in package.json and import order — run `pnpm run format-and-lint:fix` from the repo root before each commit if in doubt.
- Repo commit style: conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

---

### Task 1: Config schema and validate function

**Files:**
- Create: `apps/scrubjay-discord/src/core/config/config.schema.ts`
- Test: `apps/scrubjay-discord/src/core/config/__tests__/config.schema.spec.ts`

**Interfaces:**
- Produces: `configSchema` (zod object), `type AppConfig = z.infer<typeof configSchema>`, `validateConfig(env: Record<string, unknown>): AppConfig`. Later tasks import all three from `@/core/config/config.schema`.

- [ ] **Step 1: Write the failing test**

Create `apps/scrubjay-discord/src/core/config/__tests__/config.schema.spec.ts`:

```ts
import { validateConfig } from "../config.schema";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/scrubjay",
  DISCORD_TOKEN: "discord-token",
  EBIRD_TOKEN: "ebird-token",
};

describe("validateConfig", () => {
  it("accepts a minimal valid env and applies defaults", () => {
    const config = validateConfig(validEnv);

    expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(config.PORT).toBe(3000);
    expect(config.EBIRD_BASE_URL).toBe("https://api.ebird.org/");
    expect(config.DEVELOPMENT_GUILD_ID).toBeUndefined();
    expect(config.DISCORD_CLIENT_ID).toBeUndefined();
  });

  it("coerces PORT from string to number", () => {
    const config = validateConfig({ ...validEnv, PORT: "8080" });

    expect(config.PORT).toBe(8080);
  });

  it.each(["DATABASE_URL", "DISCORD_TOKEN", "EBIRD_TOKEN"])(
    "rejects an env missing %s, naming the variable",
    (key) => {
      const env: Record<string, unknown> = { ...validEnv };
      delete env[key];

      expect(() => validateConfig(env)).toThrow(key);
    },
  );

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() =>
      validateConfig({ ...validEnv, DATABASE_URL: "not-a-url" }),
    ).toThrow("DATABASE_URL");
  });

  it("rejects a non-URL EBIRD_BASE_URL", () => {
    expect(() =>
      validateConfig({ ...validEnv, EBIRD_BASE_URL: "not-a-url" }),
    ).toThrow("EBIRD_BASE_URL");
  });

  it("passes optional vars through", () => {
    const config = validateConfig({
      ...validEnv,
      DEVELOPMENT_GUILD_ID: "guild-123",
      DISCORD_CLIENT_ID: "client-456",
    });

    expect(config.DEVELOPMENT_GUILD_ID).toBe("guild-123");
    expect(config.DISCORD_CLIENT_ID).toBe("client-456");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/scrubjay-discord/`): `./node_modules/.bin/jest src/core/config/__tests__/config.schema.spec.ts`
Expected: FAIL — `Cannot find module '../config.schema'`

- [ ] **Step 3: Write the implementation**

Create `apps/scrubjay-discord/src/core/config/config.schema.ts`:

```ts
import { z } from "zod";

export const configSchema = z.object({
  DATABASE_URL: z.url(),
  DEVELOPMENT_GUILD_ID: z.string().optional(),
  // Development only: used for slash-command registration.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_TOKEN: z.string().min(1),
  EBIRD_BASE_URL: z.url().default("https://api.ebird.org/"),
  EBIRD_TOKEN: z.string().min(1),
  PORT: z.coerce.number().int().default(3000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function validateConfig(env: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

Note: zod v4 `prettifyError` output includes the offending key path, which is what makes the `toThrow(key)` assertions pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/jest src/core/config/__tests__/config.schema.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/scrubjay-discord/src/core/config/
git commit -m "feat: add zod config schema and validateConfig"
```

---

### Task 2: Necord options factory (the B4 regression test)

**Files:**
- Create: `apps/scrubjay-discord/src/discord/necord-options.ts`
- Test: `apps/scrubjay-discord/src/discord/__tests__/necord-options.spec.ts`

**Interfaces:**
- Consumes: `AppConfig` from `@/core/config/config.schema` (Task 1).
- Produces: `createNecordOptions(config: Pick<AppConfig, "DEVELOPMENT_GUILD_ID" | "DISCORD_TOKEN">): NecordModuleOptions`. Task 3 calls this from the `app.module.ts` factory.

- [ ] **Step 1: Write the failing test**

Create `apps/scrubjay-discord/src/discord/__tests__/necord-options.spec.ts`:

```ts
import { createNecordOptions } from "../necord-options";

describe("createNecordOptions", () => {
  it("registers commands to the development guild when the id is set", () => {
    const options = createNecordOptions({
      DEVELOPMENT_GUILD_ID: "guild-123",
      DISCORD_TOKEN: "token",
    });

    expect(options.development).toEqual(["guild-123"]);
    expect(options.token).toBe("token");
  });

  it("is explicitly false — never undefined — when the guild id is unset", () => {
    const options = createNecordOptions({
      DEVELOPMENT_GUILD_ID: undefined,
      DISCORD_TOKEN: "token",
    });

    // Necord's `development` expects Snowflake[] | false; `undefined`
    // is what risked global slash-command registration (bug B4).
    expect(options.development).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/jest src/discord/__tests__/necord-options.spec.ts`
Expected: FAIL — `Cannot find module '../necord-options'`

- [ ] **Step 3: Write the implementation**

Create `apps/scrubjay-discord/src/discord/necord-options.ts`:

```ts
import { GatewayIntentBits, Partials } from "discord.js";
import type { NecordModuleOptions } from "necord";
import type { AppConfig } from "@/core/config/config.schema";

export function createNecordOptions(
  config: Pick<AppConfig, "DEVELOPMENT_GUILD_ID" | "DISCORD_TOKEN">,
): NecordModuleOptions {
  return {
    development: config.DEVELOPMENT_GUILD_ID
      ? [config.DEVELOPMENT_GUILD_ID]
      : false,
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    token: config.DISCORD_TOKEN,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/jest src/discord/__tests__/necord-options.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/scrubjay-discord/src/discord/necord-options.ts apps/scrubjay-discord/src/discord/__tests__/necord-options.spec.ts
git commit -m "feat: extract necord options factory with explicit development:false"
```

---

### Task 3: Wire zod into app.module, drop Joi schema

**Files:**
- Modify: `apps/scrubjay-discord/src/app.module.ts` (whole file below)

**Interfaces:**
- Consumes: `validateConfig`, `AppConfig` (Task 1); `createNecordOptions` (Task 2).
- Produces: `ConfigModule` validated by zod, global. Every downstream `ConfigService` read is now backed by the schema.

- [ ] **Step 1: Replace the file contents**

`apps/scrubjay-discord/src/app.module.ts` becomes:

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { NecordModule } from "necord";
import {
  type AppConfig,
  validateConfig,
} from "@/core/config/config.schema";
import { JobsModule } from "@/features/jobs/jobs.module";
import { DrizzleModule } from "./core/drizzle/drizzle.module";
import { DiscordModule } from "./discord/discord.module";
import { createNecordOptions } from "./discord/necord-options";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
    DrizzleModule,
    NecordModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) =>
        createNecordOptions({
          DEVELOPMENT_GUILD_ID: configService.get("DEVELOPMENT_GUILD_ID", {
            infer: true,
          }),
          DISCORD_TOKEN: configService.get("DISCORD_TOKEN", { infer: true }),
        }),
    }),
    DiscordModule,
    JobsModule,
  ],
  providers: [],
})
export class AppModule {}
```

The Joi import, the `configSchema` Joi object, and every mention of `DEVELOPMENT_SERVER`/`DEVELOPMENT_SERVER_ID` are gone.

- [ ] **Step 2: Verify typecheck and full suite**

Run (from repo root): `pnpm run check-types`
Expected: 3 successful tasks.
Run (from `apps/scrubjay-discord/`): `./node_modules/.bin/jest`
Expected: PASS, 12 suites (10 existing + 2 new), 55 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/scrubjay-discord/src/app.module.ts
git commit -m "refactor: validate config with zod instead of Joi (fixes B4)"
```

---

### Task 4: Typed config in drizzle.module and ebird.fetcher

**Files:**
- Modify: `apps/scrubjay-discord/src/core/drizzle/drizzle.module.ts`
- Modify: `apps/scrubjay-discord/src/features/ebird/ebird.fetcher.ts`
- Modify: `apps/scrubjay-discord/src/features/ebird/__tests__/ebird.fetcher.spec.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 1); zod-validated `ConfigModule` (Task 3).
- Produces: no new exports; both consumers become compile-time checked.

- [ ] **Step 1: Update drizzle.module.ts**

Replace the provider factory (the schema now guarantees `DATABASE_URL`, so the manual throw goes away):

```ts
import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppConfig } from "@/core/config/config.schema";
import * as schema from "./drizzle.schema";
import { DrizzleService } from "./drizzle.service";
import { PG_CONNECTION } from "./pg-connection";

@Global()
@Module({
  exports: [DrizzleService],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: PG_CONNECTION,
      useFactory: (configService: ConfigService<AppConfig, true>) =>
        drizzle(configService.get("DATABASE_URL", { infer: true }), {
          schema,
        }),
    },
    DrizzleService,
  ],
})
export class DrizzleModule {}
```

- [ ] **Step 2: Update ebird.fetcher.ts**

Change the constructor and the two reads (`getOrThrow` → typed `get`; the schema guarantees presence, and `EBIRD_BASE_URL` always has its default):

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "@/core/config/config.schema";
import type { EBirdObservation } from "./ebird.schema";

@Injectable()
export class EBirdFetcher {
  private readonly logger = new Logger(EBirdFetcher.name);

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Fetches notable observations for a specified region code
   */
  async fetchRareObservations(regionCode: string): Promise<EBirdObservation[]> {
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
      this.logger.warn(`Failed to fetch observations: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    this.logger.log(`Fetched ${data.length} observations`);
    return data;
  }
}
```

- [ ] **Step 3: Update the fetcher spec's mock**

In `apps/scrubjay-discord/src/features/ebird/__tests__/ebird.fetcher.spec.ts`, the mock currently stubs `getOrThrow`. Change the mock object and its setup (the rest of the spec is untouched):

```ts
const configServiceMock = {
  get: jest.fn(),
} as unknown as ConfigService;
```

and in `beforeEach`:

```ts
(configServiceMock.get as unknown as jest.Mock).mockImplementation(
  (key: string) => {
    if (key === "EBIRD_BASE_URL") return "https://api.ebird.org";
    if (key === "EBIRD_TOKEN") return "token";
    throw new Error("unexpected key");
  },
);
```

Also update the constructor call if the spec constructs `EBirdFetcher` directly — the mock cast stays `as unknown as ConfigService`, which still satisfies `ConfigService<AppConfig, true>` after a matching cast: use `as unknown as ConfigService<never, true>` if the compiler complains; the pragmatic form that works is:

```ts
} as unknown as ConfigService<never, true>;
```

(match whichever cast typechecks — the mock only needs `.get`).

- [ ] **Step 4: Verify**

Run (from repo root): `pnpm run check-types` — Expected: 3 successful.
Run (from `apps/scrubjay-discord/`): `./node_modules/.bin/jest src/features/ebird` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/scrubjay-discord/src/core/drizzle/drizzle.module.ts apps/scrubjay-discord/src/features/ebird/
git commit -m "refactor: typed ConfigService reads in drizzle module and ebird fetcher"
```

---

### Task 5: Bootstrap reorder in main.ts (fixes B5)

**Files:**
- Modify: `apps/scrubjay-discord/src/main.ts` (whole file below)

**Interfaces:**
- Consumes: `AppConfig` (Task 1); zod-validated `ConfigModule` (Task 3).
- Produces: zero raw `process.env` reads in `src/` (grep-verifiable).

- [ ] **Step 1: Replace the file contents**

`apps/scrubjay-discord/src/main.ts` becomes:

```ts
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { AppConfig } from "@/core/config/config.schema";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Creating the app validates the environment and loads .env.
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppConfig, true>);

  // Migrations must finish before the bot goes live; Necord login and
  // cron jobs only start on listen().
  const db = drizzle(config.get("DATABASE_URL", { infer: true }));
  await migrate(db, {
    migrationsFolder: join(process.cwd(), "src", "drizzle"),
  });

  await app.listen(config.get("PORT", { infer: true }));
}
bootstrap();
```

- [ ] **Step 2: Verify no raw env reads remain**

Run (from `apps/scrubjay-discord/`):
`grep -rn "process\.env" src/ --include="*.ts" | grep -v testing/ | grep -v __tests__`
Expected: no output.
(`src/testing/global-setup.ts` legitimately sets `process.env.TEST_DATABASE_URL` and is excluded.)

- [ ] **Step 3: Verify typecheck**

Run (from repo root): `pnpm run check-types`
Expected: 3 successful.

- [ ] **Step 4: Commit**

```bash
git add apps/scrubjay-discord/src/main.ts
git commit -m "fix: validate DATABASE_URL/PORT via config seam, migrate after create (fixes B5)"
```

---

### Task 6: Remove joi and dotenv, full verification, PR

**Files:**
- Modify: `apps/scrubjay-discord/package.json` (remove `joi` from dependencies, `dotenv` from dependencies)
- Modify: `pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Remove the dependencies**

In `apps/scrubjay-discord/package.json` delete the `"dotenv": "^17.4.2"` and `"joi": "^18.2.3"` lines from `dependencies` (`dotenv` is imported nowhere — `@nestjs/config` bundles its own; `joi` is replaced by zod). Then from repo root:

```bash
pnpm install
```

Expected: lockfile updates, exit 0.

- [ ] **Step 2: Confirm nothing still imports them**

Run: `grep -rn "joi\|dotenv" apps/scrubjay-discord/src --include="*.ts" -i | grep -v __tests__`
Expected: no output.

- [ ] **Step 3: Full local CI parity**

From repo root:

```bash
pnpm install --frozen-lockfile
pnpm run format-and-lint
pnpm run check-types
pnpm run test
```

Expected: all pass; jest reports 12 suites / 55 tests.

- [ ] **Step 4: Commit and open PR**

```bash
git add apps/scrubjay-discord/package.json pnpm-lock.yaml
git commit -m "chore: drop joi and unused dotenv"
git push -u origin refactor/zod-config
gh pr create --repo drewbxyz/scrubjay --head refactor/zod-config \
  --title "refactor: zod config seam (fixes B4, B5)" \
  --body "Implements docs/superpowers/specs/2026-07-07-zod-config-seam-design.md. Joi→zod via ConfigModule validate; typed ConfigService<AppConfig, true> everywhere; main.ts reordered to create→migrate→listen; DEVELOPMENT_GUILD_ID replaces the drifted DEVELOPMENT_SERVER(_ID) pair; joi and dead dotenv removed."
```

Expected: PR opens; all 4 checks pass (Status Checks runs lint + typecheck + tests).
