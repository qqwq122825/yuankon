#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
python3 engine.py "$@"
status_code=$?
if [[ -t 0 ]]; then
  printf '\n按回车关闭…'
  read -r
fi
exit "$status_code"
