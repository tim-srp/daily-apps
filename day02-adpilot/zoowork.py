"""Minimal stdlib client for ZooWork Managed Agents API (/service/v1). Key stays server-side."""
import os, json, urllib.request, urllib.error, time

BASE = (os.environ.get("ZOOWORK_BASE_URL") or "https://clawapi.ecap.gsmo.ai/service/v1").rstrip("/")
UA = "daily-apps-adpilot/1.0 (+server-proxy)"
STATE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "d02_agent.json")

def key(): return (os.environ.get("ZOOWORK_API_KEY") or "").strip()
def enabled(): return bool(key())

class ZWError(Exception): pass

def req(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + key(), "User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as f:
            t = f.read(); return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        raise ZWError(f"HTTP {e.code} {method} {path}: {e.read()[:300].decode('utf-8','replace')}")

def agent_id():
    """ZOOWORK_AGENT_ID, else a cached auto-provisioned 'adpilot' agent (created once, tools disabled: pure writing agent)."""
    a = os.environ.get("ZOOWORK_AGENT_ID", "").strip()
    if a: return a
    try: return json.load(open(STATE))["agent_id"]
    except Exception: pass
    ag = req("POST", "/agents", {"resource": {"name": "adpilot-d02", "onboarding": False,
          "labels": {"app": "daily-apps-d02"}, "tool_policy": {"allow": ["read"]}}})
    a = ag["agent_id"]
    os.makedirs(os.path.dirname(STATE), exist_ok=True); json.dump({"agent_id": a}, open(STATE, "w"))
    return a

def ensure_running(a):
    try: req("POST", f"/agents/{a}/start", None, 60)
    except ZWError as e:
        if "409" not in str(e): raise
    for _ in range(30):
        st = req("GET", f"/agents/{a}")
        s = json.dumps(st.get("status") or st.get("state") or {})
        if "running" in s or "running" not in json.dumps(st): return
        time.sleep(1)

def run(prompt, on_event, timeout=240):
    """Create session, post user.message, read SSE until run.finished. Returns concatenated assistant text."""
    a = agent_id(); ensure_running(a)
    s = req("POST", f"/agents/{a}/sessions", {})
    sid = s["session_id"]
    rc = req("POST", f"/agents/{a}/sessions/{sid}/events", {"events": [{"type": "user.message", "content": prompt}]})
    ev0 = (rc.get("events") or [{}])[0]
    if ev0.get("accepted") is not True: raise ZWError("message not accepted: " + json.dumps(rc)[:200])
    on_event("session", {"agent_id": a, "session_id": sid})
    r = urllib.request.Request(f"{BASE}/agents/{a}/sessions/{sid}/events/stream?deltas=agent.message",
        headers={"Authorization": "Bearer " + key(), "User-Agent": UA, "Accept": "text/event-stream"})
    texts, t0 = [], time.time()
    with urllib.request.urlopen(r, timeout=timeout) as f:
        data = []
        for raw in f:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line.startswith("data:"): data.append(line[5:].lstrip()); continue
            if line or not data: continue
            try: ev = json.loads("\n".join(data))
            except Exception: ev = None
            data = []
            if not ev: continue
            if ev.get("type") == "event_delta":
                on_event("delta", {"text": ev.get("deltaText", "")}); continue
            et, p = ev.get("event_type"), ev.get("payload") or {}
            if et == "agent.assistant":
                for c in ((p.get("message") or {}).get("content") or []):
                    if c.get("type") == "text": texts.append(c.get("text", ""))
            elif et == "agent.tool" and p.get("phase") == "start":
                on_event("step", {"text": f"调用工具 {p.get('toolName')}"})
            elif et == "agent.thinking":
                on_event("step", {"text": "Agent 思考中…"})
            elif et in ("agent.error", "agent.runtime_error"):
                on_event("step", {"text": "Agent 报错：" + json.dumps(p, ensure_ascii=False)[:160]})
            elif et == "run.finished":
                st = p.get("status")
                if st != "succeeded": raise ZWError(f"run.finished status={st}")
                return "\n".join(texts)
            if time.time() - t0 > timeout: raise ZWError("timeout")
    raise ZWError("stream closed before run.finished")
