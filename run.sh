#!/usr/bin/env bash
# Start MyWhiteBoard on http://localhost:8000
cd "$(dirname "$0")"
PORT="${1:-8000}"
echo "MyWhiteBoard -> http://localhost:$PORT"
if command -v python3 >/dev/null; then exec python3 -m http.server "$PORT"
elif command -v npx >/dev/null; then exec npx --yes serve -l "$PORT" .
elif command -v php >/dev/null; then exec php -S "localhost:$PORT"
else echo "need python3, npx, or php"; exit 1; fi
