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

## Metric semantics

**`scrubjay_dispatch_alerts_total` by `status`:** `transient` counts retry
attempts, not unique alerts — one alert failing transiently over K ticks
increments `transient` K times and may later also increment `sent`.
`sent + failed + transient + expired` is therefore NOT a partition of unique
alerts. A stacked or percentage panel over `status` should treat
`transient`/`expired` as attempt-rate signals, not shares of a total.

The `scrubjay.*` OTel instrument names reach Prometheus with the standard
OTLP→Prometheus mangling (dots → `_`; counters gain a `_total` suffix;
`ms`-unit histograms become `_milliseconds_bucket` / `_sum` / `_count`;
gauges and up-down counters keep their base name). A starter "Critical
Health" Grafana dashboard is maintained outside this repo (in Grafana); it
is intentionally not version-controlled here.
