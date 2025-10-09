# DATA & MIGRATIONS

## Скрипты миграций
- `npm run migrate` запускает `src/db/migrate.js`, который выполняет SQL-скрипт создания всех таблиц.
- Подключение к БД определяется переменной `DATABASE_URL` (см. `src/db/index.js`).
- Скрипт idempotent: использует `CREATE TABLE IF NOT EXISTS` и `CREATE INDEX IF NOT EXISTS`.

## Схема базы данных
| Таблица | Ключевые поля | Назначение |
|---------|---------------|------------|
| `offers` | `id UUID PK`, `target_url`, `event_type`, `base_rate`, `premium_rate`, `status` | Хранение офферов, созданных через `/ads`. Доп.поля: `caps_total`, `caps_window JSONB`, `reaction_whitelist JSONB`, `chat_ref JSONB`, `created_at`. |
| `clicks` | `id UUID PK`, `offer_id UUID`, `uid TEXT`, `subs JSONB` | Фиксация кликов из CPA ссылок. |
| `start_tokens` | `token TEXT PK`, `offer_id UUID`, `uid TEXT`, `exp_at TIMESTAMPTZ` | Одноразовые токены для `/start` параметра в Telegram. |
| `attribution` | PK по `(user_id BIGINT, offer_id UUID)`, `uid TEXT`, `is_premium BOOLEAN`, `first_seen`, `last_seen` | Соответствие Telegram пользователя клику и офферу. |
| `events` | `id UUID PK`, `offer_id`, `uid`, `user_id`, `event_type`, `payload JSONB`, `idempotency_key` | Журнал целевых событий (реакции, вступления, покупки). Может содержать `chat_id`, `message_id`, `thread_id`, `poll_id`. |
| `postbacks` | `id UUID PK`, `offer_id`, `uid`, `url TEXT`, `payload JSONB`, `status`, `attempts`, `last_try_at` | Очередь на повторную отправку постбеков в CPA сеть. |
| `offer_audit_log` | `id UUID PK`, `offer_id`, `action`, `user_id`, `chat_id`, `details JSONB`, `created_at` | Аудит действий мастера (создание, обновления). |

## Работа с миграциями
```bash
npm run migrate
# вывод: Migration complete
```

### Повторный запуск
Скрипт безопасен для повторного запуска (проверки `IF NOT EXISTS`).

### Seed-данные
- На текущей версии отдельного seed-скрипта нет. Для подготовки тестовых данных используйте `POST /debug/seed_offer` (см. `API_AND_COMMANDS.md`).
- TODO: добавить автоматический seed с тестовым оффером и кликом для smoke-тестов.

## Резервное копирование
- Для PostgreSQL используйте `pg_dump` / `pg_restore`.
- Минимальный набор таблиц для бэкапа: `offers`, `clicks`, `attribution`, `events`, `postbacks`, `offer_audit_log`.
