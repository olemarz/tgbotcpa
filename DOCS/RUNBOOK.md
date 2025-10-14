# Runbook

## Pre-flight checks
- `make check` — ensure all JavaScript files pass `node --check`.
- `npm run lint` *(if configured)* — optional lint pass.

## Deploy verification
1. `pm2 restart tg-api`
2. `sleep 1 && pm2 logs tg-api --lines 120`
3. `make health`
4. `make webhook-test`

## Incident diagnostics
- `pm2 status` — confirm process `tg-api` is online.
- `pm2 logs tg-api --lines 200` — inspect runtime errors.
- `curl -v http://127.0.0.1:${PORT:-8000}/health` — verify Express server responds.
- `curl -X POST https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo` — inspect Telegram webhook state.
- `curl -X POST https://api.telegram.org/bot${BOT_TOKEN}/setWebhook -d "url=https://adspirin.ru${WEBHOOK_PATH:-/bot/webhook}"` — reapply webhook.
- `psql $DATABASE_URL` — check PostgreSQL health when DB issues suspected.

## Recovery
- `pm2 restart tg-api` — restart bot after configuration changes.
- `pm2 delete tg-api && pm2 start ecosystem.config.cjs --only tg-api` — redeploy clean process definition.
- `git revert <commit>` — rollback faulty release.
