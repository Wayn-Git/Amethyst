"""Per-model reasoning effort persistence and resolution.

Stores user effort preferences per model in ~/.amethyst/config/model_variants.json.
Stores per-conversation session effort in ~/.amethyst/config/session_efforts.json.

Resolution priority: explicit override > saved preference > session memory > catalog default.
All lookups are dict accesses — zero latency.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from backend.config import paths
from backend.runtime.reasoning_catalog import (
    default_effort,
    effort_levels,
)

log = logging.getLogger(__name__)

_VARIANTS_FILE = "model_variants.json"
_SESSION_FILE = "session_efforts.json"

#: In-memory caches, loaded once per process.
_cache: dict[str, str] | None = None
_session_cache: dict[str, str] | None = None


def _file() -> Path:
    return paths().config_dir / _VARIANTS_FILE


def _load() -> dict[str, str]:
    global _cache
    if _cache is not None:
        return _cache
    f = _file()
    if f.exists():
        try:
            _cache = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            log.warning("corrupt %s, resetting", f)
            _cache = {}
    else:
        _cache = {}
    return _cache


def _save(data: dict[str, str]) -> None:
    global _cache
    _cache = data
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2))


def get_saved(model_id: str) -> str | None:
    """Return the saved effort for a model, or None if never set."""
    return _load().get(model_id)


def set_saved(model_id: str, effort: str) -> None:
    """Persist the effort level for a model."""
    data = _load()
    data[model_id] = effort
    _save(data)


# ── Per-conversation session memory ──────────────────────────────────

def _session_file() -> Path:
    return paths().config_dir / _SESSION_FILE


def _load_session() -> dict[str, str]:
    global _session_cache
    if _session_cache is not None:
        return _session_cache
    f = _session_file()
    if f.exists():
        try:
            _session_cache = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            _session_cache = {}
    else:
        _session_cache = {}
    return _session_cache


def _save_session(data: dict[str, str]) -> None:
    global _session_cache
    _session_cache = data
    f = _session_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2))


def get_session_effort(conversation_id: str) -> str | None:
    """Return the last effort used in a conversation, or None."""
    return _load_session().get(conversation_id)


def set_session_effort(conversation_id: str, effort: str) -> None:
    """Remember the effort used in a conversation."""
    data = _load_session()
    data[conversation_id] = effort
    _save_session(data)


def fit_variant(saved: str | None, model_id: str, provider_caps: dict | None = None) -> str | None:
    """Clamp a saved effort to what the model actually supports.

    If the saved value is not in the model's effort list, return None
    (so the resolver falls through to the next priority).
    """
    if saved is None:
        return None
    supported = effort_levels(model_id, provider_caps)
    if not supported:
        return None
    return saved if saved in supported else None


def resolve(
    model_id: str,
    *,
    override: str | None = None,
    conversation_id: str | None = None,
    provider_caps: dict | None = None,
) -> str:
    """Resolve the effort level for a model.

    Priority (matching OpenCode):
    1. override — explicit value from CLI or caller
    2. saved preference — per-model, persisted across sessions
    3. session memory — last effort used in this conversation
    4. catalog default — the recommended default for this model

    Always returns a valid effort level (falls back to catalog default).
    """
    supported = effort_levels(model_id, provider_caps)

    # No reasoning support → "none"
    if not supported:
        return "none"

    # 1. Explicit override
    if override is not None:
        if override in supported:
            return override

    # 2. Saved preference (per-model)
    saved = get_saved(model_id)
    fitted = fit_variant(saved, model_id, provider_caps)
    if fitted is not None:
        return fitted

    # 3. Session memory (per-conversation)
    if conversation_id:
        session_effort = get_session_effort(conversation_id)
        fitted = fit_variant(session_effort, model_id, provider_caps)
        if fitted is not None:
            return fitted

    # 4. Catalog default
    return default_effort(model_id, provider_caps)
