# Management Portal — Design

**Date:** 2026-07-13
**Status:** Approved (pending spec review)

## Summary

An optional web portal for bot operators to manage ScrubJay without slash
commands or psql: CRUD for Subscriptions and Filters, plus read-only ops views
(observations, deliveries, pending alerts, ingest regions, job health). Built
as a TanStack Start app backed by a new REST API on the existing
`scrubjay-discord` NestJS app.

## Requirements

- **Audience:** bot operators only. Guild-admin access is a possible future
  expansion with its own privacy requirements — explicitly out of scope now,
  but auth choices should not paint us into a corner.
- **Scope (v1):**
  - Subscriptions CRUD — create/edit/toggle/delete any channel's subscriptions
    centrally (today only possible via `/subscribe` in the target channel).
  - Filters CRUD — list/add/remove per-channel species filters (today
    write-only via 👎 reaction; no way to list or remove).
  - Read-only ops views — observations, deliveries, pending alerts (the
    AlertQueue's view), derived ingest regions, job/health status. Supports
    "why didn't channel X get alert Y" debugging.
- **Sources stay derived.** Ingest regions remain
  `SELECT DISTINCT state_code FROM channel_ebird_subscriptions`
  (`SourcesRepository`). No sources table, no sources CRUD. The portal shows a
  read-only view of which states are ingested and which subscriptions drive
  them. (Considered and rejected: promoting sources to a first-class table.)
- **Channel UX:** creating a subscription browses real guilds/channels from the
  bot's live Discord client, permission-checked — not raw channel ID entry.
  This requirement is why the API must live in the bot process.
- **Exposure:** assume public internet (likely behind a tunnel, but design for
  real auth regardless). Only the portal is ever exposed; the bot API stays on
  the internal Docker network.
- **Optional add-on:** the bot must run exactly as today when no portal is
  deployed.

## Architecture

Three parts in the monorepo:

### `apps/scrubjay-discord` — new `src/api` module

REST controllers under `/api/v1/*` on the existing Express server (the one
already serving `/health`). Controllers are thin: they call the existing
services/repositories (subscriptions, filters, AlertQueue, observation repo),
so slash commands and portal writes share one domain path — no duplicated
validation, no drift. Honors the CONTEXT.md invariant that the AlertQueue is
the only reader/writer of Pending and Delivery semantics.

The module registers itself only when an API token is configured
(`SCRUBJAY_API_TOKEN` unset → module not loaded → bot behaves exactly as
today).

### `apps/scrubjay-portal` — new TanStack Start app

All data access goes through TanStack Start server functions, which call the
bot API over the Docker network. The browser never talks to the bot API and
the API token never reaches the client.

### `packages/api-contracts` — shared zod contracts

Zod schemas for every endpoint's params/body/response, imported by both apps;
types inferred, no codegen. The bot validates inbound requests with them; the
portal parses responses with them.

### Deployment

Portal is a new container in the existing compose stack. Public exposure
(tunnel/reverse proxy) terminates at the portal only. Bot API traffic is
traced by the existing OTel Express/Nest instrumentation for free; portal
OTel instrumentation is a later nice-to-have, not v1.

## Auth

Two distinct trust boundaries:

**Browser → portal:** Better Auth with Discord as the social provider.
Sessions and user records live in Better Auth's own tables in the same
Postgres, via a drizzle adapter — owned and migrated by the portal app; the
bot's schema is untouched. Authorization is an env allowlist of operator
Discord user IDs; anyone else can authenticate but gets a 403 page.
Guild-admin expansion later means new authorization rules, same login.

**Portal server → bot API:** static bearer token from env on both sides,
enforced by a Nest guard on the whole `/api/v1` router. Sufficient because
the only caller is server-side code the operator runs; revisit if the API
ever gains a second consumer.

## Bot API surface (v1)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/guilds` | Guilds the bot is in, each with text channels where the bot can post (permission-checked via Discord client). Powers the channel picker. |
| `GET /api/v1/subscriptions` | List, filterable by channel/state. |
| `POST /api/v1/subscriptions` | Create; same validation as `/subscribe`. |
| `PATCH /api/v1/subscriptions/...` | Toggle `active`. |
| `DELETE /api/v1/subscriptions/...` | Delete. |
| `GET /api/v1/channels/:channelId/filters` | List a channel's species filters. |
| `POST /api/v1/channels/:channelId/filters` | Add filter (free-text common name, matching 👎 semantics). |
| `DELETE /api/v1/channels/:channelId/filters/...` | Remove filter. |
| `GET /api/v1/regions` | Read-only derived ingest states + the subscriptions driving each. |
| `GET /api/v1/observations` | Paginated; filter by state/county/species/date. |
| `GET /api/v1/deliveries` | Paginated; filter by channel/status/alert. |
| `GET /api/v1/alerts/pending` | The AlertQueue's pending view, for alert debugging. |
| `GET /api/v1/ebird/regions/:stateCode/counties` | Cached proxy to eBird's region API, for county pickers. |

Subscription identity is the composite key `(channelId, stateCode,
countyCode)`; PATCH/DELETE address it via those three values.

## Portal app

- **Pages:** Dashboard (job health, ingest regions, recent delivery
  failures) · Channels (guild → channel tree; channel page shows its
  subscriptions and filters with inline CRUD) · Observations explorer ·
  Deliveries & pending alerts debug view.
- **Stack:** TanStack Start + Router + Query; Tailwind + shadcn/ui.
- Destructive actions (delete subscription, remove filter) confirm first.

## Error handling

One error envelope in the contracts package: `{ error: { code, message } }`.
Zod validation failures → 400 with field details. The portal maps error codes
to toasts/inline errors.

## Testing

Repo conventions apply (vitest everywhere):

- **Bot:** controller + guard tests using the existing Nest testing +
  testcontainers setup.
- **Contracts:** round-trip parse tests in the package.
- **Portal:** server-function tests with the bot API faked at the contract
  boundary; component tests where behavior warrants.

## Out of scope (v1)

- Guild-admin access and its privacy model.
- Sources/regions CRUD (sources stay derived).
- Portal-side OTel instrumentation.
- Any change to ingest/dispatch pipeline behavior.
