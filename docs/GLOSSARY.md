# Glossary

| Term | Definition | Where to look |
| --- | --- | --- |
| **Offer** | Campaign configuration containing target link, event type, payouts and budget. | `offers` table, `src/bot/adsWizard.js` |
| **Event type** | Target action the advertiser pays for (`join_group`, `start_bot`, `paid`, etc.). | `src/bot/constants.js`, wizard validation |
| **Cap** | Limit on conversions or budget; enforced via `caps_total`, `budget_cents`, `budget_xtr`. | `offers` table, `adsWizardScene` |
| **GEO targeting** | Whitelist of ISO country codes restricting traffic. | `geo_input`, `geo_list` columns; `parseGeoInput` |
| **Start token** | One-time token issued on click and consumed by `/start`. Stored alongside the click row. | `src/api/click.js`, `clicks.start_token` |
| **Attribution** | Mapping between Telegram user and click/offer, enabling conversion deduplication. | `attribution` table, `sendPostback` |
| **Postback** | HTTP notification sent to partner about a conversion. Signed with `CPA_PB_SECRET`. | `src/services/postback.js`, `postbacks` table |
| **CPA secret** | HMAC key appended as `X-Signature` header for partner integrations. | `CPA_PB_SECRET`, `sendPostback` |
| **Wizard** | Telegraf Scenes flow guiding advertisers through offer creation. | `src/bot/adsWizard.js` |
| **Debug token** | Shared secret for `/debug/*` HTTP endpoints and WhatsApp router. | `DEBUG_TOKEN`, `requireDebug` |
| **Link capture** | Middleware that logs shared Telegram invite links for manual review. | `src/bot/link-capture.js` |
