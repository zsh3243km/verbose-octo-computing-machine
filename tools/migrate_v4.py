#!/usr/bin/env python3
"""Controlled state migration: schema_version 3 -> 4.

What changes:
  * a top-level "settings" object is added (defaults only, never rewritten);
  * the Multi-Location limit stops being hard-coded 2 and is read from settings;
  * existing subscriptions are checked against the configured limit and reported,
    but never silently rewritten.

This tool is read-only by default. Run --apply to write the migrated document.
A backup of the original is always written next to it before any change.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import settings as lumen_settings  # noqa: E402  (import after sys.path setup)

OLD_SCHEMA = 3
NEW_SCHEMA = 4


def load(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("state root is not an object")
    return data


def preview(data: dict) -> list[str]:
    """Human-readable list of what the migration would change."""
    notes: list[str] = []
    version = int(data.get("schema_version") or 0)
    if version >= NEW_SCHEMA:
        notes.append("state is already schema_version %d; nothing to do" % NEW_SCHEMA)
        return notes

    notes.append("schema_version %d -> %d" % (version, NEW_SCHEMA))

    subs = data.get("subs") or {}
    links = data.get("links") or {}
    notes.append("links: %d" % len(links))
    notes.append("subscriptions: %d" % len(subs))

    # The old code hard-coded 2, so any subscription that is already valid was
    # valid under exactly that limit. Report, never mutate.
    old_limit = 2
    ml_enabled = 0
    over_old = 0
    for sub in subs.values():
        ml = (sub or {}).get("multi_location") or {}
        if ml.get("enabled"):
            ml_enabled += 1
            locations = ml.get("locations") or []
            if len(locations) > old_limit:
                over_old += 1
    notes.append("Multi-Location subscriptions: %d (over the old limit of 2: %d)" % (ml_enabled, over_old))

    # Users reachable from Telegram link ownership, for the default-exit preview.
    owned = sum(
        1 for link in links.values()
        if (link or {}).get("owner_telegram_id") is not None
    )
    notes.append("Store-managed configs (owned by a Telegram user): %d" % owned)
    direct = sum(
        1 for link in links.values()
        if str((link or {}).get("exit_proxy_mode") or "direct") == "direct"
    )
    notes.append("Configs currently on a direct exit: %d" % direct)

    s = lumen_settings.get_settings()
    notes.append(
        "defaults to install: max_subscription_locations=%d, "
        "default_exit_proxy_mode=%s, telegram_default_proxy_id=%s"
        % (
            s.max_subscription_locations,
            s.default_exit_proxy_mode or "(none)",
            s.telegram_default_proxy_id or "(none)",
        )
    )
    return notes


def migrate(data: dict) -> dict:
    out = dict(data)
    out["schema_version"] = NEW_SCHEMA
    # Install defaults only; never overwrite an existing settings block.
    if not isinstance(out.get("settings"), dict):
        out["settings"] = lumen_settings.settings_payload()
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("state", type=Path, help="path to code_state.json")
    parser.add_argument("--apply", action="store_true", help="write the migrated document")
    parser.add_argument("--backup-dir", type=Path, default=None, help="where to keep the pre-migration copy")
    args = parser.parse_args()

    if not args.state.exists():
        print("state file not found: %s" % args.state)
        return 2

    data = load(args.state)
    notes = preview(data)
    print("Migration preview")
    print("-----------------")
    for note in notes:
        print("  " + note)

    version = int(data.get("schema_version") or 0)
    if version >= NEW_SCHEMA:
        print("\nNothing to do.")
        return 0

    migrated = migrate(data)

    print("\nFields added: settings")
    print(json.dumps(migrated["settings"], indent=2, ensure_ascii=False))

    if not args.apply:
        print("\nDry run only. Re-run with --apply to write the migrated document.")
        return 0

    backup_dir = args.backup_dir or args.state.parent
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / (args.state.name + ".pre-v4")
    shutil.copy2(args.state, backup)
    print("\nBackup written: %s" % backup)

    tmp = args.state.with_suffix(".tmp")
    tmp.write_text(json.dumps(migrated, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, args.state)
    print("Migrated: %s" % args.state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
