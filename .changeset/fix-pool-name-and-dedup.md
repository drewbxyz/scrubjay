---
"scrubjay-discord": patch
---

Name the pg pool in connection metrics and stop double-emitting them.
`db.client.connection.count` / `.pending_requests` come from
instrumentation-pg, which derives `db.client.connection.pool.name` from the
Pool's `host`/`port`/`database` options — undefined when the Pool is built from
only a `connectionString`, so every series was labeled
`unknown_host:unknown_port/unknown_database`. Those fields are now populated
(parsed from `DATABASE_URL`; the connection string still wins for the actual
connection). `PoolMetricsService` also re-emitted the same two metric names by
hand under a bare `state` label, producing duplicate series for one
measurement; that redundant instrumentation is removed, leaving only
`scrubjay.db.pool.errors`.
