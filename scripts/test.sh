#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/php-runtime.sh"
exec "$PHP_BIN" artisan test "$@"
