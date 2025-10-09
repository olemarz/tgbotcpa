# Глоссарий

| Термин | Определение | Где встречается |
|--------|-------------|-----------------|
| **Offer / оффер** | Рекламное размещение с URL, типом события и ставками. | Таблица `offers`, сцена `/ads` (`src/bot/adsWizard.js`). |
| **CPA (Cost Per Action)** | Модель оплаты за целевое действие. | Постбеки в `/postbacks/relay`, `sendCpaPostback`. |
| **UID / click_id** | Идентификатор клика, который возвращается CPA-сети. | Таблица `clicks`, endpoint `/click/:offerId`. |
| **Caps** | Ограничение количества целевых действий. | Поля `caps_total`, `caps_window` в `offers`. |
| **Caps window** | Временное окно лимита (например, `100/day`). | Парсинг `parseCapsWindow` в `adsWizard`. |
| **Premium ставка** | Увеличенная оплата за премиум-пользователей Telegram. | `adsWizard` шаг ставок, поля `premium_rate`. |
| **Time targeting** | Расписание показов оффера (по дням/часам). | `adsWizard`, поле `time_targeting`. |
| **Attribution** | Связка `user_id ↔ uid` для последующих постбеков. | Таблица `attribution`, endpoint `/postbacks/relay`. |
| **Postback** | HTTP-запрос в CPA-сеть о выполнении действия. | `sendCpaPostback`, таблица `postbacks`. |
| **Wizard** | Пошаговый сценарий в Telegraf. | `Scenes.WizardScene` в `src/bot/adsWizard.js`. |
| **Relay** | Ретрансляция событий из внешних ботов в CPA-сеть. | Endpoint `/postbacks/relay`. |
| **Share-click** | Переход по шаринг-ссылке (`/s/:shareToken`). | Endpoint `/s/:shareToken`. |
| **Start token** | Токен, с которым пользователь попадает в бота (`/start <token>`). | Таблица `start_tokens`, генерация в `/click/:offerId`. |
