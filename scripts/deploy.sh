#!/usr/bin/env bash
set -euo pipefail
cd /opt/tgbotcpa
npm i
npm run migrate
pm2 startOrReload ecosystem.config.cjs --only tg-api
npm run register:webhook
node -e "require('dotenv').config(); fetch('https://api.telegram.org/bot'+process.env.BOT_TOKEN+'/getWebhookInfo').then(r=>r.text()).then(console.log)"
