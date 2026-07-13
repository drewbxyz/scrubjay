# Filtering — Stable Species Keys, Taxonomy Seam, and Command Surface

**Date:** 2026-07-13
**Status:** Draft
**Scope:** `apps/scrubjay-discord` filters feature, plus a `fetchTaxonomy()` addition
to the eBird ingest seam and a new `species` reference table

## Problem

A **Filter** is a channel-level species exclusion (`CONTEXT.md`). Today the entire
record is `filtered_species(channel_id, common_name)` (`drizzle.schema.ts`), and the
feature is wired end-to-end on the species' **common name as a display string**:

1. **Creation re-parses a rendered embed.** The only way to add a filter is a 👎
   reaction crossing `FILTER_REACTION_THRESHOLD`; `FiltersReactions` then recovers the
   species by string-slicing the embed title (`extractSpeciesNameFromTitle`,
   `lastIndexOf(" - ")` in `filters.reactions.ts`). The alert's structured
   `speciesCode` — carried on every `PendingEBirdAlert` and used as the alert's own
   identity (`speciesCode:subId`) — is thrown away by the formatter
   (`ebird-alert.formatter.ts`) and never reaches the message. The B2 bug
   (species names containing `" - "`) is one instance of a whole class: any change to
   the title layout silently breaks filtering.
2. **Matching is exact string equality on the common name.**
   `filteredSpeciesMatch()` joins `filtered_species.common_name = observations.common_name`
   (`alert-queue.repository.ts`). An eBird rename, a casing/whitespace drift, or a
   subspecies annotation is a silent miss. Common name is a presentation value, not a
   key.
3. **No proactive or reversible surface.** There is no `/filter` command group (unlike
   `/subscription`, which has `add`/`remove`/`list` — `subscriptions.commands.ts`). A
   channel can only mute a species *after* it has already been alerted, cannot list
   what it has muted, and cannot un-mute without hand-editing Postgres.
4. **`isChannelFilterable` is misnamed and ignores `active`.** It is a plain existence
   check on `channel_id` (`filters.repository.ts`) that reports `true` even for a
   channel whose subscriptions are all deactivated.

The root cause of 1, 2, and half of 3 is a single fact: **species identity lives in the
system only as a display string**, and the one authoritative `common_name ↔ species_code`
mapping (`observations`, 7-day retention) is not durable enough to key filters on.

## Decisions (made with owner, 2026-07-13)

1. **Filters key on `species_code`.** `common_name` is retained as a display/label
   column only. `species_code` is the match key.
2. **No user IDs / audit-actor columns.** Reaction-based creation makes an actor field
   awkward and it is not wanted. The table gains no `added_by`.
3. **The full eBird taxonomy is fetched as reference data**, not derived from
   `observations`. This is one API call on an existing seam and makes the
   `common_name → species_code` backfill *complete* rather than best-effort, so the
   migration can hard-cutover with no transitional dual-match.
4. **The taxonomy is persisted** in a `species` table (not fetch-and-discard), because
   the same data also backs proactive `/filter add` autocomplete and `/filter list`
   display, and permanently severs `common_name ↔ species_code` from `observations`.
5. **Species identity travels in the alert message** via a single-sourced encode/read
   contract, so the reaction path reads a structured field instead of parsing the title.

## Design

### 1. eBird taxonomy fetch — `EBirdFetcher.fetchTaxonomy()`

Add one method to `EBirdFetcher` (`ebird.fetcher.ts`), mirroring
`fetchRareObservations` exactly (base URL from `EBIRD_BASE_URL`, `X-eBirdApiToken`
header, `AbortController` timeout, per-row `safeParse`-and-skip):

```
GET /v2/ref/taxonomy/ebird?fmt=json&cat=species
```

