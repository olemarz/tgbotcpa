# Summary

## How to navigate the documentation

1. Start with [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md) for an architectural tour.
2. Use [RUN_LOCAL.md](./RUN_LOCAL.md) to bootstrap a local environment.
3. Consult [API_AND_COMMANDS.md](./API_AND_COMMANDS.md) for bot flows and HTTP endpoints.
4. Reference [CONFIG_ENV.md](./CONFIG_ENV.md) and [../DOCS/ENV.md](../DOCS/ENV.md) when updating secrets.
5. Operational guidance lives in [DEPLOY_OPERATIONS.md](./DEPLOY_OPERATIONS.md), [DOCS/RUNBOOK.md](../DOCS/RUNBOOK.md) and [TESTING_AND_QA.md](./TESTING_AND_QA.md).
6. Keep an eye on [CHANGELOG.md](./CHANGELOG.md) and [ROADMAP.md](./ROADMAP.md) for ongoing work.

## Contents

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

## Repository quick map

```
README.md                – project overview and quick start
ecosystem.config.cjs     – PM2 process configuration
package.json             – scripts and dependencies
src/
  api/                   – Express app, webhook server and partner APIs
  bot/                   – Telegraf scenes, commands and middleware
  constants/             – domain enums and limits
  db/                    – PostgreSQL pool, migrations and seeds
  integrations/          – external partner helpers
  services/              – business logic (postbacks, conversions)
  util/ & utils/         – shared helpers (IDs, geo, Telegram)
tests/                   – Node test runner suites
DOCS/ & docs/            – operational + product documentation bundles
scripts/                 – CLI utilities (doctor, webhook registration)
```

> Tip: Each document links to concrete source files so you can jump directly to implementations.
