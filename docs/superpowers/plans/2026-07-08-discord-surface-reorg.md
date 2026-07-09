# Discord Surface Reorganization (§7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Discord surface the Necord way — reaction plumbing collapses to one controller in the filters slice, slash commands move into their feature slices behind one exception filter, and `DiscordHelper` shrinks to a single-method `ChannelSenderService`.

**Architecture:** Feature slices own their controllers (Necord handlers), `discord/` keeps only cross-cutting infra (sender, lifecycle, `/ping`, exception filter). `FiltersService` (pure pass-through) is deleted; the reactions controller calls `FiltersRepository` directly. No schema or migration changes.

**Tech Stack:** NestJS 11, Necord, discord.js v14, zod v4 config seam (`ConfigService<AppConfig, true>`), Jest, drizzle (untouched).

**Spec:** `docs/superpowers/specs/2026-07-08-discord-surface-reorg-design.md`

## Global Constraints

- Run Jest from `apps/scrubjay-discord/` via `./node_modules/.bin/jest` (NEVER `pnpm run test -- args`). Docker must be running (testcontainers global setup boots Postgres even for unit-only runs).
- Biome enforces sorted object keys and import order: run `pnpm run format-and-lint:fix` from the repo root before every commit.
- Conventional commit messages.
- No raw `process.env` in `src/`; every env read goes through `ConfigService<AppConfig, true>` with `{ infer: true }`.
- The reaction guard order is behavior-preserving and fixed: partial-user fetch → `user.bot` → partial-reaction fetch → emoji → threshold → filterable channel → embed title. Do not reorder.
- Exact user-facing strings (copy verbatim): `Something went wrong running that command.` / `Invalid region code: ${regionCode}` / `Channel ${channelId} not found or not sendable` / `Subscribed to eBird observations for ${region}.` / presence text `looking for birds...`.
- `pnpm run check-types` from repo root = 2 successful turbo tasks.
- Suite arithmetic below assumes the pre-plan baseline of 16 suites / 64 tests; if a count differs by a test or two, the binding requirement is "everything green and the named new cases exist," not the literal number.

---

### Task 1: `FILTER_REACTION_THRESHOLD` config entry

