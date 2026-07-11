---
"scrubjay-discord": patch
---

Bound and batch the subscribe-time backfill so `subscription add` no longer
crashes on large regions.

`backfillDeliveries` marked every currently-pending alert as suppressed with a
single unbatched insert (4 bind params/row) over an unbounded pending select.
Two problems compounded on a busy/statewide (`*` county) subscription:

- **Wire-protocol overflow.** Past 16,383 rows the insert exceeded Postgres's
  16-bit parameter count (max 65,535), desyncing the bind message — surfacing as
  `ERROR: bind message has N parameter formats but 0 parameters` (SQLSTATE
  `08P01`) and rolling back the whole command. Delivery inserts (backfill and the
  expired sweep) now chunk at 1,000 rows / 4,000 params.

- **Unbounded scan.** The select suppressed the entire retention window, and
  before the retention prune runs the table can hold months of history. Backfill
  now only suppresses alerts from the last 8 days. Dispatch sends on a fixed
  15-minute lookback, so anything older can never reach a newly-subscribed
  channel anyway; 8 days covers the eBird ingest / sweep window (7 days) with a
  day of margin.
