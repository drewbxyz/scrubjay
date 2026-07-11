# Observability

ScrubJay instruments itself with [OpenTelemetry](https://opentelemetry.io/)
and exports over **OTLP/HTTP (protobuf)**. OTLP is the contract, not a
product: point the bot at any OTLP endpoint — a self-hosted collector, a
SaaS free tier, or nothing at all. **No backend ships in this repo, and the
choice of one is left entirely to the operator.**

## The on-switch

Telemetry is **off by default**. If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset,
the SDK is never loaded — a fork gets zero observability, zero overhead, and
zero new runtime behavior.

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node dist/src/main.js
```

Standard OTel environment variables are honored (read by the SDK itself,
never re-invented):

| Variable | Meaning | Default |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP receiver base URL; the on-switch | unset (off) |
| `OTEL_SERVICE_NAME` | `service.name` resource attribute | `scrubjay-discord` |
| `OTEL_EXPORTER_OTLP_HEADERS` | e.g. auth headers for a hosted backend | — |
| `OTEL_RESOURCE_ATTRIBUTES` | extra resource attributes | — |
| `OTEL_TRACES_SAMPLER` / `_ARG` | sampling policy | `parentbased_always_on` |
| `OTEL_METRIC_EXPORT_INTERVAL` | metric push cadence (ms) | `60000` |
| `OTEL_LOG_LEVEL` | SDK self-diagnostics | — |

Only OTLP over HTTP/protobuf is wired; `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` is
not supported.

App-owned (non-OTel) knob: `LOG_LEVEL` — pino log level (`info` default).

## Signals

**Logs** — always-on structured JSON on stdout (pino). With telemetry
enabled, each line gains `trace_id`/`span_id` when inside a span, and log
records are also exported over OTLP.

**Traces** — root spans for every Discord interaction (named by command,
e.g. `subscription add`) and every cron run (`job dispatch`, `job ingest`,
`job retention`), with nested spans from auto-instrumented pg queries,
outbound HTTP (Discord REST, eBird), Express, and Nest handlers. `/health`
requests are not traced.

**Metrics** — pushed every `OTEL_METRIC_EXPORT_INTERVAL`:

| Metric | Type | What it tells you |
|---|---|---|
| `scrubjay.command.duration` (ms) | histogram | interaction latency, by `command` + `status` |
| `scrubjay.command.errors` | counter | handler failures, by `command` |
| `scrubjay.job.duration` (ms) | histogram | cron run duration, by `job` + `status` |
| `scrubjay.job.runs` | counter | cron outcomes, by `job` + `status` |
| `scrubjay.dispatch.queue.depth` | gauge | pending alerts per dispatch tick; rising = falling behind |
| `scrubjay.discord.gateway.reconnects` | counter | gateway instability, by `event` |
| `db.client.connection.count` | gauge | pg pool connections, by `state` (`used`/`idle`) |
| `db.client.connection.pending_requests` | gauge | callers waiting on a saturated pool |
| `scrubjay.db.pool.errors` | counter | idle pg client errors |

## Liveness

`GET /health` (on `PORT`, default 3000) is independent of telemetry and
suits any external uptime checker; the Docker `HEALTHCHECK` already probes
it. It reports DB connectivity plus ingest/dispatch freshness.

## Verifying against a throwaway receiver

No backend needed — run a scratch collector that prints everything it
receives:

```sh
cat > /tmp/otelcol.yaml <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces:   { receivers: [otlp], exporters: [debug] }
    metrics:  { receivers: [otlp], exporters: [debug] }
    logs:     { receivers: [otlp], exporters: [debug] }
EOF
docker run --rm -p 4318:4318 \
  -v /tmp/otelcol.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector:latest
```

Then start the bot with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
(e.g. in `apps/scrubjay-discord/.env`) and watch the collector's stdout:
spans appear as commands run and crons tick, metrics arrive every minute,
and every log line shows up as a log record.

## Critical Health dashboard

`observability/dashboards/critical-health.json` is an importable Grafana
dashboard model covering liveness (is dispatch/ingest running, are commands
and jobs failing), the ingest → eBird path, the dispatch → Discord delivery
path, Discord interaction latency, and the Postgres pool.

**Import:**

1. Grafana → Dashboards → New → Import.
2. Upload `observability/dashboards/critical-health.json` (or paste its
   contents).
3. When prompted for the `DS_PROM` variable, pick the Prometheus datasource
   backed by this stack's OTLP→Prometheus metrics.
4. Import, then confirm every panel renders (see the verification checklist
   below before trusting any panel that shows "No data").

**⚠️ VERIFY THESE NAMES before/after import.** This dashboard's queries were
authored from the *logical* OTel instrument names using the standard
OTLP→Prometheus mangling rules (dots → `_`; counters gain a `_total` suffix;
`ms`-unit histograms become `_milliseconds_bucket` / `_sum` / `_count`;
gauges and up-down counters keep their base name). Nobody has confirmed
these against the live metric browser yet — this dashboard has **not**
been imported or rendered against a real Grafana Cloud stack. Before
relying on it, open Grafana → Explore → the Prometheus datasource →
metric browser, and check each name below actually exists; fix any query
in the JSON whose name differs.

| Query uses | Expect to find |
|---|---|
| `scrubjay_job_runs_total` | counter, labels `job`, `status` |
| `scrubjay_job_duration_milliseconds_bucket` / `_sum` / `_count` | histogram, labels `job`, `status`, `le` |
| `scrubjay_command_errors_total` | counter, label `command` |
| `scrubjay_command_duration_milliseconds_bucket` / `_sum` / `_count` | histogram, labels `command`, `status`, `le` |
| `scrubjay_discord_gateway_reconnects_total` | counter, label `event` |
| `scrubjay_dispatch_queue_depth` | gauge, no `_total` suffix |
| `scrubjay_dispatch_alerts_total` | counter, label `status` |
| `scrubjay_ingest_records_total` | counter, label `region` |
| `scrubjay_db_pool_errors_total` | counter |
| `db_client_connection_count` | gauge, label `state` |
| `db_client_connection_pending_requests` | gauge |
| `traces_service_graph_request_total` / `traces_service_graph_request_failed_total` | Tempo/Grafana Agent service-graph metrics, label `server` |

If any name above doesn't match the metric browser, edit
`observability/dashboards/critical-health.json` directly (each panel's
`targets[].expr`), re-import, and confirm the panel now shows data.
