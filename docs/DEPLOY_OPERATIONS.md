# DEPLOY & OPERATIONS

## Продакшен окружение
- Сервер: Linux (VPS), Node.js 20, PM2.
- Корневая директория приложения: `/opt/tgbotcpa`.
- PM2-процесс: `tg-api` (см. `ecosystem.config.cjs`).

## Ручной деплой (SSH)
```bash
ssh <user>@<host>
cd /opt/tgbotcpa
git fetch origin
git reset --hard origin/main
npm ci --omit=dev
npm run migrate   # при необходимости
pm2 reload tg-api || pm2 start ecosystem.config.cjs --only tg-api
pm2 save
```

### Проверки после деплоя
```bash
pm2 status tg-api
pm2 logs tg-api --lines 50
curl -s https://<BASE_URL_HOST>/health
```

## CI/CD деплой (GitHub Actions)
Workflow `.github/workflows/deploy.yml` запускается при пуше в `main`:
1. Checkout репозитория.
2. Поднимает `ssh-agent` и добавляет приватный ключ.
3. Делает `ssh-keyscan` для сервера.
4. Выполняет SSH-команды на сервере (`/opt/tgbotcpa`): `git reset --hard origin/main`, `npm ci --omit=dev`, `pm2 reload tg-api`.

### Секреты GitHub Actions
| Имя секрета | Назначение |
|-------------|------------|
| `SSH_HOST` | Хост продакшен-сервера. |
| `SSH_PORT` | Порт SSH (по умолчанию 22). |
| `SSH_USER` | Пользователь для деплоя. |
| `SSH_KEY` | Приватный ключ для `ssh-agent`. |
| `APP_DIR` | Директория приложения (по умолчанию `/opt/tgbotcpa`). |
| `PM2_NAME` | Название процесса PM2 (`tg-api`). |

## Health, Logs, Rollback
- **Health:** `curl -f https://<BASE_URL_HOST>/health` → должен вернуть `{"ok":true}`.
- **Логи:** `pm2 logs tg-api`, ошибки API также выводятся в stdout (постбеки, debug).
- **Rollback:**
  1. На сервере выполните `pm2 stop tg-api` (если нужно).
  2. `git checkout <previous-tag-or-sha>` в `/opt/tgbotcpa`.
  3. `npm ci --omit=dev` и `pm2 start ecosystem.config.cjs --only tg-api`.
  4. Проверьте `/health`.
- **Бэкап env:** храните `.env` вне git, например `/opt/tgbotcpa/.env`; перед деплоем убедитесь, что значения актуальны.

## Операционные заметки
- Debug endpoints (`/debug/*`) требуют `DEBUG_TOKEN`. Не оставляйте дефолт `dev-debug` в продакшене.
- Для горизонтального масштабирования потребуется внешнее хранилище сессий Telegraf (сейчас память процесса).
- Следите за задачей P0: `src/api/server.js` должен использовать `createApp()` иначе деплой упадёт.
