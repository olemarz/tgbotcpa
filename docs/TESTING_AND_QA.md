# TESTING & QA

## Автоматические проверки
- **Node test + Supertest** — `tests/click.test.js`, `tests/debug-complete.test.js`, `tests/hmac.test.js`.
  Проверяют редирект `/click/:offerId`, dry-run `/debug/complete` и подпись HMAC.
- **Запуск**: `npm run test` или `npm run test:ci`.

## Ручной smoke-check перед релизом
1. **API**
   - `curl -f https://<BASE_URL_HOST>/health` → `{ "ok": true }`.
   - `curl -I "https://<BASE_URL_HOST>/click/<offer_uuid>?uid=test&click_id=123"` → 302 на `https://t.me/<BOT_USERNAME>?start=...`.
   - `curl -X POST https://<BASE_URL_HOST>/debug/complete` c заголовком `x-debug-token` и телом `{"offer_id":...,"tg_id":...,"event":"join_group"}` → `{ "ok": true, ... }`.
2. **Бот**
   - `/start <token>` (полученный из `/click`) → запись в `attribution` со `state='started'`, `clicks.used_at` обновлён.
   - Вступить в тестовый канал/группу → в БД появляется `events.join_group`, `attribution.state='converted'`, в логах — успешный postback.
3. **Постбек**
   - Проверить `postbacks` таблицу: новая запись со статусом `sent` (или `dry-run` в деве) и HTTP-статусом 200.

## Регрессионный чек
- Просмотреть `pm2 logs tg-api --lines 100` на предмет ошибок отправки в CPA (ошибки `postback send failed`). Повторяющиеся ошибки → блокер релиза.
- Проверить базу: `SELECT COUNT(*) FROM offers;` после миграции/создания оффера.

## Локальные тестовые данные
- Используйте `GET /click/<offer_id>?uid=test` для генерации start-токена.
- При необходимости `POST /debug/complete` (dry-run) для ручной отправки постбека.

## Мониторинг после деплоя
- Через 5–10 минут после релиза убедиться, что `/health` доступен, а в бот поступают новые апдейты (см. логи).
- Мониторить таблицы `clicks`, `attribution`, `events`, `postbacks` на появление свежих записей после рекламных запусков.

## QA чек-лист трекинга
1. **Клик**: открыть `{{base}}/click/<offer_id>?uid=U123&click_id=C456` → 302 на `https://t.me/<BOT_USERNAME>?start=...`, запись в `clicks` с UID и click_id.
2. **Старт бота**: отправить `/start <token>` из шага выше → `clicks.used_at` заполнен, создана запись `attribution` со `state='started'`.
3. **Конверсия**: вступить в группу/канал, где добавлен бот → `events` содержит `join_group`, `attribution.state='converted'`, отправлен постбек на `CPA_PB_URL` с заголовком `X-Signature`.
4. **Идемпотентность**: повторное получение события `join_group` (повторный апдейт/пере-вступление) не создаёт второй постбек в течение TTL (`IDEMPOTENCY_TTL_SEC`).
