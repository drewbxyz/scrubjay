---
"scrubjay-discord": patch
---

Reorganize the Discord surface the Necord way (§7): the 6-file reaction
router/explorer/decorator chain collapses into `FiltersReactions`, a single
Necord handler in the filters slice (which now calls `FiltersRepository`
directly — the pass-through `FiltersService` is gone). Slash commands move
into their feature slices (`/sub-ebird` → subscriptions, `/ping` →
`discord/util.commands.ts`) behind one `CommandExceptionFilter` that logs
stacks server-side and replies generically (typed `UserFacingError`
messages, such as `InvalidRegionError`, pass through verbatim). `/sub-ebird`
now defers its reply, removing the 3-second-window failure mode.
`DiscordHelper` shrinks to `ChannelSenderService.send()` (~85 dead lines
deleted).

Behavior changes: the 👎-filter threshold is now `FILTER_REACTION_THRESHOLD`
(default 3), and species names containing " - " are parsed correctly from
embed titles (B2-residual).
