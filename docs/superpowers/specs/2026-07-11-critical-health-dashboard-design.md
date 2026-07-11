# ScrubJay — Critical Health Dashboard

**Date:** 2026-07-11
**Status:** Approved for planning

## Goal

A single Grafana dashboard that answers, at a glance and in priority order:

1. **Is it alive?** — bot, cron jobs, and telemetry all still ticking (the "11:15 silent stall" detector).
2. **Is it healthy?** — operational RED view of the ingest → dispatch → delivery pipeline, Discord interactions, and Postgres.

Scope is deliberately narrow: this is a single-service app, so there is no service-topology story to tell. Dependency health (eBird, Discord) is folded into the pipeline rows, not given its own section.

## Two deliverables

### A. Code — two new counters

The dashboard needs delivery and ingest volume as first-class metrics. Today, alert outcomes live only in Postgres (`alertQueue.record`) and ingested-record counts are only logged. Add:

| Metric | Type | Attributes | Increment site |
|---|---|---|---|
| `scrubjay.dispatch.alerts` | Counter | `status` = `sent` \| `failed` \| `suppressed` \| `transient` | `dispatch.service.ts` (sent line ~53, permanent-failure line ~90, transient line ~82) and `bootstrap.service.ts` (suppressed line ~58) — alongside each existing `alertQueue.record(...)` / retry path |
| `scrubjay.ingest.records` | Counter | `region` | `ingest.service.ts` `ingestRegion` — add `batch.length` after successful upsert |

Notes:
- `status="failed"` counts only **permanent** failures (matches the DB `record(..,"failed")` semantics — transient sends are not recorded and stay pending). `status="transient"` is a separate, additive signal for Discord flakiness; it is not written to the DB.
- Both counters use the existing `getMeter("scrubjay-discord")` meter, matching the pattern already in `dispatch.service.ts` and the telemetry services.
- Unit tests assert the counter fires with the right `status`/`region` on each path, using the existing OTel test harness (`src/testing/otel-harness.ts`).

### B. Grafana dashboard JSON (importable)

Five rows, top-to-bottom by "what makes me panic." Metric names below are the **logical** OTel names; exact Prometheus names (dots→`_`, `_total` on counters, histograms → `_milliseconds_bucket/_sum/_count`) are **verified against the live metric browser at build time** before the JSON is finalized.

**Row 0 · Liveness** (stat tiles, green→red):
| Tile | Query | Red when |
|---|---|---|
| Heartbeat | `sum(increase(scrubjay_job_runs_total{job="dispatch"}[5m]))` (dispatch is `*/1`) | `0` |
| Ingest fresh | `sum(increase(scrubjay_job_runs_total{job="ingest"}[20m]))` (`*/15`) | `0` |
| Job failures | `sum(increase(scrubjay_job_runs_total{status="error"}[15m]))` | `> 0` |
| Command errors | `sum(increase(scrubjay_command_errors_total[15m]))` | `> 0` |

**Row 1 · Ingest → eBird:**
- eBird error rate: `traces_service_graph_request_failed_total{server="ebird"}` / `..request_total{server="ebird"}`
- Records ingested rate: `sum(rate(scrubjay_ingest_records_total[1h])) by (region)` (new counter)
- Ingest job p95 duration: `scrubjay_job_duration_milliseconds{job="ingest"}`

**Row 2 · Dispatch → delivery:**
- Queue depth timeseries: `scrubjay_dispatch_queue_depth`
- Alert outcomes: `sum(rate(scrubjay_dispatch_alerts_total[1h])) by (status)` (new counter) — sent vs failed vs suppressed vs transient
- Discord delivery errors: `traces_service_graph_request_failed_total{server="discord"}`
- Dispatch job p95 duration

**Row 3 · Discord interactions:**
- Command latency p50/p95 by `command`: `scrubjay_command_duration_milliseconds`
- Gateway reconnects rate: `scrubjay_discord_gateway_reconnects_total`

**Row 4 · Postgres:**
- Pool used vs idle: `db_client_connection_count` by `state`
- Pending requests: `db_client_connection_pending_requests` (sustained `>0` = saturation)
- Pool errors rate: `scrubjay_db_pool_errors_total`

**Dashboard settings:** default range last 6h, refresh 1m, single Prometheus datasource (the stack's hosted Prom that the metrics-generator writes to).

## Explicitly out of scope

- **Alerting rules.** The Heartbeat tile is the liveness surface; no paging rule until a recurrence proves the telemetry-silence class is worth alerting on.
- **Service-graph node fixes.** The `peer.service` tagging already works when traffic flows; the 11:15 gap was an emission stall, not a config gap.
- Runtime/process metrics (not currently emitted; no runtime instrumentation installed).

## Build order

1. Counters + tests (TDD), one changeset.
2. Verify exact Prometheus metric names in the live metric browser.
3. Author dashboard JSON against verified names; import and confirm each panel renders.
