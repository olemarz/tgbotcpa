# Данные и миграции

## Скрипт миграции
- Запускается через `npm run migrate` → `node src/db/migrate.js`.
- Скрипт выполняет один SQL-блок `CREATE TABLE IF NOT EXISTS` для всех сущностей.

## Таблицы
### `offers`
- `id UUID PRIMARY KEY`
- `advertiser_id UUID`
- `target_url TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `premium_rate INT`
- `base_rate INT NOT NULL`
- `caps_total INT DEFAULT 0`
- `caps_window JSONB`
- `reaction_whitelist JSONB`
- `chat_ref JSONB`
- `status TEXT DEFAULT 'active'`
- `created_at TIMESTAMPTZ DEFAULT now()`

Используется сценой `/ads` (вставка оффера) и debug seed.

### `clicks`
- `id UUID PRIMARY KEY`
- `offer_id UUID NOT NULL`
- `uid TEXT NOT NULL`
- `subs JSONB`
- `created_at TIMESTAMPTZ DEFAULT now()`

Заполняется при обращении к `/click/:offerId`.

### `start_tokens`
- `token TEXT PRIMARY KEY`
- `offer_id UUID NOT NULL`
- `uid TEXT NOT NULL`
- `exp_at TIMESTAMPTZ NOT NULL`

Хранит токены для `/start` в Telegram.

### `attribution`
- `user_id BIGINT NOT NULL`
- `offer_id UUID NOT NULL`
- `uid TEXT NOT NULL`
- `is_premium BOOLEAN DEFAULT FALSE`
- `first_seen TIMESTAMPTZ DEFAULT now()`
- `last_seen TIMESTAMPTZ DEFAULT now()`
- `PRIMARY KEY (user_id, offer_id)`

Используется для поиска `uid` в `/postbacks/relay`.

### `events`
- `id UUID PRIMARY KEY`
- `offer_id UUID NOT NULL`
- `uid TEXT NOT NULL`
- `user_id BIGINT NOT NULL`
- `event_type TEXT NOT NULL`
- `chat_id BIGINT`
- `message_id BIGINT`
- `thread_id BIGINT`
- `poll_id TEXT`
- `payload JSONB`
- `created_at TIMESTAMPTZ DEFAULT now()`
- `idempotency_key TEXT UNIQUE`

Планируется для фиксации действий (пока не используется сценой, но понадобится для постбеков).

### `postbacks`
- `id UUID PRIMARY KEY`
- `offer_id UUID NOT NULL`
- `uid TEXT NOT NULL`
- `url TEXT NOT NULL`
- `payload JSONB NOT NULL`
- `status TEXT DEFAULT 'pending'`
- `attempts INT DEFAULT 0`
- `last_try_at TIMESTAMPTZ`

Заготовка под очередь повторных отправок постбеков.

## Seeds
- Специальных сидов нет. Для тестов используйте `POST /debug/seed_offer` и `/debug/complete`.

## TODO
- Добавить миграции для заполнения `reaction_whitelist`, `chat_ref`, `events` (в коде пока не используются).
- Рассмотреть переход на миграционный инструмент (например, `node-pg-migrate` или `Prisma`) для версионирования схемы.
