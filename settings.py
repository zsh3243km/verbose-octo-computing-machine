"""Admin-configurable runtime settings.

One source of truth for the values the panel and the Telegram bot read at
runtime. Everything that needs a setting calls :func:`get_settings` at use
time rather than importing a constant, so a change made in the panel is
respected by the backend, the API validation, the UI and the bot at once.

Settings live in the persisted state document under a top-level ``settings``
object, alongside ``links`` and ``subs``. Because they are part of the same
document they share its atomic write, backups and snapshot mechanism; no new
storage path is introduced.
"""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass, asdict, replace
from typing import Any

import proxy_repository

# Bounds for the per-subscription Multi-Location limit. The old hard-coded 2
# stays the default so existing deployments behave identically until an admin
# changes it.
MIN_LOCATIONS = 1
MAX_LOCATIONS = 10
DEFAULT_MAX_LOCATIONS = 2


@dataclass(frozen=True)
class Settings:
    """Every admin-tunable default. Immutable; changes replace the whole value."""

    # Multi-Location: how many exit locations one subscription may select.
    max_subscription_locations: int = DEFAULT_MAX_LOCATIONS

    # Exit proxy applied to a newly created config when the caller does not
    # choose one. `direct` is the historical behaviour and the safe default.
    default_exit_proxy_mode: str = "direct"
    default_proxy_id: str = ""
    default_custom_proxy: str = ""

    # Exit proxy applied to a newly provisioned Telegram customer config.
    telegram_default_proxy_id: str = ""

    # Base host used to build a per-user Dial Address template.
    # Empty keeps the historical "current service host" behaviour.
    telegram_dial_address_base: str = ""

    def public_payload(self) -> dict:
        """Safe payload for the authenticated Settings page.

        Proxy credentials and endpoints are never included; only the managed
        proxy's public summary is, exactly as :mod:`proxy_repository` exposes
        it everywhere else.
        """
        data = asdict(self)
        for key in ("default_proxy_id", "telegram_default_proxy_id"):
            record = proxy_repository.get_record(data.get(key) or "")
            data[f"{key}_summary"] = proxy_repository.public(record) if record else None
        return data


_DEFAULTS = Settings()


