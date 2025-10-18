# Data & Migrations

## Migration tooling

- `npm run migrate` executes `src/db/migrate.js`. The script applies SQL files under `src/db/migrations/` and records progress in `_migrations`.
- Migrations run inside a transaction per file and are idempotent (`IF NOT EXISTS`).
- When `SEED=1`, SQL files from `src/db/seeds/` are executed to pre-populate demo data.
- Connection string is sourced from `DATABASE_URL`. In tests (`pgmem://`) the shared pool is reused.

## Schema highlights

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `offers` | Advertiser offers created via bot or APIs. | `target_url`, `event_type`, `payout_cents`, `budget_cents`, `geo_input`, `geo_list`, `status`, `created_by_tg_id`, `tracking_url`. |
| `clicks` | Raw CPA click records feeding attribution. | `offer_id`, `uid`, `click_id`, `start_token`, `tg_id`, `subs`, `ip`, `ua`, `used_at`. |
| `attribution` | Maps Telegram users to offers/clicks. | `tg_id`, `offer_id`, `uid`, `state`, `first_seen`, `last_seen`, `is_premium`. |
| `events` | Target actions detected by the bot (join, start, etc.). | `type`, `tg_id`, `offer_id`, `payload`, `idempotency_key`. |
| `postbacks` | Delivery log for CPA postbacks. | `status`, `http_status`, `dedup_key`, `last_try_at`, `attempts`, `payload`. |
| `offer_audit_log` | Audit trail for wizard actions. | `action`, `user_id`, `chat_id`, `details`. |
| `sessions` | Telegraf session storage. | `key`, `session jsonb`, TTL metadata. |

Refer to the SQL files for the exact column set (`src/db/migrations/*.sql`).

## Operational notes

- Re-running `npm run migrate` is safe; already applied files are skipped.
- Always back up `offers`, `clicks`, `attribution`, `events`, `postbacks`, `offer_audit_log` before destructive schema changes.
- Use `psql $DATABASE_URL` or `npm run doctor` to verify connectivity prior to migration windows.
- Seeds are optional and should not be enabled in production environments.
