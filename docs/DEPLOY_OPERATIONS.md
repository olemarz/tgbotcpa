# Deploy & Operations

## Production environment

- Target OS: Linux (Ubuntu/Debian). Install Node.js 20.x and PM2 globally (`npm install -g pm2`).
- Application path: `/opt/tgbotcpa` (adjust in `ecosystem.config.cjs` or PM2 ecosystem).
- PM2 process name: `tg-api`; script entry is `src/api/server.js`.
- The HTTP server listens on `${BIND_HOST:-127.0.0.1}:${PORT:-8000}`. Put Nginx/Caddy in front to terminate TLS and forward to the internal port.

## Manual deployment over SSH

```bash
ssh <user>@<host>
cd /opt/tgbotcpa
git fetch origin
git reset --hard origin/main
npm ci --omit=dev
cp /opt/tgbotcpa/.env.example /opt/tgbotcpa/.env # optional, ensure secrets are present
npm run migrate
pm2 restart tg-api || pm2 start ecosystem.config.cjs --only tg-api
pm2 save
```

Post-deploy verification:

```bash
pm2 status tg-api
pm2 logs tg-api --lines 120
curl -fsS http://127.0.0.1:${PORT:-8000}/health
```

## CI/CD deployment (GitHub Actions)

If you rely on the provided workflow (`.github/workflows/deploy.yml`):

1. Checkout repository and install dependencies.
2. Provision SSH credentials via secrets (`SSH_HOST`, `SSH_USER`, `SSH_KEY`, etc.).
3. Execute remote commands: `git reset --hard`, `npm ci --omit=dev`, `npm run migrate`, `pm2 restart tg-api`.
4. Optionally trigger smoke checks (`curl /health`).

Ensure the following secrets are configured in the repository:

| Secret | Purpose |
| --- | --- |
| `SSH_HOST`, `SSH_PORT` | Destination host and port. |
| `SSH_USER` | Remote user with deployment rights. |
| `SSH_KEY` | Private key for the deployment user. |
| `APP_DIR` | Remote application directory (defaults to `/opt/tgbotcpa`). |
| `PM2_NAME` | PM2 process name (`tg-api`). |

## Health, logs & rollback

- Health check: `curl -f https://<public-host>/health` should return `{ "ok": true }`.
- Logs: `pm2 logs tg-api --lines 200` (webhook, postbacks and bot errors log to stdout).
- Rollback strategy:
  1. `git checkout <stable-sha>` in `/opt/tgbotcpa`.
  2. `npm ci --omit=dev` to sync dependencies.
  3. `pm2 restart tg-api` and confirm `/health`.
- Keep `.env` outside version control; review secrets during each deployment.

## Operational reminders

- Debug endpoints require `DEBUG_TOKEN`. Use long, random values in production.
- Monitor database growth for `clicks` and `events`; schedule pruning if volume exceeds storage budget.
- Update webhook (`setWebhook`) after changing `PUBLIC_BASE_URL`, `WEBHOOK_PATH` or TLS certificates.
- Scale horizontally only after introducing a shared session backend (current store relies on PostgreSQL via `sessionStore`).
