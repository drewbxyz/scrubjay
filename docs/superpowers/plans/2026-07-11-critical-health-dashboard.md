# Critical Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit two new counters (alert-delivery outcomes, ingest volume) and ship an importable Grafana dashboard that surfaces ScrubJay liveness and operational health.

**Architecture:** Add `scrubjay.ingest.records{region}` in `IngestService` and `scrubjay.dispatch.alerts{status}` across `DispatchService` (sent/failed/transient) and `BootstrapService` (suppressed), reusing the existing `metrics.getMeter("scrubjay-discord")` pattern. Then author a Grafana dashboard JSON consuming these plus existing metrics, verifying exact Prometheus metric names against the live metric browser before finalizing.

**Tech Stack:** TypeScript, NestJS, `@opentelemetry/api`, Vitest, the in-memory OTel test harness (`src/testing/otel-harness.ts`), Grafana Cloud (Prometheus datasource).

## Global Constraints

- All metric instruments use `metrics.getMeter("scrubjay-discord")` (matches every existing telemetry site).
- Counters are `createCounter`; values are the affected row count (`refs.length` / `batch.length`).
- Same-named counter created in two files MUST use a byte-identical `description` so the OTel SDK dedupes it instead of warning about a conflicting instrument.
- Changesets required for user-facing/behavioral changes (repo uses `@changesets/cli`); patch bump for `scrubjay-discord`.
- Tests use the existing harness: `registerMetricHarness()` → `collect(name)` → `dataPoints`, DELTA temporality (each `collect` sees only points since the last flush).
- Run tests from `apps/scrubjay-discord` with `pnpm test` (Vitest).

---

### Task 1: `scrubjay.ingest.records` counter

**Files:**
- Modify: `apps/scrubjay-discord/src/features/ingest/ingest.service.ts`
- Test: `apps/scrubjay-discord/src/features/ingest/ingest.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: metric `scrubjay.ingest.records` (Counter, attribute `region`), Prometheus `scrubjay_ingest_records_total{region=...}`.

- [ ] **Step 1: Write the failing test**

Add to `ingest.service.spec.ts`. Import the harness at top and register it at module scope (mirror `dispatch.service.spec.ts:13,53`):

```typescript
import { registerMetricHarness } from "@/testing/otel-harness";
// ...
const metricHarness = registerMetricHarness();
```

Add inside the `describe("IngestService", ...)` block (the existing suite already mocks `fetcherMock`, `transformerMock`, `repoMock`; `transformObservations` returns the batch, `upsertObservations` resolves):

```typescript
afterAll(async () => {
  await metricHarness.shutdown();
});

it("counts ingested records per region", async () => {
  fetcherMock.fetchRareObservations.mockResolvedValue([rawObservation]);
  transformerMock.transformObservations.mockReturnValue([
    { some: "obs" },
    { some: "obs" },
  ] as unknown as Observation[]);
  repoMock.upsertObservations.mockResolvedValue(undefined);

  await service.ingestRegion("US-WA");

  const records = await metricHarness.collect("scrubjay.ingest.records");
  const point = records?.dataPoints.at(-1);
  expect(point?.value).toBe(2);
  expect(point?.attributes.region).toBe("US-WA");
});

