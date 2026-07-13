---
"scrubjay-discord": patch
---

Dispatch alert plans concurrently across channels. Sends to different channels
run in parallel (they are independent Discord rate-limit buckets) while sends
within a channel stay sequential, preserving message order and the send-then-
record crash-safety protocol. Cuts dispatch tick wall time from the sum of all
sends to the slowest single channel's chain (~14s → ~1-2s on a typical
multi-channel tick).
