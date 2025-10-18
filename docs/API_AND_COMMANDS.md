# API & Commands

## Telegram commands

| Command | Audience | Description | Implementation |
| --- | --- | --- | --- |
| `/start` | All users | Entry point for CPA links and deep links. Dispatches to `handleStartWithToken` when payload is present, otherwise explains how to request access. | `src/bot/telegraf.js` (`bot.start`, `handleStartWithToken`) |
| `/ads` | Whitelisted advertisers | Launches the offer creation wizard (`adsWizardScene`). | `src/bot/telegraf.js`, `src/bot/adsWizard.js` |
| `/claim <TOKEN>` | QA / manual recovery | Redeems a previously issued invite token and replays onboarding. | `src/bot/telegraf.js` (`handleClaimCommand`) |
| `/whoami` | All users | Sends the Telegram ID and username for debugging. | `src/bot/telegraf.js` |
| `/help` | All users | Short instructions and support contact. | `src/bot/telegraf.js` |
| `/cancel` | Scene participants | Exits the current wizard state. | `src/bot/telegraf.js`, `adsWizardScene` |
| `/stat` | Whitelisted analysts | Opens stats dashboard with inline keyboard callbacks. | `src/bot/stat.js` |
| `/admin_offers`, `/offer_status` | Admin only (`ADMIN_TG_ID`) | Lists recently created offers and inspects status by ID. | `src/bot/telegraf.js` |

Additional developer shortcuts: `/go <offer_id> [uid]` synthesises a click and invokes onboarding; `/qa_click <offer_id>` seeds click attribution without hitting the public redirect.

## Ads wizard flow

The wizard lives in `src/bot/adsWizard.js` and stores state in PostgreSQL via `sessionStore`. Core stages:

1. **Target link** — validates Telegram join/chat links and persists `target_url`.
2. **Event type** — inline keyboard selection (`join_group`, `start_bot`, etc.).
3. **Payouts** — base and premium rates with minimum thresholds (`config.MIN_RATES`). High GEO codes add +30% (`adjustPayoutCents`).
4. **Budget** — budget in cents or stars, automatically defaults to payout when omitted.
5. **GEO targeting** — parsed by `parseGeoInput`; stores both raw input and normalized list.
6. **Offer metadata** — title, optional slug, campaign notes.
7. **Confirmation** — inserts row into `offers`, sends audit log and returns deep link + tracking URL.

Users can send `Назад` or `/back` to revisit previous steps. `/cancel` clears the session and exits the scene.

## HTTP & partner APIs

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness probe returning `{ ok: true }`. | None |
| `GET` | `/` | Basic JSON banner with service metadata. | None |
| `POST` | `/bot/webhook` | Telegram webhook handler. Validates `WEBHOOK_SECRET` when provided. | Telegram secret token (optional) |
| `GET` | `/click/:offerId` | Registers a click, stores attribution and redirects to `/start <token>`. Accepts `uid`, `sub`, `click_id`. | None |
| `POST` | `/offers` | Minimal REST endpoint to create offers (used by internal tools). | None |
| `GET` | `/api/offers` | Returns latest offers for admin dashboards. | `ADMIN_TOKEN` query or header |
| `POST` | `/api/offers` | Inserts a draft offer with adjusted payout. | `ADMIN_TOKEN` |
| `POST` | `/api/pay/:id` | Debug route to mark offers as paid. | `ADMIN_TOKEN` |
| `GET` | `/api/cpa/offers/:id` | Partner API exposing offer metadata (tracking URL, GEO, payout). | `X-Api-Key: ${CPA_API_KEY}` |
| `POST` | `/debug/complete` | Simulates conversion and posts back to CPA endpoint. | `X-Debug-Token: ${DEBUG_TOKEN}` |
| `GET` | `/debug/last` | Returns last clicks/events/postbacks for a Telegram ID. | `X-Debug-Token: ${DEBUG_TOKEN}` |
| `GET` | `/api/wa/*` | WhatsApp landing pages and lead collection. | `X-Debug-Token: ${DEBUG_TOKEN}` |

CPA postbacks are signed with `HMAC_SHA256` using `CPA_PB_SECRET` and delivered with a configurable timeout (`POSTBACK_TIMEOUT_MS`). Deduplication is enforced for `IDEMPOTENCY_TTL_SEC` seconds to avoid double crediting.
