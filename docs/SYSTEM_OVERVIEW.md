# Архитектура и потоки системы

## Общий обзор
- **Ядро** — Node.js 20+ с модульной системой ES Modules (`type: "module"` в `package.json`).
- **Бэкенд-API** — Express-приложение `src/api/server.js`, которое поднимает HTTP-сервер, обслуживает вспомогательные debug-эндпоинты, основной `/click`-редирект и Telegram webhook.
- **Бот** — Telegraf 4 (`src/bot/telegraf.js`, `src/bot/run-bot.js`), использующий сцены (`Scenes.Stage`) и сессию (`session()`), основная сцена — `adsWizard`.
- **Данные** — PostgreSQL, подключение через `pg.Pool` (`src/db/index.js`), миграции выполняются SQL-скриптом `src/db/migrate.js`.
- **Процесс-менеджер** — PM2 (`ecosystem.config.cjs`) с единым процессом `tg-api`, который стартует `src/api/server.js`.

## Модули и зависимости
| Блок | Файл | Назначение | Внешние зависимости |
|------|------|------------|---------------------|
| Конфигурация | `src/config.js` | Загружает ENV через `dotenv/config`, валидирует обязательные переменные, задаёт константы (минимальные ставки, часовой пояс) | `dotenv`
| HTTP API | `src/api/server.js` | Express-приложение: debug endpoints, redirect `/click`, relay постбеков, health-check, webhook | `express`, `body-parser`, `axios`
| Telegram | `src/bot/telegraf.js` | Инициализация бота, регистрация сцен, команд и текстового fallback | `telegraf`
| Сцена /ads | `src/bot/adsWizard.js` | Мастер создания оффера: пошаговая валидация и запись в БД | `telegraf`, `pg`
| Утилиты | `src/util/*` | UUID, короткие токены, HMAC, slugify | `node:crypto`
| БД | `src/db/index.js`, `src/db/migrate.js` | Пул соединений и SQL-миграция схемы | `pg`

## Поток данных
1. **Трафик → /click** (`src/api/server.js`, строки 57-83): сохраняет клик в таблицу `clicks`, выдаёт короткий токен (30 мин TTL в `start_tokens`) и редиректит в бот `https://t.me/<bot>?start=<token>`.
2. **Webhook** (`/bot/webhook` в `src/api/server.js`, строки 49-51) проксирует запрос в `bot.handleUpdate`. Для локального polling есть `src/bot/run-bot.js`.
3. **Обработка апдейтов**:
   - Инициализация Telegraf и сессий (`src/bot/telegraf.js`, строки 1-33).
   - Middleware-логгер (`src/bot/telegraf.js`, строки 16-27).
   - Команды `/start`, `/whoami`, `/ads`, текстовый echo (`src/bot/telegraf.js`, строки 34-65).
   - Сцена `adsWizard` обрабатывает `/ads` (файл `src/bot/adsWizard.js`) и после подтверждения записывает оффер в таблицу `offers`.
4. **Атрибуция и постбеки**:
   - Таблица `attribution` хранит связь `user_id` ↔ `uid` (`src/db/migrate.js`).
   - Endpoint `/postbacks/relay` (`src/api/server.js`, строки 100-132) принимает постбеки от сторонних ботов: ищет `uid` в `attribution`, подписывает payload через HMAC и отправляет в CPA-сеть (`axios.post`).
   - Отдельная функция `sendCpaPostback` используется для debug-завершения (`/debug/complete`).

## Интеграции
- **PostgreSQL**: все записи кликов, атрибуций и офферов проходят через `query()` (`src/db/index.js`).
- **CPA-сеть**: webhook и relay отправляют HTTP POST на `config.cpaPostbackUrl` (`src/api/server.js`, строки 40-44, 123-125).
- **Telegram**: Telegraf бот, работает либо через webhook (`webhookCallback`), либо через polling (`src/bot/run-bot.js`).

## Обработка сцен
- `adsWizard` регистрируется как сцена `ads-wizard` и запускается командой `/ads` (`src/bot/telegraf.js`, строка 50).
- Внутри сцены шаги: ввод URL, выбор события, ставки, лимиты, время, название, slug, подтверждение, сохранение (детали в `API_AND_COMMANDS.md`).

## Известные ограничения
- В `src/bot/telegraf.js` отсутствует импорт `config` и `Markup`, а `Scenes.Stage` создаётся дважды — это критичный баг запуска (зафиксировано в ROADMAP).
- В `src/api/server.js` используется `crypto.createHmac`, но модуль `crypto` не импортирован — постбеки CPA упадут (ROADMAP).
