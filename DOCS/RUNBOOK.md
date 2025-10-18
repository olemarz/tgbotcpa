# Runbook

## Pre-flight checks before deploy

1. `npm test` — automated test suite (click tracking, postback signing, debug API).
2. `npm run doctor` — environment sanity check (Node version, required binaries).
3. `npm run migrate` — run pending migrations against staging before production.
4. Verify `.env` updates and secrets in your deployment target.

## Deploy procedure

1. `pm2 deploy` or git pull to the production host.
2. `pm2 restart tg-api` to reload the webhook process.
3. `sleep 2 && pm2 logs tg-api --lines 120` to confirm the boot sequence.
4. `curl -fsS http://127.0.0.1:${PORT:-8000}/health` to ensure the API responds.
5. Trigger a synthetic `/start` via `scripts/test-webhook.sh` (optional) to validate bot handlers.

## Incident diagnostics

- `pm2 status` — check whether `tg-api` is online and the last exit reason.
- `pm2 logs tg-api --lines 200` — inspect runtime errors and webhook failures.
- `curl -v http://127.0.0.1:${PORT:-8000}/health` — confirm Express is up.
- `curl -X POST https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo` — inspect Telegram webhook binding.
- `curl -X POST https://api.telegram.org/bot${BOT_TOKEN}/setWebhook -d "url=${PUBLIC_BASE_URL}${WEBHOOK_PATH:-/bot/webhook}"` — reapply webhook if necessary.
- `psql $DATABASE_URL` — check PostgreSQL connectivity and locks.
- `node scripts/doctor.js` — gather environment report on the server.

## Recovery actions

- `pm2 restart tg-api` — restart after configuration or transient failures.
- `pm2 delete tg-api && pm2 start ecosystem.config.cjs --only tg-api` — recreate the process from scratch.
- `npm run migrate` with `SEED=0` — re-run migrations if schema drift is suspected.
- `git revert <commit>` — rollback faulty release and redeploy.
- Escalate to infrastructure on-call if database remains unavailable after retry attempts.
