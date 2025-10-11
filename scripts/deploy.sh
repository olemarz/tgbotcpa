#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "git is required for deployment" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for deployment" >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required for deployment" >&2
  exit 1
fi

git fetch origin

git reset --hard origin/main

npm ci --omit=dev

npm run migrate

pm2 reload tg-api --update-env

npm run doctor

curl -fsS http://127.0.0.1:3000/health > /dev/null

echo "Deployment completed successfully"
