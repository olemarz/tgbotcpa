# System overview

## Entry points

- **Express webhook server** — `src/api/server.js` bootstraps an Express app, registers health checks, webhook guard and admin APIs, then delegates updates to `bot.handleUpdate`.
- **Telegraf bot** — initialisation lives in `src/bot/telegraf.js`; long polling helper in `src/bot/run-bot.js` is used for local development.
- **Configuration** — `src/config.js` collects environment variables, validates URLs and exposes derived values (`config`).
- **Database** — PostgreSQL pool and helpers reside in `src/db/index.js`; migrations are applied via `src/db/migrate.js`.

## Module layout

| Directory | Purpose |
| --- | --- |
| `src/api/` | Express routes for webhook, click tracking, CPA partner API, debug tooling. |
| `src/bot/` | Telegraf scenes, commands, session store, auxiliary middleware. |
| `src/constants/` | Domain constants (event types, limits). |
| `src/integrations/` | Ad network and WhatsApp helpers. |
| `src/services/` | Business logic for postbacks, conversions, join checks. |
| `src/util/` & `src/utils/` | Shared helpers (IDs, pricing, Telegram utilities, validation). |
| `tests/` | Node test runner suites covering click redirect, debug tools, postback signing. |

## Data flow

1. **Clicks** — Users land on `/click/:offerId`. The handler validates the offer, stores a click row, creates a short start token and redirects to `https://t.me/${botUsername}?start=${token}`.
2. **Onboarding** — `/start` with payload reaches the webhook. `handleStartWithToken` links the Telegram user to the click (`attribution`), renders CTA buttons and, when relevant, writes audit logs.
3. **Wizard** — `/ads` triggers `adsWizardScene` which collects offer data, enforces minimum payouts, normalises GEO inputs and inserts into `offers` while logging actions to `offer_audit_log`.
4. **Events & conversions** — Join updates and manual callbacks run through `approveJoin`/`createConversion`, generate `events` rows and queue CPA postbacks (`postbacks`).
5. **Postbacks** — `sendPostback` signs payloads with `CPA_PB_SECRET` and retries on failure. Deduplication is enforced by storing `idempotency_key` and `dedup_key`.
6. **Partner API** — `/api/cpa/offers/:id` exposes offer metadata to trusted partners authorised via `X-Api-Key`.

## Telegram update handling

- Middleware: sessions stored in PostgreSQL via `sessionStore`, optional `link-capture` logs suspicious invite links when enabled.
- Commands: `/start`, `/ads`, `/claim`, `/whoami`, `/help`, `/cancel`, `/stat`, plus admin commands for offer inspection.
- Callbacks: Stats keyboard, manual conversion checks and wizard inline buttons are processed with `bot.action` handlers.
- Error handling: `bot.catch` logs stack traces; ensure production logs are aggregated via PM2 or external logging.

## External integrations

- **PostgreSQL** for persistent state (`DATABASE_URL`).
- **CPA endpoint** defined by `CPA_POSTBACK_URL`; signed requests with `CPA_PB_SECRET`.
- **Telegram Bot API** for webhook updates and inline keyboards.
- **PM2** handles process supervision using `ecosystem.config.cjs`.
- **GitHub Actions** run tests (`.github/workflows/test.yml`) and deploy over SSH (`deploy.yml`).

## Observability

- Health check: `GET /health` returns `{ ok: true }` from both the webhook server and the app built by `createApp()`.
- Logs: `console.log`/`console.error` are used across the app; PM2 captures stdout/stderr. Consider adding structured logging for production.
- Metrics: Not yet instrumented. Suggested next steps include Prometheus exporter or log-based dashboards (see [docs/ROADMAP.md](./ROADMAP.md)).
