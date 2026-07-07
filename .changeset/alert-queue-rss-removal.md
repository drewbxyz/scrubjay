---
"scrubjay-discord": minor
---

Delete the RSS feature end-to-end and replace the dispatcher routing layer with `AlertQueue`, a single deep module owning pending-alert selection (matched × unfiltered × undelivered, `recentlyConfirmed` computed in SQL) and idempotent send-marking. `DispatcherService`/`DispatcherMap` are gone now that only eBird alerts exist; callers depend on `EBirdDispatcherService` directly. Migration 0004 drops the `rss_items`, `rss_sources`, and `channel_rss_subscriptions` tables and purges `kind='rss'` delivery rows — irreversible, run automatically at startup.

Also adds testcontainers-based integration tests (a real `postgres:17` container, migrated with the same programmatic `migrate()` production uses) covering the full pending-alerts spec matrix, including an EXPLAIN smoke test asserting the deliveries exclusion stays an anti-join.

Spec: `docs/superpowers/specs/2026-07-06-alert-queue-design.md`
Plan: `docs/superpowers/plans/2026-07-06-alert-queue.md`
