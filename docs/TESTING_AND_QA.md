# TESTING & QA

## Автоматические проверки
- **Smoke-тесты API** — `tests/smoke/api.spec.js` (Jest + Supertest). Проверяет `/health`, валидацию `/postbacks/relay`, debug endpoint `/debug/complete` (с заглушкой axios).
- **Запуск**: `node --test` (скрипт `npm run test`).
- ⚠️ TODO (P0): Workflow `.github/workflows/test.yml` вызывает `npm run test:ci`, которого нет в `package.json`. Из-за этого CI падает. Добавьте скрипт или обновите workflow.

## Ручной smoke-check перед релизом
1. **API**
   - `curl -f https://<BASE_URL_HOST>/health` → `{ "ok": true }`.
   - `curl -I "https://<BASE_URL_HOST>/click/<offer_uuid>?click_id=test"` → 302 на `https://t.me/<bot>?start=...`.
2. **Бот**
   - Написать боту `/whoami` → получить ID.
   - Запустить `/ads` и пройти минимум до шага выбора типа события (валидировать inline-кнопки и проверки). Используйте тестовую ссылку `https://t.me/c/123456789/1?comment=2`.
3. **Постбек**
   - С подставным `DEBUG_TOKEN` отправить `POST /debug/complete` и убедиться, что в логах нет ошибок HMAC.

## Регрессионный чек
- Просмотреть `pm2 logs tg-api --lines 100` на предмет ошибок отправки в CPA (axios). Повторяющиеся `cpa postback failed` → блокер релиза.
- Проверить базу: `SELECT COUNT(*) FROM offers;` после миграции/создания оффера.

## Локальные тестовые данные
- Используйте `POST /debug/seed_offer` для создания оффера.
- Вручную добавьте запись в `start_tokens`, чтобы протестировать `/click` редирект (или запустить `GET /click/...`).

## Мониторинг после деплоя
- Через 5–10 минут после релиза убедиться, что `/health` доступен, а в бот поступают новые апдейты (см. логи).
