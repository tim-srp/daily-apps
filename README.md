# daily-apps — 每日一个有用小工具 (one server, one gate, one folder per day)

```
daily-apps/
  server.py        # single process, serves every dayNN-*/ app at /<path>/ (port 8787, 127.0.0.1)
  gate/            # shared gate: __init__.py (sqlite codes, HMAC cookies) + gate.html (输入体验码 page)
  mint_code.py     # admin CLI   list_codes / revoke  # wrappers
  run.sh           # supervisor: restarts server + cloudflared quick tunnel forever
  url.sh           # prints current trycloudflare URL
  data/gate.db     # codes + per-day usage + cookie secret (keep private)
  logs/            # server.log, tunnel.log
  day01-titles/    # app.json, index.html, api.py, promo/, post.md
```

## Access codes
- `./mint_code.py --hours 72 --uses 3 --cap 50 --note @handle [--apps d01,d02]` → prints an 8-char code (no 0/O/1/I/L). `--uses` = how many times the code may be entered (devices/browsers); `--cap` = API requests per code per day; default apps `*` = all days.
- `./list_codes`, `./revoke CODE`.
- Verification is server-side: `POST /<app>/enter` checks the code in sqlite and sets an HttpOnly, Secure, HMAC-signed cookie `dg` (7 days, but every request re-checks expiry/revocation/daily cap, so an expired code stops working immediately). Wrong-code attempts are limited to 10 per IP per 10 min.
- `GATE_LOCAL_BYPASS=1` (only for 127.0.0.1 without proxy headers) lets you screen-record without a code — run it on a separate port, never on the tunneled one.

## Add a new day
1. `mkdir day02-xxx` with `app.json` `{"path":"d02","name":"…","day":2}`, `index.html` (calls `fetch('api', …)` relative), optional `api.py` with `handle(payload)->dict`.
2. Restart server: `pkill -f server.py` (run.sh restarts it in 2 s). Gate, cookie and codes are shared automatically.

## Run / restart
- `setsid nohup ./run.sh >/dev/null 2>&1 </dev/null &`  (`TUNNEL=0` = local only; `CF_PROTO=quic|http2`)
- `./url.sh` → public URL. **Quick-tunnel URLs change whenever cloudflared restarts** — re-share the new link.
- Permanent options (not set up): Cloudflare named tunnel + own domain (`cloudflared tunnel login/create/route dns`), or deploy this folder to Render/Fly.io/a small VPS (it is stdlib-only Python, no deps).

## Known limitation on this box (2026-10-31)
The box's outbound network blocks Cloudflare's tunnel edge (QUIC/HTTP2 on port 7844) and SSH-based tunnels, so the quick tunnel could not connect from here. Run `run.sh` on any normal machine/VPS and it works as-is.
