# Design: zod config seam on NestJS builtins

**Date:** 2026-07-07
**Status:** Approved
**Fixes:** B4 (env var name drift), B5 (unvalidated `DATABASE_URL`/`PORT`) from
`docs/architecture-improvements.md` §2; implements §10 (one honest config seam)
on the "keep NestJS builtins" variant.

## Goal

Replace Joi with zod as the validation layer inside `@nestjs/config`, make every
env read typed and schema-declared, and eliminate all raw `process.env` reads
from `apps/scrubjay-discord/src/`.

Decisions made during brainstorming:

- **Keep `@nestjs/config`** (user preference: NestJS builtins). zod plugs in via
  the `validate` option; `ConfigService` remains the injection surface.
- **`DEVELOPMENT_GUILD_ID`** replaces both `DEVELOPMENT_SERVER` (Joi-validated,
  never read) and `DEVELOPMENT_SERVER_ID` (read, never validated). Neither old
  name is set in any real environment, so the rename is free. "Guild" matches
  Discord/Necord terminology.
- **`DISCORD_CLIENT_ID` stays, optional.** Needed in development only, for
  slash-command registration.
- zod is already a dependency (v4). No new packages.

## 1. Schema — one source of truth

New file `src/core/config/config.schema.ts`:

```ts
import { z } from "zod";

export const configSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().default(3000),
  DISCORD_TOKEN: z.string().min(1),
  // Development only: used for slash-command registration.
  DISCORD_CLIENT_ID: z.string().optional(),
  DEVELOPMENT_GUILD_ID: z.string().optional(),
  EBIRD_BASE_URL: z.url().default("https://api.ebird.org/"),
  EBIRD_TOKEN: z.string().min(1),
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

Wired in `app.module.ts`:

```ts
ConfigModule.forRoot({ isGlobal: true, validate: validateConfig })
```

The Joi schema and the `joi` dependency are deleted.

## 2. Bootstrap reorder — create → migrate → listen

Today `main.ts` runs migrations before `NestFactory.create`, reading raw
`process.env.DATABASE_URL`. That is why B5 exists, and it also means `.env`
(loaded by `ConfigModule.forRoot`) is not yet available — dev migrations only
work when `DATABASE_URL` is exported in the shell.

New `main.ts` shape:

```ts
const app = await NestFactory.create(AppModule);        // validates env, loads .env
const config = app.get(ConfigService<AppConfig, true>);
const db = drizzle(config.get("DATABASE_URL", { infer: true }));
await migrate(db, { migrationsFolder: join(process.cwd(), "src", "drizzle") });
await app.listen(config.get("PORT", { infer: true }));
```

Safety argument: `NestFactory.create` only instantiates the DI graph. Necord's
Discord client login and `@nestjs/schedule` cron jobs start on
`app.listen()`/`init()`, so migrations still complete before the bot goes live
or any job fires.

After this change, `grep -rn "process\.env" src/` (excluding tests) returns
nothing.

## 3. Typed consumers

The three `ConfigService` injection sites switch to the typed form
`ConfigService<AppConfig, true>` with `get("KEY", { infer: true })`:

- `core/drizzle/drizzle.module.ts` — `DATABASE_URL`
- `app.module.ts` Necord factory — `DEVELOPMENT_GUILD_ID`, `DISCORD_TOKEN`
- `features/ebird/ebird.fetcher.ts` — `EBIRD_BASE_URL`, `EBIRD_TOKEN`

Key names and return types become compile-time checked; a B4-style name drift
is a type error.

The Necord factory also fixes the `undefined`-vs-`false` half of B4 explicitly:

```ts
const guildId = config.get("DEVELOPMENT_GUILD_ID", { infer: true });
return {
  development: guildId ? [guildId] : false,  // never undefined
  ...
};
```

## 4. Dependency cleanup

- Remove `joi` (replaced by zod).
- Remove `dotenv` (imported nowhere; `@nestjs/config` bundles its own).

## 5. Testing

New `src/core/config/__tests__/config.schema.spec.ts`:

- rejects an env missing each required var (`DATABASE_URL`, `DISCORD_TOKEN`,
  `EBIRD_TOKEN`), with the var named in the error
- coerces `PORT="8080"` to number `8080`; defaults to `3000` when unset
- applies the `EBIRD_BASE_URL` default; rejects a non-URL value
- accepts a full valid env and strips nothing needed

Plus the B4 regression test: the Necord options factory (extracted to a named,
testable function) returns `development: false` when `DEVELOPMENT_GUILD_ID` is
unset, and `["<id>"]` when set.

All of this runs in CI via the `test` task wired in PR #63.

## Out of scope

- B10 (raw error text in `/sub-ebird` replies) — separate change.
- Any move off `@nestjs/config` (considered, rejected by user preference).
- NestJS 12 / ESM concerns — this design is v12-compatible either way.
