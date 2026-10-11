#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$ROOT/app" || exit 1
exec "$ROOT/runtime/python/bin/python3" -E -s -X utf8 -m server.portable --root "$ROOT" "$@"
