# CONFIG & ENV

| Переменная | Тип | Обязательна | Значение по умолчанию | Где используется | Риски/примечания |
|------------|-----|-------------|-----------------------|------------------|------------------|
| `BOT_TOKEN` | `string` (Telegram bot token) | Да | — | Загружается в `src/config.js`, передаётся в `Telegraf(config.botToken)` (`src/bot/telegraf.js`). | Без токена бот и API не стартуют (`config` бросает исключение). |
| `BASE_URL` | `url` | Да | — | `config.baseUrl`, `config.baseUrlHost` для генерации ссылок `https://<host>/click/...` в мастере (`adsWizard`). | Некорректный URL ломает редирект и валидацию; используется при генерации итоговых ссылок рекламодателям. |
| `PORT` | `number` | Нет (но рекомендуется) | `3000` | Порт HTTP сервера (`config.port`, слушается в `src/api/server.js`). | Невалидное значение → ошибка при запуске (валидируется `Number.parseInt`). |
| `DATABASE_URL` | `postgres connection string` | Да | Передаётся в `pg.Pool` (`src/db/index.js`). | Без подключения операции `query()` падают; требуется доступ Postgres. |
| `CPA_POSTBACK_URL` | `url` | Да (можно через alias `CPA_PB_URL`) | — | URL для отправки постбеков (`sendCpaPostback`, `/postbacks/relay`). | Неверный URL → ошибки сети; прод-логика постбеков не работает. |
| `CPA_PB_URL` | `url` | Alias | — | Альтернативное имя для `CPA_POSTBACK_URL` (см. `buildConfig`). | Используется, если исторически переменная называлась иначе. |
| `CPA_PB_SECRET` | `string` | Нет, но рекомендуется | Если пусто — `config` выводит warning и подставляет `'dev-secret'`. | Секрет для подписи HMAC (`sendCpaPostback`, `hmacSHA256Hex`). | В проде обязательна для безопасности; fallback `'dev-secret'` оставляет подписи предсказуемыми. |
| `ALLOWED_UPDATES` | `string` (CSV) | Нет | `''` → `[]` | Используется в `config.allowedUpdates` (можно пробросить в Telegraf при webhook setup). | При пустом массиве Telegram шлёт все типы апдейтов. |
| `TZ` | `string` (IANA timezone) | Нет | `Europe/Rome` | Используется в `config.tz`; влияет на cron/даты, если будут добавлены. | Уточняйте при развёртывании в других регионах. |
| `DEBUG_TOKEN` | `string` | Нет, но обязателен для debug-endpoints | — | Сравнивается в middleware `requireDebug` (`src/api/app.js`). | Без него доступ к `/debug/*` закрыт (401); установите уникальное значение. |
| `WEBHOOK_PATH` | `string` (путь) | Нет | `''` → по умолчанию `/bot/webhook` | Используется в `config.webhookPath` и Telegraf webhook (`bot.webhookCallback`). | Если изменить, нужно обновить webhook в Telegram. |
| `NODE_ENV` | `string` | Нет | `undefined` | Логика автозапуска polling (`src/bot/telegraf.js`) активируется, если `NODE_ENV === 'dev'` и webhook не задан. | Убедитесь, что в проде значение не `dev`, иначе бот попытается включить polling. |

## Источники значений
- `.env.example` содержит базовый шаблон.
- `src/config.js` валидирует и нормализует переменные.
- `tests/setup-env.js` и `src/config.test.js` задают тестовые значения.

## Настройка webhook
Команда установки webhook (из README) использует `BOT_TOKEN`, `BASE_URL` и необязательный список `ALLOWED_UPDATES`. Убедитесь, что `WEBHOOK_PATH` совпадает с тем, что передаётся в запрос `setWebhook`.
