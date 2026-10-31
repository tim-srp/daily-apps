# daily-apps — 每日一个有用小工具 (one server, one gate, one folder per day)

```
daily-apps/
  server.py        # single process, serves every dayNN-*/ app at /<path>/ (port 8787)
  gate/            # shared gate: __init__.py (sqlite codes, HMAC cookies) + gate.html
  mint_code.py     # admin CLI   list_codes / revoke
  run.sh           # supervisor: restarts server + cloudflared quick tunnel forever
  url.sh           # prints current trycloudflare URL
  data/gate.db     # codes + usage + cookie secret (keep private)
  logs/
  day01-flashcut/  # 闪剪台 — browser multi-track editor (static: index.html, app.js, styles.css, export.js)
```

## Day 1 — 闪剪台 / FlashCut
Browser-native multi-track short video editor at `/d01/`. Media never uploads; export uses **ffmpeg.wasm** from jsDelivr CDN (see `day01-flashcut/README.md`).

## Access codes
- `./mint_code.py --hours 72 --uses 3 --cap 50 --note @handle [--apps d01,d02]` → 8-char code.
- `./list_codes`, `./revoke CODE`.
- `GATE_LOCAL_BYPASS=1` only for 127.0.0.1 without proxy headers (demo recording).

## Add a new day
1. `mkdir day02-xxx` with `app.json` `{"path":"d02","name":"…","day":2}`, static `index.html` (+ js/css), optional `api.py`.
2. Restart server. Gate/cookie/codes are shared. Static assets under the app folder are served when authenticated.

## Run
- `PORT=8787 GATE_LOCAL_BYPASS=1 python3 server.py` — local demo
- `setsid nohup ./run.sh >/dev/null 2>&1 </dev/null &` — with tunnel (`TUNNEL=0` = local only)
