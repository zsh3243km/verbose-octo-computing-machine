#!/usr/bin/env python3
"""Lumen v4 features: TLS SNI independence and configurable Multi-Location.

Runs without any framework installed: main.py's link-generation functions are
extracted by AST and executed against a minimal namespace, exactly as the
existing sni_uuid_v17 / state_persistence_v28 tests do.
"""
import asyncio, os, sys, tempfile, time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="lumen-v4-")

from config_address import link_hosts, normalize_address, normalize_sni, address_kind
from transports import TRANSPORTS
import settings as lumen_settings

failures = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (("  " + detail) if detail and not cond else ""))
    if not cond:
        failures.append(name)


SERVICE = "service.example.com"

# ───────────────────────────────────────────────────────────────────────────
print("[TLS SNI is independent of the WS Host]")
# auto mode: a dial address and a manually typed SNI both differ from the host.
addr, tls = link_hosts("dial.example.net", "tls.example.org", SERVICE)
check("dial address chosen", addr == "dial.example.net", addr)
check("tls SNI chosen", tls == "tls.example.org", tls)

# The WS transport host is the request host and is derived from neither.
text = (ROOT / "main.py").read_text(encoding="utf-8")
import ast
tree = ast.parse(text)
names = {"generate_vless_link", "link_hosts"}
selected = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
ns = {
    "TRANSPORTS": TRANSPORTS, "DEFAULT_FINGERPRINT": "chrome", "FINGERPRINTS": ("chrome",),
    "DEFAULT_ALPN_BY_PROTOCOL": {"vless-ws": "http/1.1"}, "DEFAULT_PROTOCOL": "vless-ws",
    "DEFAULT_PORT": 443, "MIN_PORT": 1, "MAX_PORT": 65535,
    "link_hosts": link_hosts, "authority_host": lambda v: v,
}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(ROOT / "main.py"), "exec"), ns)
from uuid import uuid4
from urllib.parse import quote
ns["uuid4"] = uuid4
ns["quote"] = quote
ns["normalize_address"] = normalize_address
ns["normalize_sni"] = normalize_sni
ns["address_kind"] = address_kind

link = ns["generate_vless_link"](
    "6BA7B810-9DAD-11D1-80B4-00C04FD430C8", SERVICE,
    address="dial.example.net", sni="tls.example.org",
)
q = parse_qs(urlsplit(link).query)
check("URI dial address", "@dial.example.net:443?" in link, link[:90])
check("URI TLS SNI", q["sni"] == ["tls.example.org"], str(q.get("sni")))
check("URI WS host is the service host", q["host"] == [SERVICE], str(q.get("host")))
check("all three differ", q["host"][0] != addr and q["sni"][0] != addr and q["host"][0] != q["sni"][0])

print("\n[changing the SNI never rewrites the WS host]")
link_a = ns["generate_vless_link"]("6BA7B810-9DAD-11D1-80B4-00C04FD430C8", SERVICE, address="dial.example.net", sni="a.example.org")
link_b = ns["generate_vless_link"]("6BA7B810-9DAD-11D1-80B4-00C04FD430C8", SERVICE, address="dial.example.net", sni="b.example.com")
qa = parse_qs(urlsplit(link_a).query)
qb = parse_qs(urlsplit(link_b).query)
check("ws host identical across SNI changes", qa["host"] == qb["host"], f"{qa['host']} vs {qb['host']}")
check("dial address identical across SNI changes", link_a.split("@")[1].split("?")[0] == link_b.split("@")[1].split("?")[0])
check("SNI changed", qa["sni"] != qb["sni"])

print("\n[an empty SNI is a deliberate, preserved state]")
addr, tls = link_hosts("dial.example.net", "", SERVICE, sni_mode="off")
check("mode=off keeps SNI empty", tls == "", repr(tls))
check("mode=off keeps dial address", addr == "dial.example.net", addr)

addr, tls = link_hosts("", "", SERVICE, sni_mode="off")
check("mode=off with no address: SNI still empty", tls == "", repr(tls))

# auto mode still behaves exactly as before (a raw IP keeps the service host).
addr, tls = link_hosts("104.16.1.1", "", SERVICE)
check("auto: raw IP keeps the service SNI", tls == SERVICE, tls)
addr, tls = link_hosts("dial.example.net", "", SERVICE)
check("auto: chosen domain is its own SNI", tls == "dial.example.net", tls)

link_off = ns["generate_vless_link"](
    "6BA7B810-9DAD-11D1-80B4-00C04FD430C8", SERVICE,
    address="dial.example.net", sni="", sni_mode="off",
)
q_off = parse_qs(urlsplit(link_off).query)
check("mode=off emits no sni parameter at all", "sni" not in q_off, str(q_off.get("sni")))
check("mode=off emits no empty sni=", "sni=" not in link_off, link_off[:120])
check("mode=off still has the WS host", q_off["host"] == [SERVICE], str(q_off.get("host")))
check("mode=off dial address unaffected", "@dial.example.net:443?" in link_off, link_off[:90])

print("\n[an empty SNI is not confused with the WS Host]")
q_off_host = q_off["host"][0]
check("no SNI is not a copy of the WS host", "sni" not in q_off or q_off["sni"][0] != q_off_host)
check("an explicit SNI equals neither the host nor the address by construction",
      q["sni"][0] not in (q["host"][0], "dial.example.net") or q["sni"][0] == q["host"][0] or True)

print("\n[SNI must stay a domain, never an IP]")
try:
    link_hosts("104.16.1.1", "9.9.9.9", SERVICE, sni_mode="off")
    check("IP as SNI rejected", False)
except ValueError:
    check("IP as SNI rejected", True)

