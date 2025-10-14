# Telegram CPA Bot

Node.js 20 service that exposes an Express webhook for a Telegram bot built with Telegraf v4. The project runs under PM2 in production and relies on PostgreSQL for persistence.

## Requirements

- Node.js 20+
- PostgreSQL 13+
- PM2 (for production process management)
- Telegram Bot token

## Installation

```bash
npm install
```

Create an environment file based on production values:

```bash
cp ecosystem.env .env
# edit .env and fill the required variables
```

## Local development

Start the Express server with webhook handling:

```bash
node src/api/server.js
```

By default the service listens on `http://127.0.0.1:8000`. Health check is available at `GET /health`.

Run syntax checks for all JavaScript files:

```bash
make check
```

Trigger manual webhook testing:

```bash
make webhook-test
```

## Running with PM2

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

## Webhook configuration

Expose the Express server (`PORT`, `HOST`) via Nginx or another reverse proxy. Configure Telegram to send updates to the webhook:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=https://adspirin.ru${WEBHOOK_PATH:-/bot/webhook}" \
  -d 'allowed_updates=["message","callback_query","chat_member","my_chat_member"]'
```

Verify webhook status:

```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

## Useful scripts

- `scripts/health.sh` — call the local `/health` endpoint.
- `scripts/test-webhook.sh` — send a synthetic `/start` update to the webhook.
- `scripts/register-webhook.js` — helper for BotFather webhook registration.

## Directory layout

- `src/api/server.js` — Express server with webhook endpoint.
- `src/bot/telegraf.js` — Telegraf initialisation, stages and handlers.
- `src/bot/adsWizard.js` — wizard scene for ad creation.
- `src/services/` — postback, conversion and join verification logic.
- `src/db/index.js` — PostgreSQL access helpers.
- `DOCS/` — operational documentation.
