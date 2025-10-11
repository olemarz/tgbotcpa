# RUN LOCAL

## Требования
- Node.js 20.x (совместимо с GitHub Actions и README).
- npm 10+ (поставляется с Node 20).
- PostgreSQL 14+ (любой совместимый инстанс, локально или через Docker).

## Подготовка окружения
```bash
cp .env.example .env
# отредактируйте BOT_TOKEN, BASE_URL, DATABASE_URL, CPA_POSTBACK_URL, CPA_PB_SECRET
```

Пример запуска PostgreSQL через Docker:
```bash
docker run --name tgbotcpa-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

## Установка зависимостей
```bash
npm ci
```

## Миграции БД
```bash
npm run migrate
# скрипт вызывает src/db/migrate.js и создаёт таблицы offers, clicks, start_tokens, attribution, events, postbacks, offer_audit_log
```

## Запуск API и бота
⚠️ **Важно:** текущая версия `src/api/server.js` не использует `createApp()` и не импортирует `express`, поэтому падает при запуске. До исправления P0 (см. ROADMAP) используйте прямой запуск `createApp()` из REPL:
```bash
node -e "import('./src/api/app.js').then(({createApp})=>{const app=createApp();app.listen(3000,()=>console.log('API on 3000 (manual)'));})"
```

Для локального long polling бота (без вебхука):
```bash
NODE_ENV=dev npm run bot
# вывод: Bot launched (long polling)
```

### QA-ярлыки для проверки старта
- `/claim <TOKEN>` — вручную отрабатывает старт-токен, если Telegram не передал payload в `/start`.
- `/go <offer_id> [uid]` — создаёт синтетический `click`, генерирует base64url-токен (≤64 символов) и сразу вызывает старт-обработчик.

Оба сценария логируются через `logUpdate()` с указанием `startPayload` и типа апдейта.

## Smoke-тесты
После запуска API:
```bash
curl -s http://localhost:3000/health
# {"ok":true}
```

Проверка redirect:
```bash
curl -I "http://localhost:3000/click/<offer_uuid>?click_id=test"
# HTTP/1.1 302 Found
# location: https://t.me/<bot>?start=<token>
```

## Завершение работы
- Остановите локальный сервер (`Ctrl+C`) или контейнер Postgres (`docker stop tgbotcpa-db`).
- Очистите временные данные, если использовали debug endpoints (`DELETE FROM offers ...`).
