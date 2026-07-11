---
"scrubjay-discord": patch
---

Harden `peer.service` host detection in the OTel undici `requestHook`: parse
the request origin and suffix-match on a label boundary instead of a naive
substring `includes()` (which `evil-discord.com` / `discord.com.evil.com`
could slip past), and guard against malformed origins.
