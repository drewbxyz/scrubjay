---
"scrubjay-discord": patch
---

Stop tracing the Discord gateway WebSocket connection in the OTel
`HttpInstrumentation`. The gateway is opened via an HTTP GET that upgrades to a
long-lived WebSocket and never returns, so it produced a client span that
stayed open for the whole bot session and silently adopted every interaction as
a child — command traces (e.g. `/ping`) hung off a root that was never exported,
which Tempo surfaced as "root span not yet received". An `ignoreOutgoingRequestHook`
now skips `*.discord.gg`, so interactions become their own trace roots.
