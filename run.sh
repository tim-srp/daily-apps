#!/bin/bash
# Supervisor: keeps server (and optionally a cloudflared quick tunnel) alive.
# Start: setsid nohup ./run.sh >/dev/null 2>&1 </dev/null &     (TUNNEL=0 to skip the tunnel)
cd "$(dirname "$0")"; mkdir -p logs
( while true; do python3 server.py >> logs/server.log 2>&1; echo "server died $(date)" >> logs/server.log; sleep 2; done ) &
[ "${TUNNEL:-1}" = "0" ] && wait
while true; do
  cloudflared tunnel --no-autoupdate --protocol ${CF_PROTO:-http2} --url http://127.0.0.1:${PORT:-8787} > logs/tunnel.log 2>&1
  echo "tunnel died $(date), restarting in 30s (URL WILL CHANGE)" >> logs/server.log; sleep 30
done