class SettingsError(ValueError):
    """A settings value is invalid; `detail` carries the operator-facing reason."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


_settings_lock = asyncio.Lock()
_settings = _DEFAULTS


# ── Reading ──────────────────────────────────────────────────────────────────

def get_settings() -> Settings:
    """Current settings snapshot. Cheap; called on the hot path, never cached."""
    return _settings


def max_locations() -> int:
    """The configured per-subscription Multi-Location limit."""
    return _settings.max_subscription_locations


# ── Persistence ──────────────────────────────────────────────────────────────

def settings_payload() -> dict:
    """Serialized form stored inside the state document."""
    return asdict(_settings)


def load_settings(raw: object) -> None:
    """Install persisted settings, keeping safe defaults for anything missing.

    Called while the state document is being loaded. Unknown keys are dropped
    and malformed values fall back to the default rather than failing startup,
    so a partially written document can never make the service boot-loop.
    """
    global _settings
    if not isinstance(raw, dict):
        return
    values: dict[str, Any] = {}
    for field in Settings.__dataclass_fields__:
        if field not in raw:
            continue
        value = raw[field]
        try:
            values[field] = _coerce(field, value)
        except SettingsError:
            # Keep the default for this one field; the rest still applies.
            continue
    try:
        _settings = replace(_DEFAULTS, **values)
    except TypeError:
        _settings = _DEFAULTS


def _coerce(field: str, value: object) -> object:
    if field == "max_subscription_locations":
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise SettingsError("max_subscription_locations must be an integer") from exc
        if not MIN_LOCATIONS <= number <= MAX_LOCATIONS:
            raise SettingsError(f"max_subscription_locations must be {MIN_LOCATIONS}..{MAX_LOCATIONS}")
        return number
    if field in ("default_exit_proxy_mode",):
        mode = str(value or "").strip().lower()
        if mode not in {"direct", "repository", "custom"}:
            raise SettingsError("default_exit_proxy_mode must be direct, repository or custom")
        return mode
    return str(value or "").strip()


# ── Updating ─────────────────────────────────────────────────────────────────

async def apply_settings(patch: object) -> Settings:
    """Validate a partial update, install it, and persist the state document.

    Raises :class:`SettingsError` with an operator-facing message when a value
    is rejected; the running settings are left untouched in that case.
    """
    global _settings
    if not isinstance(patch, dict):
        raise SettingsError("settings must be an object")
    async with _settings_lock:
        current = _settings
        merged = asdict(current)
        for field, value in patch.items():
            if field not in merged:
                # Unknown keys are ignored so a newer panel cannot be
                # rejected by an older backend, and vice versa.
                continue
            merged[field] = _coerce(field, value)
        candidate = Settings(**merged)

        # Cross-field validation: a repository selection must name a live proxy.
        if candidate.default_exit_proxy_mode == "repository" and candidate.default_proxy_id:
            if proxy_repository.get_record(candidate.default_proxy_id) is None:
                raise SettingsError("Selected default proxy is not in the current repository")
        if candidate.default_exit_proxy_mode == "custom" and candidate.default_custom_proxy:
            try:
                candidate = replace(candidate, default_custom_proxy=proxy_repository.validate_url(candidate.default_custom_proxy))
            except ValueError as exc:
                raise SettingsError(f"Default custom proxy is invalid: {exc}") from exc
        if candidate.telegram_default_proxy_id:
            if proxy_repository.get_record(candidate.telegram_default_proxy_id) is None:
                raise SettingsError("Selected Telegram default proxy is not in the current repository")

        # A failed write must leave the running value alone.
        from main import save_state

        _settings = candidate
        try:
            ok = await save_state(strict=True)
        except Exception:
            _settings = current
            raise
        if not ok:
            _settings = current
            raise SettingsError("Settings could not be persisted")
        return _settings


# ── Applying defaults to new resources ───────────────────────────────────────

def apply_default_exit(link: dict) -> None:
    """Apply the panel default exit proxy to a config that has none.

    Only ever runs when the caller did not choose an exit proxy, and never
    touches a config that already has an explicit selection, so existing users
    keep their own settings.
    """
    if link.get("exit_proxy_mode", "direct") not in ("", "direct"):
        return
    mode = _settings.default_exit_proxy_mode
    if mode == "repository" and _settings.default_proxy_id:
        if proxy_repository.get_record(_settings.default_proxy_id) is not None:
            link["exit_proxy_mode"] = "repository"
            link["proxy_id"] = _settings.default_proxy_id
            link["custom_proxy"] = ""
    elif mode == "custom" and _settings.default_custom_proxy:
        try:
            link["custom_proxy"] = proxy_repository.validate_url(_settings.default_custom_proxy)
            link["exit_proxy_mode"] = "custom"
            link["proxy_id"] = ""
        except ValueError:
            pass


def apply_telegram_default_exit(link: dict) -> None:
    """Apply the Telegram default exit proxy to a newly provisioned config.

    An explicit choice on the link always wins, so the panel default and the
    Telegram default are both only *defaults*.
    """
    if not _settings.telegram_default_proxy_id:
        return
    if link.get("exit_proxy_mode", "direct") not in ("", "direct") and not (
        link.get("exit_proxy_mode") == "direct" and link.get("proxy_id") == ""
    ):
        return
    if proxy_repository.get_record(_settings.telegram_default_proxy_id) is None:
        return
    link["exit_proxy_mode"] = "repository"
    link["proxy_id"] = _settings.telegram_default_proxy_id
    link["custom_proxy"] = ""


# ── Per-user Dial Address slugs ───────────────────────────────────────────────

def dial_address_for(slug: str) -> str:
    """Build the per-user Dial Address from the configured base.

    With no base configured this returns the empty string, which the link
    generator already understands as "use the current service host". The slug
    is unique per user and stored on the link itself, so a user's identity
    never depends on the admin configuring a base.
    """
    base = _settings.telegram_dial_address_base.strip().rstrip(".")
    if not base or not slug:
        return ""
    return f"{slug}.{base}"


def new_dial_slug() -> str:
    """A short, URL-safe, unique-per-call identifier for one user."""
    return "u" + secrets.token_urlsafe(6).replace("-", "").replace("_", "").lower()