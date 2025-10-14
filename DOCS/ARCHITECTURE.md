# Architecture

## Module dependencies
```mermaid
graph TD
  server["src/api/server.js"]
  bot["src/bot/telegraf.js"]
  adsWizard["src/bot/adsWizard.js"]
  stat["src/bot/stat.js"]
  sessionStore["src/bot/sessionStore.js"]
  postback["src/services/postback.js"]
  conversion["src/services/conversion.js"]
  joinCheck["src/services/joinCheck.js"]
  db["src/db/index.js"]
  utilId["src/util/id.js"]

  server --> bot
  bot --> adsWizard
  bot --> stat
  bot --> sessionStore
  bot --> postback
  bot --> conversion
  bot --> joinCheck
  bot --> db
  bot --> utilId
  adsWizard --> db
  adsWizard --> utilId
  postback --> db
  conversion --> db
  joinCheck --> db
```

## Update flow
```mermaid
graph LR
  tg[Telegram Updates]
  nginx[Nginx / HTTPS terminator]
  express[Express app\n(src/api/server.js)]
  telegraf[Telegraf bot\n(src/bot/telegraf.js)]
  stage[Scenes.Stage middleware]
  adsWizard[adsWizardScene]

  tg --> nginx --> express --> telegraf --> stage --> adsWizard
  telegraf -->|other handlers| botHandlers[Commands, actions, joins]
  botHandlers --> services[Postback / Conversion / Join checks]
  services --> db[(PostgreSQL)]
```
