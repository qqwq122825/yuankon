#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/php-runtime.sh"
exec "$PHP_BIN" artisan serve --host=127.0.0.1 --port="${PORT:-8877}"
