#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$ROOT/app" || exit 1
"$ROOT/runtime/python/bin/python3" -E -s -X utf8 -m server.portable --root "$ROOT" "$@"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  read -r -p '启动失败。按回车关闭终端…' _studio_reply
fi
exit "$STATUS"
