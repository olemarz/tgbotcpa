# Локальный запуск

## Предусловия
- Node.js 20+ (поддержка ES Modules, см. `package.json`).
- npm 10+ (идёт в комплекте с Node 20).
- PostgreSQL 14+ (локально или в Docker/облаке).

## Настройка окружения
1. Создайте файл `.env` в корне, взяв за основу [.env.example](../.env.example).
   - В шаблоне перечислены `BOT_TOKEN`, `BASE_URL`, `PORT`, `DATABASE_URL`, `CPA_POSTBACK_URL`, `CPA_PB_SECRET`, `ALLOWED_UPDATES`, `TZ`, `DEBUG_TOKEN`, `WEBHOOK_PATH` (поддерживается алиас `CPA_PB_URL`).
   - Обновите значения согласно [CONFIG_ENV.md](CONFIG_ENV.md) (минимум `BOT_TOKEN`, `BASE_URL`, `DATABASE_URL`, `CPA_POSTBACK_URL`/`CPA_PB_URL`, `CPA_PB_SECRET`).
2. (Опционально) Поднимите PostgreSQL в Docker:
   ```bash
   docker run --name tgbotcpa-pg -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=tgbotcpa -p 5432:5432 -d postgres:15
   export DATABASE_URL="postgres://postgres:postgres@localhost:5432/tgbotcpa"
   ```

## Установка зависимостей
```bash
npm ci
```

## Миграция БД
```bash
npm run migrate
```
Запускает `node src/db/migrate.js`, создавая таблицы `offers`, `clicks`, `start_tokens`, `attribution`, `events`, `postbacks`.

## Запуск сервисов
- **API (Express + webhook)**:
  ```bash
  npm run api
  # или npm start (тот же скрипт)
  ```
  Сервер слушает порт `PORT` (по умолчанию 3000) и логирует `API on <port>`.
- **Бот (long polling)**:
  ```bash
  NODE_ENV=dev npm run bot
  ```
  При `NODE_ENV=dev` и отсутствии `WEBHOOK_PATH` бот запустит polling и выведет `Bot polling on <port>`. Если задать `WEBHOOK_PATH`, Express примет webhook на этом пути (по умолчанию `/bot/webhook`).

## Smoke-тест
1. Убедитесь, что API запущен: `curl -s http://localhost:3000/health` → `{"ok":true}`.
2. Создайте тестовый оффер через сцену `/ads` в Telegram (нужен настоящий `BOT_TOKEN`).
3. Сымитируйте клик: `curl -I "http://localhost:3000/click/<offer_uuid>?uid=test123"` → редирект 302 на `https://t.me/<bot>?start=...`.

## Остановка
- Ctrl+C в терминале.
- Если использовался Docker для PostgreSQL: `docker stop tgbotcpa-pg`.
