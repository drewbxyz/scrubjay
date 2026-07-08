---
"scrubjay-discord": patch
---

Swat seven latent bugs (B1, B3, B6–B10), each with a regression test:

- **B1** — `isChannelFilterable` never awaited its query, so a 👎 reaction in any channel could insert a filter row; the guard now actually guards.
- **B3** — eBird upserts spread raw API keys into `onConflictDoUpdate`, which drizzle silently dropped; location renames and privacy changes now propagate via explicit column mappings.
- **B6** — a failed bootstrap no longer sets `bootstrapComplete` in a `finally`; startup now fails fast instead of unblocking dispatch into a stale-alert burst.
- **B7** — bootstrap timeout rejects with a named `Error("Bootstrap timed out after 5 minutes")` instead of a bare `reject()`.
- **B8** — `DispatchJob.run` catches and logs failures instead of emitting an unhandled rejection every minute.
- **B9** — the reaction listener resolves partial users before reading `user.bot`.
- **B10** — `/sub-ebird` no longer interpolates raw error text into Discord replies; invalid-region messages pass through, everything else gets a generic message with the full error logged server-side.

Spec: `docs/superpowers/specs/2026-07-07-bug-swat-design.md`
