# Roadmap

## P0 — критично
1. **Исправить `src/bot/telegraf.js`**
   - Добавить `import { Markup } from 'telegraf';` и `import { config } from '../config.js';`.
   - Удалить дублирующее объявление `const stage = new Scenes.Stage(...)` (сейчас два раза, что вызывает синтаксическую ошибку).
   - Убедиться, что `bot.use(session())` вызывается один раз до `stage.middleware()`.
2. **Импортировать `crypto` в `src/api/server.js`** для `sendCpaPostback` (`crypto.createHmac`) — иначе ReferenceError при первом вызове `/debug/complete` или реального постбека.
3. **Проверить корректность `BOT_TOKEN` и `BASE_URL` в рантайме** — при отсутствии переменных `config` бросает исключение и падает весь сервис (нужно в мониторинге).
4. **Покрыть smoke-тестом webhook** — без рабочего `/bot/webhook` бот не принимает апдейты.

## P1 — важно
1. Добавить `./.env.example` с описанием всех переменных.
2. Реализовать учёт уникальности в `/s/:shareToken` (см. TODO в коде).
3. Удалить неиспользуемую зависимость `crypto-js` или задокументировать её использование.
4. Настроить CI/CD через GitHub Actions (см. DEPLOY_OPERATIONS.md).
5. Добавить обработку ошибок/ретраев для очереди `postbacks` (сейчас таблица не используется).

## P2 — желательно
1. Автоматические тесты для парсеров (`parseCapsWindow`, `ensureUniqueSlug`).
2. Метрики и оповещения (Sentry, Telegram-чат) по ошибкам бота и API.
3. Документация по схемам событий (`events`, `postbacks`) и интеграции с CPA-сетью.
4. Нормализовать хранение справочников (часть лежит в `src/constants/offers.js`, часть в `config.MIN_RATES`).
5. Добавить seed-скрипты для demo-данных.
