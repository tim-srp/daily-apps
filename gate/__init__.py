"""Shared access gate: short expiring codes stored in sqlite, HMAC-signed session cookies."""
import os, sqlite3, secrets, time, hmac, hashlib, threading
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get("GATE_DB", os.path.join(BASE, "data", "gate.db"))
ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L
_lock = threading.Lock()

def _conn():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, created REAL, expires REAL,
      max_uses INTEGER, uses INTEGER DEFAULT 0, daily_cap INTEGER, apps TEXT, note TEXT, revoked INTEGER DEFAULT 0)""")
    c.execute("CREATE TABLE IF NOT EXISTS usage(code TEXT, day TEXT, n INTEGER, PRIMARY KEY(code,day))")
    c.execute("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)")
    return c

def secret():
    with _conn() as c:
        r = c.execute("SELECT v FROM meta WHERE k='secret'").fetchone()
        if r: return r["v"].encode()
        s = secrets.token_hex(32); c.execute("INSERT INTO meta VALUES('secret',?)", (s,)); return s.encode()

def norm(code): return "".join(ch for ch in (code or "").upper() if ch.isalnum())

def mint(hours=72, uses=None, daily_cap=50, apps="*", note=""):
    code = "".join(secrets.choice(ALPHA) for _ in range(8)); now = time.time()
    with _lock, _conn() as c:
        c.execute("INSERT INTO codes(code,created,expires,max_uses,daily_cap,apps,note) VALUES(?,?,?,?,?,?,?)",
                  (code, now, now + hours * 3600, uses, daily_cap, apps, note))
    return code, now + hours * 3600

def _row(c, code): return c.execute("SELECT * FROM codes WHERE code=?", (norm(code),)).fetchone()

def check(code, app):
    """-> (ok, reason)"""
    with _conn() as c:
        r = _row(c, code)
    if not r: return False, "体验码无效"
    if r["revoked"]: return False, "体验码已被停用"
    if time.time() > r["expires"]: return False, "体验码已过期"
    if r["apps"] != "*" and app not in r["apps"].split(","): return False, "此体验码不适用于该工具"
    return True, "ok"

def redeem(code, app):
    """Validate on entry and count one use (max_uses = number of logins/devices)."""
    ok, why = check(code, app)
    if not ok: return False, why
    with _lock, _conn() as c:
        r = _row(c, code)
        if r["max_uses"] is not None and r["uses"] >= r["max_uses"]: return False, "体验码使用次数已用完"
        c.execute("UPDATE codes SET uses=uses+1 WHERE code=?", (r["code"],))
    return True, "ok"

def consume(code, app):
    """Per request: re-check validity + daily cap."""
    ok, why = check(code, app)
    if not ok: return False, why
    day = time.strftime("%Y-%m-%d")
    with _lock, _conn() as c:
        r = _row(c, code)
        u = c.execute("SELECT n FROM usage WHERE code=? AND day=?", (r["code"], day)).fetchone()
        n = u["n"] if u else 0
        if r["daily_cap"] and n >= r["daily_cap"]: return False, "今日次数已用完，明天再来"
        c.execute("INSERT INTO usage VALUES(?,?,1) ON CONFLICT(code,day) DO UPDATE SET n=n+1", (r["code"], day))
    return True, "ok"

def sign(code):
    code = norm(code); return code + "." + hmac.new(secret(), code.encode(), hashlib.sha256).hexdigest()[:32]

def unsign(tok):
    try:
        code, sig = (tok or "").split(".", 1)
    except ValueError: return None
    return code if hmac.compare_digest(sign(code), tok) else None

def list_codes():
    with _conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM codes ORDER BY created DESC")]

def revoke(code):
    with _lock, _conn() as c:
        return c.execute("UPDATE codes SET revoked=1 WHERE code=?", (norm(code),)).rowcount
