"""Per-provider capability profiles and pre-request normalization (Problem 2).

Applies per-provider capability profiles to every request before sending:
- supports tool_choice (auto, none, required)
- supports parallel_tool_calls
- supports stream_options
- supports reasoning_effort
- max_tokens output limit
- max_tools limit
- message format quirks (system placement, empty assistant handling)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("amethyst.capability_profiles")


@dataclass(frozen=True)
class ProviderProfile:
    """Explicit capabilities and constraints for a model provider or gateway."""

    name: str
    supports_tool_choice: bool = True
    supports_tool_choice_none: bool = True
    supports_parallel_tool_calls: bool = False
    supports_stream_options: bool = False
    supports_reasoning_effort: bool = False
    max_tokens_ceiling: int = 4096
    max_tools: int | None = None
    requires_alternating_roles: bool = False
    allows_system_in_messages: bool = True
    tool_arguments_as_dict: bool = False
    default_live_model: str | None = None


# Tuned profiles for known providers and gateways
_PROFILES: dict[str, ProviderProfile] = {
    "opencode-zen": ProviderProfile(
        name="opencode-zen",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=8192,
        max_tools=64,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="mimo-v2.6-flash-free",
    ),
    "nvidia": ProviderProfile(
        name="nvidia",
        supports_tool_choice=True,
        supports_tool_choice_none=False,  # NIM rejects tool_choice="none"
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=4096,
        max_tools=64,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="deepseek-ai/deepseek-v4.1-flash",
    ),
    "mistral": ProviderProfile(
        name="mistral",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=8192,
        max_tools=128,
        requires_alternating_roles=True,  # Mistral strictly enforces user/assistant alternation
        allows_system_in_messages=True,
        default_live_model="ministral-8b-2512",
    ),
    "groq": ProviderProfile(
        name="groq",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=True,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=8192,
        max_tools=128,  # Groq hard limit is 128 items
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="llama-3.1-8b-instant",
    ),
    "kilocode": ProviderProfile(
        name="kilocode",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=4096,
        max_tools=64,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="kilo-auto/free",
    ),
    "cerebras": ProviderProfile(
        name="cerebras",
        supports_tool_choice=True,
        supports_tool_choice_none=False,
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=8192,
        max_tools=64,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="llama-3.3-70b",
    ),
    "anthropic": ProviderProfile(
        name="anthropic",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=True,
        supports_stream_options=False,
        supports_reasoning_effort=True,
        max_tokens_ceiling=8192,
        max_tools=128,
        requires_alternating_roles=True,
        allows_system_in_messages=False,  # System prompt must be passed in top-level 'system' field
        tool_arguments_as_dict=True,  # Anthropic requires dict input, not string
        default_live_model="claude-3-5-sonnet-latest",
    ),
    "google": ProviderProfile(
        name="google",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=True,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=8192,
        max_tools=128,
        requires_alternating_roles=True,
        allows_system_in_messages=False,
        tool_arguments_as_dict=True,  # Gemini requires dict args, not string
        default_live_model="gemini-2.0-flash",
    ),
    "openai": ProviderProfile(
        name="openai",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=True,
        supports_stream_options=True,
        supports_reasoning_effort=True,
        max_tokens_ceiling=16384,
        max_tools=128,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="gpt-4o",
    ),
    "openrouter": ProviderProfile(
        name="openrouter",
        supports_tool_choice=True,
        supports_tool_choice_none=True,
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=8192,
        max_tools=64,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
    ),
    "cloudflare": ProviderProfile(
        name="cloudflare",
        supports_tool_choice=False,  # Cloudflare Workers AI rejects tool_choice objects
        supports_tool_choice_none=False,
        supports_parallel_tool_calls=False,
        supports_stream_options=False,
        supports_reasoning_effort=False,
        max_tokens_ceiling=4096,
        max_tools=32,
        requires_alternating_roles=False,
        allows_system_in_messages=True,
        default_live_model="@cf/meta/llama-3.1-8b-instruct-fast",
    ),
}

# Generic fallback profile for arbitrary OpenAI-compatible endpoints
_DEFAULT_PROFILE = ProviderProfile(
    name="default",
    supports_tool_choice=True,
    supports_tool_choice_none=True,
    supports_parallel_tool_calls=False,
    supports_stream_options=False,
    supports_reasoning_effort=False,
    max_tokens_ceiling=4096,
    max_tools=64,
    requires_alternating_roles=False,
    allows_system_in_messages=True,
)


# Maps known API hostnames/path prefixes to the profile key in _PROFILES.
# Used as a fallback when the provider name alone does not resolve to a known profile.
_URL_PROFILE_MAP: dict[str, str] = {
    "api.openai.com": "openai",
    "api.anthropic.com": "anthropic",
    "generativelanguage.googleapis.com": "google",
    "api.together.xyz": "together",
    "api.groq.com": "groq",
    "openrouter.ai": "openrouter",
    "cloudflare.com": "cloudflare",
}


def get_capability_profile(
    provider: str | None,
    model: str | None = None,
    *,
    base_url: str | None = None,
) -> ProviderProfile:
    """Retrieve capability profile for a provider or gateway.

    Resolution order:
    1. Exact key match on lowercased provider name.
    2. Substring match (profile key contained in provider slug).
    3. URL-based match using *base_url* against ``_URL_PROFILE_MAP``.
    4. Default profile.
    """
    slug = (provider or "").strip().lower()
    if slug in _PROFILES:
        profile = _PROFILES[slug]
    else:
        # Check base provider prefix or gateway detection
        for k, p in _PROFILES.items():
            if k in slug:
                profile = p
                break
        else:
            # Fall back to URL-based detection when a custom provider name is used
            # (e.g. name="test_provider", base_url="https://api.openai.com/v1").
            url_lower = (base_url or "").lower()
            model_lower = (model or "").lower()
            profile = _DEFAULT_PROFILE
            for host_fragment, profile_key in _URL_PROFILE_MAP.items():
                if host_fragment in url_lower:
                    profile = _PROFILES.get(profile_key, _DEFAULT_PROFILE)
                    break
            else:
                # Model-name based fallback: gpt-* and o-series models imply OpenAI capabilities
                # even when served from a proxy or custom provider name.
                if model_lower.startswith(("gpt-", "o1", "o3", "o4", "o1-", "o3-", "o4-")):
                    profile = _PROFILES.get("openai", _DEFAULT_PROFILE)

    # Specific model overrides
    model_str = (model or "").lower()
    if profile.supports_reasoning_effort:
        # Only models that actually support reasoning effort keep it
        from backend.runtime.reasoning_catalog import is_reasoning_model
        is_reasoning = is_reasoning_model(model_str)
        if not is_reasoning:
            profile = ProviderProfile(
                name=profile.name,
                supports_tool_choice=profile.supports_tool_choice,
                supports_tool_choice_none=profile.supports_tool_choice_none,
                supports_parallel_tool_calls=profile.supports_parallel_tool_calls,
                supports_stream_options=profile.supports_stream_options,
                supports_reasoning_effort=False,
                max_tokens_ceiling=profile.max_tokens_ceiling,
                max_tools=profile.max_tools,
                requires_alternating_roles=profile.requires_alternating_roles,
                allows_system_in_messages=profile.allows_system_in_messages,
                tool_arguments_as_dict=profile.tool_arguments_as_dict,
                default_live_model=profile.default_live_model,
            )
    return profile


def apply_capability_profile(
    payload: dict[str, Any],
    profile: ProviderProfile,
    model: str | None = None,
) -> dict[str, Any]:
    """Cleanse and constrain request payload according to provider capabilities."""
    adapted = dict(payload)

    # 1. Parallel tool calls
    if not profile.supports_parallel_tool_calls and "parallel_tool_calls" in adapted:
        adapted.pop("parallel_tool_calls", None)

    # 2. Stream options
    if not profile.supports_stream_options and "stream_options" in adapted:
        adapted.pop("stream_options", None)

    # 3. Reasoning effort
    if not profile.supports_reasoning_effort and "reasoning_effort" in adapted:
        adapted.pop("reasoning_effort", None)

    # 4. Tool choice
    tc = adapted.get("tool_choice")
    if tc is not None:
        if not profile.supports_tool_choice:
            adapted.pop("tool_choice", None)
        elif tc == "none" and not profile.supports_tool_choice_none:
            adapted.pop("tool_choice", None)

    # 5. Cap max_tokens to provider ceiling if specified and exceeding
    if "max_tokens" in adapted and isinstance(adapted["max_tokens"], int):
        if adapted["max_tokens"] > profile.max_tokens_ceiling:
            adapted["max_tokens"] = profile.max_tokens_ceiling

    # 6. Cap tools list if exceeding provider max_tools
    tools = adapted.get("tools")
    if isinstance(tools, list) and profile.max_tools and len(tools) > profile.max_tools:
        log.debug(
            "Capping tools for %s from %d to %d",
            profile.name,
            len(tools),
            profile.max_tools,
        )
        adapted["tools"] = tools[: profile.max_tools]

    return adapted


def build_minimal_payload(payload: dict[str, Any], provider: str | None = None) -> dict[str, Any]:
    """Create a minimal, resilient version of a payload for gateway 4xx recovery.

    Strips non-essential parameters (tool_choice, parallel_tool_calls, stream_options,
    reasoning_effort), bounds max_tokens to safe 2048 limit, and prunes tools to core essentials.
    """
    minimized = dict(payload)

    # Strip optional parameters
    minimized.pop("tool_choice", None)
    minimized.pop("parallel_tool_calls", None)
    minimized.pop("stream_options", None)
    minimized.pop("reasoning_effort", None)
    minimized.pop("temperature", None)
    minimized.pop("top_p", None)

    # Clamp max_tokens to safe bound
    if "max_tokens" in minimized and isinstance(minimized["max_tokens"], int):
        minimized["max_tokens"] = min(minimized["max_tokens"], 2048)
    else:
        minimized["max_tokens"] = 2048

    # Prune tools to core tools only (max 8)
    tools = minimized.get("tools")
    if isinstance(tools, list) and len(tools) > 8:
        core_names = {"read", "edit", "bash", "view_file", "edit_file", "run_command", "read_data"}
        core_tools = [
            t for t in tools
            if isinstance(t, dict) and t.get("function", {}).get("name") in core_names
        ]
        if core_tools:
            minimized["tools"] = core_tools
        else:
            minimized["tools"] = tools[:8]

    # Sanitize messages
    msgs = minimized.get("messages")
    if isinstance(msgs, list):
        sys_msgs = [m for m in msgs if isinstance(m, dict) and m.get("role") == "system"]
        non_sys = [m for m in msgs if isinstance(m, dict) and m.get("role") != "system"]
        trimmed_non_sys = non_sys[-6:] if len(non_sys) > 6 else non_sys
        minimized["messages"] = [*sys_msgs[:1], *trimmed_non_sys]

    return minimized

