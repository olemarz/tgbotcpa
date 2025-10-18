# Roadmap

## P0 — Critical
- [ ] Harden webhook server with rate limiting and request logging (prevent abuse, aid incident response).
- [ ] Automate database backups and retention policy for `offers`, `clicks`, `events`, `postbacks` tables.
- [ ] Introduce monitoring/alerting (health endpoint checks, PostgreSQL connection metrics).

## P1 — Important
- [ ] Consolidate Express bootstrap so `src/api/server.js` reuses `createApp()` (single source of truth for middleware).
- [ ] Add integration tests for `/api/cpa/*` and `/api/offers` covering auth failures and success paths.
- [ ] Implement session eviction/TTL cleanup for Telegraf sessions to prevent unbounded growth.

## P2 — Enhancements
- [ ] Provide seed script for demo offer, click and conversion for quick onboarding (`npm run seed`).
- [ ] Publish CPA postback examples (JSON + signature instructions) in docs.
- [ ] Instrument conversion funnel metrics (clicks → attribution → postbacks) and expose via dashboard or logs.
- [ ] Localise advertiser wizard prompts (RU/EN) based on operator preference.
