#!/usr/bin/env python3
"""Telegram customer provisioning: per-user dial address + default exit proxy."""
import asyncio, os, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="lumen-tg-")

import types
class _App:
    def __init__(self, *a, **k): pass
    def deco(self, *a, **k): return lambda f: f
    on_event = get = post = patch = delete = api_route = middleware = deco
    def add_middleware(self, *a, **k): pass
    def add_api_websocket_route(self, *a, **k): pass
class _HTTP(Exception):
    def __init__(self, status_code=500, detail=""): self.status_code = status_code; self.detail = detail
class _D: pass
fa = types.ModuleType("fastapi"); fa.FastAPI = _App; fa.Request = _D; fa.HTTPException = _HTTP
fa.WebSocket = _D; fa.WebSocketDisconnect = Exception; fa.Depends = lambda f: f
resp = types.ModuleType("fastapi.responses")
for n in ["Response", "HTMLResponse", "JSONResponse", "RedirectResponse"]:
    setattr(resp, n, type(n, (), {"__init__": lambda self, *a, **k: None}))
cors = types.ModuleType("fastapi.middleware.cors"); cors.CORSMiddleware = _D
sys.modules.update({
    "fastapi": fa, "fastapi.responses": resp,
    "fastapi.middleware": types.ModuleType("fastapi.middleware"),
    "fastapi.middleware.cors": cors,
})
sys.modules["aiofiles"] = types.ModuleType("aiofiles")
_hx = types.ModuleType("httpx"); _hx.AsyncClient = _D; _hx.Limits = _D; _hx.Timeout = _D
sys.modules["httpx"] = _hx
_uv = types.ModuleType("uvicorn"); _uv.Config = _D; _uv.Server = _D
sys.modules["uvicorn"] = _uv
_pg = types.ModuleType("pages"); _pg.LOGIN_HTML = _pg.DASHBOARD_HTML = _pg.LANDING_HTML = ""
sys.modules["pages"] = _pg

import proxy_repository as repo
import main
import settings as lumen_settings
import telegram_bot as bot

failures = []
def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (("  " + detail) if detail and not cond else ""))
    if not cond: failures.append(name)

DE = repo.Record("de1", "http://10.0.0.1:8080", "http", "Germany", "DE", "🇩🇪", 5)
NL = repo.Record("nl1", "http://10.0.1.1:8080", "http", "Netherlands", "NL", "🇳🇱", 7)


def seed():
    repo._records = {"de1": DE, "nl1": NL}
    repo._last = time.monotonic()
    repo._error = ""
    main.LINKS.clear(); main.SUBS.clear()
    bot.STORE["users"].clear(); bot.STORE["orders"].clear()


async def register(user_id, name="کاربر"):
    seed()
    return await bot._ensure_user({"id": user_id, "first_name": name, "username": "u%s" % user_id})


