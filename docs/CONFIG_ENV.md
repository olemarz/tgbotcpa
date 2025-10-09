# Переменные окружения

| Имя | Тип | Обязательно | Значение по умолчанию | Где используется | Риски/примечания |
|-----|-----|-------------|------------------------|------------------|------------------|
| `BOT_TOKEN` | string | Да | — | Проверка и запуск Telegraf (`src/config.js`, `src/bot/telegraf.js`) | Без токена бот не стартует (ошибка при импорте `config`). |
| `BASE_URL` | url | Да | — | Формирование redirect-ссылок и webhook (`src/config.js`, `src/bot/adsWizard.js`, `README.md`) | Валидный абсолютный URL. В `config.baseUrlHost` хранится только хост/порт для ссылок вида `https://<BASE_URL_HOST>/click/...`. |
| `PORT` | number | Нет | `3000` | Порт Express (`src/config.js`, `src/bot/telegraf.js` для локального polling) | При запуске под Nginx выставить соответствующее значение. |
| `DATABASE_URL` | url (postgres) | Да | — | Пул `pg.Pool` (`src/config.js`, `src/db/index.js`, `src/db/migrate.js`) | Неверная строка → отказ подключения и падение миграции. |
| `CPA_POSTBACK_URL`<br>`CPA_PB_URL` | url | Да | — | Отправка постбеков (`src/config.js`, `src/api/server.js`) | Допустим алиас `CPA_PB_URL`. Без URL API не стартует (throw). |
| `CPA_PB_SECRET` | string | Желательно (prod) | `dev-secret` при отсутствии | Подпись постбеков (`src/config.js`, `src/api/server.js`) | Без секрета включается dev-значение и отключается проверка подписи (логирование предупреждения). |
| `ALLOWED_UPDATES` | string (CSV) | Нет | пусто | Ограничение типов апдейтов (`src/config.js`) | Передавать список через запятую, иначе принимаются все. |
| `TZ` | string | Нет | `Europe/Rome` | Временная зона для cron/логики (`src/config.js`) | При деплое поменять на нужный регион. |
| `DEBUG_TOKEN` | string | Нет (но обязателен для использования debug API) | — | Проверка заголовка `x-debug-token` (`src/api/server.js`) | Без значения debug endpoints вернут 401. |
| `NODE_ENV` | string | Нет | — | Режим бота (`config.nodeEnv`) | Для локального polling достаточно `dev`; в проде ожидается `production` (см. `ecosystem.config.cjs`). |
| `WEBHOOK_PATH` | string | Нет | — | Принудительный webhook (`config.webhookPath`, `src/bot/telegraf.js`, `src/api/server.js`) | Если указан, polling отключится, а Express будет слушать путь `<WEBHOOK_PATH>` (по умолчанию `/bot/webhook`). |
