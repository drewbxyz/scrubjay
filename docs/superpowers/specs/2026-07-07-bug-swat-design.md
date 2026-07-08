# Design: bug swat — B1, B3, B6, B7, B8, B9, B10

**Date:** 2026-07-07
**Status:** Approved
**Source:** `docs/architecture-improvements.md` §2, all re-verified against main
(post PR #63) on 2026-07-07. Companion to
`2026-07-07-zod-config-seam-design.md` (which covers B4/B5); ships as a
**separate PR** from the config seam.

Every fix lands with a test; CI (PR #63) runs them.

## B1 — `isChannelFilterable` never awaits

`filters/filters.repository.ts:14` — `findFirst` is not awaited, so
`!!channelMeta` wraps a thenable and is always `true`. Any channel passes the
"is this an eBird channel" guard; three 👎 in any channel insert a filter row.

**Fix:** `await` the query.

**Test:** real-Postgres repository test (uses `testing/db-helpers`): `true` for
a channel with a seeded `channel_ebird_subscriptions` row, `false` for an
unknown channel.

## B3 — upsert on-conflict writes raw eBird keys

`ebird/ebird.repository.ts` — both `upsertLocation` (:28-34) and
`upsertObservation` (:57-64) do `set: { ...data }` in `onConflictDoUpdate`,
spreading eBird API field names (`subnational2Name`, `locName`,
`locationPrivate`, …) that match no DB column. Drizzle silently drops unknown
keys, so on update only `lat`/`lng`/`lastUpdated` (and coincidentally-named
fields) are written — location renames and privacy changes never propagate.

**Fix:** explicit column mapping in each `set`, mirroring the insert `values`
block (minus the conflict-target columns).

**Test:** real-Postgres — upsert the same `locId` twice with a changed
`locName`/`locationPrivate`, assert the row reflects the second payload. Same
shape for `upsertObservation` (e.g. changed `howMany`).

## B6 — failed bootstrap still unblocks jobs

`jobs/bootstrap.service.ts:83-86` — `bootstrapComplete = true` sits in a
`finally`, so a bootstrap that dies before `markSent` still unblocks dispatch,
which then fires a burst of stale alerts.

Per-region ingest failures are already caught individually and are fine to
tolerate. The dangerous failure is `pendingEBirdAlerts()`/`markSent()`
throwing.

**Fix (decision: fail fast):** remove the `finally`; set `bootstrapComplete =
true` only after `markSent` succeeds. If it throws, `onModuleInit` propagates
and the app fails to start — a crash beats spamming channels with old alerts.

**Test:** unit test with mocked `AlertQueue`: `markSent` rejects →
`onModuleInit` rejects and `waitForBootstrap` does not resolve; happy path →
resolves.

## B7 + B8 — unhandled rejections in the cron path

`bootstrap.service.ts:52` rejects with a bare `reject()` after the 5-minute
timeout, and neither that rejection nor `dispatchSince` errors are caught in
`jobs/dispatch.job.ts` — every failure is an unhandled rejection, once per
minute.

**Fix:**
- `reject(new Error("Bootstrap timed out after 5 minutes"))` in
  `waitForBootstrap`.
- Wrap the entire body of `DispatchJob.run` in try/catch: log the error, skip
  the tick.

**Test:** unit tests — `run()` resolves (does not throw) when
`waitForBootstrap` rejects and when `dispatchSince` rejects; error is logged.

## B9 — bot-guard reads `user.bot` on a possibly-partial user

`discord/listeners/reaction-listener.service.ts:15` — `user.bot` is read
before any partial handling; on a partial user `bot` is `null` and the guard
silently passes.

**Fix:** before the bot check, `if (user.partial) user = await user.fetch()`
— same pattern the method already uses for `reaction.partial` (including the
try/catch-and-return on fetch failure).

**Test:** unit test with a stubbed partial user: `fetch` is called before
`bot` is read; a bot user post-fetch is ignored; fetch failure → handler
returns without routing.

## B10 — raw error text leaks into Discord replies

`discord/commands/subscription-commands.service.ts:37` — the catch
interpolates `${error}` into the ephemeral reply.

The service throws two shapes deliberately: `Invalid region code: <input>`
(safe and useful — show it) and wrapped DB errors (internal — hide).

**Fix:** branch in the catch — invalid-region message passes through
verbatim; anything else replies "Something went wrong subscribing this
channel." The full error is still logged server-side.

**Test:** unit test the command handler with a mocked service: invalid-region
rejection → reply contains the region message; generic rejection → reply is
the generic string and contains no error internals.

## Out of scope

- **B2 residual** (species parsed from embed title text): the correct fix is a
  stable species identifier carried in the embed, which belongs to the §7
  Discord-surface reorg.
- **B4/B5:** covered by the zod config seam spec.
- **B11:** the turbo/CI half landed in PR #63; the dead `test:e2e` script goes
  with the tier-2 dead-code batch.
