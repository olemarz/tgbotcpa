# Inventory

## Repository tree (depth ≤3)
```
.
├─ DOCS/
├─ README.md
├─ Makefile
├─ package.json
├─ scripts/
│  ├─ health.sh
│  └─ test-webhook.sh
├─ src/
│  ├─ api/
│  │  └─ server.js
│  ├─ bot/
│  │  ├─ adsWizard.js
│  │  ├─ link-capture.js
│  │  ├─ sessionStore.js
│  │  ├─ stat.js
│  │  └─ telegraf.js
│  ├─ db/
│  │  └─ index.js
│  ├─ services/
│  │  ├─ conversion.js
│  │  ├─ joinCheck.js
│  │  └─ postback.js
│  └─ util/
│     └─ id.js
└─ tests/
```

## Key modules and exports

| File | Exports |
| --- | --- |
| `src/api/server.js` | `createApp`, `startServer` |
| `src/bot/telegraf.js` | `bot`, `handleStartWithToken`, `handleClaimCommand`, `logUpdate`, default `bot` |
| `src/bot/adsWizard.js` | `ADS_WIZARD_ID`, `GEO`, `adsWizardScene`, `initializeAdsWizard`, `startAdsWizard`, default `adsWizardScene` |
| `src/bot/sessionStore.js` | `PostgresSessionStore`, `sessionStore` |
| `src/bot/stat.js` | `registerStatHandlers`, `STAT_CALLBACK_PREFIX`, `__testables` |
| `src/services/postback.js` | `sendPostback` |
| `src/services/conversion.js` | `createConversion`, `approveJoin` |
| `src/services/joinCheck.js` | `joinCheck`, `extractUsername` |
| `src/db/index.js` | `query`, `pool`, `db`, `insertOfferAuditLog` |
| `src/util/id.js` | `uuid`, `shortToken` |

## Environment variables (usage)

- `BOT_TOKEN` — Telegram bot token, required in `src/bot/telegraf.js` line 15.
- `DISABLE_LINK_CAPTURE` — toggles optional middleware in `src/bot/telegraf.js` line 40.
- `WEBHOOK_PATH` — webhook route suffix in `src/api/server.js` line 15.
- `PORT` — HTTP port in `src/api/server.js` line 45.
- `HOST` — HTTP host/interface in `src/api/server.js` line 46.
- `ADMIN_IDS` — optional broadcast targets for offer notifications in `src/bot/adsWizard.js` line 307.

Additional configuration (database, CPA, etc.) is loaded via `src/config.js`.

## HTTP routes

| Method | Path | File:Line |
| --- | --- | --- |
| `GET` | `/health` | `src/api/server.js`:11 |
| `POST` | `WEBHOOK_PATH` (defaults to `/bot/webhook`) | `src/api/server.js`:18 |
| `*` | fallback JSON 404 | `src/api/server.js`:30 |

## Telegraf handlers & scenes

- Stage initialisation at `src/bot/telegraf.js`:23–38 with `adsWizardScene` as the only scene.
- Optional `link-capture` middleware loaded when `DISABLE_LINK_CAPTURE !== 'true'` (`src/bot/telegraf.js`:40–55).
- `bot.start` handles `/start` payload routing (`src/bot/telegraf.js`:114–127).
- `bot.command('ads')` launches the ads wizard (`src/bot/telegraf.js`:129–138).
- `bot.command('claim')` parses `/claim <TOKEN>` (`src/bot/telegraf.js`:219).
- `bot.hears(/^\/go …/)` QA shortcut for synthetic tokens (`src/bot/telegraf.js`:219–262).
- `bot.command('whoami')`, `bot.command('help')`, `bot.command('cancel')` handle utility flows (`src/bot/telegraf.js`:265–299).
- `bot.on(['chat_member','my_chat_member'])` reacts to join events (`src/bot/telegraf.js`:301–357).
- `bot.action(/^check:…/)` manual conversion check (`src/bot/telegraf.js`:359–422).
- `registerStatHandlers` wires `/stat` command and callbacks via `src/bot/stat.js` (`src/bot/telegraf.js`:97).