it("does not count records when the fetch fails", async () => {
  fetcherMock.fetchRareObservations.mockRejectedValue(new Error("ebird down"));

  await service.ingestRegion("US-WA");

  const records = await metricHarness.collect("scrubjay.ingest.records");
  expect(records).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/scrubjay-discord && pnpm test -- ingest.service`
Expected: FAIL — `scrubjay.ingest.records` metric not found (`records` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

In `ingest.service.ts`, add the meter/counter as a field and increment after a successful upsert. Import `metrics`:

```typescript
import { metrics } from "@opentelemetry/api";
```

Add the field to the class:

```typescript
private readonly records = metrics
  .getMeter("scrubjay-discord")
  .createCounter("scrubjay.ingest.records", {
    description: "eBird observations upserted per ingest, by region",
  });
```

In `ingestRegion`, after the successful `await this.repo.upsertObservations(batch);` block (before `return batch.length;`), add:

```typescript
this.records.add(batch.length, { region: regionCode });
```

The increment sits after the upsert try/catch, so a persist failure returns `0` without counting (the catch `return 0` short-circuits before this line).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/scrubjay-discord && pnpm test -- ingest.service`
Expected: PASS (both new tests + existing suite green).

- [ ] **Step 5: Commit**

```bash
git add apps/scrubjay-discord/src/features/ingest/ingest.service.ts apps/scrubjay-discord/src/features/ingest/ingest.service.spec.ts
git commit -m "feat(scrubjay-discord): count ingested eBird records by region"
```

---

### Task 2: `scrubjay.dispatch.alerts` counter — sent/failed/transient

**Files:**
- Modify: `apps/scrubjay-discord/src/features/dispatch/dispatch.service.ts`
- Test: `apps/scrubjay-discord/src/features/dispatch/dispatch.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: metric `scrubjay.dispatch.alerts` (Counter, attribute `status` ∈ `sent|failed|transient`), Prometheus `scrubjay_dispatch_alerts_total{status=...}`. Task 3 extends the same metric with `status="suppressed"` from another file — description string below is the shared contract and MUST match.

- [ ] **Step 1: Write the failing test**

The suite (`dispatch.service.spec.ts`) already has `registerMetricHarness()` at module scope and `afterAll` shutdown. Add three tests inside `describe("DispatchService", ...)`. Helper to read the counter by status:

```typescript
async function alertCount(status: string): Promise<number | undefined> {
  const metric = await metricHarness.collect("scrubjay.dispatch.alerts");
  return metric?.dataPoints.find((p) => p.attributes.status === status)?.value;
}

it("counts sent alerts", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
    makeAlert({ subId: "S001" }),
    makeAlert({ subId: "S002" }),
  ]);

  await service.dispatchSince(since);

  expect(await alertCount("sent")).toBe(2);
});

it("counts permanently failed alerts", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
  senderMock.send.mockRejectedValue(apiError(50013));

  await service.dispatchSince(since);

  expect(await alertCount("failed")).toBe(1);
});

