---
"scrubjay-discord": patch
---

Set peer.service="postgres" on pg client spans so the service graph draws the scrubjay-discord → postgres edge. Postgres emits no server spans, so the graph generator only renders the dependency from a virtual node keyed on peer.service — the same treatment the undici hook already gives discord and ebird.
