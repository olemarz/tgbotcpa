#!/usr/bin/env bash
set -euo pipefail
cd /opt/tgbotcpa
git pull --ff-only
npm ci --omit=dev
npm run migrate
pm2 reload tg-api --update-env
pm2 save
curl -fsS https://adspirin.ru/health | grep '"ok":true' && echo "DEPLOY OK"
