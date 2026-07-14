---
"scrubjay-discord": minor
---

Add the operator REST API (`/api/v1`) behind `SCRUBJAY_API_TOKEN`: guild/channel
browsing, subscriptions and filters CRUD, read-only regions/observations/
deliveries/pending-alert views, and an eBird county reference proxy. Adds the
shared `@scrubjay/api-contracts` zod package. Without `SCRUBJAY_API_TOKEN` the
bot behaves exactly as today (no HTTP surface beyond `/health`).
