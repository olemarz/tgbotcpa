# Telegram CPA Bot

Telegram CPA bot and webhook service built on Node.js 20. The application exposes an Express API for handling Telegram webhook updates, CPA postbacks and offer management flows, while the Telegraf bot guides advertisers through offer configuration inside the chat.

## Features

- **Express HTTP service** with webhook endpoint, admin APIs and debugging utilities.
- **Telegraf bot** with session-backed wizard for creating and managing CPA offers.
- **PostgreSQL persistence** for offers, clicks, attribution, events and postbacks.
- **CPA integrations** for click tracking, conversion notifications and join verification.
- **Operational tooling** including PM2 ecosystem file, health scripts and automated tests.

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 13+
- Telegram bot token (`BOT_TOKEN`)

## Installation

```bash
npm install
```

Copy the example environment file and adjust it for your setup:

```bash
cp ecosystem.env .env
# edit .env and fill the required variables
```

The full list of environment variables with defaults and hints is available in [DOCS/ENV.md](DOCS/ENV.md).

## Local development

### Start the HTTP API (webhook mode)

```bash
npm run api
```

By default the service listens on `http://127.0.0.1:8000`. A JSON health check is served from `GET /health`.

### Run the bot in long polling mode

```bash
npm run bot
```

Long polling is handy for local testing without exposing a public webhook. The command respects the same `.env` configuration.

### Database migrations

```bash
npm run migrate
```

The migration script uses `DATABASE_URL` and optionally seeds fixtures when `SEED=1`.

### Tests and diagnostics

```bash
npm test
npm run doctor
```

`npm test` executes the Node.js test runner with Supertest and pg-mem based suites. `npm run doctor` performs a lightweight environment verification.

## Webhook configuration

Expose the Express server via a reverse proxy (Nginx, Caddy, etc.) and configure Telegram to send updates to the webhook URL:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${PUBLIC_BASE_URL}${WEBHOOK_PATH:-/bot/webhook}" \
  -d 'allowed_updates=["message","callback_query","chat_member","my_chat_member"]'
```

Optionally set `WEBHOOK_SECRET` and pass it in the `X-Telegram-Bot-Api-Secret-Token` header to harden the endpoint.

## PM2 deployment

The repository ships with `ecosystem.config.cjs`. Deploy and launch on a server:

```bash
pm2 start ecosystem.config.cjs --only tg-api
pm2 save
pm2 status
pm2 logs tg-api --lines 120
```

Reload after deploying new code:

```bash
pm2 restart tg-api
```

## Project structure

```
src/
  api/        Express app, webhook server and CPA helpers
  bot/        Telegraf scenes, commands and middleware
  db/         Query helpers, migrations and seed logic
  integrations/ External partner integrations (CPA, WA, etc.)
  services/   Business logic for postbacks, conversions and joins
  util/       Shared helpers (IDs, pricing, geo, Telegram utils)
DOCS/         Operational documentation (runbooks, env, architecture)
docs/         Product and engineering handbook (overview, roadmap, QA)
scripts/      Utility scripts for webhook registration, health checks
public/       Static assets served by the Express app
```

Additional documentation lives under `DOCS/` and `docs/`. See [docs/SUMMARY.md](docs/SUMMARY.md) for a curated reading order.

## Documentation archive

Generate an offline bundle of all docs and the README when you need to share them without repository access:

```bash
./scripts/package-docs.sh
```

Pass a custom output path if you want a different filename:

```bash
./scripts/package-docs.sh /tmp/tgbotcpa-docs.tar.gz
```
