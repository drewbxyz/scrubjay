---
"scrubjay-discord": patch
---

Tag outbound eBird and Discord calls with the standard `peer.service`
attribute via the undici `requestHook`, so a service-graph generator draws
virtual-node edges for these uninstrumented dependencies and labels them
cleanly (`ebird`/`discord`) instead of raw hostnames.
