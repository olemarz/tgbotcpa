# SYSTEM OVERVIEW

## Архитектура и точки входа
- **HTTP API / вебхук** — Express-приложение создаётся в `src/api/app.js` (функция `createApp`) и поднимается через `src/api/server.js`. Конфигурация PM2 указывает на `src/api/server.js`, процесс называется `tg-api` (`ecosystem.config.cjs`).
- **Telegram-бот** — основная инициализация Telegraf и сцены описаны в `src/bot/telegraf.js`; точка запуска long polling для разработки — `src/bot/run-bot.js`.
- **Конфигурация** — сбор переменных окружения в `src/config.js`, экспорт `config` используется и в API, и в боте.
- **База данных** — подключение к PostgreSQL через пул `pg.Pool` в `src/db/index.js`; миграции запускаются скриптом `src/db/migrate.js`.

> ⚠️ Поскольку `src/api/server.js` напрямую использует `express` и `body-parser`, но не импортирует их (см. файл), сервер в текущем состоянии не стартует. В `ROADMAP.md` помечено как P0 с рекомендацией использовать `createApp()`.

## Модули и директории
| Директория | Назначение |
|------------|------------|
| `src/api/` | HTTP-эндпоинты (`/health`, `/click/:offerId`, `/postbacks/relay`, debug-хуки) и webhook для бота. |
| `src/bot/` | Логика Telegraf: сцены (`adsWizard.js`), команды (`telegraf.js`), запуск polling (`run-bot.js`). |
| `src/constants/` | Доменные константы (типы событий). |
| `src/db/` | Подключение к БД, вспомогательные операции (insert audit). |
| `src/util/` | Генерация UUID/short token, HMAC. |
| `tests/` | Smoke-тесты API (Jest + Supertest) и подготовка env. |

## Поток данных и интеграции
1. **Входной трафик**: пользователь CPA сети получает ссылку вида `GET /click/:offerId`. Контроллер сохраняет клик в таблицу `clicks`, генерирует короткий `start`-токен (`start_tokens`) и редиректит в Telegram (`src/api/app.js`, `app.get('/click/:offerId', ...)`).
2. **Старт в боте**: пользователь запускает бота с `start`-токеном. В webhook (`/bot/webhook`) Telegraf сопоставляет `start_tokens` → `attribution` в сцене `ads-wizard` (подробнее в `API_AND_COMMANDS.md`).
3. **Мастер создания оффера**: рекламодатель проходит сцену `/ads`, бот валидирует ввод и создаёт запись `offers` (`src/bot/adsWizard.js`). Параллельно записываются аудит-логи (`insertOfferAuditLog`).
4. **Трекинг событий**: бот реагирует на обновления Telegram (реакции, join, comment) и пишет их в таблицу `events` (см. хендлеры внутри `adsWizard.js`, секция подтверждения — поиск `query('INSERT INTO offers ...')`).
5. **Постбеки**: завершённые события отправляются в CPA сеть через `sendCpaPostback`, используется HMAC-подпись (`src/api/app.js`, `axios.post(config.cpaPostbackUrl, ...)`). Дополнительно, интеграция для внешних ботов (`POST /postbacks/relay`) ищет атрибуцию и отправляет постбек.
6. **Debug-инструменты**: эндпоинты `/debug/seed_offer` и `/debug/complete` доступны только с заголовком `x-debug-token`, помогают быстро подготовить данные для тестов.

## Обработка обновлений Telegram
- Все апдейты проходят middleware-лог (`bot.use` в `src/bot/telegraf.js`).
- Сессии пользователей хранятся в памяти Telegraf (`session()`), что важно при деплое — несколько инстансов потребуют внешнее хранилище.
- Сцены подключаются через `Scenes.Stage`, основная сцена — `adsWizard` (идентификатор `ads-wizard`). Команда `/ads` переводит пользователя в мастер, `/whoami` выдаёт Telegram ID, `/start` показывает приветствие.
- Обработчик `bot.on('text')` работает как fallback echo вне сцены.

## Внешние зависимости
- **PostgreSQL** — хранение офферов, кликов, атрибуции, событий, аудита, postback-очереди.
- **CPA сеть** — HTTP POST (`config.cpaPostbackUrl`) с подписью HMAC SHA256 (`config.cpaSecret`).
- **PM2** — процесс-менеджер для продакшена; конфиг `ecosystem.config.cjs` использует переменные из `.env`.
- **GitHub Actions** — CI (`.github/workflows/test.yml`) и деплой по SSH (`deploy.yml`).

## Логирование и мониторинг
- Бот логирует каждое обновление (`console.log` в middleware) и ошибки отправки сообщений.
- API логирует ошибки отправки постбеков и работы debug endpoints.
- Локальный health-check: `GET /health` возвращает `{ ok: true }`.
