# ScrubJay

A Discord bot that alerts birding channels to notable eBird observations. Two
pipelines — ingest and dispatch — communicate only through Postgres.

## Language

**Observation**:
One species sighting on one eBird checklist, as ingested (deduped per species×checklist, media counts tallied).
_Avoid_: sighting, report (a "report" is what eBird returns, pre-dedup)

**Subscription**:
A channel's standing request for alerts in a region (state + county, or `*` for the whole state).
_Avoid_: source, feed

**Alert**:
An observation × channel pair that should be (or was) announced in Discord. Identity is `speciesCode:subId` per channel.
_Avoid_: notification, message

**AlertQueue**:
The deep dispatch module: decides which alerts are pending (matched, unfiltered, undelivered, with confirmation status) and records which were sent.
_Avoid_: dispatcher repository, deliveries service

**Pending**:
An alert that matches an active subscription, is not species-filtered for that channel, and has no delivery row yet.
_Avoid_: undelivered (delivery is only one of the three conditions)

**Delivery**:
The record that an alert was sent to a channel; the dedup ledger. Unique per (kind, alertId, channelId).
_Avoid_: sent log

**Filter**:
A channel-level species exclusion, keyed by common name (added by 👎 reaction).
_Avoid_: block, mute

**Recently confirmed**:
A species×location with a valid **and** reviewed observation within the last 7 days; shown green instead of yellow.
_Avoid_: verified

**Ingest**:
The pipeline that pulls eBird data into Postgres on a schedule. Never talks to Discord.

**Dispatch**:
The pipeline that turns pending alerts into Discord embeds and records deliveries. Never talks to eBird.

**Bootstrap**:
Startup pass that ingests everything and marks all pending alerts sent *without* sending, so a restart never floods channels.

## Relationships

- A **Subscription** belongs to one Discord channel; a channel may hold many.
- An **Observation** becomes a **Pending** **Alert** for every channel whose **Subscription** matches, minus **Filter** hits and existing **Deliveries**.
- The **AlertQueue** is the only reader/writer of **Pending** and **Delivery** semantics.
- **Bootstrap** must finish before **Dispatch** runs (jobs wait on it).

## Example dialogue

> **Dev:** "A user says their channel never got the Vermilion Flycatcher alert."
> **Domain expert:** "Ask the **AlertQueue** why it wasn't **pending**: no matching **Subscription** for that county, a **Filter** on that common name, or a **Delivery** already recorded — possibly by **Bootstrap** if the bot restarted after the observation was ingested."

## Flagged ambiguities

- "source" previously meant both an RSS feed and an eBird region to ingest. RSS is
  deleted; "source" now only appears in `SourcesService` as the list of state codes
  to ingest — candidate for renaming to **Region** when touched.
- "delivered" vs "sent": a delivery row means *recorded*, not necessarily
  successfully sent (send-then-record is at-least-once). Use **Delivery** for the
  record, "sent" for the Discord side effect.
