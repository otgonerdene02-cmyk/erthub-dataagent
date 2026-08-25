#!/usr/bin/env bash
# Commit хийхийн өмнө ажиллуулна: node scripts/check-registry.js-ийн bash
# дамжуулагч. Алдаа олдвол exit 1.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/check-registry.js"
