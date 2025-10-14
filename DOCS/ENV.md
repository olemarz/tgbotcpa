# Environment variables

| Variable | Description | Default | Used in |
| --- | --- | --- | --- |
| `BOT_TOKEN` | Telegram bot token; process exits if missing. | — | `src/bot/telegraf.js` |
| `ADMIN_IDS` | Comma-separated Telegram IDs notified about new offers. | empty | `src/bot/adsWizard.js` via `config.ADMIN_IDS` |
| `WEBHOOK_PATH` | Relative webhook path exposed by Express. | `/bot/webhook` | `src/api/server.js`, `src/config.js` |
| `PORT` | HTTP port for Express listener. | `8000` | `src/api/server.js` |
| `HOST` | Interface/address for Express listener. | `0.0.0.0` | `src/api/server.js` |
| `DISABLE_LINK_CAPTURE` | When set to `true`, skips link-capture middleware. | `false` | `src/bot/telegraf.js` |

See `src/config.js` for additional CPA/postback/database options.