it("counts transient send failures separately", async () => {
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([makeAlert()]);
  senderMock.send.mockRejectedValue(new Error("socket hang up"));

  await service.dispatchSince(since);

  expect(await alertCount("transient")).toBe(1);
});
```

Note DELTA temporality: each `metricHarness.collect` consumes points since the last flush. These tests each run one `dispatchSince` and one `collect`, so they don't interfere. Place them so they don't share a flush with an existing `collect("scrubjay.dispatch.queue.depth")` test in the same tick — they already run as separate `it` blocks, which is fine.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/scrubjay-discord && pnpm test -- dispatch.service`
Expected: FAIL — `scrubjay.dispatch.alerts` not found (`alertCount(...)` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

In `dispatch.service.ts`, add the counter next to the existing `queueDepth` gauge field:

```typescript
private readonly alerts = metrics
  .getMeter("scrubjay-discord")
  .createCounter("scrubjay.dispatch.alerts", {
    description: "Alert delivery outcomes by status",
  });
```

Increment on the sent path — after `await this.alertQueue.record(refs, "sent");` (currently line ~52):

```typescript
this.alerts.add(refs.length, { status: "sent" });
```

In `handleSendFailure`, the transient branch (currently the early `return` after logging) increments transient before returning:

```typescript
if (failure.kind === "transient") {
  this.logger.error(
    `Send failed for channel ${channelId}; alerts stay pending`,
    err instanceof Error ? err.stack : String(err),
  );
  this.alerts.add(refs.length, { status: "transient" });
  return;
}
```

And after `await this.alertQueue.record(refs, "failed", ...)` (permanent path, currently line ~90):

```typescript
this.alerts.add(refs.length, { status: "failed" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/scrubjay-discord && pnpm test -- dispatch.service`
Expected: PASS (3 new tests + existing suite green).

- [ ] **Step 5: Commit**

```bash
git add apps/scrubjay-discord/src/features/dispatch/dispatch.service.ts apps/scrubjay-discord/src/features/dispatch/dispatch.service.spec.ts
git commit -m "feat(scrubjay-discord): count alert deliveries by outcome"
```

---

### Task 3: `scrubjay.dispatch.alerts{status="suppressed"}` in bootstrap + changeset

**Files:**
- Modify: `apps/scrubjay-discord/src/features/jobs/bootstrap.service.ts`
- Test: `apps/scrubjay-discord/src/features/jobs/bootstrap.service.spec.ts`
- Create: `.changeset/critical-health-counters.md`

**Interfaces:**
- Consumes: metric `scrubjay.dispatch.alerts` from Task 2 (same name, same `description` string — the SDK dedupes the instrument).
- Produces: `status="suppressed"` data points on that metric.

- [ ] **Step 1: Write the failing test**

In `bootstrap.service.spec.ts`, register the harness at module scope (add import `import { registerMetricHarness } from "@/testing/otel-harness";` and `const metricHarness = registerMetricHarness();`), add `afterAll(async () => { await metricHarness.shutdown(); });`, then a test that drives `bootstrap()` with N pending alerts and asserts the suppressed count. Match the existing suite's construction of `BootstrapService` and its `alertQueueMock`/`sourcesMock`/`ingestServiceMock` (mirror what that spec already sets up):

```typescript
it("counts suppressed pre-existing alerts", async () => {
  sourcesMock.getEBirdSources.mockResolvedValue([]); // skip ingest loop
  alertQueueMock.pendingEBirdAlerts.mockResolvedValue([
    { channelId: "CH1", speciesCode: "verfly", subId: "S1" },
    { channelId: "CH1", speciesCode: "verfly", subId: "S2" },
  ]);
  alertQueueMock.record.mockResolvedValue(undefined);

  await service.onModuleInit();

  const metric = await metricHarness.collect("scrubjay.dispatch.alerts");
  const point = metric?.dataPoints.find(
    (p) => p.attributes.status === "suppressed",
  );
  expect(point?.value).toBe(2);
});
```

If the existing spec triggers bootstrap via a different entrypoint than `onModuleInit()`, use that entrypoint — check the top of `bootstrap.service.spec.ts` and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/scrubjay-discord && pnpm test -- bootstrap.service`
Expected: FAIL — no `suppressed` data point.

- [ ] **Step 3: Write minimal implementation**

In `bootstrap.service.ts`, add the counter field (byte-identical description to Task 2):

```typescript
private readonly alerts = metrics
  .getMeter("scrubjay-discord")
  .createCounter("scrubjay.dispatch.alerts", {
    description: "Alert delivery outcomes by status",
  });
```

Add `import { metrics } from "@opentelemetry/api";` if absent. After `await this.alertQueue.record(pending, "suppressed");`:

```typescript
this.alerts.add(pending.length, { status: "suppressed" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/scrubjay-discord && pnpm test`
Expected: PASS — full suite green, no OTel "duplicate instrument" warning in output (descriptions match).

- [ ] **Step 5: Add changeset**

Create `.changeset/critical-health-counters.md`:

```markdown
---
"scrubjay-discord": patch
---

Add operational counters for the critical-health dashboard: `scrubjay.ingest.records{region}` (eBird observations upserted per ingest) and `scrubjay.dispatch.alerts{status}` (alert delivery outcomes — sent, failed, transient, suppressed).
```

- [ ] **Step 6: Commit**

```bash
git add apps/scrubjay-discord/src/features/jobs/bootstrap.service.ts apps/scrubjay-discord/src/features/jobs/bootstrap.service.spec.ts .changeset/critical-health-counters.md
git commit -m "feat(scrubjay-discord): count bootstrap-suppressed alerts"
```

---

### Task 4: Grafana dashboard JSON

**Files:**
- Create: `observability/dashboards/critical-health.json`
- Modify: `OBSERVABILITY.md` (add a pointer to the dashboard + how to import)

**Interfaces:**
- Consumes: all metrics above plus existing `scrubjay_job_runs_total`, `scrubjay_job_duration_milliseconds`, `scrubjay_command_errors_total`, `scrubjay_command_duration_milliseconds`, `scrubjay_discord_gateway_reconnects_total`, `scrubjay_dispatch_queue_depth`, `db_client_connection_count`, `db_client_connection_pending_requests`, `scrubjay_db_pool_errors_total`, `traces_service_graph_request_total`, `traces_service_graph_request_failed_total`.
- Produces: an importable dashboard.

> This task is not TDD — the "test" is importing into Grafana and confirming panels render. It requires the live Grafana Cloud stack (Drew), because exact Prometheus metric names depend on the OTLP→Prom mapping.

- [ ] **Step 1: Verify exact metric names against the live metric browser**

In Grafana → Explore → the stack's Prometheus, open the metric browser and confirm the real names for each metric in the Interfaces list above. OTLP→Prom mangling to check: dots→`_`; counters gain `_total`; the `ms`-unit histograms become `_milliseconds` with `_bucket`/`_sum`/`_count` series; gauges/observable-updown-counters keep their base name. Write the confirmed names into a scratch list. Any name that differs from the Interfaces list is the one to use in the JSON.

- [ ] **Step 2: Author the dashboard JSON**

Create `observability/dashboards/critical-health.json` as a Grafana dashboard model (schemaVersion for current Grafana, `"editable": true`, `"refresh": "1m"`, `"time": {"from": "now-6h", "to": "now"}`, a single Prometheus datasource variable `${DS_PROM}` of type `datasource`/`prometheus` so import prompts for the datasource). Panels, using the verified names:

Row 0 — **Liveness** (4 `stat` panels, `thresholds` mode `absolute`, color by value):
- Heartbeat: `sum(increase(scrubjay_job_runs_total{job="dispatch"}[5m]))` — thresholds: red `0`, green `0.5`.
- Ingest fresh: `sum(increase(scrubjay_job_runs_total{job="ingest"}[20m]))` — red `0`, green `0.5`.
- Job failures (15m): `sum(increase(scrubjay_job_runs_total{status="error"}[15m]))` — green `0`, red `0.5` (invert: 0 is good).
- Command errors (15m): `sum(increase(scrubjay_command_errors_total[15m]))` — green `0`, red `0.5`.

Row 1 — **Ingest → eBird** (timeseries):
- eBird error rate: `sum(rate(traces_service_graph_request_failed_total{server="ebird"}[5m])) / clamp_min(sum(rate(traces_service_graph_request_total{server="ebird"}[5m])), 1)`.
- Records ingested: `sum(rate(scrubjay_ingest_records_total[1h])) by (region)`.
- Ingest p95 (ms): `histogram_quantile(0.95, sum(rate(scrubjay_job_duration_milliseconds_bucket{job="ingest"}[$__rate_interval])) by (le))`.

Row 2 — **Dispatch → delivery** (timeseries):
- Queue depth: `scrubjay_dispatch_queue_depth`.
- Alert outcomes: `sum(rate(scrubjay_dispatch_alerts_total[1h])) by (status)`.
- Discord delivery errors: `sum(rate(traces_service_graph_request_failed_total{server="discord"}[5m]))`.
- Dispatch p95 (ms): `histogram_quantile(0.95, sum(rate(scrubjay_job_duration_milliseconds_bucket{job="dispatch"}[$__rate_interval])) by (le))`.

Row 3 — **Discord interactions** (timeseries):
- Command p50/p95 by command: `histogram_quantile(0.95, sum(rate(scrubjay_command_duration_milliseconds_bucket[$__rate_interval])) by (le, command))` and the same with `0.5`.
- Gateway reconnects: `sum(rate(scrubjay_discord_gateway_reconnects_total[$__rate_interval])) by (event)`.

Row 4 — **Postgres** (timeseries):
- Pool connections: `db_client_connection_count` (legend by `state`).
- Pending requests: `db_client_connection_pending_requests`.
- Pool errors: `sum(rate(scrubjay_db_pool_errors_total[$__rate_interval]))`.

- [ ] **Step 3: Import and verify every panel renders**

In Grafana → Dashboards → New → Import → upload `critical-health.json`, pick the Prometheus datasource. Confirm: no panel shows "No data" for a metric that should have data (accounting for intermittent series — trigger a `/` command and wait one dispatch tick if needed). Fix any query whose series is empty because of a name mismatch, and update the JSON file to match.

- [ ] **Step 4: Document and commit**

Add a short section to `OBSERVABILITY.md` pointing at `observability/dashboards/critical-health.json` and the import steps. Then:

```bash
git add observability/dashboards/critical-health.json OBSERVABILITY.md
git commit -m "feat(observability): critical-health Grafana dashboard"
```

---

## Self-Review

- **Spec coverage:** Liveness row → Task 4 Row 0; ingest/dispatch operational rows → Task 4 Rows 1–4; the two new counters → Tasks 1–3; changeset → Task 3; metric-name verification → Task 4 Step 1; no alert rule (out of scope) → correctly absent. All spec sections mapped.
- **Placeholder scan:** No TBD/TODO; every code step shows the code; every test step shows the assertion. Task 3 Step 1 notes the one conditional (match the existing spec's bootstrap entrypoint) with an explicit instruction rather than a placeholder.
- **Type consistency:** Metric name `scrubjay.dispatch.alerts` and description `"Alert delivery outcomes by status"` identical in Tasks 2 and 3; `status` values `sent|failed|transient|suppressed` consistent across tasks, changeset, and dashboard query; `scrubjay.ingest.records` / attribute `region` consistent between Task 1 and Task 4.
