---
"scrubjay-discord": patch
---

Pipeline boundary refactor. Dispatch: send-then-record protocol moves into
DispatchService (replacing EBirdDispatcherService); a failed Discord send is
no longer recorded as delivered — the alert stays pending and retries until
it ages out of the dispatch window. Ingest: features/ebird becomes
features/ingest; location+observation persistence is one transactional
upsertObservation; eBird→domain field translation moves into the
transformer behind a domain Observation type. File names now follow the
NestJS <name>.<role>.ts convention and specs are co-located with sources.
