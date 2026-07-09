# Design: Discord surface reorganization (§7)

**Date:** 2026-07-08
**Status:** Approved
**Source:** `docs/architecture-improvements.md` §7 (7a/7b/7c), re-verified against
main (post PR #64/#65) on 2026-07-08. Folds in the filters half of §4
(`FiltersService` deletion) and two review follow-ups that land naturally here
(typed `InvalidRegionError`, filter-threshold config). Ships as one PR on
`refactor/discord-surface`.

**Decisions made during brainstorming:**
- B2-residual: keep parsing the species from the embed title (owner's call) —
  harden the parse instead of adding a stable id. No schema migration, no
  AlertQueue changes.
- Region autocomplete for `/sub-ebird`: deferred to a follow-up.
- `FiltersService` (pure pass-through, §4): deleted here; the reactions
  controller calls `FiltersRepository` directly.

## Target layout

```
src/
  app.module.ts                    # imports Discord, Filters, Subscriptions, Jobs, …
  discord/                         # cross-cutting Discord infra ONLY
    discord.module.ts
    channel-sender.service.ts      # slimmed DiscordHelper: one send()
    lifecycle.update.ts            # presence on ClientReady
    util.commands.ts               # /ping
    common/filters/command-exception.filter.ts
    necord-options.ts              # unchanged
  features/
    filters/
      filters.reactions.ts         # controller: the whole 👎 chain in one file
      filters.repository.ts        # unchanged queries
      filters.module.ts
    subscriptions/
      subscriptions.commands.ts    # /sub-ebird controller
      options/subscribe-ebird.options.ts
      invalid-region.error.ts
      subscriptions.service.ts     # throws InvalidRegionError; no error wrapping
      subscriptions.repository.ts  # unchanged
      subscriptions.module.ts
```

**Deleted (15 source files, 4 reborn in new homes):**
`discord/reaction-router/` (5 files), `discord/listeners/` (3 files: reaction
listener, listeners module, lifecycle listener — the last reborn as
`discord/lifecycle.update.ts`), `discord/commands/` (4 files: dto, module,
subscription-commands, util-commands — dto and both command classes reborn in
their new homes), `discord/discord.helper.ts`,
`features/filters/handlers/filters-add.handler.ts`,
`features/filters/filters.service.ts`. Net: the `discord/` folder drops from
15 source files to 6.

## 7a — Reaction plumbing collapses to one controller

`features/filters/filters.reactions.ts`, a single Necord handler that inlines
the listener → router → explorer → decorator → interface → handler chain:

```ts
@Injectable()
export class FiltersReactions {
  // deps: FiltersRepository, ConfigService<AppConfig, true>

  @On(Events.MessageReactionAdd)
  async onReactionAdd(@Context() [reaction, user]: ContextOf<Events.MessageReactionAdd>) {
    // 1. if (user.partial) fetch, log-and-return on failure   (B9, verbatim from listener)
    // 2. if (user.bot) return
    // 3. if (reaction.partial) fetch, log-and-return on failure
    // 4. if (reaction.emoji.name !== "👎") return
    // 5. if (reaction.count < threshold) return               (threshold from config)
    // 6. if (!await repo.isChannelFilterable(channelId)) return
    // 7. parse species from embed title; return if absent
    // 8. await repo.addChannelFilter(channelId, name), log errors (never throw)
  }
}
```

Guard order preserves the current listener + handler semantics exactly.

**Threshold config:** `config.schema.ts` gains
`FILTER_REACTION_THRESHOLD: z.coerce.number().int().min(1).default(3)`, read
via the typed `ConfigService` (`{ infer: true }`).

**Hardened title parse (B2-residual):** the embed title is
`` `${comName} - ${county}` `` and county names never contain `" - "`, so parse
from the right:

```ts
const idx = title.lastIndexOf(" - ");
const speciesCommonName = idx === -1 ? title : title.slice(0, idx);
```

A species name containing `" - "` now survives; a title with no separator
falls back to the whole title (current behavior). Note the `idx === -1` guard
is load-bearing — `slice(0, -1)` would silently chop the last character.

**§4 fold-in:** `FiltersService` is deleted; `FiltersReactions` injects
`FiltersRepository` directly. `FiltersModule` provides both, exports nothing
(no other module consumes filters — the AlertQueue query does its own join).

## 7b — Commands move into their feature slices

**`/sub-ebird`** → `features/subscriptions/subscriptions.commands.ts`, DTO at
`options/subscribe-ebird.options.ts` (content of today's `commands.dto.ts`).
Handler shape:

```ts
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
await this.subscriptions.subscribeToEBird(interaction.channelId, region);
return interaction.editReply({ content: `Subscribed to eBird observations for ${region}.` });
```

`deferReply` removes the `Unknown interaction` failure mode (DB work inside
Discord's 3-second window). No try/catch in the handler — errors go to the
exception filter.

**`/ping`** → `discord/util.commands.ts`, content unchanged apart from the
`@UseFilters` annotation and dropping its dead try/catch (the filter is the
error boundary; the `console.error` there was unreachable-in-practice noise).

**Typed error:** `features/subscriptions/invalid-region.error.ts`:

```ts
export class InvalidRegionError extends Error {
  constructor(readonly regionCode: string) {
    super(`Invalid region code: ${regionCode}`);
    this.name = "InvalidRegionError";
  }
}
```

`SubscriptionsService.parseRegionCode` throws it; the service stops wrapping
repository errors (`Failed to subscribe to eBird: ${err}` wrapper deleted) —
they propagate raw to the filter, which logs them with stack.

## Exception filter — one error boundary for all commands

`discord/common/filters/command-exception.filter.ts`, the necord/toolkit
pattern:

- `@Catch()` filter; gets `[interaction]` via `NecordArgumentsHost`.
- Reply content: `err instanceof InvalidRegionError` → `err.message`
  verbatim; anything else → `"Something went wrong running that command."`
  Always ephemeral.
- Uses `editReply` when the interaction is already deferred/replied,
  `reply` otherwise.
- Logs the full error with stack (`logger.error(message, err.stack)`) —
  starts the logger stack-trace convention the review follow-up asked for.
- No constructor dependencies, so `@UseFilters(CommandExceptionFilter)` on
  both command classes needs no provider registration.

This preserves PR #64's B10 behavior (invalid-region passes through,
everything else generic, full error server-side) while deleting the
per-command try/catch and the string-match on `error.message`.

## 7c — DiscordHelper shrinks to ChannelSenderService

`discord/channel-sender.service.ts`, one method:

```ts
async send(channelId: string, options: string | MessageCreateOptions): Promise<void> {
  const channel = await this.client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Channel ${channelId} not found or not sendable`);
  }
  await channel.send(options);
}
```

- `isSendable()` already implies text-based — the double guard collapses.
- **Throws instead of returning `false`**: `EBirdDispatcherService`'s existing
  try/catch around the send (`ebird-dispatcher.service.ts:127-131`) becomes
  the single error boundary; the helper's swallow-and-log double-logging
  disappears. The dispatcher's per-send catch keeps one bad channel from
  aborting the batch (B8 semantics unchanged).
- Dispatcher call site: `this.sender.send(channelId, { embeds: [embed] })`.
- The three dead methods (`sendEmbedsToChannel`, `sendMessageToChannel`,
  `getChannel`, ~85 lines) die with `discord.helper.ts`.

## Lifecycle + module wiring

- `lifecycle.update.ts`: class `LifecycleUpdate`, `@Once(Events.ClientReady)`
  (was `@On`; ClientReady fires once per session — `@Once` is the idiomatic
  form and behavior is unchanged), same presence content.
- `DiscordModule`: providers `ChannelSenderService`, `LifecycleUpdate`,
  `UtilCommands`; exports `ChannelSenderService`. No feature imports — the
  inverted dependency (discord importing filters) disappears.
- `SubscriptionsModule`: adds `SubscriptionsCommands` to providers.
- `AppModule`: imports gain `FiltersModule` and `SubscriptionsModule`
  (previously reached via `DiscordModule` → `CommandsModule`).

## Testing

All existing behavior keeps its coverage; moved code moves its specs:

- `features/filters/__tests__/filters.reactions.spec.ts` — merge of the
  reaction-listener and filters-add specs (partial-user fetch incl. failure,
  bot skip, partial-reaction fetch incl. failure, wrong emoji, below
  threshold, non-filterable channel, missing embed/title, repo error
  swallowed, happy path) **plus new cases:** threshold read from config
  (e.g. threshold 5, count 4 → no insert), species name containing `" - "`
  parses fully, title without separator falls back to whole title.
- `features/subscriptions/__tests__/subscriptions.commands.spec.ts` — moved
  from `discord/commands/__tests__/`; asserts `deferReply` → `editReply`
  ordering and that errors propagate (no in-handler catch).
- `discord/common/filters/__tests__/command-exception.filter.spec.ts` — new:
  InvalidRegionError message passes through, generic message otherwise,
  `editReply` vs `reply` selection, error logged with stack.
- `subscriptions.service.spec.ts` — updated: `InvalidRegionError` instance
  asserted; repo-error wrapping assertions removed.
- `config.schema.spec.ts` — `FILTER_REACTION_THRESHOLD` default, coercion,
  and `min(1)` rejection.
- `filters.repository.spec.ts` (real-Postgres) — unchanged.
- Full suite green from `apps/scrubjay-discord/` (`./node_modules/.bin/jest`,
  Docker running); lint (`pnpm run format-and-lint:fix`) and
  `pnpm run check-types` clean from repo root.

## Out of scope

- Region autocomplete for `/sub-ebird` (deferred by decision above).
- §4's remaining pass-throughs (`SourcesService`, dead eBird chain).
- §6 fetcher validation.
- Any schema/migration change (`filtered_species` stays name-keyed).
- Remaining review follow-ups not named here (bootstrap `.catch`, migration
  pool `.end()`, `PORT` bounds, `DISCORD_CLIENT_ID` removal, repo-wide logger
  stack-trace sweep).
