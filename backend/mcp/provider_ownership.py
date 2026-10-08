"""Provider ownership and deduplication rules between Local MCP and Composio.

Enforces the invariant that a provider (e.g. Gmail, GitHub) is owned by at most
one backend at any time. When a local MCP server for a provider is configured
and signed in with an active account, local takes ownership (advanced/self-hosted
path), and the corresponding Composio cloud toolkit is withheld and hidden.
"""

from __future__ import annotations

import logging
import time
from typing import Any

log = logging.getLogger(__name__)

#: Mapping of Composio toolkit slugs to corresponding local MCP server names.
PROVIDER_MAPPING: dict[str, set[str]] = {
    "gmail": {"google-workspace", "google-gmail"},
    "googlecalendar": {"google-workspace", "google-calendar"},
    "github": {"github"},
    "spotify": {"spotify"},
}

#: Inverse mapping: local server name -> set of Composio toolkit slugs.
LOCAL_TO_COMPOSIO_TOOLKITS: dict[str, set[str]] = {}
for _tk, _local_servers in PROVIDER_MAPPING.items():
    for _server in _local_servers:
        LOCAL_TO_COMPOSIO_TOOLKITS.setdefault(_server, set()).add(_tk)

CACHE_TTL_SECONDS = 5.0
_cache: tuple[float, set[str]] | None = None


def forget() -> None:
    """Clear cached active local servers."""
    global _cache
    _cache = None


def get_active_local_servers(force: bool = False) -> set[str]:
    """Return set of configured local servers that have a verified signed-in account."""
    global _cache
    now = time.monotonic()
    if not force and _cache is not None and now < _cache[0]:
        return _cache[1]

    active: set[str] = set()
    try:
        from backend.mcp import commands as mcp
        from backend.mcp.config import load_servers

        servers = load_servers()
        for name, config in servers.items():
            if name == "composio":
                continue
            if config.enabled and mcp.is_signed_in(config) is True:
                active.add(name)
    except Exception as exc:
        log.debug("Could not determine active local servers: %s", exc)

    _cache = (now + CACHE_TTL_SECONDS, active)
    return active


def is_provider_overridden_by_local(toolkit_slug: str) -> bool:
    """Return True if local MCP handles this provider instead of Composio."""
    normalized = toolkit_slug.strip().lower()
    equivalent_local_servers = PROVIDER_MAPPING.get(normalized, set())
    if not equivalent_local_servers:
        return False

    # Check if explicit active_target is stored in database
    try:
        from backend.db.connection import get_connection

        conn = get_connection()
        row = conn.execute(
            "SELECT active_target FROM provider_fallbacks WHERE provider = ?",
            (normalized,),
        ).fetchone()
        if row and row["active_target"]:
            target = str(row["active_target"]).lower()
            if target == "local":
                return True
            if target == "composio":
                return False
    except Exception as exc:
        log.debug("Error checking explicit fallback target: %s", exc)

    active_local = get_active_local_servers()
    return bool(equivalent_local_servers & active_local)


def get_active_target(provider: str) -> str:
    """Return the active backend ('composio' or 'local') for a provider."""
    normalized = provider.strip().lower()
    try:
        from backend.db.connection import get_connection

        conn = get_connection()
        row = conn.execute(
            "SELECT active_target FROM provider_fallbacks WHERE provider = ?",
            (normalized,),
        ).fetchone()
        if row and row["active_target"]:
            return str(row["active_target"]).lower()
    except Exception as exc:
        log.debug("Could not read provider fallback target: %s", exc)

    equivalent_local_servers = PROVIDER_MAPPING.get(normalized, set())
    if equivalent_local_servers and (equivalent_local_servers & get_active_local_servers()):
        return "local"
    return "composio"


def switch_target(provider: str, target: str, reason: str | None = None) -> bool:
    """Switch a provider's backend to 'local' or 'composio' with an optional failure reason."""
    normalized = provider.strip().lower()
    target_norm = target.strip().lower()
    if target_norm not in ("local", "composio"):
        raise ValueError("target must be 'local' or 'composio'")

    try:
        from backend.db.connection import get_connection

        conn = get_connection()
        conn.execute(
            """
            INSERT INTO provider_fallbacks (provider, active_target, failure_reason, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(provider) DO UPDATE SET
                active_target = excluded.active_target,
                failure_reason = excluded.failure_reason,
                updated_at = excluded.updated_at
            """,
            (normalized, target_norm, reason),
        )
        conn.commit()
        forget()
        return True
    except Exception as exc:
        log.error("Failed to switch provider fallback target for %s: %s", provider, exc)
        return False


def reset_target(provider: str) -> bool:
    """Remove explicit fallback target setting for a provider, reverting to default logic."""
    normalized = provider.strip().lower()
    try:
        from backend.db.connection import get_connection

        conn = get_connection()
        conn.execute("DELETE FROM provider_fallbacks WHERE provider = ?", (normalized,))
        conn.commit()
        forget()
        return True
    except Exception as exc:
        log.error("Failed to reset provider fallback target for %s: %s", provider, exc)
        return False


def detect_fallback_trigger(error: str | Exception) -> str | None:
    """Detect if an error is a Composio credits, plan expiration, or service outage issue."""
    text = str(error).lower()
    if any(k in text for k in ("402", "credits", "insufficient credits", "quota", "rate limit", "payment required")):
        return "credits_exhausted"
    if any(k in text for k in ("403", "plan expired", "subscription", "upgrade required", "billing")):
        return "plan_expired"
    if any(
        k in text
        for k in (
            "502",
            "503",
            "504",
            "unavailable",
            "service unavailable",
            "gateway timeout",
            "connection refused",
            "bad gateway",
            "mcp_auth_failure_reason",
        )
    ):
        return "service_unavailable"
    return None


def get_provider_fallback_status(provider: str) -> dict[str, Any]:
    """Get comprehensive fallback status for a provider."""
    norm = provider.strip().lower()
    equivalent = sorted(list(PROVIDER_MAPPING.get(norm, set())))
    active_local = get_active_local_servers()
    is_signed_in = bool(set(equivalent) & active_local)

    active_target = "composio"
    failure_reason = None
    try:
        from backend.db.connection import get_connection

        conn = get_connection()
        row = conn.execute(
            "SELECT active_target, failure_reason FROM provider_fallbacks WHERE provider = ?",
            (norm,),
        ).fetchone()
        if row and row["active_target"]:
            active_target = str(row["active_target"]).lower()
            failure_reason = row["failure_reason"]
        elif is_signed_in:
            active_target = "local"
    except Exception:
        if is_signed_in:
            active_target = "local"

    is_configured = False
    try:
        from backend.mcp.config import load_servers

        servers = load_servers()
        is_configured = any(s in servers for s in equivalent)
    except Exception:
        pass

    return {
        "provider": norm,
        "active_target": active_target,
        "failure_reason": failure_reason,
        "has_local_alternative": bool(equivalent),
        "local_server_names": equivalent,
        "local_configured": is_configured,
        "local_signed_in": is_signed_in,
    }


def get_all_fallbacks() -> list[dict[str, Any]]:
    """Return fallback status for all providers that have local alternatives."""
    return [get_provider_fallback_status(p) for p in sorted(PROVIDER_MAPPING.keys())]
