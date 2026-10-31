#!/usr/bin/env python3
"""Admin CLI. mint: ./mint_code.py --hours 72 --uses 3 --note @handle [--cap 50] [--apps d01,d02]
list: ./mint_code.py list      revoke: ./mint_code.py revoke CODE"""
import sys, argparse, time, gate
if len(sys.argv) > 1 and sys.argv[1] == "list":
    for r in gate.list_codes():
        st = "REVOKED" if r["revoked"] else ("EXPIRED" if time.time() > r["expires"] else "active")
        print(f'{r["code"]}  {st:8} exp {time.strftime("%m-%d %H:%M", time.localtime(r["expires"]))}  uses {r["uses"]}/{r["max_uses"] or "∞"}  cap/day {r["daily_cap"]}  apps {r["apps"]}  {r["note"]}')
    sys.exit()
if len(sys.argv) > 2 and sys.argv[1] == "revoke":
    print("revoked" if gate.revoke(sys.argv[2]) else "not found"); sys.exit()
p = argparse.ArgumentParser()
p.add_argument("--hours", type=float, default=72); p.add_argument("--uses", type=int, default=None)
p.add_argument("--cap", type=int, default=50); p.add_argument("--apps", default="*"); p.add_argument("--note", default="")
a = p.parse_args()
code, exp = gate.mint(a.hours, a.uses, a.cap, a.apps, a.note)
print(code); print("expires", time.strftime("%Y-%m-%d %H:%M (UTC+8)", time.localtime(exp)), file=sys.stderr)
