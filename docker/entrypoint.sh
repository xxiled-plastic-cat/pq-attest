#!/bin/bash
set -euo pipefail

port="${PORT:-3000}"

node src/server.ts &
api_pid=$!

healthy=0
for _ in $(seq 1 50); do
  if node --input-type=module -e "try { const r = await fetch('http://127.0.0.1:${port}/health'); process.exit(r.ok ? 0 : 1); } catch { process.exit(1); }" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API process exited before it was healthy" >&2
    exit 1
  fi
  sleep 0.2
done

if [[ "$healthy" -ne 1 ]]; then
  echo "API did not become healthy on 127.0.0.1:${port}" >&2
  kill "$api_pid" 2>/dev/null || true
  exit 1
fi

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

term() {
  kill "$api_pid" "$caddy_pid" 2>/dev/null || true
}
trap term INT TERM

wait -n "$api_pid" "$caddy_pid"
status=$?
term
wait || true
exit "$status"
