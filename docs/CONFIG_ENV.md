# Configuration & Environment

This project relies on `.env` (or deployment secrets) loaded through `dotenv`. The canonical reference lives in [DOCS/ENV.md](../DOCS/ENV.md). Key highlights:

- **Core requirements**: `BOT_TOKEN`, `BASE_URL`, `DATABASE_URL` must be present or the app will terminate during boot (`buildConfig`).
- **Security tokens**:
  - `ADMIN_TOKEN` protects admin HTTP endpoints.
  - `ADMIN_TG_ID` unlocks admin bot commands.
  - `WEBHOOK_SECRET` enables Telegram secret-token validation.
  - `CPA_API_KEY` locks down `/api/cpa/*` partner routes.
  - `DEBUG_TOKEN` guards debug tooling (`/debug/*`, `/api/wa/*`).
- **CPA integration**: Set `CPA_POSTBACK_URL` and `CPA_PB_SECRET` to forward conversions. Optionally tweak `POSTBACK_TIMEOUT_MS` and `IDEMPOTENCY_TTL_SEC` to match partner SLAs.
- **Wizard access**: Provide comma-separated Telegram IDs through `ADS_MASTERS` (or legacy aliases `ADS_WIZARD_ADMINS`, `ADS_WIZARD_WHITELIST`).
- **Pricing controls**: `HIGH_GEO_LIST` (e.g. `US,CA,GB`) increases payouts by 30% for specified GEO codes.
- **Operational tweaks**: `WEBHOOK_PATH`, `BIND_HOST`, `PORT`, `TZ`, `NODE_ENV`, `DISABLE_LINK_CAPTURE`.

For local development duplicate `ecosystem.env` and adjust secrets. Production deployments should rely on secure secret storage (Ansible vault, environment manager, etc.) rather than committed files.
