---
"scrubjay-discord": patch
---

Fix `scrubjay.job.runs` / `scrubjay.job.duration` emitting their job identity
under the attribute key `job`, which collides with Prometheus's reserved `job`
target label (OTLP ingestion sets `job` = `service.name`). Every series
therefore showed `job="scrubjay-discord"` and per-job filtering matched
nothing. The attribute is now `job_name`, so filtering by `dispatch`/`ingest`/…
works.
