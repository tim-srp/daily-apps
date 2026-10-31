#!/usr/bin/env python3
"""One process serving all daily apps. Each app = folder dayNN-*/ with app.json {"path":"d01","name":..}
static files (index.html, *.js, *.css, …) and optional api.py exposing handle(payload)->dict (POST /dNN/api)."""
import os, json, glob, importlib.util, http.cookies, re, time, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import gate
BASE = os.path.dirname(os.path.abspath(__file__))
APPS = {}
for f in sorted(glob.glob(os.path.join(BASE, "day*", "app.json"))):
    d = os.path.dirname(f); meta = json.load(open(f)); meta["dir"] = d
    api = os.path.join(d, "api.py")
    if os.path.exists(api):
        s = importlib.util.spec_from_file_location(meta["path"] + "_api", api); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); meta["api"] = m
    APPS[meta["path"]] = meta
GATE_HTML = open(os.path.join(BASE, "gate", "gate.html"), encoding="utf-8").read()
BYPASS = os.environ.get("GATE_LOCAL_BYPASS") == "1"  # only honoured for 127.0.0.1 requests w/o proxy headers (demo recording)
_ip_hits = {}

# Extra MIME types browsers care about for ES modules / wasm
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")

SAFE_STATIC = re.compile(r"^/[A-Za-z0-9._\-]+(/[A-Za-z0-9._\-]+)*$")

class H(BaseHTTPRequestHandler):
    server_version = "daily-apps"
    def log_message(self, fmt, *a): print(time.strftime("%H:%M:%S"), self.address_string(), fmt % a, flush=True)
    def send(self, code, body, ctype="text/html; charset=utf-8", headers=()):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        for k, v in headers: self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def jsend(self, code, obj, headers=()): self.send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8", headers)
    def route(self):
        m = re.match(r"^/([a-z0-9]+)(/.*)?$", self.path.split("?")[0])
        if not m or m.group(1) not in APPS: return None, None
        return APPS[m.group(1)], (m.group(2) or "/")
    def session(self, app):
        if BYPASS and self.client_address[0] == "127.0.0.1" and not self.headers.get("Cf-Connecting-Ip") and not self.headers.get("X-Forwarded-For"):
            return "LOCALDEMO"
        c = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        code = gate.unsign(c["dg"].value) if "dg" in c else None
        return code if code and gate.check(code, app["path"])[0] else None
    def safe_file(self, app, sub):
        """Resolve a static file under the app dir; None if missing or unsafe."""
        if sub in ("", "/"): return None
        if not SAFE_STATIC.match(sub): return None
        root = os.path.realpath(app["dir"])
        fpath = os.path.realpath(os.path.join(root, sub.lstrip("/")))
        if not fpath.startswith(root + os.sep): return None
        if not os.path.isfile(fpath): return None
        return fpath
    def do_GET(self):
        if self.path in ("/", ""):
            return self.send(200, "<meta charset=utf-8><h3>每日一个有用小工具</h3>" + "".join(f'<p><a href="/{k}/">{v["name"]}</a></p>' for k, v in APPS.items()))
        app, sub = self.route()
        if not app: return self.send(404, "not found", "text/plain")
        if self.path.rstrip("/") == "/" + app["path"] and not self.path.endswith("/"):
            self.send_response(302); self.send_header("Location", "/" + app["path"] + "/"); self.end_headers(); return
        if sub == "/logout":
            return self.send(302, "", headers=[("Location", f"/{app['path']}/"), ("Set-Cookie", f"dg=; Path=/; Max-Age=0")])
        if sub == "/":
            if not self.session(app):
                return self.send(200, GATE_HTML.replace("{{APP}}", app["path"]).replace("{{NAME}}", app["name"]))
            return self.send(200, open(os.path.join(app["dir"], "index.html"), "rb").read())
        # Authenticated static assets for the app (js/css/images/…)
        fpath = self.safe_file(app, sub)
        if fpath:
            if not self.session(app):
                return self.send(401, "需要体验码", "text/plain")
            ctype = mimetypes.guess_type(fpath)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype = ctype + "; charset=utf-8"
            return self.send(200, open(fpath, "rb").read(), ctype)
        return self.send(404, "not found", "text/plain")
    def body(self):
        n = min(int(self.headers.get("Content-Length") or 0), 20000)
        try: return json.loads(self.rfile.read(n) or b"{}")
        except Exception: return {}
    def do_POST(self):
        app, sub = self.route()
        if not app: return self.jsend(404, {"error": "not found"})
        ip = self.headers.get("Cf-Connecting-Ip") or self.client_address[0]
        if sub == "/enter":
            now = time.time(); hits = [t for t in _ip_hits.get(ip, []) if now - t < 600]
            if len(hits) >= 10: return self.jsend(429, {"ok": False, "error": "尝试太频繁，请 10 分钟后再试"})
            _ip_hits[ip] = hits + [now]
            code = gate.norm(self.body().get("code"))
            ok, why = gate.redeem(code, app["path"])
            if not ok: return self.jsend(403, {"ok": False, "error": why})
            return self.jsend(200, {"ok": True}, [("Set-Cookie", f"dg={gate.sign(code)}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure")])
        if sub == "/api":
            code = self.session(app)
            if not code: return self.jsend(401, {"error": "需要体验码"})
            if code != "LOCALDEMO":
                ok, why = gate.consume(code, app["path"])
                if not ok: return self.jsend(429, {"error": why})
            if "api" not in app: return self.jsend(404, {"error": "no api"})
            try: return self.jsend(200, app["api"].handle(self.body()))
            except Exception as e: return self.jsend(500, {"error": "生成失败"})
        return self.jsend(404, {"error": "not found"})

if __name__ == "__main__":
    # Optional bootstrap: GATE_BOOTSTRAP_CODE=CODE[:HOURS[:USES[:CAP]]] seeds one code if missing
    boot = os.environ.get("GATE_BOOTSTRAP_CODE", "").strip()
    if boot:
        parts = boot.split(":")
        code = parts[0].upper()
        hours = float(parts[1]) if len(parts) > 1 else 72
        uses = int(parts[2]) if len(parts) > 2 else 20
        cap = int(parts[3]) if len(parts) > 3 else 50
        with gate._conn() as c:
            if not c.execute("SELECT 1 FROM codes WHERE code=?", (gate.norm(code),)).fetchone():
                now = time.time()
                c.execute("INSERT INTO codes(code,created,expires,max_uses,daily_cap,apps,note) VALUES(?,?,?,?,?,?,?)",
                          (gate.norm(code), now, now + hours * 3600, uses, cap, "*", "bootstrap"))
                print("bootstrapped code", gate.norm(code), flush=True)
    port = int(os.environ.get("PORT", 8787))
    print("apps:", list(APPS), "bypass:", BYPASS, flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
