# Paginated, interactive subscription list

**Date:** 2026-07-09
**Feature:** `/subscription list` — a paginated, manage-in-place view of a channel's
eBird subscriptions, with inline removal.

## Goal

Replace the stub `onSubscriptionList` command with an interactive Discord surface that:

- shows a channel's subscriptions as an embed, 10 per page;
- lets the user page with Prev/Next buttons;
- lets the user remove a subscription by picking it from a select menu, re-rendering
  the page in place.

## State model — stateless, page encoded in the `customId`

Discord component handlers are global and fire long after the originating command
scope is gone, so no state is held in memory. Every interaction re-queries the
channel's subscriptions and re-renders. This is cheap: per-channel counts are small
(tens), so there is no DB-level pagination — we fetch all rows and slice in-app.

- `channelId` comes free off `interaction.channelId` on every component interaction,
  so it is never encoded.
- `page` is carried in parameterized custom IDs (necord `@ComponentParam`):
  - `subscription/list/nav/:page` — both Prev and Next buttons; the button carries the
    target page number.
  - `subscription/list/remove/:page` — the select menu; carries the page to re-render
    after a removal.

Interaction flow: click → parse `page` → `listSubscriptions(channelId)` → rebuild view
→ `interaction.update(...)`.

## Structure — pure view builder + thin handlers

Mirrors the existing `planEBirdAlerts` / `buildEBirdAlertEmbed` split in
`ebird-alert.formatter.ts`: rendering is a pure function with no Discord I/O, so it is
unit-testable in isolation.

```
subscription-list.view.ts    buildSubscriptionListView(subs, page): InteractionReplyOptions
                             — owns PAGE_SIZE = 10, slicing, page clamping, empty state,
                               embed + select row + button row. Pure.
subscriptions.commands.ts    onSubscriptionList (slash) + @Button nav + @StringSelect remove.
                             All four handlers just call the view builder.
subscriptions.service.ts     listSubscriptions(channelId) returns rows.
```

The three interactive handlers are thin: resolve `page`, hit the service, and (for
remove) delete then re-render. All layout logic lives in the one pure function.

## Removal wiring

- The region code is recoverable from a row — the county code for a county sub, or
  the state code when the county is `*` — so the select-option `value` carries that
  region code directly.
- The remove handler feeds the value straight back into the existing
  `service.unsubscribe(channelId, regionCode)`; no new service method and no exact-key
  variant are needed.

## Edge cases

- **Page clamp:** removing the last item on the last page, or navigating past the end,
  clamps to the new last valid page. The view builder owns this so every handler
  benefits.
- **Empty state:** last subscription removed → embed reads "No subscriptions" and
  components are dropped (`components: []`).
- **Ephemeral + token expiry:** the message is ephemeral; components work until
  Discord's ~15-minute interaction-token window closes, after which clicks fail. This
  is acceptable for a management UI — no refresh-token handling is built.
- **3-second rule:** the remove handler performs a DB write, so it `deferUpdate()`s
  first when needed.

## Testing

- Unit-test `buildSubscriptionListView` directly (pure): pagination slicing, page
  clamping, empty state, select-option values, disabled Prev/Next at bounds.
- Service test for `listSubscriptions` delegating to the repository.
- Command tests for the list/nav/remove handlers (ephemeral reply, in-place
  re-render, defer-then-unsubscribe ordering).
