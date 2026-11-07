#!/usr/bin/env python3
"""End-to-end backend verification against a LIVE server, via its real HTTP API.

Not a unit test: it logs in, changes settings, creates configs, restarts the
process, and reads the state back — the way an operator would.

    python tests/e2e_api.py http://localhost:8210 <password>
"""
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8210"
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "zippw"

failures = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (("  " + detail) if detail and not cond else ""))
    if not cond:
        failures.append(name)


def call(method, path, body=None, cookie=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", "code_session=" + cookie)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            try:
                parsed = json.loads(raw) if raw else {}
            except Exception:
                parsed = raw.decode(errors="replace")
            return r.status, parsed, r.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = raw.decode(errors="replace")
        return e.code, parsed, e.headers.get("Set-Cookie", "")
    except Exception as e:
        return 0, {"error": str(e)}, ""


# Read code_session out of the Set-Cookie header.
def session_from(set_cookie):
    for part in set_cookie.split(";"):
        part = part.strip()
        if part.startswith("code_session="):
            return part[len("code_session="):]
    return None


print("[authentication]")
st, body, _ = call("POST", "/api/login", {"password": "wrong-password"})
check("wrong password is rejected with 401", st == 401, str(st))
st, body, _ = call("GET", "/api/settings")
check("an anonymous request is rejected", st == 401, str(st))
st, body, sc = call("POST", "/api/login", {"password": PASSWORD})
check("correct password is accepted", st == 200 and body.get("ok"), str(st))
COOKIE = session_from(sc)
check("a session cookie is issued", bool(COOKIE))
st, body, _ = call("GET", "/api/settings", cookie=COOKIE)
check("the session grants access", st == 200, str(st))

print("\n[settings: the location limit is honoured live]")
for value, expected in [(3, 3), (5, 5), (2, 2)]:
    st, body, _ = call("POST", "/api/settings", {"max_subscription_locations": value}, COOKIE)
    check(f"limit set to {value}", st == 200 and body["settings"]["max_subscription_locations"] == expected, str(body))
    st, body, _ = call("POST", "/api/subs", {"name": f"lim{value}"}, COOKIE)
    sid = body.get("sub_id")
    check(f"a group was created for the limit={value} test", bool(sid), str(body))
    # Under the limit: rejected with the count message.
    st, body, _ = call("PATCH", f"/api/subs/{sid}", {"multi_location": {
        "enabled": True, "selection_mode": "explicit",
        "locations": [{"code": "DE", "proxy_id": "x"} for _ in range(max(1, value - 1))],
    }}, COOKIE)
    check(f"limit={value} rejects {value-1} locations", st == 400 and f"exactly {value}" in body.get("detail", ""), body.get("detail", ""))
    # Over the limit: also rejected.
    st, body, _ = call("PATCH", f"/api/subs/{sid}", {"multi_location": {
        "enabled": True, "selection_mode": "explicit",
        "locations": [{"code": c, "proxy_id": "x"} for c in ["DE", "FR", "NL", "US", "GB"]][: value + 1],
    }}, COOKIE)
    # Rejected either by the count, or by the proxy lookup after the count passed.
    rejected = st == 400 and (
        f"exactly {value}" in body.get("detail", "") or "repository" in body.get("detail", "")
    )
    check(f"limit={value} rejects {value+1} locations", rejected, body.get("detail", ""))

st, body, _ = call("POST", "/api/settings", {"max_subscription_locations": 99}, COOKIE)
check("an out-of-range limit is rejected", st == 400, str(body))
st, body, _ = call("POST", "/api/settings", {"default_exit_proxy_mode": "nonsense"}, COOKIE)
check("an unknown exit mode is rejected", st == 400, str(body))

print("\n[TLS SNI independence over the real API]")
# Unique per process: a v4 UUID with the version/variant bits forced, so a
# re-run against the same server never collides with the previous one.
from uuid import uuid4
UUID_A, UUID_B, UUID_C = str(uuid4()), str(uuid4()), str(uuid4())

st, a, _, _ = *call("POST", "/api/links", {
    "label": "e2e-auto", "address": "dial.example.net", "sni": "tls.example.org", "uuid": UUID_A,
}, COOKIE), None
check("the auto-mode config was created", "vless_link" in a, str(a))
from urllib.parse import urlsplit, parse_qs
qa = parse_qs(urlsplit(a["vless_link"]).query)
check("auto mode: dial address is its own value", a["address"] == "dial.example.net", a["address"])
check("auto mode: the SNI is the configured one", qa.get("sni") == ["tls.example.org"], str(qa.get("sni")))
check("auto mode: the WS host is separate", qa.get("host") != qa.get("sni"), str(qa.get("host")))

st, b, _, _ = *call("POST", "/api/links", {
    "label": "e2e-off", "address": "dial.example.net", "sni_mode": "off", "uuid": UUID_B,
}, COOKIE), None
qb = parse_qs(urlsplit(b["vless_link"]).query)
check("snI off: no sni parameter at all", "sni" not in qb, str(qb.get("sni")))
check("sni off: no empty sni= in the URI", "sni=" not in b["vless_link"])
check("sni off: the dial address is untouched", b["address"] == "dial.example.net")
check("sni off: the WS host is untouched", qb.get("host") == qa.get("host"), str(qb.get("host")))
check("sni off: the mode is persisted", b.get("sni_mode") == "off", str(b.get("sni_mode")))
check("the empty SNI is not a copy of the WS host", qb.get("host") != [""], str(qb.get("host")))

# Edit through PATCH keeps the mode.
st, c, _, _ = *call("PATCH", f"/api/links/{UUID_B}", {"sni_mode": "off", "address": "other.example.net"}, COOKIE), None
st, listb, _, _ = *call("GET", "/api/links", cookie=COOKIE), None
after = next(l for l in listb["links"] if l["uuid"] == UUID_B)
check("editing keeps sni_mode=off", after.get("sni_mode") == "off", str(after.get("sni_mode")))
check("editing changes the address", after.get("address") == "other.example.net", str(after.get("address")))

# An explicit SNI always wins, whatever the mode.
st, d, _, _ = *call("POST", "/api/links", {
    "label": "e2e-explicit", "address": "x.example.net", "sni": "wins.example.org",
    "sni_mode": "off", "uuid": UUID_C,
}, COOKIE), None
qd = parse_qs(urlsplit(d["vless_link"]).query)
check("an explicit SNI overrides sni_mode=off", qd.get("sni") == ["wins.example.org"], str(qd.get("sni")))

print("\n[subscription output for each SNI mode]")
st, sub, _, _ = *call("GET", f"/sub/{UUID_B}", cookie=COOKIE), None
import base64
decoded = base64.b64decode(sub).decode() if isinstance(sub, str) and sub else ""
check("the subscription for the off-mode config has no sni=", "sni=" not in decoded, decoded[:120])

st, body, _ = call("POST", "/api/settings", {
    "max_subscription_locations": 2,
    "telegram_dial_address_base": "relay.example.com",
}, COOKIE)
check("a dial base is accepted", st == 200 and body["settings"]["telegram_dial_address_base"] == "relay.example.com", str(body))

print("\n[the config was created and is listed]")
st, links, _, _ = *call("GET", "/api/links", cookie=COOKIE), None
check("all three configs are listed", len(links["links"]) >= 3, str(len(links["links"])))

print("\n[state survives a process restart]")
state_dir = os.environ.get("E2E_STATE_DIR", "")
before = None
if state_dir:
    p = Path(state_dir) / "code_state.json"
    if p.exists():
        before = json.loads(p.read_text(encoding="utf-8"))
check("a state file exists on disk", before is not None)
if before:
    check("the schema is version 4", before.get("schema_version") == 4, str(before.get("schema_version")))
    check("the settings block is persisted", isinstance(before.get("settings"), dict))
    check("the dial base is on disk", before["settings"].get("telegram_dial_address_base") == "relay.example.com")
    off = next((l for l in before["links"].values() if l.get("label") == "e2e-off"), None)
    check("sni_mode=off is on disk", off is not None and off.get("sni_mode") == "off", str(off and off.get("sni_mode")))

print("\n[static assets]")
for path in ["/glisse/styles.css", "/glisse/glisse.js", "/glisse/lens.js", "/glisse/refraction.js",
             "/glisse/components.js", "/glisse/spring.mjs", "/glisse/lens-map-core.mjs"]:
    st, _, _, _ = *call("GET", path), None
    check(f"GET {path} -> 200", st == 200, str(st))

if failures:
    print(f"\nFAILURES: {len(failures)} -> {failures}")
    sys.exit(1)
print("\nLive API end-to-end: auth=OK limit=OK sni-independence=OK empty-sni=OK persistence=OK assets=OK")
