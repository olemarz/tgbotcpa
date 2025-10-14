#!/usr/bin/env bash
set -euo pipefail
webhook_path="${WEBHOOK_PATH:-/bot/webhook}"
curl -sS -X POST "http://127.0.0.1:${PORT:-8000}${webhook_path}" \
  -H 'Content-Type: application/json' \
  -d '{"update_id":999999999,"message":{"message_id":1,"date":0,"chat":{"id":123,"type":"private"},"from":{"id":123},"text":"/start"}}'
echo
