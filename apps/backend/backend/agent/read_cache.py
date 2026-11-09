"""Short-lived in-memory read cache for external tools and projected dashboard connector reads.

Provides TTL-based caching for read queries:
- Calendar queries: 60s TTL
- Email queries: 180s TTL

Enforces strict safety properties:
- Never caches write or mutating operations.
- Automatically invalidates domain entries when a mutating tool executes.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from backend.agent.config import agent_config


def normalize_cache_args(arguments: dict[str, Any] | None) -> str:
    """Normalize tool arguments into a deterministic JSON string."""
    if not arguments:
        return "{}"
    try:
        return json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str)
    except Exception:
        return str(sorted(arguments.items()))


WRITE_KEYWORDS = frozenset(
    {
        "create",
        "insert",
        "update",
        "delete",
        "remove",
        "patch",
        "send",
        "compose",
        "reply",
        "forward",
        "draft",
        "trash",
        "cancel",
        "edit",
        "modify",
        "add",
    }
)


def detect_tool_domain(tool_name: str) -> str | None:
    """Detect the source domain used for cache invalidation."""
    lower = tool_name.lower()
    if lower.startswith(("github_", "dashboard_github_")):
        return "github"
    if lower.startswith(("slack_", "dashboard_slack_")):
        return "slack"
    if lower.startswith("dashboard_google_maps_"):
        return "google_maps"
    if "calendar" in lower:
        return "calendar"
    if "gmail" in lower or "email" in lower or "mail" in lower:
        return "email"
    return None


def is_mutation_tool(tool_name: str) -> bool:
    """Check if tool performs a mutating write operation."""
    lower = tool_name.lower()
    return any(kw in lower for kw in WRITE_KEYWORDS)


@dataclass
class CacheEntry:
    content: str
    artifacts: list[Any]
    is_error: bool
    recoverable: bool
    timestamp: float
    ttl: float

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.timestamp) > self.ttl


class ReadCache:
    """In-memory TTL cache for read-only queries with mutation invalidation."""

    def __init__(self) -> None:
        self._cache: dict[tuple[str, str], CacheEntry] = {}
        self._domain_keys: dict[str, set[tuple[str, str]]] = {
            "calendar": set(),
            "email": set(),
        }

    def get_ttl_for_tool(self, tool_name: str) -> float | None:
        """Get TTL in seconds for a read tool, or None if not cacheable."""
        if is_mutation_tool(tool_name):
            return None
        domain = detect_tool_domain(tool_name)
        if domain in ("github", "slack", "google_maps"):
            return 60 if tool_name.lower().startswith("dashboard_") else None
        if domain == "calendar":
            return agent_config.calendar_cache_ttl
        if domain == "email":
            return agent_config.email_cache_ttl
        return None

    def get(self, tool_name: str, arguments: dict[str, Any] | None) -> CacheEntry | None:
        """Retrieve cached result if present and not expired."""
        if is_mutation_tool(tool_name):
            return None
        key = (tool_name, normalize_cache_args(arguments))
        entry = self._cache.get(key)
        if entry is None:
            return None
        if entry.is_expired:
            self._evict(key)
            return None
        return entry

    def set(
        self,
        tool_name: str,
        arguments: dict[str, Any] | None,
        content: str,
        artifacts: list[Any] | None = None,
        is_error: bool = False,
        recoverable: bool = False,
    ) -> None:
        """Store result in cache if tool is a cacheable read tool."""
        if is_error or is_mutation_tool(tool_name):
            return
        ttl = self.get_ttl_for_tool(tool_name)
        if ttl is None or ttl <= 0:
            return

        domain = detect_tool_domain(tool_name)
        key = (tool_name, normalize_cache_args(arguments))
        entry = CacheEntry(
            content=content,
            artifacts=artifacts or [],
            is_error=is_error,
            recoverable=recoverable,
            timestamp=time.time(),
            ttl=ttl,
        )
        self._cache[key] = entry
        if domain:
            self._domain_keys.setdefault(domain, set()).add(key)

    def invalidate_for_tool(self, tool_name: str) -> None:
        """Invalidate cached domain entries if this tool is a write/mutation."""
        if not is_mutation_tool(tool_name):
            return
        domain = detect_tool_domain(tool_name)
        if domain:
            self.invalidate_domain(domain)

    def invalidate_domain(self, domain: str) -> None:
        """Evict all cache entries for a given domain."""
        keys = self._domain_keys.get(domain, set())
        for key in list(keys):
            self._cache.pop(key, None)
        keys.clear()

    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()
        for s in self._domain_keys.values():
            s.clear()

    def _evict(self, key: tuple[str, str]) -> None:
        self._cache.pop(key, None)
        for s in self._domain_keys.values():
            s.discard(key)


# Global singleton instance
read_cache = ReadCache()