Returns rows validated by a new `RawEBirdTaxonReport` zod schema in `ebird.schema.ts`,
projected to `{ speciesCode, comName, sciName }`. `cat=species` narrows the ~17k-row
payload to true species (dropping spuhs/hybrids/slashes that can never be a notable
observation's `species_code`); malformed rows are logged and skipped, never fatal.

### 2. Schema — `species` reference table

New table in `drizzle.schema.ts`:

- `species_code text PRIMARY KEY`
- `common_name text NOT NULL`
- `sci_name text NOT NULL`
- `index("species_common_name_idx").on(common_name)` — serves autocomplete and the
  migration backfill join.

This is cold reference data. eBird publishes a taxonomy update roughly once a year (the
October update); refresh is a manual reseed or a low-frequency job, out of any hot path.

### 3. Schema — `filtered_species` becomes code-keyed

Target shape:

- `channel_id text NOT NULL`
- `species_code text NOT NULL`
- `common_name text NOT NULL` — display snapshot; no longer part of the key
- `primaryKey({ columns: [channel_id, species_code] })`
- `index("filtered_species_channel_idx").on(channel_id)`

`filteredSpeciesMatch()` (`alert-queue.repository.ts`) flips from
`eq(filteredSpecies.commonName, observations.comName)` to
`eq(filteredSpecies.speciesCode, observations.speciesCode)`. Because
`species_code` is the key everywhere, common-name normalization (casing, whitespace,
subspecies) stops mattering — there is no name-match path left to normalize.

### 4. Migration (phased, no sharp edge)

1. **Seed `species`** from `fetchTaxonomy()`.
2. **Add `filtered_species.species_code`** nullable.
3. **Backfill** from the authoritative table:
   ```sql
   UPDATE filtered_species f SET species_code = s.species_code
   FROM species s WHERE s.common_name = f.common_name;
   ```
   This resolves every row whose name is a current eBird common name — including
   species not observed in the retention window, which is why `observations` alone was
   insufficient.
4. **Audit the residue.** Any row still `NULL` is genuine junk (a retired name, or a
   title-parse artifact from the old B2 slicing). Log each `(channel_id, common_name)`
   at warn level and **delete** it. There is no silent NULL and no lossy guessing — the
   migration reports exactly what it dropped.
5. **Hard cutover:** `species_code NOT NULL`, swap the primary key to
   `(channel_id, species_code)`, drop the old `common_name_channel_id_idx`.

No transitional dual-match (name OR code) is needed, because step 3 is complete.

### 5. Alert-message identity contract

Species identity travels with the alert so the reaction path never parses the title.
A single module owns both directions (new `alert-identity.ts` in the dispatch feature):

- `encodeAlertIdentity(alert)` — called by `buildEBirdAlertEmbed`
  (`ebird-alert.formatter.ts`); writes `species_code` into the embed footer
  (e.g. `eBird • {speciesCode}`), a dedicated data field, not the display title.
- `readAlertIdentity(message)` — called by `FiltersReactions`; returns
  `{ speciesCode, comName } | null` from the footer + title.

`extractSpeciesNameFromTitle` is deleted. The formatter and the reaction handler now
share one contract, so a title-layout change cannot break filtering. Messages sent
before this change carry no code; reacting to them is already outside the
dispatch/retention window, so no back-compat path is warranted (`readAlertIdentity`
returns `null` and the reaction is ignored, as it is today for an unparseable title).

`FiltersReactions.onReactionAdd` change: after the threshold and `active`-channel
checks, call `readAlertIdentity(message)` and `repo.addChannelFilter(channelId,
speciesCode, comName)` instead of the title slice.

### 6. Repository rename and `active` semantics

- `FiltersRepository.isChannelFilterable` → `channelHasActiveSubscriptions`, and the
  query gains `eq(channelEBirdSubscriptions.active, true)`. A filter on a channel that
  can no longer receive alerts is cruft; refusing it there matches intent and the new
  name states what the method checks.
- `addChannelFilter(channelId, speciesCode, commonName)` inserts all three columns,
  `onConflictDoNothing` on the new PK.

### 7. Command surface — `/filter` (unlocked by the `species` table)

A `FilterCommand` group mirroring `SubscriptionCommand` (`subscriptions.commands.ts`):
`Guild`-context, `Administrator`-gated, `CommandExceptionFilter`.

- `/filter add <species>` — a string option with **autocomplete** querying `species`
  by `common_name` prefix; resolves to `species_code`, so proactive muting no longer
  requires waiting for an alert.
- `/filter list` — ephemeral, paginated, reusing the subscription list view pattern
  (`subscription-list.view.ts`) over `common_name`.
- `/filter remove <species>` — select-menu removal off the list, parity with
  `onSubscriptionListRemove`.

This is the ease-of-use half of the change and reuses the subscription command
scaffolding wholesale; it depends only on §2 and §3.

## Testing

Extend `filters.reactions.spec.ts`, `filters.repository.spec.ts`,
`alert-queue.repository.spec.ts`, `ebird.fetcher.spec.ts`, and add
`alert-identity.spec.ts` and (for §7) `filters.commands.spec.ts`:

1. `fetchTaxonomy` parses a valid payload, skips malformed rows, throws on non-2xx and
   on timeout (parity with the `fetchRareObservations` cases).
2. `encodeAlertIdentity`/`readAlertIdentity` round-trip a `speciesCode`; `readAlertIdentity`
   returns `null` for a legacy message with no footer.
3. Reaction path stores `species_code` (not a title slice); a species whose common name
   contains `" - "` is unaffected (the B2 case is now structurally impossible).
4. `filteredSpeciesMatch` suppresses by `species_code`; a common-name rename in
   `observations` no longer leaks a filtered species.
5. `channelHasActiveSubscriptions` returns `false` when all of a channel's
   subscriptions are inactive.
6. Migration: name-keyed rows resolve to `species_code`; an unmappable row is logged and
   dropped; post-migration PK is `(channel_id, species_code)`.
7. `/filter add` autocomplete returns species-code-backed choices; `add`/`remove`/`list`
   round-trip and are `Administrator`-gated.

## Out of scope

- `guild`-level (server-wide) filters — the table stays channel-scoped.
- Filter expiry / temporary mutes, and non-species predicates (media count, per-county).
- Automatic taxonomy refresh scheduling — reseed is manual for now (§2).
- Reversing a filter by removing the 👎 reaction — `/filter remove` (§7) is the
  reversal surface.
