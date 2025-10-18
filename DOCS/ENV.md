# Environment variables

| Variable | Required | Default | Description | Used in |
| --- | --- | --- | --- | --- |
| `BOT_TOKEN` | ✅ | — | Telegram bot token used to initialise Telegraf. The process exits if missing. | `src/bot/telegraf.js`, `src/utils/tgInitData.*` |
| `BASE_URL` | ✅ | — | Public base URL for building tracking links and redirects. Must be absolute (https://...). | `src/config.js`, `src/api/click.*`, `src/api/cpa.js` |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string for pool, migrations and session storage. | `src/config.js`, `src/db/index.js`, `src/db/migrate.js` |
| `CPA_POSTBACK_URL` / `CPA_PB_URL` | ➖ | — | Endpoint that receives conversion postbacks. Validation requires an absolute URL. | `src/config.js`, `src/services/postback.js` |
| `CPA_PB_SECRET` | ➖ | `dev-secret` (if unset) | Secret used to sign CPA postback payloads. Warns when missing. | `src/config.js`, `src/services/postback.js` |
| `CPA_API_KEY` | ➖ | — | API key that external partners must send via `X-Api-Key` to access `/api/cpa/*`. | `src/config.js`, `src/api/cpa.js`, tests |
| `PORT` | ➖ | `3000` (config), `8000` (webhook server default) | TCP port for HTTP server. `src/api/server.js` falls back to `8000` when run standalone. | `src/config.js`, `src/api/server.js` |
| `BIND_HOST` | ➖ | `127.0.0.1` | Interface used by the webhook server. Override to `0.0.0.0` behind a reverse proxy. | `src/api/server.js` |
| `WEBHOOK_PATH` | ➖ | `/bot/webhook` | Relative path for Telegram webhook handler. Must start with `/`. | `src/config.js`, `src/api/server.js` |
| `WEBHOOK_SECRET` | ➖ | — | Optional secret token validated against `X-Telegram-Bot-Api-Secret-Token`. | `src/api/server.js` |
| `ADMIN_TOKEN` | ➖ | — | Token required for admin HTTP endpoints (`/api/offers`). | `src/api/server.js` |
| `ADMIN_TG_ID` | ➖ | — | Telegram ID that gains access to admin bot commands (`/admin_offers`, `/offer_status`). | `src/bot/telegraf.js` |
| `BOT_USERNAME` | ➖ | — | Username used to render deep links and hints. | `src/config.js`, `src/api/click.*`, `src/bot/run-bot.js` |
| `ALLOWED_UPDATES` | ➖ | `message,callback_query,chat_member,my_chat_member` | Comma separated list passed to Telegram when registering a webhook. | `src/config.js` |
| `DISABLE_LINK_CAPTURE` | ➖ | `false` | When set to `true`, skips loading `src/bot/link-capture.js`. | `src/bot/telegraf.js` |
| `ADS_MASTERS` / `ADS_WIZARD_ADMINS` / `ADS_WIZARD_WHITELIST` | ➖ | — | Comma separated list of Telegram IDs allowed to run the ads wizard. | `src/config.js`, `src/bot/adsWizard.js` |
| `POSTBACK_TIMEOUT_MS` | ➖ | `4000` | Timeout used when delivering CPA postbacks. | `src/config.js`, `src/services/postback.js` |
| `IDEMPOTENCY_TTL_SEC` | ➖ | `600` | Time window for deduplication of CPA events. | `src/config.js`, `src/services/postback.js` |
| `TZ` | ➖ | `Europe/Rome` | Default timezone, affects cron-style operations and logs. | `src/config.js` |
| `NODE_ENV` | ➖ | — | Standard Node.js environment indicator. | `src/config.js` |
| `DEBUG_TOKEN` | ➖ | — | Required header (`X-Debug-Token`) for debug routes (`/debug/*`, `/api/wa/*`). | `src/api/app.js`, `src/api/wa.js` |
| `HIGH_GEO_LIST` | ➖ | — | Comma separated list of GEO codes that trigger +30% payout adjustment. | `src/util/pricing.js` |
| `SEED` | ➖ | `0` | When set to `1`, migrations seed demo data. | `src/db/migrate.js` |

Legend: ✅ – required, ➖ – optional / situational.
