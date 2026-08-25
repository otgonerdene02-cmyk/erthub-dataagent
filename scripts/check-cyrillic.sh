#!/usr/bin/env bash
# Commit хийхийн өмнө ажиллуулна: node scripts/check-cyrillic.js-ийн
# bash дамжуулагч. Алдаа олдвол exit 1 (commit хийхгүй, эхлээд зас).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/check-cyrillic.js" "$@"
