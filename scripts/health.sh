#!/usr/bin/env bash
set -euo pipefail
curl -sS "http://127.0.0.1:${PORT:-8000}/health" | jq .
