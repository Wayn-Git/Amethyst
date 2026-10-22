"""Conversation history sanitizer and provider adapter (Problem 2).

Adapts a conversation to the target provider on every switch:
- Strip or convert foreign reasoning fields (reasoning_content, thought)
- Normalize tool_call ids and tool result messages
- Remove empty assistant messages (preventing Mistral/Anthropic 400s)
- Drop unknown keys from wire messages (is_error, tool_name, etc.)
- Consolidate system messages to head (preventing trailing system prompt 400s)
- Ensure tool arguments format matches target adapter (JSON string vs dict)
- Enforce valid role alternation if provider requires it
"""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.runtime.capability_profiles import ProviderProfile, get_capability_profile

log = logging.getLogger("amethyst.history_sanitizer")

# Non-standard keys that must not reach strict OpenAI-compatible or upstream APIs
_DISALLOWED_MESSAGE_KEYS = frozenset(
    {
        "is_error",
        "tool_name",
        "reasoning_content",
        "thought",
        "reasoning",
        "partial",
        "id",
        "created_at",
        "conversation_id",
        "metadata",
    }
)


def sanitize_conversation_history(
    messages: list[dict[str, Any]],
    provider: str | None = None,
    model: str | None = None,
    profile: ProviderProfile | None = None,
    requires_alternating_roles: bool | None = None,
) -> list[dict[str, Any]]:
    """Cleanse and adapt conversation messages for the target provider and model."""
    if not messages:
        return []

    prof = profile or get_capability_profile(provider, model)
    cleaned: list[dict[str, Any]] = []

    # 1. First pass: extract and consolidate all system prompts
    system_parts: list[str] = []
    non_system_messages: list[dict[str, Any]] = []

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "user")
        if role == "system":
            content = msg.get("content")
            if content and isinstance(content, str):
                trimmed = content.strip()
                if trimmed and trimmed not in system_parts:
                    system_parts.append(trimmed)
            continue
        non_system_messages.append(msg)

    # 2. Second pass: normalize tool calls, results, and remove empty assistant messages
    # Track known tool call ids from assistant messages to prune orphaned tool results
    known_call_ids: set[str] = set()

    for msg in non_system_messages:
        role = msg.get("role", "user")
        content = msg.get("content")
        tool_calls = msg.get("tool_calls")

        # Skip empty assistant messages with no content and no tool calls
        if role == "assistant":
            has_text = content is not None and str(content).strip() != ""
            has_calls = bool(tool_calls and isinstance(tool_calls, list) and len(tool_calls) > 0)
            if not has_text and not has_calls:
                log.debug("Dropping empty assistant message with no content and no tool_calls")
                continue

        # Prune orphaned tool messages (results for tool calls never seen in history)
        if role == "tool":
            call_id = msg.get("tool_call_id")
            if call_id and call_id not in known_call_ids:
                log.debug("Dropping orphaned tool message with call_id=%s", call_id)
                continue

        # Build clean message copy stripping disallowed keys
        clean_msg: dict[str, Any] = {"role": role}

        # Content handling
        if content is not None:
            clean_msg["content"] = content
        elif role == "assistant" and tool_calls:
            # Explicit null content for assistant tool calls (OpenAI spec)
            clean_msg["content"] = None
        else:
            clean_msg["content"] = ""

        # Tool calls normalization
        if tool_calls and isinstance(tool_calls, list):
            norm_calls = []
            for tc in tool_calls:
                if not isinstance(tc, dict):
                    continue
                tc_id = tc.get("id") or f"call_{len(known_call_ids) + 1}"
                known_call_ids.add(tc_id)
                tc_type = tc.get("type") or "function"
                fn = tc.get("function") or {}

                fn_name = fn.get("name") if isinstance(fn, dict) else tc.get("name", "unknown")
                fn_args = fn.get("arguments") if isinstance(fn, dict) else tc.get("arguments", "{}")

                # Format arguments according to provider needs
                if prof.tool_arguments_as_dict:
                    if isinstance(fn_args, str):
                        try:
                            fn_args = json.loads(fn_args)
                        except Exception:
                            fn_args = {"raw": fn_args}
                else:
                    if isinstance(fn_args, (dict, list)):
                        try:
                            fn_args = json.dumps(fn_args)
                        except Exception:
                            fn_args = str(fn_args)

                norm_calls.append({
                    "id": tc_id,
                    "type": tc_type,
                    "function": {
                        "name": fn_name,
                        "arguments": fn_args,
                    },
                })
            if norm_calls:
                clean_msg["tool_calls"] = norm_calls

        # Tool result role handling
        if role == "tool":
            clean_msg["tool_call_id"] = msg.get("tool_call_id") or ""
            # Ensure content is string
            if not isinstance(clean_msg.get("content"), str):
                clean_msg["content"] = json.dumps(clean_msg["content"], default=str)

        cleaned.append(clean_msg)

    # 3. Third pass: enforce role alternation if required (e.g. Mistral)
    alternation_needed = requires_alternating_roles if requires_alternating_roles is not None else prof.requires_alternating_roles
    if alternation_needed and cleaned:
        alternated: list[dict[str, Any]] = []
        for msg in cleaned:
            if not alternated:
                alternated.append(msg)
                continue
            prev = alternated[-1]
            if prev["role"] == msg["role"] and msg["role"] in ("user", "assistant"):
                # Merge consecutive user messages or consecutive assistant text messages
                if not prev.get("tool_calls") and not msg.get("tool_calls"):
                    prev_c = str(prev.get("content") or "")
                    msg_c = str(msg.get("content") or "")
                    prev["content"] = f"{prev_c}\n\n{msg_c}".strip()
                    continue
            alternated.append(msg)
        cleaned = alternated

    # 4. Final assembly: place consolidated system prompt at head
    if system_parts and prof.allows_system_in_messages:
        consolidated_system = "\n\n".join(system_parts)
        return [{"role": "system", "content": consolidated_system}, *cleaned]

    return cleaned
