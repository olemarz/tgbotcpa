# Документация tgbotcpa

## Как пользоваться
- Начните с [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) для понимания архитектуры и потока данных.
- Затем перейдите к [CONFIG_ENV.md](CONFIG_ENV.md) и [RUN_LOCAL.md](RUN_LOCAL.md), чтобы поднять проект локально.
- Подробности по командам бота и HTTP-точкам собраны в [API_AND_COMMANDS.md](API_AND_COMMANDS.md).
- Для миграций БД см. [DATA_AND_MIGRATIONS.md](DATA_AND_MIGRATIONS.md), для деплоя — [DEPLOY_OPERATIONS.md](DEPLOY_OPERATIONS.md).
- Проверки перед релизом собраны в [TESTING_AND_QA.md](TESTING_AND_QA.md).
- Текущие долги и планы — в [ROADMAP.md](ROADMAP.md). Термины домена — в [GLOSSARY.md](GLOSSARY.md). Изменения фиксируются в [CHANGELOG.md](CHANGELOG.md).

## Карта репозитория
```
.
├── README.md
├── ecosystem.config.cjs        # PM2-конфиг для API-процесса
├── package.json                # npm-скрипты и зависимости
├── src/
│   ├── api/server.js           # Express API + вебхук бота
│   ├── bot/
│   │   ├── adsWizard.js        # Сцена создания оффера /ads
│   │   ├── constants.js        # Справочники событий для бота
│   │   ├── run-bot.js          # Запуск бота в режиме polling
│   │   └── telegraf.js         # Инициализация Telegraf и команды
│   ├── config.js               # Загрузка ENV и глобальные константы
│   ├── constants/offers.js     # Общие справочники офферов
│   ├── db/
│   │   ├── index.js            # Клиент PostgreSQL
│   │   └── migrate.js          # Скрипт миграции схемы
│   └── util/                   # Утилиты (UUID, HMAC, slug)
└── docs/                       # Текущая документация
```

## Ссылки по разделам
- Архитектура: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)
- Команды и API: [API_AND_COMMANDS.md](API_AND_COMMANDS.md)
- Окружение: [CONFIG_ENV.md](CONFIG_ENV.md)
- Локальный запуск: [RUN_LOCAL.md](RUN_LOCAL.md)
- Данные и миграции: [DATA_AND_MIGRATIONS.md](DATA_AND_MIGRATIONS.md)
- Деплой и операции: [DEPLOY_OPERATIONS.md](DEPLOY_OPERATIONS.md)
- Тестирование: [TESTING_AND_QA.md](TESTING_AND_QA.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Глоссарий: [GLOSSARY.md](GLOSSARY.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Контекст для ChatGPT: [chat_assistant_context.json](chat_assistant_context.json)