**Files:**
- Modify: `apps/scrubjay-discord/src/core/config/config.schema.ts`
- Test: `apps/scrubjay-discord/src/core/config/__tests__/config.schema.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AppConfig.FILTER_REACTION_THRESHOLD: number` (default 3, coerced from string, integer ≥ 1). Task 2 reads it via `config.get("FILTER_REACTION_THRESHOLD", { infer: true })`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("validateConfig", ...)` block of `config.schema.spec.ts`:

```ts
  it("defaults FILTER_REACTION_THRESHOLD to 3", () => {
    const config = validateConfig(validEnv);

    expect(config.FILTER_REACTION_THRESHOLD).toBe(3);
  });

  it("coerces FILTER_REACTION_THRESHOLD from string to number", () => {
    const config = validateConfig({
      ...validEnv,
      FILTER_REACTION_THRESHOLD: "5",
    });

    expect(config.FILTER_REACTION_THRESHOLD).toBe(5);
  });

  it("rejects a FILTER_REACTION_THRESHOLD below 1", () => {
    expect(() =>
      validateConfig({ ...validEnv, FILTER_REACTION_THRESHOLD: "0" }),
    ).toThrow("FILTER_REACTION_THRESHOLD");
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run (from `apps/scrubjay-discord/`): `./node_modules/.bin/jest src/core/config -v`
Expected: 8 pass, 3 FAIL (`FILTER_REACTION_THRESHOLD` is `undefined` / no error thrown).

- [ ] **Step 3: Add the schema entry**

In `config.schema.ts`, add one line to `configSchema` (keys stay alphabetically sorted — it goes between `EBIRD_TOKEN` and `PORT`):

```ts
  FILTER_REACTION_THRESHOLD: z.coerce.number().int().min(1).default(3),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/jest src/core/config -v`
Expected: 11/11 pass.

- [ ] **Step 5: Lint and commit**

```bash
pnpm run format-and-lint:fix   # repo root
git add apps/scrubjay-discord/src/core/config
git commit -m "feat(config): add FILTER_REACTION_THRESHOLD"
```

---

### Task 2: `FiltersReactions` controller — collapse the reaction plumbing (7a + §4 fold-in)

**Files:**
- Create: `apps/scrubjay-discord/src/features/filters/filters.reactions.ts`
- Test: `apps/scrubjay-discord/src/features/filters/__tests__/filters.reactions.spec.ts`
- Modify: `apps/scrubjay-discord/src/features/filters/filters.module.ts`, `apps/scrubjay-discord/src/discord/discord.module.ts`, `apps/scrubjay-discord/src/discord/listeners/listeners.module.ts`, `apps/scrubjay-discord/src/app.module.ts`
- Delete: `apps/scrubjay-discord/src/discord/reaction-router/` (all 5 files), `apps/scrubjay-discord/src/discord/listeners/reaction-listener.service.ts`, `apps/scrubjay-discord/src/discord/listeners/__tests__/reaction-listener.service.spec.ts`, `apps/scrubjay-discord/src/features/filters/handlers/filters-add.handler.ts`, `apps/scrubjay-discord/src/features/filters/__tests__/filters-add.handler.spec.ts`, `apps/scrubjay-discord/src/features/filters/filters.service.ts`

**Interfaces:**
- Consumes: `AppConfig.FILTER_REACTION_THRESHOLD` (Task 1); `FiltersRepository.isChannelFilterable(channelId: string): Promise<boolean>` and `FiltersRepository.addChannelFilter(channelId: string, commonName: string)` (existing, unchanged).
- Produces: `FiltersReactions` provider (Necord `@On(Events.MessageReactionAdd)` handler). Nothing else imports it; `FiltersModule` stops exporting anything.

- [ ] **Step 1: Write the failing test file**

Create `features/filters/__tests__/filters.reactions.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { FiltersRepository } from "../filters.repository";
import { FiltersReactions } from "../filters.reactions";

describe("FiltersReactions", () => {
  let reactions: FiltersReactions;

  const repoMock = {
    addChannelFilter: jest.fn(),
    isChannelFilterable: jest.fn(),
  };
  const configMock = { get: jest.fn() };

  const fullUser = { bot: false, partial: false };

  const makeReaction = (overrides: Record<string, unknown> = {}) => ({
    count: 3,
    emoji: { name: "👎" },
    message: {
      channelId: "channel-1",
      embeds: [{ title: "Snowy Owl - King County" }],
    },
    partial: false,
    ...overrides,
  });

  // biome-ignore lint/suspicious/noExplicitAny: stubbed discord.js payload
  const run = (reaction: any, user: any = fullUser) =>
    reactions.onReactionAdd([reaction, user] as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    configMock.get.mockReturnValue(3);
    repoMock.isChannelFilterable.mockResolvedValue(true);
    repoMock.addChannelFilter.mockResolvedValue([]);
    reactions = new FiltersReactions(
      repoMock as unknown as FiltersRepository,
      configMock as unknown as ConfigService<never, true>,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds a filter when the channel is filterable and an embed title exists", async () => {
    await run(makeReaction());

    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("fetches a partial user before reading bot (B9)", async () => {
    const partialUser = {
      bot: null,
      fetch: jest.fn().mockResolvedValue({ bot: false, partial: false }),
      partial: true,
    };

    await run(makeReaction(), partialUser);

    expect(partialUser.fetch).toHaveBeenCalled();
    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("ignores a bot user discovered after fetching (B9)", async () => {
    const partialBot = {
      bot: null,
      fetch: jest.fn().mockResolvedValue({ bot: true, partial: false }),
      partial: true,
    };

    await run(makeReaction(), partialBot);

    expect(repoMock.isChannelFilterable).not.toHaveBeenCalled();
    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("bails out when the user fetch fails", async () => {
    const partialUser = {
      bot: null,
      fetch: jest.fn().mockRejectedValue(new Error("unknown user")),
      partial: true,
    };

    await run(makeReaction(), partialUser);

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("still ignores plain bot users", async () => {
    await run(makeReaction(), { bot: true, partial: false });

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("fetches a partial reaction before reading it", async () => {
    const partialReaction = {
      fetch: jest.fn().mockResolvedValue(makeReaction()),
      partial: true,
    };

    await run(partialReaction);

    expect(partialReaction.fetch).toHaveBeenCalled();
    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("bails out when the reaction fetch fails", async () => {
    const partialReaction = {
      fetch: jest.fn().mockRejectedValue(new Error("unknown message")),
      partial: true,
    };

    await run(partialReaction);

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("ignores reactions with other emoji", async () => {
    await run(makeReaction({ emoji: { name: "👍" } }));

    expect(repoMock.isChannelFilterable).not.toHaveBeenCalled();
    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("ignores reactions below the threshold", async () => {
    await run(makeReaction({ count: 2 }));

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("reads the threshold from config", async () => {
    configMock.get.mockReturnValue(5);

    await run(makeReaction({ count: 4 }));
    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();

    await run(makeReaction({ count: 5 }));
    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
    expect(configMock.get).toHaveBeenCalledWith("FILTER_REACTION_THRESHOLD", {
      infer: true,
    });
  });

  it("does not add a filter when the channel is not filterable", async () => {
    repoMock.isChannelFilterable.mockResolvedValue(false);

    await run(makeReaction());

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("does nothing when the message has no embed title", async () => {
    await run(makeReaction({ message: { channelId: "channel-1", embeds: [] } }));

    expect(repoMock.addChannelFilter).not.toHaveBeenCalled();
  });

  it("parses species names containing ' - ' fully (B2)", async () => {
    await run(
      makeReaction({
        message: {
          channelId: "channel-1",
          embeds: [{ title: "Northern Goshawk - dark morph - King County" }],
        },
      }),
    );

    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Northern Goshawk - dark morph",
    );
  });

  it("falls back to the whole title when there is no separator", async () => {
    await run(
      makeReaction({
        message: { channelId: "channel-1", embeds: [{ title: "Snowy Owl" }] },
      }),
    );

    expect(repoMock.addChannelFilter).toHaveBeenCalledWith(
      "channel-1",
      "Snowy Owl",
    );
  });

  it("swallows repository insert failures", async () => {
    repoMock.addChannelFilter.mockRejectedValue(new Error("db down"));

    await expect(run(makeReaction())).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/jest src/features/filters/__tests__/filters.reactions.spec.ts -v`
Expected: FAIL — `Cannot find module '../filters.reactions'`.

- [ ] **Step 3: Create the controller**

Create `features/filters/filters.reactions.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Events } from "discord.js";
import { Context, type ContextOf, On } from "necord";
import type { AppConfig } from "@/core/config/config.schema";
import { FiltersRepository } from "./filters.repository";

@Injectable()
export class FiltersReactions {
  private readonly logger = new Logger(FiltersReactions.name);

  constructor(
    private readonly repo: FiltersRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @On(Events.MessageReactionAdd)
  async onReactionAdd(
    @Context() [reaction, user]: ContextOf<Events.MessageReactionAdd>,
  ) {
    if (user.partial) {
      try {
        user = await user.fetch();
      } catch (error) {
        this.logger.error(`Error fetching user: ${error}`);
        return;
      }
    }

    if (user.bot) return; // ignore any bot

    if (reaction.partial) {
      try {
        reaction = await reaction.fetch();
      } catch (error) {
        this.logger.error(`Error fetching reaction: ${error}`);
        return;
      }
    }

    if (reaction.emoji.name !== "👎") return;

    const threshold = this.config.get("FILTER_REACTION_THRESHOLD", {
      infer: true,
    });
    if (reaction.count < threshold) {
      this.logger.debug("Filter vote added, but count is below threshold");
      return;
    }

    const message = reaction.message;

    const filterable = await this.repo.isChannelFilterable(message.channelId);
    if (!filterable) return;

    const embed = message.embeds[0];
    if (!embed || !embed.title) return;

    const speciesCommonName = this.extractSpeciesNameFromTitle(embed.title);
    if (!speciesCommonName) return;

    try {
      await this.repo.addChannelFilter(message.channelId, speciesCommonName);
    } catch (err) {
      this.logger.error(
        `Could not insert filter into database (${message.channelId}:${speciesCommonName}): ${err}`,
      );
      return;
    }

    this.logger.log(
      `Filter added: ${speciesCommonName} - ${message.channelId}`,
    );
  }

  private extractSpeciesNameFromTitle(title: string) {
    const idx = title.lastIndexOf(" - ");
    return idx === -1 ? title : title.slice(0, idx);
  }
}
```

Note on types: `reaction.count` — after the `reaction.partial` fetch block, TS has narrowed the union to `MessageReaction` (discriminated on `partial`); the old `FiltersAddHandler` compared `count` the same way. If `tsc` complains about `count` being `number | null`, use `(reaction.count ?? 0) < threshold`.

- [ ] **Step 4: Run the new spec to verify it passes**

Run: `./node_modules/.bin/jest src/features/filters/__tests__/filters.reactions.spec.ts -v`
Expected: 15/15 pass.

- [ ] **Step 5: Delete the old plumbing and rewire modules**

Delete these files/directories:

```bash
git rm -r apps/scrubjay-discord/src/discord/reaction-router
git rm apps/scrubjay-discord/src/discord/listeners/reaction-listener.service.ts
git rm apps/scrubjay-discord/src/discord/listeners/__tests__/reaction-listener.service.spec.ts
git rm apps/scrubjay-discord/src/features/filters/handlers/filters-add.handler.ts
git rm apps/scrubjay-discord/src/features/filters/__tests__/filters-add.handler.spec.ts
git rm apps/scrubjay-discord/src/features/filters/filters.service.ts
```

(`handlers/` and `listeners/__tests__/` directories disappear with their last file.)

Replace `features/filters/filters.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { FiltersReactions } from "./filters.reactions";
import { FiltersRepository } from "./filters.repository";

@Module({
  providers: [FiltersReactions, FiltersRepository],
})
export class FiltersModule {}
```

Replace `discord/listeners/listeners.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { LifecycleListenerService } from "./lifecycle-listener.service";

@Module({
  providers: [LifecycleListenerService],
})
export class ListenersModule {}
```

Replace `discord/discord.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { CommandsModule } from "./commands/commands.module";
import { DiscordHelper } from "./discord.helper";
import { ListenersModule } from "./listeners/listeners.module";

@Module({
  exports: [DiscordHelper],
  imports: [CommandsModule, ListenersModule],
  providers: [DiscordHelper],
})
export class DiscordModule {}
```

In `app.module.ts`, add the import statement

```ts
import { FiltersModule } from "@/features/filters/filters.module";
```

and add `FiltersModule` to the `imports` array directly after `DiscordModule`.

`discord/commands/commands.module.ts` still lists `FiltersModule` in its imports — leave it; nothing there injects a filters provider and the whole folder dies in Task 5.

- [ ] **Step 6: Run the full suite**

Run: `./node_modules/.bin/jest`
Expected: all green — 15 suites / 75 tests (from the post-Task-1 16/67: −2 suites and −7 tests deleted, +1 suite and +15 tests added; if your printout differs slightly, the requirement is zero failures and zero references to the deleted files).

Also run from repo root: `pnpm run check-types`
Expected: 2 successful turbo tasks.

- [ ] **Step 7: Lint and commit**

```bash
pnpm run format-and-lint:fix
git add -A apps/scrubjay-discord/src
git commit -m "refactor(filters): collapse reaction plumbing into FiltersReactions controller"
```

---

### Task 3: `InvalidRegionError` + `SubscriptionsService` stops wrapping errors

**Files:**
- Create: `apps/scrubjay-discord/src/features/subscriptions/invalid-region.error.ts`
- Modify: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.service.ts`
- Test: `apps/scrubjay-discord/src/features/subscriptions/__tests__/subscriptions.service.spec.ts` (rewrite)

**Interfaces:**
- Consumes: `SubscriptionsRepository.insertEBirdSubscription({ channelId, countyCode, stateCode })` (existing, unchanged).
- Produces: `InvalidRegionError` (class, `extends Error`, `name = "InvalidRegionError"`, message `Invalid region code: ${regionCode}`, public readonly `regionCode`). Task 4's filter does `instanceof InvalidRegionError`; Task 5's command relies on `subscribeToEBird` throwing it. Repository errors now propagate **raw** (no more `Failed to subscribe to eBird: ...` wrapper).

Compatibility note: the still-live old command (`discord/commands/subscription-commands.service.ts`, deleted in Task 5) matches errors with `error.message.startsWith("Invalid region code")`, which `InvalidRegionError`'s message satisfies — no interim breakage.

- [ ] **Step 1: Rewrite the service spec (failing first)**

Replace the entire content of `features/subscriptions/__tests__/subscriptions.service.spec.ts` with:

```ts
import { InvalidRegionError } from "../invalid-region.error";
import type { SubscriptionsRepository } from "../subscriptions.repository";
import { SubscriptionsService } from "../subscriptions.service";

describe("SubscriptionsService", () => {
  let service: SubscriptionsService;

  const repoMock = {
    insertEBirdSubscription: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionsService(
      repoMock as unknown as SubscriptionsRepository,
    );
  });

  describe("subscribeToEBird", () => {
    it("successfully subscribes to a state-level region (2 parts)", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-WA");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-WA",
      });
    });

    it("successfully subscribes to a county-level region (3 parts)", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-WA-033");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-WA-033",
        stateCode: "US-WA",
      });
    });

    it("rejects a 1-part region code with InvalidRegionError", async () => {
      await expect(
        service.subscribeToEBird("channel-123", "US"),
      ).rejects.toThrow(InvalidRegionError);

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
    });

    it("rejects a 4-part region code, naming the code", async () => {
      await expect(
        service.subscribeToEBird("channel-123", "US-WA-033-EXTRA"),
      ).rejects.toThrow("Invalid region code: US-WA-033-EXTRA");

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
    });

    it("rejects an empty region code", async () => {
      await expect(
        service.subscribeToEBird("channel-123", ""),
      ).rejects.toThrow(InvalidRegionError);

      expect(repoMock.insertEBirdSubscription).not.toHaveBeenCalled();
    });

    it("lets repository errors propagate unwrapped", async () => {
      repoMock.insertEBirdSubscription.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        service.subscribeToEBird("channel-123", "US-WA"),
      ).rejects.toThrow("Database connection failed");
    });

    it("handles various state codes correctly", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-CA");
      await service.subscribeToEBird("channel-123", "US-NY");

      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(1, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-CA",
      });
      expect(repoMock.insertEBirdSubscription).toHaveBeenNthCalledWith(2, {
        channelId: "channel-123",
        countyCode: "*",
        stateCode: "US-NY",
      });
    });

    it("handles various county codes correctly", async () => {
      repoMock.insertEBirdSubscription.mockResolvedValue(undefined);

      await service.subscribeToEBird("channel-123", "US-CA-037");

      expect(repoMock.insertEBirdSubscription).toHaveBeenCalledWith({
        channelId: "channel-123",
        countyCode: "US-CA-037",
        stateCode: "US-CA",
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/jest src/features/subscriptions/__tests__/subscriptions.service.spec.ts -v`
Expected: FAIL — `Cannot find module '../invalid-region.error'`.

- [ ] **Step 3: Create the error and simplify the service**

Create `features/subscriptions/invalid-region.error.ts`:

```ts
export class InvalidRegionError extends Error {
  constructor(readonly regionCode: string) {
    super(`Invalid region code: ${regionCode}`);
    this.name = "InvalidRegionError";
  }
}
```

Replace the entire content of `features/subscriptions/subscriptions.service.ts` with:

```ts
import { Injectable } from "@nestjs/common";
import { InvalidRegionError } from "./invalid-region.error";
import { SubscriptionsRepository } from "./subscriptions.repository";

@Injectable()
export class SubscriptionsService {
  constructor(private readonly repo: SubscriptionsRepository) {}

  private parseRegionCode(regionCode: string) {
    const parts = regionCode.split("-");
    if (parts.length === 2) {
      return {
        countyCode: "*",
        stateCode: regionCode,
      };
    }
    if (parts.length === 3) {
      return {
        countyCode: regionCode,
        stateCode: `${parts[0]}-${parts[1]}`,
      };
    }
    throw new InvalidRegionError(regionCode);
  }

  async subscribeToEBird(channelId: string, regionCode: string) {
    const { countyCode, stateCode } = this.parseRegionCode(regionCode);
    await this.repo.insertEBirdSubscription({
      channelId,
      countyCode,
      stateCode,
    });
  }
}
```

(The `Logger` and both try/catch blocks are deliberately gone — the exception filter added in Task 4 becomes the single place command errors are logged.)

- [ ] **Step 4: Run the suite**

Run: `./node_modules/.bin/jest src/features/subscriptions src/discord -v`
Expected: all green (the old command spec still passes — it mocks the service directly). Then `./node_modules/.bin/jest` — all green, still 15 suites / 75 tests (the rewritten service spec has 8 tests, same as before: 2 happy + 3 invalid + 1 propagate + 2 various).

- [ ] **Step 5: Lint and commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-discord/src/features/subscriptions
git commit -m "refactor(subscriptions): typed InvalidRegionError, stop wrapping repo errors"
```

---

### Task 4: `CommandExceptionFilter` — one error boundary for slash commands

**Files:**
- Create: `apps/scrubjay-discord/src/discord/common/filters/command-exception.filter.ts`
- Test: `apps/scrubjay-discord/src/discord/common/filters/__tests__/command-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `InvalidRegionError` (Task 3).
- Produces: `CommandExceptionFilter` (Nest `ExceptionFilter`, no constructor deps). Task 5 applies it with `@UseFilters(CommandExceptionFilter)` on both command classes — no provider registration needed.
- Verified API fact: `NecordArgumentsHost.create(host)` calls `host.getType()` and `host.getArgs()`; `getContext()` returns `getArgByIndex(0)` — so the necord context args are `[[interaction], discovery]` and a mock host of `{ getArgs: () => [[interaction]], getType: () => "necord" }` is sufficient (checked against `necord/dist/context/necord-arguments-host.js`).

- [ ] **Step 1: Write the failing spec**

Create `discord/common/filters/__tests__/command-exception.filter.spec.ts`:

```ts
import type { ArgumentsHost } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import { CommandExceptionFilter } from "../command-exception.filter";

describe("CommandExceptionFilter", () => {
  let filter: CommandExceptionFilter;
  let loggerErrorSpy: jest.SpyInstance;

  const interaction = {
    deferred: false,
    editReply: jest.fn(),
    replied: false,
    reply: jest.fn(),
  };

  const host = {
    getArgs: () => [[interaction]],
    getType: () => "necord",
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    interaction.deferred = false;
    interaction.replied = false;
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation();
    filter = new CommandExceptionFilter();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it("passes an InvalidRegionError message through verbatim", async () => {
    await filter.catch(new InvalidRegionError("US"), host);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Invalid region code: US" }),
    );
  });

  it("hides other errors behind a generic message", async () => {
    await filter.catch(new Error("connection refused"), host);

    const { content } = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(content).toBe("Something went wrong running that command.");
    expect(content).not.toContain("connection refused");
  });

  it("uses editReply when the interaction was already deferred", async () => {
    interaction.deferred = true;

    await filter.catch(new Error("boom"), host);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Something went wrong running that command.",
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("logs the error with its stack", async () => {
    const err = new Error("boom");

    await filter.catch(err, host);

    expect(loggerErrorSpy).toHaveBeenCalledWith("boom", err.stack);
  });

  it("copes with non-Error thrown values", async () => {
    await filter.catch("string failure", host);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Something went wrong running that command.",
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/jest src/discord/common -v`
Expected: FAIL — `Cannot find module '../command-exception.filter'`.

- [ ] **Step 3: Implement the filter**

Create `discord/common/filters/command-exception.filter.ts`:

```ts
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from "@nestjs/common";
import { MessageFlags } from "discord.js";
import { NecordArgumentsHost, type SlashCommandContext } from "necord";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";

const GENERIC_MESSAGE = "Something went wrong running that command.";

@Catch()
export class CommandExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CommandExceptionFilter.name);

  async catch(exception: unknown, host: ArgumentsHost) {
    const [interaction] =
      NecordArgumentsHost.create(host).getContext<SlashCommandContext>();

    const error =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(error.message, error.stack);

    const content =
      exception instanceof InvalidRegionError
        ? exception.message
        : GENERIC_MESSAGE;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/jest src/discord/common -v`
Expected: 5/5 pass.

- [ ] **Step 5: Lint and commit**

```bash
pnpm run format-and-lint:fix
git add apps/scrubjay-discord/src/discord/common
git commit -m "feat(discord): command exception filter"
```

---

### Task 5: Commands move into their feature slices (7b)

**Files:**
- Create: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.commands.ts`, `apps/scrubjay-discord/src/features/subscriptions/options/subscribe-ebird.options.ts`, `apps/scrubjay-discord/src/discord/util.commands.ts`
- Test: `apps/scrubjay-discord/src/features/subscriptions/__tests__/subscriptions.commands.spec.ts`
- Modify: `apps/scrubjay-discord/src/features/subscriptions/subscriptions.module.ts`, `apps/scrubjay-discord/src/discord/discord.module.ts`, `apps/scrubjay-discord/src/app.module.ts`
- Delete: `apps/scrubjay-discord/src/discord/commands/` (commands.dto.ts, commands.module.ts, subscription-commands.service.ts, util-commands.service.ts, `__tests__/subscription-commands.spec.ts`)

**Interfaces:**
- Consumes: `SubscriptionsService.subscribeToEBird(channelId, region)` (Task 3 shape — throws `InvalidRegionError`/raw repo errors); `CommandExceptionFilter` (Task 4).
- Produces: `SubscriptionsCommands` provider (in `SubscriptionsModule`), `UtilCommands` provider (in `DiscordModule`), `SubscribeEBirdOptions` DTO (renamed from `SubscribeEBirdCommandDto`). `AppModule` now imports `SubscriptionsModule` directly.

- [ ] **Step 1: Write the failing commands spec**

Create `features/subscriptions/__tests__/subscriptions.commands.spec.ts`:

```ts
import type { SlashCommandContext } from "necord";
import type { SubscribeEBirdOptions } from "../options/subscribe-ebird.options";
import { SubscriptionsCommands } from "../subscriptions.commands";
import type { SubscriptionsService } from "../subscriptions.service";

describe("SubscriptionsCommands", () => {
  let commands: SubscriptionsCommands;

  const serviceMock = { subscribeToEBird: jest.fn() };
  const interaction = {
    channelId: "CH1",
    deferReply: jest.fn(),
    editReply: jest.fn(),
  };

  const run = (region: string) =>
    commands.onSubscribeEBird(
      [interaction] as unknown as SlashCommandContext,
      { region } as SubscribeEBirdOptions,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    commands = new SubscriptionsCommands(
      serviceMock as unknown as SubscriptionsService,
    );
  });

  it("defers the reply before doing subscription work", async () => {
    const order: string[] = [];
    interaction.deferReply.mockImplementation(async () => {
      order.push("defer");
    });
    serviceMock.subscribeToEBird.mockImplementation(async () => {
      order.push("subscribe");
    });

    await run("US-WA");

    expect(order).toEqual(["defer", "subscribe"]);
  });

  it("confirms a successful subscription via editReply", async () => {
    serviceMock.subscribeToEBird.mockResolvedValue(undefined);

    await run("US-WA");

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Subscribed to eBird observations for US-WA.",
      }),
    );
  });

  it("lets errors propagate to the exception filter", async () => {
    serviceMock.subscribeToEBird.mockRejectedValue(new Error("boom"));

    await expect(run("US-WA")).rejects.toThrow("boom");
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/jest src/features/subscriptions/__tests__/subscriptions.commands.spec.ts -v`
Expected: FAIL — `Cannot find module '../subscriptions.commands'`.

- [ ] **Step 3: Create the new command files**

Create `features/subscriptions/options/subscribe-ebird.options.ts`:

```ts
import { StringOption } from "necord";

export class SubscribeEBirdOptions {
  @StringOption({
    description: "The region code to subscribe to",
    name: "region",
    required: true,
  })
  region: string;
}
```

Create `features/subscriptions/subscriptions.commands.ts`:

```ts
import { Injectable, UseFilters } from "@nestjs/common";
import { MessageFlags, PermissionsBitField } from "discord.js";
import {
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
} from "necord";
import { CommandExceptionFilter } from "@/discord/common/filters/command-exception.filter";
import { SubscribeEBirdOptions } from "./options/subscribe-ebird.options";
import { SubscriptionsService } from "./subscriptions.service";

@Injectable()
@UseFilters(CommandExceptionFilter)
export class SubscriptionsCommands {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @SlashCommand({
    defaultMemberPermissions: PermissionsBitField.Flags.Administrator,
    description: "Subscribe to eBird observations for a region",
    name: "sub-ebird",
  })
  public async onSubscribeEBird(
    @Context() [interaction]: SlashCommandContext,
    @Options() { region }: SubscribeEBirdOptions,
  ) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    await this.subscriptions.subscribeToEBird(interaction.channelId, region);
    return interaction.editReply({
      content: `Subscribed to eBird observations for ${region}.`,
    });
  }
}
```

Create `discord/util.commands.ts` (moved from `commands/util-commands.service.ts`; the dead try/catch and its `console.error` are dropped — the filter is the error boundary):

```ts
import { Injectable, Logger, UseFilters } from "@nestjs/common";
import { Context, SlashCommand, type SlashCommandContext } from "necord";
import { CommandExceptionFilter } from "./common/filters/command-exception.filter";

@Injectable()
@UseFilters(CommandExceptionFilter)
export class UtilCommands {
  private readonly logger = new Logger(UtilCommands.name);

  @SlashCommand({
    description: "Responds with latency",
    name: "ping",
  })
  public async onPing(@Context() [interaction]: SlashCommandContext) {
    this.logger.debug("Received ping command.");
    const latency = Date.now() - interaction.createdTimestamp;

    if (latency < 0) {
      return interaction.reply({
        content: `Something weird happened... latency was ${latency}ms`,
      });
    }
    return interaction.reply({ content: `Pong! Latency: ${latency}ms` });
  }
}
```

- [ ] **Step 4: Delete the old folder and rewire modules**

```bash
git rm -r apps/scrubjay-discord/src/discord/commands
```

Replace `features/subscriptions/subscriptions.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { SubscriptionsCommands } from "./subscriptions.commands";
import { SubscriptionsRepository } from "./subscriptions.repository";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
  exports: [SubscriptionsService],
  providers: [
    SubscriptionsCommands,
    SubscriptionsRepository,
    SubscriptionsService,
  ],
})
export class SubscriptionsModule {}
```

Replace `discord/discord.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { DiscordHelper } from "./discord.helper";
import { ListenersModule } from "./listeners/listeners.module";
import { UtilCommands } from "./util.commands";

@Module({
  exports: [DiscordHelper],
  imports: [ListenersModule],
  providers: [DiscordHelper, UtilCommands],
})
export class DiscordModule {}
```

In `app.module.ts`, add

```ts
import { SubscriptionsModule } from "@/features/subscriptions/subscriptions.module";
```

and add `SubscriptionsModule` to the `imports` array directly after `FiltersModule`.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `./node_modules/.bin/jest`
Expected: all green (subscription commands suite now lives under `features/subscriptions`; total 15 suites — old command spec deleted, new one added, one suite net 0... final expectation: same suite count as after Task 4, test delta 3 − 3 = 0).

From repo root: `pnpm run check-types` — 2 successful turbo tasks.

- [ ] **Step 6: Lint and commit**

```bash
pnpm run format-and-lint:fix
git add -A apps/scrubjay-discord/src
git commit -m "refactor(discord): move slash commands into their feature slices"
```

---

### Task 6: `ChannelSenderService` replaces `DiscordHelper` (7c)

**Files:**
- Create: `apps/scrubjay-discord/src/discord/channel-sender.service.ts`
- Test: `apps/scrubjay-discord/src/discord/__tests__/channel-sender.service.spec.ts`
- Modify: `apps/scrubjay-discord/src/features/dispatch/ebird-dispatcher.service.ts`, `apps/scrubjay-discord/src/discord/discord.module.ts`
- Delete: `apps/scrubjay-discord/src/discord/discord.helper.ts`

**Interfaces:**
- Consumes: discord.js `Client` (provided by Necord — same injection `DiscordHelper` uses today).
- Produces: `ChannelSenderService.send(channelId: string, options: string | MessageCreateOptions): Promise<void>` — **throws** `Error("Channel ${channelId} not found or not sendable")` on a missing/unsendable channel and propagates `channel.send` failures. `DiscordModule` exports it; `EBirdDispatcherService`'s existing per-send try/catch is the error boundary (B8 semantics unchanged).

- [ ] **Step 1: Write the failing spec**

Create `discord/__tests__/channel-sender.service.spec.ts`:

```ts
import type { Client } from "discord.js";
import { ChannelSenderService } from "../channel-sender.service";

describe("ChannelSenderService", () => {
  let sender: ChannelSenderService;

  const fetchMock = jest.fn();
  const clientMock = { channels: { fetch: fetchMock } } as unknown as Client;

  beforeEach(() => {
    jest.clearAllMocks();
    sender = new ChannelSenderService(clientMock);
  });

  it("sends to a sendable channel", async () => {
    const send = jest.fn();
    fetchMock.mockResolvedValue({ isSendable: () => true, send });

    await sender.send("channel-1", { embeds: [] });

    expect(fetchMock).toHaveBeenCalledWith("channel-1");
    expect(send).toHaveBeenCalledWith({ embeds: [] });
  });

  it("throws when the channel does not exist", async () => {
    fetchMock.mockResolvedValue(null);

    await expect(sender.send("nope", "hi")).rejects.toThrow(
      "Channel nope not found or not sendable",
    );
  });

  it("throws when the channel is not sendable", async () => {
    const send = jest.fn();
    fetchMock.mockResolvedValue({ isSendable: () => false, send });

    await expect(sender.send("channel-1", "hi")).rejects.toThrow(
      "Channel channel-1 not found or not sendable",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/jest src/discord/__tests__/channel-sender.service.spec.ts -v`
Expected: FAIL — `Cannot find module '../channel-sender.service'`.

- [ ] **Step 3: Implement the sender**

Create `discord/channel-sender.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { Client, type MessageCreateOptions } from "discord.js";

@Injectable()
export class ChannelSenderService {
  constructor(private readonly client: Client) {}

  async send(
    channelId: string,
    options: string | MessageCreateOptions,
  ): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) {
      throw new Error(`Channel ${channelId} not found or not sendable`);
    }
    await channel.send(options);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/jest src/discord/__tests__/channel-sender.service.spec.ts -v`
Expected: 3/3 pass.

- [ ] **Step 5: Rewire the dispatcher, delete the helper**

In `features/dispatch/ebird-dispatcher.service.ts`:

Replace the import

```ts
import { DiscordHelper } from "@/discord/discord.helper";
```

with

```ts
import { ChannelSenderService } from "@/discord/channel-sender.service";
```

Replace the constructor with:

```ts
  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly sender: ChannelSenderService,
  ) {}
```

Replace the send call at the end of `sendGroupedEBirdAlert` with:

```ts
    try {
      await this.sender.send(channelId, { embeds: [embed] });
    } catch (err) {
      this.logger.error(`Failed to send embed to channel: ${err}`);
    }
```

Then:

```bash
git rm apps/scrubjay-discord/src/discord/discord.helper.ts
```

Replace `discord/discord.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { ChannelSenderService } from "./channel-sender.service";
import { ListenersModule } from "./listeners/listeners.module";
import { UtilCommands } from "./util.commands";

@Module({
  exports: [ChannelSenderService],
  imports: [ListenersModule],
  providers: [ChannelSenderService, UtilCommands],
})
export class DiscordModule {}
```

(`DispatchModule` already imports `DiscordModule`, so `EBirdDispatcherService` resolves `ChannelSenderService` with no further wiring.)

- [ ] **Step 6: Run the full suite and typecheck**

Run: `./node_modules/.bin/jest` — all green, plus one new suite (+3 tests).
From repo root: `pnpm run check-types` — 2 successful turbo tasks. Also verify no stragglers: `grep -rn "DiscordHelper" apps/scrubjay-discord/src` → no matches.

- [ ] **Step 7: Lint and commit**

```bash
pnpm run format-and-lint:fix
git add -A apps/scrubjay-discord/src
git commit -m "refactor(discord): replace DiscordHelper with ChannelSenderService"
```

---

### Task 7: `lifecycle.update.ts` + final layout

**Files:**
- Create: `apps/scrubjay-discord/src/discord/lifecycle.update.ts`
- Modify: `apps/scrubjay-discord/src/discord/discord.module.ts`
- Delete: `apps/scrubjay-discord/src/discord/listeners/` (lifecycle-listener.service.ts, listeners.module.ts)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LifecycleUpdate` provider (`@Once(Events.ClientReady)` presence). `DiscordModule` reaches its final shape: providers `ChannelSenderService`, `LifecycleUpdate`, `UtilCommands`; exports `ChannelSenderService`; no imports.

- [ ] **Step 1: Create the update class**

Create `discord/lifecycle.update.ts` (content of `lifecycle-listener.service.ts` with the Necord-convention name and `@Once` — `ClientReady` fires once per session, so behavior is unchanged):

```ts
import { Injectable } from "@nestjs/common";
import { ActivityType, Events } from "discord.js";
import { Context, type ContextOf, Once } from "necord";

@Injectable()
export class LifecycleUpdate {
  @Once(Events.ClientReady)
  async onClientReady(@Context() [client]: ContextOf<Events.ClientReady>) {
    client.user.setActivity("looking for birds...", {
      type: ActivityType.Custom,
    });
  }
}
```

- [ ] **Step 2: Delete `listeners/` and finish `DiscordModule`**

```bash
git rm -r apps/scrubjay-discord/src/discord/listeners
```

Replace `discord/discord.module.ts` with:

```ts
import { Module } from "@nestjs/common";
import { ChannelSenderService } from "./channel-sender.service";
import { LifecycleUpdate } from "./lifecycle.update";
import { UtilCommands } from "./util.commands";

@Module({
  exports: [ChannelSenderService],
  providers: [ChannelSenderService, LifecycleUpdate, UtilCommands],
})
export class DiscordModule {}
```

- [ ] **Step 3: Verify the final layout**

Run: `find apps/scrubjay-discord/src/discord -type f | sort`
Expected exactly:

```
apps/scrubjay-discord/src/discord/__tests__/channel-sender.service.spec.ts
apps/scrubjay-discord/src/discord/__tests__/necord-options.spec.ts
apps/scrubjay-discord/src/discord/channel-sender.service.ts
apps/scrubjay-discord/src/discord/common/filters/__tests__/command-exception.filter.spec.ts
apps/scrubjay-discord/src/discord/common/filters/command-exception.filter.ts
apps/scrubjay-discord/src/discord/discord.module.ts
apps/scrubjay-discord/src/discord/lifecycle.update.ts
apps/scrubjay-discord/src/discord/necord-options.ts
apps/scrubjay-discord/src/discord/util.commands.ts
```

- [ ] **Step 4: Full suite, typecheck, lint**

Run: `./node_modules/.bin/jest`
Expected: all green — 17 suites / 83 tests (16/64 baseline: +3 config, −7 deleted reaction specs, +15 reactions, ±0 service, +5 filter, ±0 commands move, +3 sender).

From repo root: `pnpm run check-types` (2 turbo tasks) and `pnpm run format-and-lint:fix` (clean).

- [ ] **Step 5: Commit**

```bash
git add -A apps/scrubjay-discord/src
git commit -m "refactor(discord): finish Necord-style layout (lifecycle.update, drop listeners)"
```

---

### Task 8: Changeset, push, PR

**Files:**
- Create: `.changeset/discord-surface-reorg.md`

**Interfaces:**
- Consumes: everything above, complete and green.
- Produces: an open PR.

- [ ] **Step 1: Add the changeset**

Create `.changeset/discord-surface-reorg.md`:

```markdown
---
"scrubjay-discord": patch
---

Reorganize the Discord surface the Necord way (§7): the 6-file reaction
router/explorer/decorator chain collapses into `FiltersReactions`, a single
Necord handler in the filters slice (which now calls `FiltersRepository`
directly — the pass-through `FiltersService` is gone). Slash commands move
into their feature slices (`/sub-ebird` → subscriptions, `/ping` →
`discord/util.commands.ts`) behind one `CommandExceptionFilter` that logs
stacks server-side and replies generically (typed `InvalidRegionError`
messages pass through verbatim). `/sub-ebird` now defers its reply, removing
the 3-second-window failure mode. `DiscordHelper` shrinks to
`ChannelSenderService.send()` (~85 dead lines deleted).

Behavior changes: the 👎-filter threshold is now `FILTER_REACTION_THRESHOLD`
(default 3), and species names containing " - " are parsed correctly from
embed titles (B2-residual).
```

- [ ] **Step 2: Final verification**

From `apps/scrubjay-discord/`: `./node_modules/.bin/jest` — all green.
From repo root: `pnpm run check-types` && `pnpm run format-and-lint:fix` — clean.

- [ ] **Step 3: Commit, push, open PR**

```bash
git add .changeset/discord-surface-reorg.md
git commit -m "chore: add changeset for discord surface reorg"
git push -u origin refactor/discord-surface
gh pr create --repo drewbxyz/scrubjay --head refactor/discord-surface \
  --title "refactor: organize the Discord surface the Necord way (§7)" \
  --body "$(cat <<'EOF'
Implements `docs/superpowers/specs/2026-07-08-discord-surface-reorg-design.md` (§7 of `docs/architecture-improvements.md`, plus the filters half of §4).

## What moved

- **7a** — the 6-file reaction chain (listener → router → explorer → decorator → interface → handler) collapses into `features/filters/filters.reactions.ts`, one Necord `@On` handler. `FiltersService` (pure pass-through) is deleted; the controller calls `FiltersRepository` directly.
- **7b** — `/sub-ebird` lives in `features/subscriptions/subscriptions.commands.ts` (+ options DTO), `/ping` in `discord/util.commands.ts`. Both sit behind one `CommandExceptionFilter`: typed `InvalidRegionError` messages pass through verbatim, everything else gets a generic reply with the full error + stack logged server-side.
- **7c** — `DiscordHelper` (111 lines, 3 of 4 methods dead) becomes `ChannelSenderService.send()`, which throws instead of returning `false`; the dispatcher's existing per-send catch is the single error boundary.
- `discord/` drops from 15 source files to 6 and contains only cross-cutting infra.

## Behavior changes

- `/sub-ebird` defers its reply (removes the `Unknown interaction` 3-second-window failure mode).
- The 👎-filter threshold is `FILTER_REACTION_THRESHOLD` (default 3, validated ≥ 1).
- Species names containing `" - "` parse correctly from embed titles (B2-residual: parse on the last separator).

## Out of scope (per spec)

Region autocomplete, remaining §4 pass-throughs, §6 fetcher validation, any schema change.

Plan: `docs/superpowers/plans/2026-07-08-discord-surface-reorg.md`
EOF
)"
```

Expected: PR opens against `main`; CI (typecheck + tests) green.
