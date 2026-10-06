"""Search provider circuit breaker and resilience registry.

Tracks health states (healthy, rate-limited, credits exhausted, auth failed, unavailable),
implements automatic exponential cooldowns, and enables zero-latency bypass of degraded
providers so subsequent queries never suffer connection timeouts or retry penalties.
"""

from __future__ import annotations

import enum
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


class ProviderStatus(str, enum.Enum):
    HEALTHY = "healthy"
    RATE_LIMITED = "rate_limited"
    CREDITS_EXHAUSTED = "credits_exhausted"
    AUTH_FAILED = "auth_failed"
    UNAVAILABLE = "unavailable"


@dataclass
class ProviderHealth:
    name: str
    status: ProviderStatus = ProviderStatus.HEALTHY
    consecutive_failures: int = 0
    cooldown_until: float = 0.0
    last_error: str = ""
    last_status_code: int = 0
    total_calls: int = 0
    total_failures: int = 0

    def is_available(self, now: float | None = None) -> bool:
        if self.status == ProviderStatus.HEALTHY:
            return True
        if self.status == ProviderStatus.AUTH_FAILED:
            return False
        current_time = now if now is not None else time.monotonic()
        if current_time >= self.cooldown_until:
            # Cooldown has passed; return to healthy state for a trial query
            return True
        return False


class SearchCircuitBreaker:
    """Thread-safe circuit breaker for external search providers."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._providers: dict[str, ProviderHealth] = {}
        for p in ("langsearch", "exa", "firecrawl", "tavily"):
            self._providers[p] = ProviderHealth(name=p)

    def _get_or_create(self, provider: str) -> ProviderHealth:
        p = provider.lower().strip()
        if p not in self._providers:
            self._providers[p] = ProviderHealth(name=p)
        return self._providers[p]

    def is_available(self, provider: str) -> bool:
        """Check if provider is available or should be bypassed immediately."""
        with self._lock:
            ph = self._get_or_create(provider)
            now = time.monotonic()
            if ph.is_available(now):
                if ph.status != ProviderStatus.HEALTHY and ph.status != ProviderStatus.AUTH_FAILED:
                    # In half-open state after cooldown expiration
                    logger.debug("Provider %s cooldown expired; allowing probe request", provider)
                return True
            return False

    def record_success(self, provider: str) -> None:
        """Mark provider healthy and clear failure counters."""
        with self._lock:
            ph = self._get_or_create(provider)
            ph.status = ProviderStatus.HEALTHY
            ph.consecutive_failures = 0
            ph.cooldown_until = 0.0
            ph.last_error = ""
            ph.last_status_code = 200
            ph.total_calls += 1

    def record_failure(self, provider: str, status_code: int = 500, error_msg: str = "", error: str = "") -> None:
        """Record error and set appropriate cooldown policy."""
        now = time.monotonic()
        msg = error_msg or error
        with self._lock:
            ph = self._get_or_create(provider)
            ph.consecutive_failures += 1
            ph.total_calls += 1
            ph.total_failures += 1
            ph.last_status_code = status_code
            ph.last_error = str(msg)[:300]

            if status_code in (401, 403):
                ph.status = ProviderStatus.AUTH_FAILED
                # Disabled indefinitely until key is reset / re-entered
                ph.cooldown_until = float("inf")
                logger.warning(
                    "Search provider %s auth failed (%s): %s. Bypassed until key is updated.",
                    provider, status_code, error_msg,
                )
            elif status_code == 402:
                ph.status = ProviderStatus.CREDITS_EXHAUSTED
                # 30-minute cooldown
                ph.cooldown_until = now + 1800.0
                logger.warning(
                    "Search provider %s credits exhausted (402). Cooldown for 30m.", provider,
                )
            elif status_code == 429:
                ph.status = ProviderStatus.RATE_LIMITED
                # Exponential backoff: 30s, 60s, 120s, up to 600s
                backoff = min(600.0, 30.0 * (2 ** (ph.consecutive_failures - 1)))
                ph.cooldown_until = now + backoff
                logger.warning(
                    "Search provider %s rate limited (429). Cooldown for %.1fs.", provider, backoff,
                )
            else:
                # 5xx or connection error
                if ph.consecutive_failures >= 2:
                    ph.status = ProviderStatus.UNAVAILABLE
                    ph.cooldown_until = now + 60.0
                    logger.warning(
                        "Search provider %s unavailable (%s). Cooldown for 60s.", provider, status_code,
                    )

    def reset(self, provider: str | None = None) -> None:
        """Reset health state for a provider or all providers (e.g. after updating API key)."""
        with self._lock:
            now = time.monotonic()
            if provider:
                p = provider.lower().strip()
                if p in self._providers:
                    self._providers[p] = ProviderHealth(name=p)
            else:
                for p in self._providers:
                    self._providers[p] = ProviderHealth(name=p)

    def get_status(self) -> dict[str, dict[str, Any]]:
        """Return snapshot of provider health for monitoring or settings UI."""
        now = time.monotonic()
        out: dict[str, dict[str, Any]] = {}
        with self._lock:
            for name, ph in self._providers.items():
                cooldown_remaining = max(0.0, ph.cooldown_until - now) if ph.cooldown_until != float("inf") else -1.0
                effective_status = ph.status.value
                if ph.status != ProviderStatus.HEALTHY and ph.is_available(now):
                    effective_status = "probing"
                out[name] = {
                    "status": effective_status,
                    "is_available": ph.is_available(now),
                    "consecutive_failures": ph.consecutive_failures,
                    "cooldown_seconds": round(cooldown_remaining, 1),
                    "last_error": ph.last_error,
                    "last_status_code": ph.last_status_code,
                    "total_calls": ph.total_calls,
                    "total_failures": ph.total_failures,
                }
        return out


_GLOBAL_CIRCUIT_BREAKER = SearchCircuitBreaker()


def get_circuit_breaker() -> SearchCircuitBreaker:
    return _GLOBAL_CIRCUIT_BREAKER
