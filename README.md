# ScrubJay Discord Bot

ScrubJay is a NestJS-powered Discord bot built for the California Birding community, and has since expanded to North Carolina. It polls eBird for notable observations, stores them in Postgres, and posts grouped alerts to Discord channels so birders can act fast without noisy duplicates.

## Overview

- Poll eBird on a 15 minute schedule, normalize observations with Drizzle ORM, and keep location metadata current.
- Group alerts per channel and send Discord embeds with media counts and confirmation status while avoiding repeat deliveries.
- Necord and discord.js power slash commands and reactions; a `ping` command is included for basic health checks.
- Local mock of the eBird v2 API lets you develop without hitting the production service.

## Repository layout

- `apps/scrubjay-discord` - Discord bot service (NestJS, Necord, Drizzle, discord.js).
- `apps/test-api` - Mock eBird API for local development and tests.
- `packages/typescript-config` - Shared TypeScript config.
- `docker-compose.yaml` - Postgres 17 for local use.

## Prerequisites

- Node.js 24 (see `.nvmrc`) and pnpm 10.
- Postgres 17 running locally (`docker compose up -d postgres`).
- Discord application with a bot token.
- eBird API token. Point the bot at `apps/test-api` if you want to avoid the live API.

## Configuration

Create an `.env` in the repo root:

```env
DATABASE_URL=postgres://scrubjay:scrubjay@localhost:5432/scrubjay
DISCORD_TOKEN=your_discord_bot_token
EBIRD_TOKEN=your_ebird_token
# Optional
EBIRD_BASE_URL=http://localhost:8080/        # use the mock API
DEVELOPMENT_GUILD_ID=your_dev_guild_id       # limit commands to a dev server
PORT=3000
```

The bot runs database migrations on startup using the Drizzle files in `apps/scrubjay-discord/src/drizzle`.

## Running locally

1. Install dependencies: `pnpm install`
2. Start Postgres: `docker compose up -d postgres`
3. Start the bot: `pnpm --filter scrubjay-discord dev`
4. Optional: run the mock API at `localhost:8080` with `pnpm --filter test-api dev`

Jobs ingest eBird data every 15 minutes and dispatch grouped alerts every minute; a daily retention job (04:17) prunes aged observations and delivery records. Bootstrap logic runs on startup to backfill observations without sending Discord messages. A `/health` HTTP endpoint (on `PORT`) reports DB connectivity plus ingest/dispatch freshness.

## Notes

- Alert subscriptions live in the `channel_ebird_subscriptions` table; add your channels there before expecting dispatches.
- Formatting and linting: `pnpm format-and-lint`. Build tasks are coordinated by Turbo.
