# Тестирование и QA

## Перед релизом
1. **Проверка миграций**
   - `npm run migrate` на staging/preview БД.
   - Убедиться, что новые таблицы создаются без ошибок.
2. **Health-check**
   - `curl -s https://<BASE_URL>/health` → `{ "ok": true }`.
3. **Webhook Telegram**
   - Проверить `setWebhook` на `$BASE_URL/bot/webhook`.
   - Отправить `/whoami` → бот должен ответить ID.
4. **Сцена /ads**
   - Пройти мастер до конца, убедиться в создании записи в `offers` (`SELECT * FROM offers ORDER BY created_at DESC LIMIT 1`).
   - Проверить валидации: ставки ниже минимума → бот должен отклонить.
5. **Клики и токены**
   - `curl -I "https://<BASE_URL>/click/<offer_id>?uid=test123"` → статус `302` и редирект на `t.me`.
   - Проверить наличие записи в `clicks` и `start_tokens`.
6. **Relay постбек**
   - Подготовить запись в `attribution` (`INSERT` вручную или через сцену, если реализовано).
   - `curl -X POST https://<BASE_URL>/postbacks/relay -H 'Content-Type: application/json' -d '{"offer_id":"...","user_id":123,"event":"conversion"}'` → `{ "ok": true }`.
   - Проверить, что CPA-сеть получает подписанный POST (отследить через логи).
7. **Debug endpoints** (при необходимости)
   - С корректным `DEBUG_TOKEN` убедиться, что `/debug/seed_offer` и `/debug/complete` работают, без него — 401.

## Проверка логов
- `pm2 logs tg-api --lines 100` — нет ошибок при старте или в процессе.
- Ищите сообщения `webhook error`, `send error`, `ads wizard insert error`.

## Регресс по багам
- Убедиться, что импорты `config`, `Markup`, `crypto` исправлены (см. ROADMAP) перед релизом.
- Проверить, что дубликат `Scenes.Stage` удалён, иначе сцены инициализируются дважды.

## TODO
- Автоматизировать smoke-тесты (Postman/Newman или Jest-интеграционные тесты).
- Добавить unit-тесты для парсеров (`parseCapsWindow`, `ensureMinRate`).
