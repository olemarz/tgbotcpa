# Inventory

## Repository tree (depth ≤2)

```
.
├─ DOCS/
├─ docs/
├─ public/
├─ scripts/
├─ src/
│  ├─ api/
│  ├─ bot/
│  ├─ constants/
│  ├─ db/
│  ├─ integrations/
│  ├─ services/
│  ├─ util/
│  └─ utils/
├─ tests/
├─ ecosystem.config.cjs
├─ ecosystem.env
├─ package.json
├─ package-lock.json
└─ README.md
```

## Key modules and exports

| File | Exports |
| --- | --- |
| `src/api/app.js` | `createApp()` – constructs the Express application (static assets, click tracking, CPA APIs). |
| `src/api/server.js` | Side-effect module that bootstraps Express webhook server and binds `bot.handleUpdate`. |
| `src/api/click.js` / `click.ts` | `handleClick(req, res)` handler for `/click/:offerId`. |
| `src/api/cpa.js` | `cpaRouter` with partner API guarded by `X-Api-Key`. |
| `src/api/wa.js` | `waRouter` for WhatsApp lead capture (debug-token protected). |
| `src/bot/telegraf.js` | `bot`, `logUpdate`, `handleStartWithToken`, `handleClaimCommand`, `finalizeOfferAndInvoiceStars`, default `bot`. |
| `src/bot/adsWizard.js` | `ADS_WIZARD_ID`, `GEO`, `adsWizardScene`, `initializeAdsWizard`, `startAdsWizard`, default scene. |
| `src/bot/stat.js` | `STAT_CALLBACK_PREFIX`, `registerStatHandlers`, `__testables`. |
| `src/bot/sessionStore.js` | `PostgresSessionStore`, `sessionStore`. |
| `src/services/postback.js` | `sendPostback(payload, { dryRun })`. |
| `src/services/conversion.js` | `createConversion(event)`, `approveJoin(update)`. |
| `src/services/joinCheck.js` | `joinCheck(update)`, `extractUsername(entity)`. |
| `src/db/index.js` | `query`, `pool`, `db`, `insertOfferAuditLog`. |
| `src/util/id.js` | `uuid()`, `shortToken()`. |
| `src/util/pricing.js` | `adjustPayoutCents(baseCents, geo)`. |
| `src/util/xtr.js` | `centsToXtr(cents)`, `xtrToCents(xtr)`. |

## Runtime binaries & scripts

| Command | Purpose |
| --- | --- |
| `npm run api` | Start webhook HTTP server (`src/api/server.js`). |
| `npm run bot` | Run Telegraf long polling worker (`src/bot/run-bot.js`). |
| `npm run migrate` | Apply SQL migrations (`src/db/migrate.js`). |
| `npm run doctor` | Environment diagnostics (`scripts/doctor.js`). |
| `scripts/health.sh` | Curl-based health probe for `/health`. |
| `scripts/test-webhook.sh` | Sends sample `/start` payload to the webhook. |
| `scripts/register-webhook.js` | Registers webhook with BotFather API. |

## HTTP routes (Express)

| Method | Path | Module |
| --- | --- | --- |
| `GET` | `/health` | `src/api/server.js`, `src/api/app.js` |
| `GET` | `/` | `src/api/server.js` (webhook process info) |
| `POST` | `/bot/webhook` (default) | `src/api/server.js` → `bot.handleUpdate` |
| `GET` | `/click/:offerId` | `src/api/click.js` |
| `POST` | `/offers` | `src/api/app.js` |
| `POST` | `/api/offers` | `src/api/server.js` (admin) |
| `POST` | `/api/pay/:id` | `src/api/server.js` (debug invoice) |
| `GET` | `/api/offers` | `src/api/server.js` (admin) |
| `GET` | `/api/cpa/offers/:id` | `src/api/cpa.js` |
| `GET` | `/api/wa/*` | `src/api/wa.js` |
| `POST` | `/debug/complete` | `src/api/app.js` |
| `GET` | `/debug/last` | `src/api/app.js` |
| `GET` | `/debug/ping` | `src/api/app.js` |

## Telegram commands & actions

- `/start` — deep-link aware onboarding handled in `handleStartWithToken`.
- `/ads` — launches `adsWizardScene` for approved advertisers.
- `/claim` — redeem invite tokens issued by the wizard.
- `/whoami`, `/help`, `/cancel` — utility flows for any user.
- `/stat` — stats dashboard (registered via `registerStatHandlers`).
- Admin only: `/admin_offers`, `/offer_status`, debug callbacks under `STAT_CALLBACK_PREFIX`.

Join events (`chat_member`, `my_chat_member`) and callback buttons trigger conversion checks and postbacks.
