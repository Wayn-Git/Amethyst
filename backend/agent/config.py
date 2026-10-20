"""Central configuration for Amethyst agent execution and reliability.

Holds all configurable parameters for:
- Step budgets and round allowances
- Per-tool hard timeouts and overall turn wall-clock caps
- Read cache TTLs (calendar, email)
- Maximum result counts and bounded date windows
- Field projection and scratch payload thresholds
- Provider fallback chain, circuit breaker, and retry policies
- Token budgeting margins
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass
class AgentConfig:
    # --- Step Budget ---
    # Default model rounds per turn (replaces strict 7/8 step wall)
    default_step_budget: int = 12
    # Hard iteration ceiling across continuations
    max_iterations: int = 40
    # Continuation attempts on cut-off or empty assistant responses
    max_continuations: int = 3
    # Mid-stream resume attempts on transient stream dropped
    max_resumes: int = 4

    # --- Timeouts (seconds) ---
    # Hard timeout per tool execution
    tool_timeout_seconds: float = 15.0
    # Soft turn wall-clock cap (initiates wrap-up)
    wall_clock_cap: float = 45.0
    # Hard turn timeout (forces final answer)
    hard_timeout: float = 60.0

    # --- Read Cache TTLs (seconds) ---
    # Short-lived read cache for calendar lookups
    calendar_cache_ttl: float = 60.0
    # Short-lived read cache for email search/list lookups
    email_cache_ttl: float = 180.0
    # Process-lifetime / warm cache for Composio fast-lane tool definitions
    fast_lane_ttl: float = 86400.0  # 24 hours

    # --- Query & Tool Defaults ---
    # Maximum items returned by list/search queries
    default_max_results: int = 10
    # Default date window in days for "what's new / upcoming"
    default_date_window_days: int = 7
    # Threshold in characters before offloading large payloads to scratch store
    max_payload_chars: int = 4000
    # Scratch store TTL in seconds
    scratch_store_ttl: float = 300.0

    # --- History & Context Compaction ---
    # Number of recent completed turns to keep completely verbatim before compacting older tools
    history_verbatim_turns: int = 2

    # --- Provider Fallback & Circuit Breaker ---
    # Number of consecutive failures before tripping a provider circuit
    circuit_breaker_failures: int = 3
    # Cooldown duration in seconds when a provider circuit is tripped
    circuit_breaker_cooldown: float = 180.0
    # Model routing preferences: stronger models for tool rounds, fast/cheap for summaries
    tool_round_tier: str = "heavy"
    summary_round_tier: str = "fast"
    fast_summary_provider: str | None = None
    fast_summary_model: str | None = None
    # Network retry settings
    max_network_retries: int = 3
    retry_base_delay: float = 1.0
    retry_max_delay: float = 8.0

    # --- Token Budgeting ---
    # Safety margin multiplier for tokens-per-minute estimation
    tpm_safety_margin: float = 1.25
    # Threshold ratio of context window to trigger proactive compaction
    token_budget_threshold: float = 0.85

    @classmethod
    def from_env(cls) -> AgentConfig:
        """Create configuration with environment variable overrides."""
        def _get_int(key: str, default: int) -> int:
            try:
                val = os.environ.get(key)
                return int(val) if val is not None else default
            except (ValueError, TypeError):
                return default

        def _get_float(key: str, default: float) -> float:
            try:
                val = os.environ.get(key)
                return float(val) if val is not None else default
            except (ValueError, TypeError):
                return default

        return cls(
            default_step_budget=_get_int("AMETHYST_STEP_BUDGET", 12),
            tool_timeout_seconds=_get_float("AMETHYST_TOOL_TIMEOUT", 15.0),
            wall_clock_cap=_get_float("AMETHYST_WALL_CLOCK_CAP", 45.0),
            hard_timeout=_get_float("AMETHYST_HARD_TIMEOUT", 60.0),
            calendar_cache_ttl=_get_float("AMETHYST_CALENDAR_CACHE_TTL", 60.0),
            email_cache_ttl=_get_float("AMETHYST_EMAIL_CACHE_TTL", 180.0),
            default_max_results=_get_int("AMETHYST_MAX_RESULTS", 10),
            default_date_window_days=_get_int("AMETHYST_DATE_WINDOW_DAYS", 7),
            max_payload_chars=_get_int("AMETHYST_MAX_PAYLOAD_CHARS", 4000),
            history_verbatim_turns=_get_int("AMETHYST_HISTORY_VERBATIM_TURNS", 2),
            circuit_breaker_failures=_get_int("AMETHYST_CIRCUIT_BREAKER_FAILURES", 3),
            circuit_breaker_cooldown=_get_float("AMETHYST_CIRCUIT_BREAKER_COOLDOWN", 180.0),
            tool_round_tier=os.environ.get("AMETHYST_TOOL_ROUND_TIER", "heavy"),
            summary_round_tier=os.environ.get("AMETHYST_SUMMARY_ROUND_TIER", "fast"),
            fast_summary_provider=os.environ.get("AMETHYST_FAST_SUMMARY_PROVIDER"),
            fast_summary_model=os.environ.get("AMETHYST_FAST_SUMMARY_MODEL"),
        )


# Global singleton instance
agent_config = AgentConfig.from_env()
