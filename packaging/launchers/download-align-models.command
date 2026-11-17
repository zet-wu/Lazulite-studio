#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
"$ROOT/runtime/python/bin/python3" -I -X utf8 "$ROOT/download_align_models.py"
RESULT=$?
printf '\n按回车关闭窗口…'
read -r _
exit "$RESULT"
