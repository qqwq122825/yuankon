#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/php-runtime.sh"
composer install --prefer-dist --no-interaction
"$PHP_BIN" scripts/setup.php
