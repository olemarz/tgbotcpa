#!/usr/bin/env bash
set -euo pipefail
cd /opt/tgbotcpa

# чистим мусорные lock-и только при необходимости:
if [ ! -d node_modules ]; then rm -f package-lock.json; fi

npm i
npm run migrate

pm2 delete tg-api || true
pm2 start ecosystem.config.cjs --only tg-api
pm2 save

# регаем вебхук
npm run register:webhook

# показать статус
node -e "require('dotenv').config(); fetch('https://api.telegram.org/bot'+process.env.BOT_TOKEN+'/getWebhookInfo').then(r=>r.text()).then(console.log)"
