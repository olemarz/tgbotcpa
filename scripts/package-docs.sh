#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE_PATH="${1:-documentation.tar.gz}"

cd "$ROOT_DIR"

tar -czf "$ARCHIVE_PATH" \
  README.md \
  DOCS \
  docs

echo "Documentation bundle created at: $ARCHIVE_PATH"