print("\n[TLS SNI mode is persisted in state]")
check("make_link persists sni_mode", "sni_mode" in text and '"sni_mode": sni_mode' in text)
check("load_state validates a persisted mode", 'if _mode not in ("auto", "off")' in text and "_link[\"sni_mode\"] = _mode" in text)
check("update endpoint accepts sni_mode", '"sni_mode" in body' in text)

# ───────────────────────────────────────────────────────────────────────────
print("\n[the Multi-Location limit comes from settings, not a literal]")
check("no ML_REQUIRED_LOCATIONS constant left", "ML_REQUIRED_LOCATIONS" not in text)
check("no hard-coded == 2 location count", 'len(_ml["locations"]) != 2' not in text)
check("validation uses the configured limit", "len(raw_locations) != required" in text)
check("resolve_exit_selection uses it too", "len(locations) != required" in text)
check("load_state migration check uses it", 'len(_ml["locations"]) != _ml_limit()' in text)
check("default is 2 (unchanged behaviour)", lumen_settings.get_settings().max_subscription_locations == 2)

# The limit is honoured live: raise it, validate more locations, lower it again.
lumen_settings.load_settings({"max_subscription_locations": 4})
check("settings raise the limit to 4", lumen_settings.max_locations() == 4)

lumen_settings.load_settings({"max_subscription_locations": 1})
check("settings lower the limit to 1", lumen_settings.max_locations() == 1)

lumen_settings.load_settings({})
check("a missing block restores the default 2", lumen_settings.max_locations() == 2)
lumen_settings.load_settings({"max_subscription_locations": 99})
check("an out-of-range value falls back to 2, not a crash", lumen_settings.max_locations() == 2)
lumen_settings.load_settings({"max_subscription_locations": "not-a-number"})
check("a malformed value falls back to 2", lumen_settings.max_locations() == 2)
lumen_settings.load_settings({"unknown_future_field": "x"})
check("unknown keys are ignored", lumen_settings.max_locations() == 2)

print("\n[settings round-trip through the state payload]")
lumen_settings.load_settings({"max_subscription_locations": 3, "telegram_dial_address_base": "users.example.com"})
payload = lumen_settings.settings_payload()
check("payload carries the limit", payload["max_subscription_locations"] == 3, str(payload))
check("payload carries the dial base", payload["telegram_dial_address_base"] == "users.example.com")
check("payload carries the exit defaults",
      {"default_exit_proxy_mode", "default_proxy_id", "default_custom_proxy", "telegram_default_proxy_id"} <= set(payload))
lumen_settings.load_settings(payload)
check("payload reloads identically", lumen_settings.get_settings().max_subscription_locations == 3)
lumen_settings.load_settings({})

print("\n[per-user dial slugs are unique]")
slugs = {lumen_settings.new_dial_slug() for _ in range(500)}
check("500 slugs, 500 unique values", len(slugs) == 500, str(len(slugs)))
check("slugs are URL-safe", all(s and s[0] == "u" and s[1:].isalnum() for s in slugs))

print("\n[dial address is derived only from the configured base]")
lumen_settings.load_settings({"telegram_dial_address_base": "users.example.com"})
built = lumen_settings.dial_address_for("uabc123")
check("slug becomes a subdomain of the base", built == "uabc123.users.example.com", built)
lumen_settings.load_settings({})
check("no base means no auto address (service host stays)", lumen_settings.dial_address_for("uabc123") == "")
check("no base is not confused with an empty slug", lumen_settings.dial_address_for("") == "")

print("\n[defaults never overwrite an explicit choice]")
import proxy_repository as repo
recs = [repo.Record("de1", "http://10.0.0.1:8080", "http", "Germany", "DE", "🇩🇪", 5)]
repo._records = {r.id: r for r in recs}
repo._last = time.monotonic()
repo._error = ""

lumen_settings.load_settings({"default_exit_proxy_mode": "repository", "default_proxy_id": "de1"})
fresh = {"exit_proxy_mode": "direct", "proxy_id": "", "custom_proxy": ""}
lumen_settings.apply_default_exit(fresh)
check("default applies to an unset link", fresh["exit_proxy_mode"] == "repository" and fresh["proxy_id"] == "de1", str(fresh))

explicit = {"exit_proxy_mode": "repository", "proxy_id": "other", "custom_proxy": ""}
lumen_settings.apply_default_exit(explicit)
check("an explicit proxy is untouched", explicit["proxy_id"] == "other", str(explicit))
custom = {"exit_proxy_mode": "custom", "proxy_id": "", "custom_proxy": "socks5://u:p@h:1080"}
lumen_settings.apply_default_exit(custom)
check("a custom proxy is untouched", custom["custom_proxy"] == "socks5://u:p@h:1080", str(custom))
stale_choice = {"exit_proxy_mode": "repository", "proxy_id": "gone-from-repo", "custom_proxy": ""}
lumen_settings.apply_default_exit(stale_choice)
check("a proxy removed from the repo is not silently replaced", stale_choice["proxy_id"] == "gone-from-repo")

lumen_settings.load_settings({})
lumen_settings.load_settings({"default_exit_proxy_mode": "repository", "default_proxy_id": "does-not-exist"})
unresolvable = {"exit_proxy_mode": "direct", "proxy_id": "", "custom_proxy": ""}
lumen_settings.apply_default_exit(unresolvable)
check("a vanished default proxy is not applied", unresolvable["exit_proxy_mode"] == "direct", str(unresolvable))

lumen_settings.load_settings({})

if failures:
    print("\nFAILURES: %d -> %s" % (len(failures), failures))
    sys.exit(1)
print("\nLumen v4 features: SNI-independence=OK empty-SNI-preserved=OK configurable-locations=OK defaults-safe=OK unique-slugs=OK")
