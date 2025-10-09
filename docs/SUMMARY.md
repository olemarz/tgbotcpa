# SUMMARY

## Как пользоваться документацией
- Начните с [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md), чтобы понять архитектуру и потоки данных.
- Затем переходите к [RUN_LOCAL.md](./RUN_LOCAL.md) для локального запуска и отладки.
- Используйте [API_AND_COMMANDS.md](./API_AND_COMMANDS.md) и [CONFIG_ENV.md](./CONFIG_ENV.md) как справочник по сценариям бота и переменным окружения.
- Операционные вопросы по продакшену описаны в [DEPLOY_OPERATIONS.md](./DEPLOY_OPERATIONS.md) и [TESTING_AND_QA.md](./TESTING_AND_QA.md).
- Историю изменений и план работ смотрите в [CHANGELOG.md](./CHANGELOG.md) и [ROADMAP.md](./ROADMAP.md).

## Оглавление
1. [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)
2. [API_AND_COMMANDS.md](./API_AND_COMMANDS.md)
3. [CONFIG_ENV.md](./CONFIG_ENV.md)
4. [RUN_LOCAL.md](./RUN_LOCAL.md)
5. [DATA_AND_MIGRATIONS.md](./DATA_AND_MIGRATIONS.md)
6. [DEPLOY_OPERATIONS.md](./DEPLOY_OPERATIONS.md)
7. [TESTING_AND_QA.md](./TESTING_AND_QA.md)
8. [ROADMAP.md](./ROADMAP.md)
9. [GLOSSARY.md](./GLOSSARY.md)
10. [CHANGELOG.md](./CHANGELOG.md)
11. [chat_assistant_context.json](./chat_assistant_context.json)

## Карта репозитория
```
.
├── README.md               — постановка и быстрый старт
├── ecosystem.config.cjs    — конфиг PM2 для API-процесса `tg-api`
├── package.json            — npm-скрипты и зависимости
├── src/
│   ├── api/                — HTTP API и Telegram webhook (Express)
│   ├── bot/                — логика Telegram-бота на Telegraf (сцены, команды)
│   ├── constants/          — доменные константы
│   ├── db/                 — подключение к PostgreSQL и миграции
│   └── util/               — утилиты (HMAC, генерация ID/slug)
├── tests/                  — smoke-тесты API (Jest + Supertest)
└── docs/                   — эта документация
```

> Совет: в каждом файле документа указаны ссылки на исходный код с конкретными путями, чтобы быстрее перейти к реализации.
