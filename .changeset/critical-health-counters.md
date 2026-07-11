---
"scrubjay-discord": patch
---

Add operational counters for the critical-health dashboard: `scrubjay.ingest.records{region}` (eBird observations upserted per ingest) and `scrubjay.dispatch.alerts{status}` (alert delivery outcomes — sent, failed, transient, suppressed).
