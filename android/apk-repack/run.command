#!/bin/bash
cd "$(dirname "$0")" || exit 1
python3 repack.py "$@"
result=$?
if [ -t 0 ]; then
  read -r -p '按回车关闭…' _
fi
exit "$result"
