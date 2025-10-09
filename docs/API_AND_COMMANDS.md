# HTTP API и команды бота

## Telegram-команды
| Команда | Что делает | Код | Пример использования |
|---------|------------|-----|----------------------|
| `/start` | Приветствие, ссылка на документацию (inline-кнопка). Требует импорта `Markup` в `src/bot/telegraf.js`. | `src/bot/telegraf.js`, строки 34-40 | После перехода по ссылке `/start` → бот отвечает приветствием.
| `/whoami` | Возвращает Telegram ID пользователя. | `src/bot/telegraf.js`, строки 42-48 | Пользователь пишет `/whoami` → ответ `Your Telegram ID: <id>`.
| `/ads` | Запускает сцену `ads-wizard` для создания оффера. | `src/bot/telegraf.js`, строка 50 | Ввести `/ads`, далее следовать шагам мастера (см. ниже).
| `/cancel` (внутри сцены) | Прерывает мастер. | `src/bot/adsWizard.js`, строка 398 | В любой момент сцены ввести `/cancel` → бот подтверждает отмену.

### Сцена `ads-wizard`
Файл `src/bot/adsWizard.js` реализует `Scenes.WizardScene` из 10 шагов:
1. **Старт** — хранит `ctx.from.id`, инициализирует объект оффера.
2. **Ввод URL** — проверка на `https://` и домен `t.me` (`ctx.reply` с ошибкой иначе).
3. **Выбор события** — кнопки с `EVENT_ORDER`, валидируется значение.
4. **Ставки** — запрашивает базовую и premium ставку, проверяет минимумы `config.MIN_RATES` и что premium ≥ base.
5. **Лимит (caps_total)** — принимает целое число ≥ 0.
6. **Caps window** — принимает `0/none` (нет окна), `N/(day|hour|week|month)` или JSON (`{ "size": 10, "unit": "day" }`).
7. **Временной таргетинг** — кнопки пресетов (`24/7`, `weekdays`, `business_hours`, `weekend`) или JSON `{ "BYDAY": [...], "BYHOUR": [...] }`.
8. **Название** — непустая строка, генерация slug из `slugify()`.
9. **Slug** — ввести `-` чтобы оставить, иначе проверка regexp и уникальности `slugExists()`.
10. **Подтверждение** — inline-кнопки «Создать/Отмена». При подтверждении выполняется `INSERT INTO offers ... RETURNING id` и отдаётся итоговый URL `https://<baseUrlHost>/click/<offerId>?uid={your_uid}`.

Валидации и вспомогательные функции:
- `ensureMinRate()` — сверяет ставки с `config.MIN_RATES` (строки 92-95).
- `parseCapsWindow()` — допускает `N/day` формат (строки 104-110).
- `formatTimeTargeting()` — выводит пресеты или JSON (строки 117-123).
- `ensureUniqueSlug()` — перебирает slug, пока не найдёт свободный (строки 75-85).

## HTTP API
| Метод и путь | Описание | Авторизация | Код |
|--------------|----------|-------------|-----|
| `POST /debug/seed_offer` | Создаёт оффер с произвольными параметрами (debug). Требует заголовок `x-debug-token`. | `x-debug-token == DEBUG_TOKEN` | `src/api/server.js`, строки 24-38 |
| `POST /debug/complete` | Отправляет тестовый постбек в CPA-сеть для оффера/uid. | `x-debug-token == DEBUG_TOKEN` | `src/api/server.js`, строки 44-55 |
| `GET /health` | Health-check, возвращает `{ ok: true }`. | Без авторизации | `src/api/server.js`, строка 58 |
| `POST /bot/webhook` | Проксирует обновления Telegram в Telegraf. | Telegram | `src/api/server.js`, строка 60 |
| `GET /click/:offerId` | Запись клика, выдача `start`-токена и редирект в Telegram. Валидирует UUID. | Без авторизации | `src/api/server.js`, строки 62-84 |
| `GET /s/:shareToken` | Заглушка share-click (TODO: учёт уникальности). | Без авторизации | `src/api/server.js`, строки 86-94 |
| `POST /postbacks/relay` | Принимает постбек от внешних ботов (нужны `offer_id`, `user_id`, `event`). Подписывает и ретранслирует в CPA. | Публичный (но проверяет атрибуцию) | `src/api/server.js`, строки 96-132 |

### Примеры curl
```bash
# Health-check
curl -s http://localhost:3000/health
# Debug seed (нужен DEBUG_TOKEN в ENV)
curl -H "x-debug-token: $DEBUG_TOKEN" -H "Content-Type: application/json" \
  -d '{"target_url":"https://t.me/example","event_type":"start_bot","name":"Test","slug":"test-offer","base_rate":10,"premium_rate":15}' \
  http://localhost:3000/debug/seed_offer
```

## Webhook Telegram
- Установить через `setWebhook` на `$BASE_URL/bot/webhook` (пример в `README.md`).
- PM2-процесс `tg-api` всегда держит API запущенным; webhook не требует отдельного процесса бота.

## TODO
- Реализовать учёт уникальных переходов в `/s/:shareToken` (см. комментарий TODO в коде).
- Исправить отсутствующие импорты (`config`, `Markup`, `crypto`) перед деплоем (P0 в ROADMAP).
