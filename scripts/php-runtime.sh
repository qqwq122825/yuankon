#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PHP_BIN="${PHP_BIN:-$(command -v php || true)}"
if [[ -z "$PHP_BIN" ]] || ! "$PHP_BIN" -r 'exit(PHP_VERSION_ID >= 80300 ? 0 : 1);'; then
  if [[ -x /opt/homebrew/opt/php@8.3/bin/php ]]; then
    PHP_BIN=/opt/homebrew/opt/php@8.3/bin/php
  else
    echo '请安装 PHP 8.3+，或通过 PHP_BIN 指定已有的 PHP 路径。' >&2
    exit 1
  fi
fi
export PHP_BIN
export PATH="$(dirname "$PHP_BIN"):$PATH"
