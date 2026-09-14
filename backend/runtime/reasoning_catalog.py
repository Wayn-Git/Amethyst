"""Dynamic reasoning effort detection for any model.

Priority:
1. models.dev catalog (fetched at boot, cached locally) — exact per-model data
2. Provider-returned metadata (OpenRouter, etc.) — source of truth at runtime
3. Permissive pattern matching — assume reasoning unless we know otherwise

Zero latency: all lookups are dict/pattern-match against in-memory data.
"""

from __future__ import annotations

from backend.runtime import models_dev_catalog

#: Common effort levels for models not in the catalog.
_DEFAULT_EFFORTS = ("none", "low", "medium", "high")

#: Model-specific defaults for models not yet in models.dev.
#: Matches OpenCode's hardcoded defaults.
_MODEL_DEFAULTS: dict[str, str] = {
    "gpt-5": "medium",
    "gpt-5-pro": "high",
    "claude-opus-4": "high",
    "claude-sonnet-4": "high",
    "deepseek-r1": "high",
}


def is_reasoning_model(model_id: str, provider_caps: dict | None = None) -> bool:
    """Determine if a model supports reasoning effort.

    Priority:
    1. models.dev catalog
    2. Provider-returned capabilities
    3. Pattern-based fallback
    """
    # 1. models.dev catalog
    entry = models_dev_catalog.lookup_model(model_id)
    if entry is not None:
        return entry.get("reasoning", False)

    # 2. Provider explicitly says no reasoning
    if provider_caps is not None and provider_caps.get("supports_effort") is False:
        return False

    # 3. Provider explicitly says yes
    if provider_caps is not None and provider_caps.get("supports_effort") is True:
        return True

    # 4. Pattern-based fallback — exclude known non-reasoning models
    lower = model_id.lower()
    _NO_EFFORT = (
        "text-embedding", "embed", "embedding",
        "dall-e", "stable-diffusion", "midjourney",
        "tts-", "whisper", "audio-",
        "gpt-3", "gpt-3.5",
        "gpt-4",
        "gemini-1.",
        "claude-2",
        "llama-", "mistral-", "codestral-", "mixtral-",
        "qwen2-", "qwen3-",
        "yi-", "internlm-", "baichuan-", "glm-",
    )
    for prefix in _NO_EFFORT:
        if lower.startswith(prefix):
            return False

    return True


def effort_levels(
    model_id: str,
    provider_caps: dict | None = None,
) -> tuple[str, ...]:
    """Supported effort levels for a model.

    Priority:
    1. models.dev catalog (exact levels)
    2. Provider-returned effort_levels
    3. Default 4-level set for reasoning models
    """
    # 1. models.dev catalog
    entry = models_dev_catalog.lookup_model(model_id)
    if entry is not None:
        levels = entry.get("effort_levels", [])
        if levels:
            return tuple(levels)
        # Model is in catalog but has no effort levels — check if it has toggle
        if entry.get("has_toggle") and entry.get("reasoning"):
            return ("none", "high")
        if entry.get("reasoning"):
            return _DEFAULT_EFFORTS
        return ()

    # 2. Provider metadata
    if provider_caps and provider_caps.get("effort_levels"):
        return tuple(provider_caps["effort_levels"])

    # 3. Default for reasoning models
    if is_reasoning_model(model_id, provider_caps):
        return _DEFAULT_EFFORTS

    return ()


def default_effort(
    model_id: str,
    provider_caps: dict | None = None,
) -> str:
    """The recommended default effort for a model."""
    # 1. Provider metadata
    if provider_caps and provider_caps.get("default_effort"):
        return provider_caps["default_effort"]

    # 2. Model-specific defaults (for models not yet in models.dev)
    model_lower = model_id.lower()
    for pattern, effort in _MODEL_DEFAULTS.items():
        if pattern in model_lower:
            return effort

    # 3. models.dev catalog — pick middle of available levels
    entry = models_dev_catalog.lookup_model(model_id)
    if entry is not None:
        levels = entry.get("effort_levels", [])
        if levels:
            # Pick the middle value, or "medium" if available
            if "medium" in levels:
                return "medium"
            mid = len(levels) // 2
            return levels[mid]
        if entry.get("reasoning"):
            return "high"
        return "none"

    # 3. Heuristic for unknown models
    lower = model_id.lower()
    if any(x in lower for x in ("mini", "flash", "haiku", "nano", "lite", "small")):
        return "medium"

    return "high"


def capabilities_for(
    model_id: str,
    provider_caps: dict | None = None,
) -> dict:
    """Build the capabilities dict the frontend expects."""
    # If provider already has full capabilities, use them directly
    if provider_caps and provider_caps.get("effort_levels"):
        return {
            "supports_effort": provider_caps.get("supports_effort", True),
            "effort_levels": provider_caps["effort_levels"],
            "default_effort": provider_caps.get("default_effort", "high"),
        }

    efforts = effort_levels(model_id, provider_caps)
    return {
        "supports_effort": len(efforts) > 0,
        "effort_levels": list(efforts),
        "default_effort": default_effort(model_id, provider_caps),
    }
