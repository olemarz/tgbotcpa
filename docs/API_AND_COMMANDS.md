# API И КОМАНДЫ

## Telegram-команды
| Команда | Описание | Где реализовано | Ответ/действие |
|---------|----------|-----------------|----------------|
| `/start` | Старт-обработчик CPA-ссылок. | `src/bot/telegraf.js` (`bot.start`) | При наличии payload вызывает `handleStartWithToken()`. Без payload объясняет, как использовать `/claim <TOKEN>`. |
| `/whoami` | Отправляет пользователю его Telegram ID. | `src/bot/telegraf.js` (`bot.command('whoami')`) | Текст `Your Telegram ID: <id>`. Ошибки логируются. |
| `/ads` | Запускает сцену мастера создания оффера. | `src/bot/telegraf.js` (`ctx.scene.enter('ads-wizard')`) | Пользователь переводится в сцену `adsWizard`, дальше шаги ниже. |
| `/claim <TOKEN>` | QA-фолбэк, вручную запускает `handleStartWithToken()` по токену. | `src/bot/telegraf.js` (`bot.hears(/^\/claim ...)`) | Валидация токена, связывает `clicks` ↔ `tg_id`, отвечает кнопкой вступления/«Готово». |
| `/go <offer_id> [uid]` | QA-ярлык: создаёт синтетический `click` и сразу обрабатывает старт. | `src/bot/telegraf.js` (`bot.hears(/^\/go ...)`) | Проверяет оффер, генерирует base64url-токен ≤64 символов, вызывает `handleStartWithToken()`. |
| Любой текст вне сцены | Эхо-ответ с `echo: <текст>`. | `src/bot/telegraf.js` (`bot.on('text')`) | Отправляет echo, если пользователь не в сцене и сообщение не команда. |

## Сцена `adsWizard`
Файл: `src/bot/adsWizard.js`. Сцена содержит последовательность шагов (`Step.*`), валидирует ввод и сохраняет оффер. Основные шаги:
1. **Ввод ссылки** (`Step.TARGET_URL`): проверка формата `https://t.me/...`, hostname ∈ {t.me, telegram.me, telegram.dog}. Инвайт-ссылки (`t.me/+...`) не принимаются.
2. **Выбор типа события** (`Step.EVENT_TYPE`): inline-клавиатура (`buildEventKeyboard`) с типами из `EVENT_TYPES`. После выбора сохраняется `event_type`.
3. **Базовая ставка** (`Step.BASE_RATE`): число с точностью до копеек. Минимум берётся из `config.MIN_RATES[event_type].base`.
4. **Премиум-ставка** (`Step.PREMIUM_RATE`): не может быть ниже базовой либо минимального порога для премиума (`config.MIN_RATES[event_type].premium`).
5. **Общий кап** (`Step.CAPS_TOTAL`): целое число ≥ 0. Ноль означает отсутствие ограничения.
6. **Геотаргетинг** (`Step.GEO_TARGETING`): пустая строка/«0» — без ограничений. Любой другой ввод парсится через `parseGeoInput` и сохраняется в виде whitelist.
7. **Название** (`Step.OFFER_NAME`): произвольная непустая строка, также сохраняется в `offer.name`.
8. **Slug** (`Step.OFFER_SLUG`): отображается авто-slug (результат `slugify`). Пользователь может оставить `-` или ввести собственный slug (до 60 символов, латиница/цифры/дефис). После валидации вызывается `ensureUniqueSlug`, создаётся запись `offers`, пишется аудит и отправляется итоговая ссылка `buildTrackingUrl()`.

Дополнительно:
- Команды **«Отмена»/`/cancel`** завершают сцену (`cancelWizard`).
- **«Назад»/`/back`** возвращают к предыдущему шагу.
- При ошибках валидации бот повторяет шаг с пояснением.

Токены старта валидируются по алфавиту base64url (`A-Z`, `a-z`, `0-9`, `_`, `-`) и длине ≤ 64 символа.

## HTTP API
Файл: `src/api/app.js`.

| Метод и путь | Назначение | Требования | Ответ |
|--------------|------------|------------|--------|
| `GET /health` | Health-check приложения. | Нет. | `{ "ok": true }`. |
| `POST /bot/webhook` | Приём Telegram update через webhook. | Telegram должен слать JSON. | Всегда 200 (Telegraf webhook). |
| `GET /click/:offerId` | Регистрация клика из CPA сети, генерация `start`-токена, редирект в бота. | `offerId` должен быть UUID; query должен содержать `sub`/`uid`/`click_id`. | 400 при ошибках; 302 редирект в `https://t.me/<bot>?start=<token>`. |
| `GET /s/:shareToken` | Упрощённый счётчик «share». | Нет обязательных параметров. | 302 редирект (по умолчанию `https://t.me`). TODO: уникальный подсчёт. |
| `POST /postbacks/relay` | Получение внешнего постбека (например, от бота рекламодателя) и ретрансляция в CPA сеть. | Тело должно содержать `offer_id`, `user_id`, `event`; требуется существующая атрибуция (`attribution`). | 200 `{ ok: true }` при успехе; 404, если нет атрибуции; 502 при ошибке CPA. |
| `POST /debug/seed_offer` | Быстрое создание оффера для теста. | Заголовок `x-debug-token` = `process.env.DEBUG_TOKEN`. | `{ ok: true, offer_id }` или 401/500. |
| `POST /debug/complete` | Триггер ручного постбека в CPA. | Тот же debug-token; тело: `offer_id`, `uid`, опционально `status`. | `{ ok: true }` или ошибки. |

### CPA Postback
`sendCpaPostback(payload)` формирует подпись `X-Signature = HMAC_SHA256(body, config.cpaSecret)` при наличии `CPA_PB_SECRET`. Таймаут запроса — 4 секунды (конфигурируется). Ошибки логируются с `offer_id`, `uid`, `event`.

### Авторизация debug-endpoints
Middleware `requireDebug` в `src/api/app.js` сравнивает `x-debug-token` и `process.env.DEBUG_TOKEN`. При отсутствии заголовка или неверном значении — 401.
