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
    """Return True if an active, signed-in local server handles this toolkit's provider."""
    normalized = toolkit_slug.strip().lower()
    equivalent_local_servers = PROVIDER_MAPPING.get(normalized, set())
    if not equivalent_local_servers:
        return False
    active_local = get_active_local_servers()
    return bool(equivalent_local_servers & active_local)
