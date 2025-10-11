# GLOSSARY

| Термин | Определение | Где используется |
|--------|-------------|------------------|
| **Offer / оффер** | Настройка рекламной кампании в боте (URL, целевое действие, ставки, лимиты). | Таблица `offers`, сцена `/ads` (`src/bot/adsWizard.js`). |
| **Event type** | Целевое действие пользователя: `join_group`, `forward`, `reaction`, `comment`, `paid`, `start_bot`. | Константы `EVENT_TYPES` (`src/bot/constants.js`), валидация сцены. |
| **Caps** | Лимиты по количеству конверсий. | Поле `caps_total` таблицы `offers`. |
| **Geo targeting** | Ограничение показов оффера по странам/городам. | Поля `geo_mode`, `geo_list` таблицы `offers`. |
| **Start token** | Одноразовый токен, выдаваемый при клике и передаваемый в `/start`. | Таблица `start_tokens`, endpoint `/click/:offerId`. |
| **Attribution** | Связь Telegram-пользователя и клика с `uid/click_id`. | Таблица `attribution`, endpoint `/postbacks/relay`. |
| **Postback** | HTTP-запрос в CPA сеть о выполнении события. | `sendCpaPostback` (`src/api/app.js`), таблица `postbacks`. |
| **CPA secret** | HMAC-ключ для подписи postback payload. | Переменная `CPA_PB_SECRET`, `hmacSHA256Hex`. |
| **Wizard** | Пошаговый сценарий (`Telegraf Scenes`) для сбора параметров оффера. | `src/bot/adsWizard.js`. |
| **Debug token** | Токен доступа к `/debug/*` эндпоинтам. | `requireDebug` (`src/api/app.js`). |
| **Share token** | Токен для упрощённого счётчика переходов (`/s/:shareToken`). | Endpoint `GET /s/:shareToken`. |
