# Mock eBird API

A mock of the one eBird API v2 endpoint ScrubJay consumes, for local development
without a real eBird token.

## Endpoints

- `GET /v2/data/obs/{regionCode}/recent/notable` - Notable observations in a region
- `GET /` - API information
- `GET /health` - Health check

### Query parameters

- `maxResults` (default: 50, max: 10000) - Maximum number of results to return
- `includeProvisional` (default: false) - Include unconfirmed observations
- `hotspot` (default: false) - Only include hotspot observations
- `back` (default: 7) - How many days back to generate observations for

## Authentication

The `/v2/*` routes require an `x-ebirdapitoken` header with one of the dev keys:

- `test-api-key`
- `dev-key-123`

Rate limiting matches eBird: 10,000 requests per key per 24h window, 429 when
exceeded.

## Usage

```bash
pnpm --filter test-api dev   # starts on http://localhost:8080

curl -H "x-ebirdapitoken: test-api-key" \
  "http://localhost:8080/v2/data/obs/US-CA/recent/notable?back=7&detail=full"
```

Responses match the eBird API v2 observation shape (see `eBirdObservation` in
`src/routes/ebird.routes.ts`). Observations are generated randomly from the data
in `src/data/` (50+ species, California counties, 5 hotspot locations) and kept
in memory per region, so repeated calls within the `back` window return a mix of
previously served and fresh observations.

## Project Structure

```
src/
├── data/           # Static data (species, regions, hotspots)
├── middleware/     # Express middleware (auth, rate limiting)
├── routes/         # The notable-observations route
└── index.ts        # Application entry point
```
