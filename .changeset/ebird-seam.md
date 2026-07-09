---
"scrubjay-discord": patch
---

Make the eBird fetcher seam honest (§6): `fetchRareObservations` now
validates every row against `RawEBirdObservationSchema` (malformed rows are
logged and skipped) and throws on HTTP failure instead of silently
returning an empty batch. The location shape is mapped in one place
(`upsertLocation` reads it off the observation; `extractLocation` and the
`EBirdLocation`/`EBirdObservationResponse` types are gone). Pass-through
`SourcesService` and the dead `getObservationsSinceCreatedDate` chain are
deleted (§4). `EBirdIngestJob.run` gets the same whole-body try/catch as
`DispatchJob.run`; a DB failure during startup bootstrap now fails fast
instead of booting with zero regions.
