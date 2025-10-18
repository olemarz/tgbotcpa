# Testing & QA

## Automated checks

- `npm test` — runs Node's built-in test runner across:
  - `tests/click.test.js` — verifies redirect and attribution creation for `/click/:offerId`.
  - `tests/debug-complete.test.js` — covers debug conversion endpoint and postback dry run.
  - `tests/hmac.test.js` — asserts postback signature generation.
  - `tests/cpa.offers.api.test.js` — validates `/api/cpa/offers/:id` authorisation and response shape.
- `npm run doctor` — ensures required binaries, Node version and environment variables are present.

## Release smoke checklist

1. **HTTP API**
   - `curl -f https://<host>/health` returns `{ "ok": true }`.
   - `curl -I "https://<host>/click/<offer_uuid>?uid=test&click_id=123"` returns `302` to `https://t.me/<BOT_USERNAME>?start=...`.
   - `curl -X POST https://<host>/debug/complete \
       -H "X-Debug-Token: $DEBUG_TOKEN" \
       -d 'offer_id=...&tg_id=...&event=join_group'` returns `{ ok: true }`.
2. **Bot flows**
   - `/start <token>` creates/updates `attribution` row and marks the click as used.
   - Joining the target chat produces an `events` row and triggers a postback (check `postbacks` table or logs).
3. **Partner API**
   - `curl -H "X-Api-Key: $CPA_API_KEY" https://<host>/api/cpa/offers/<offer_uuid>` returns offer JSON.

## Regression guardrails

- Inspect `pm2 logs tg-api --lines 200` for unhandled errors or rate limit warnings.
- Run `SELECT COUNT(*) FROM offers;` and `SELECT COUNT(*) FROM postbacks WHERE status = 'failed';` to catch anomalies.
- Verify webhook binding via `getWebhookInfo` after deploy.

## Local QA helpers

- `GET /click/<offer_id>?uid=test` — generate a start token for manual bot testing.
- `/claim <TOKEN>` — replay onboarding without hitting the click URL.
- `POST /debug/complete` — simulate CPA confirmation (requires `DEBUG_TOKEN`).
- `/stat` — inspect aggregated conversions via inline keyboard.

## Post-deploy monitoring

- Confirm new entries appear in `clicks`, `attribution`, `events`, `postbacks` within expected time windows.
- Watch CPU/memory usage of `tg-api` via `pm2 monit`.
- Track Telegram API errors (rate limits, 429) in logs and adjust pacing if necessary.
