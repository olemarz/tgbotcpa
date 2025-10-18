# Run locally

## Requirements

- Node.js 20.x with npm 10+
- PostgreSQL 13+ (Docker or local instance)
- Telegram bot token (`BOT_TOKEN`)

## Environment setup

```bash
cp ecosystem.env .env
# edit .env and provide BOT_TOKEN, BASE_URL, DATABASE_URL, CPA_POSTBACK_URL, CPA_PB_SECRET
```

Optional: run PostgreSQL via Docker

```bash
docker run --name tgbotcpa-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

## Install dependencies

```bash
npm install
```

## Database migrations

```bash
npm run migrate
```

The script applies all SQL files under `src/db/migrations/` and seeds demo data if `SEED=1`.

## Start services

### Webhook HTTP server

```bash
npm run api
# listens on ${BIND_HOST:-127.0.0.1}:${PORT:-8000}
```

The process automatically wires `bot.handleUpdate` to the webhook route (`WEBHOOK_PATH`, default `/bot/webhook`).

### Long polling bot

```bash
npm run bot
```

Useful for local testing without exposing a tunnel. Stop with `Ctrl+C`.

## Smoke checks

```bash
curl -fsS http://127.0.0.1:${PORT:-8000}/health
curl -I "http://127.0.0.1:${PORT:-8000}/click/<offer_uuid>?uid=local-test"
```

You should see `HTTP/1.1 302 Found` with a Telegram deep link. Use `/claim <TOKEN>` in Telegram to replay onboarding if payload is lost.

## Debug helpers

- `scripts/test-webhook.sh` — sends a synthetic `/start` payload to the local webhook.
- `scripts/health.sh` — curl probe hitting `/health`.
- `/debug/complete` — emulate conversion (requires `DEBUG_TOKEN`).

## Cleanup

- Stop services (`Ctrl+C`).
- `docker stop tgbotcpa-db` and `docker rm tgbotcpa-db` when finished.
- Clear temporary data via SQL if you inserted test offers (`DELETE FROM offers WHERE ...`).
