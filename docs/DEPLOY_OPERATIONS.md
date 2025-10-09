# Деплой и эксплуатация

## Среда продакшена
- Сервер (VPS) с Node.js 20+, PM2 и PostgreSQL (или доступ к управляемой БД).
- Рабочий каталог приложения: `/opt/tgbotcpa`.
- PM2-конфигурация: `ecosystem.config.cjs`, процесс `tg-api` (запускает `src/api/server.js`).

## Ручной деплой через SSH
```bash
ssh $SSH_USER@$SSH_HOST -p $SSH_PORT <<'REMOTE'
set -e
cd /opt/tgbotcpa
git fetch --all
git checkout main
git pull --ff-only
npm ci
npm run migrate
pm2 reload ecosystem.config.cjs --only tg-api
pm2 save
REMOTE
```
- Убедитесь, что `.env` заранее создан и актуален на сервере: файл не поставляется из репозитория, обновляйте его отдельно (scp или `rsync`).
- После `pm2 reload` проверьте `pm2 status tg-api`.

## CI/CD через GitHub Actions (идея)
> TODO: Настроить workflow `.github/workflows/deploy.yml`, который при push в `main` делает SSH-деплой.

Предлагаемая схема шага деплоя:
1. `actions/checkout` → сбор информации.
2. `appleboy/ssh-action` или аналог с секретами:
   - `SSH_HOST`
   - `SSH_PORT`
   - `SSH_USER`
   - `SSH_KEY`
   - `APP_DIR=/opt/tgbotcpa`
   - `PM2_NAME=tg-api`
3. Выполнить те же команды, что и в ручном сценарии.

## Секреты и конфигурация
Файл `.env` хранится в `${APP_DIR}` на сервере и поддерживается вручную — он не деплоится автоматически и требует отдельного обновления при изменениях переменных.
| Имя секрета | Назначение |
|-------------|------------|
| `SSH_HOST` | IP/домен сервера |
| `SSH_PORT` | Порт SSH (обычно 22) |
| `SSH_USER` | Пользователь деплоя |
| `SSH_KEY` | Приватный ключ для GitHub Actions |
| `APP_DIR` | `/opt/tgbotcpa` |
| `PM2_NAME` | `tg-api` |
| ENV (`BOT_TOKEN`, `DATABASE_URL`, `CPA_POSTBACK_URL`, `CPA_PB_SECRET`, `BASE_URL`, `DEBUG_TOKEN`, ...) | Хранятся в `.env` на сервере |

## Health-check
```bash
curl -s https://<BASE_URL>/health
```
Ожидаемый ответ: `{"ok":true}`.

## Логи
- `pm2 logs tg-api`
- `pm2 status`
- При необходимости `pm2 reloadLogs tg-api`

## Rollback
1. На сервере выполнить `pm2 stop tg-api` (при аварии) или `pm2 reload ...` на предыдущем коммите.
2. `git checkout <previous-tag-or-commit>`.
3. `npm ci` (если изменялись зависимости).
4. `npm run migrate` **только если миграция обратима**; иначе пропустить и выполнить ручной откат БД.
5. `pm2 start ecosystem.config.cjs --only tg-api` и `pm2 save`.

## Мониторинг
- Подключите уведомления PM2 (pm2 plus) или внешнюю систему (Grafana, Healthchecks.io) к `GET /health`.
- Отдельно отслеживайте тайминги отправки CPA-постбеков (`axios` в `src/api/server.js`).

## TODO
- Добавить автоматический GitHub Actions pipeline.
- Настроить оповещения по ошибкам (Sentry/Telegram чат) — сейчас ошибки только логируются в stdout.