async def run():
    seed()

    print("[a Telegram user is an independent customer]")
    u = await register(101)
    check("user record created", bot.STORE["users"]["101"]["first_name"] == "کاربر")
    check("dial slug assigned", bool(bot.STORE["users"]["101"].get("dial_slug")))

    print("\n[each user has a unique Dial Address slug]")
    slugs = set()
    for i in range(30):
        user = await register(200 + i)
        slugs.add(bot.STORE["users"][str(200 + i)]["dial_slug"])
    check("30 users -> 30 unique slugs", len(slugs) == 30, str(len(slugs)))
    check("slugs are not the telegram id", not any(s == "101" for s in slugs))

    print("\n[new users get the admin default exit proxy]")
    seed()
    lumen_settings.load_settings({"telegram_default_proxy_id": "de1"})
    seed()
    await register(300)
    await bot._record_default_exit_for_user(300)
    rec = bot.STORE["users"]["300"]
    check("default proxy recorded", rec.get("exit_proxy_mode") == "repository", str(rec.get("exit_proxy_mode")))
    check("default proxy id recorded", rec.get("proxy_id") == "de1", str(rec.get("proxy_id")))
    check("applied-at stamped", bool(rec.get("default_exit_applied_at")))
    mode, pid, custom = bot.exit_proxy_for_user(300)
    check("resolved for a new config", (mode, pid, custom) == ("repository", "de1", ""), str((mode, pid, custom)))

    print("\n[the default applies to the provisioned config with no manual change]")
    order = {"id": "O1", "user_id": 300, "plan": bot.PLAN_BY_ID["economic"]}
    uid = await bot._provision_new(order)
    link = main.LINKS[uid]
    check("provisioned config uses the default proxy", link.get("exit_proxy_mode") == "repository" and link.get("proxy_id") == "de1",
          f"{link.get('exit_proxy_mode')}/{link.get('proxy_id')}")
    check("provisioned config carries its dial slug", bool(link.get("dial_slug")))
    check("dial slug is the user's", link.get("dial_slug") == bot.STORE["users"]["300"]["dial_slug"])
    check("ownership stamped", link.get("owner_telegram_id") == 300)

    print("\n[changing the admin default does not disturb existing users]")
    lumen_settings.load_settings({"telegram_default_proxy_id": "nl1"})
    mode, pid, custom = bot.exit_proxy_for_user(300)
    check("existing user keeps Germany", (mode, pid) == ("repository", "de1"), str((mode, pid)))
    # A second purchase for the same user still lands on Germany.
    order2 = {"id": "O2", "user_id": 300, "plan": bot.PLAN_BY_ID["economic"]}
    uid2 = await bot._provision_new(order2)
    link2 = main.LINKS[uid2]
    check("second config for the same user also stays on Germany", link2.get("proxy_id") == "de1", str(link2.get("proxy_id")))
    await bot._record_default_exit_for_user(300)
    check("user record is not rewritten by the change", bot.STORE["users"]["300"]["proxy_id"] == "de1")

    print("\n[renewals keep the user's proxy]")
    order3 = {"id": "O3", "user_id": 300, "service_id": uid, "plan": bot.PLAN_BY_ID["economic"]}
    await bot._provision_renew(order3)
    check("renewed config keeps its proxy", main.LINKS[uid].get("proxy_id") == "de1", str(main.LINKS[uid].get("proxy_id")))

    print("\n[a new user after the change gets the new default]")
    await register(400)
    await bot._record_default_exit_for_user(400)
    check("new user gets Netherlands", bot.STORE["users"]["400"].get("proxy_id") == "nl1", str(bot.STORE["users"]["400"].get("proxy_id")))

    print("\n[the panel default is used when no Telegram default is set]")
    lumen_settings.load_settings({})
    seed()
    await register(500)
    await bot._record_default_exit_for_user(500)
    lumen_settings.load_settings({"default_exit_proxy_mode": "repository", "default_proxy_id": "de1"})
    mode, pid, custom = bot.exit_proxy_for_user(500)
    check("panel default reaches the bot user", (mode, pid) == ("repository", "de1"), str((mode, pid)))

    print("\n[no default configured means direct, not a crash]")
    lumen_settings.load_settings({})
    seed()
    await register(600)
    await bot._record_default_exit_for_user(600)
    mode, pid, custom = bot.exit_proxy_for_user(600)
    check("direct when nothing is configured", (mode, pid, custom) == ("direct", "", ""), str((mode, pid, custom)))
    order4 = {"id": "O4", "user_id": 600, "plan": bot.PLAN_BY_ID["economic"]}
    uid4 = await bot._provision_new(order4)
    check("provisioned config is direct", main.LINKS[uid4].get("exit_proxy_mode") == "direct")

    print("\n[a proxy removed from the repo does not break an existing user]")
    seed()
    lumen_settings.load_settings({"telegram_default_proxy_id": "de1"})
    seed()
    await register(700)
    await bot._record_default_exit_for_user(700)
    repo._records.pop("de1")
    # A user whose recorded proxy is gone is re-resolved from the current
    # default, exactly once, instead of being handed a dead endpoint.
    lumen_settings.load_settings({"telegram_default_proxy_id": "nl1"})
    await bot._record_default_exit_for_user(700)
    mode, pid, custom = bot.exit_proxy_for_user(700)
    check("vanished proxy falls back to the current default", mode == "repository" and pid == "nl1", str((mode, pid)))
    check("the fallback is written once", bot.STORE["users"]["700"]["proxy_id"] == "nl1")

    print("\n[the admin default absorbs the Telegram default]")
    seed()
    lumen_settings.load_settings({})
    seed()
    await register(800)
    await bot._record_default_exit_for_user(800)
    lumen_settings.load_settings({"default_exit_proxy_mode": "repository", "default_proxy_id": "nl1"})
    mode, pid, custom = bot.exit_proxy_for_user(800)
    check("panel default is honoured", (mode, pid) == ("repository", "nl1"), str((mode, pid)))

    lumen_settings.load_settings({})
    if failures:
        print("\nFAILURES: %d -> %s" % (len(failures), failures))
        return 1
    print("\nTelegram provisioning: unique-dial=OK default-proxy=OK no-manual-change=OK existing-users-safe=OK renew-safe=OK")
    return 0


sys.exit(asyncio.run(run()))
