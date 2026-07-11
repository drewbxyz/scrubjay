---
"scrubjay-discord": patch
---

Add operational counters for the critical-health dashboard: `scrubjay.ingest.records{region}` (eBird observations upserted per ingest) and `scrubjay.dispatch.alerts{status}` (alert delivery outcomes — sent, failed, transient, suppressed, expired). Note: `transient` counts retry attempts, not unique alerts, so `sent + failed + transient` is not a partition of unique alerts.
