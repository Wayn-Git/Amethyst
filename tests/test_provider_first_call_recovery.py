"""Automated regression test suite for provider switching and first-request recovery.

Verifies:
(a) Provider A -> B -> A switch with tool-call history
(b) Mid-conversation switch carrying reasoning fields
(c) Idle stale connection recovery (fresh socket retry on attempt 0)
(d) Gateway 400 recovery via minimal payload retry
(e) History sanitizer and capability profile enforcement
(f) Provider warmup endpoint and obsolete model remapping
"""

from __future__ import annotations

import json
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

from backend.runtime.capability_profiles import (
    ProviderProfile,
    apply_capability_profile,
    build_minimal_payload,
    get_capability_profile,
)
from backend.runtime.history_sanitizer import sanitize_conversation_history
from backend.runtime.http import (
    is_sanitization_recoverable_4xx,
    post_json,
    stream_sse,
)
from backend.runtime.providers.anthropic import _to_anthropic_messages
from backend.runtime.providers.google import _to_contents
from backend.runtime.providers.openai_compat import OpenAICompatClient
from backend.runtime.types import ModelParameters


def test_history_sanitizer_empty_assistant_removal():
    """Mistral HTTP 400 (code 3240) occurs if an assistant message has no content and no tool_calls."""
    messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "", "tool_calls": []},
        {"role": "assistant", "content": None},
        {"role": "user", "content": "Are you there?"},
    ]
    sanitized = sanitize_conversation_history(messages)
    assert len(sanitized) == 2
    assert sanitized[0] == {"role": "user", "content": "Hello"}
    assert sanitized[1] == {"role": "user", "content": "Are you there?"}


def test_history_sanitizer_system_prompt_consolidation():
    """Anthropic and Mistral reject trailing or multiple system prompts."""
    messages = [
        {"role": "system", "content": "System prompt 1"},
        {"role": "user", "content": "Task step 1"},
        {"role": "system", "content": "Nudge or reminder"},
        {"role": "assistant", "content": "Understood."},
    ]
    sanitized = sanitize_conversation_history(messages)
    assert sanitized[0]["role"] == "system"
    assert "System prompt 1" in sanitized[0]["content"]
    assert "Nudge or reminder" in sanitized[0]["content"]
    # No other system message remains
    assert all(m["role"] != "system" for m in sanitized[1:])


def test_history_sanitizer_removes_foreign_fields():
    """Reasoning fields (reasoning_content, thought) and internal metadata must be stripped."""
    messages = [
        {
            "role": "assistant",
            "content": "Let me think...",
            "reasoning_content": "Deep reasoning tokens...",
            "thought": "Internal monologue",
            "is_error": False,
            "tool_name": "custom_tool",
        }
    ]
    sanitized = sanitize_conversation_history(messages)
    assert len(sanitized) == 1
    assert "reasoning_content" not in sanitized[0]
    assert "thought" not in sanitized[0]
    assert "is_error" not in sanitized[0]
    assert "tool_name" not in sanitized[0]
    assert sanitized[0]["content"] == "Let me think..."


def test_history_sanitizer_strict_role_alternation():
    """When requires_alternating_roles is True, consecutive user/assistant messages are merged."""
    messages = [
        {"role": "user", "content": "First instruction."},
        {"role": "user", "content": "Second instruction."},
        {"role": "assistant", "content": "Draft response."},
        {"role": "assistant", "content": "Final response."},
    ]
    sanitized = sanitize_conversation_history(messages, requires_alternating_roles=True)
    assert len(sanitized) == 2
    assert sanitized[0]["role"] == "user"
    assert "First instruction.\n\nSecond instruction." in sanitized[0]["content"]
    assert sanitized[1]["role"] == "assistant"
    assert "Draft response.\n\nFinal response." in sanitized[1]["content"]


def test_provider_switch_tool_arguments_anthropic_and_google():
    """Anthropic and Google reject string tool arguments; must be deserialized to dicts."""
    messages = [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "arguments": json.dumps({"path": "/path/to/file.py"}),
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_123",
            "name": "read_file",
            "content": "file contents",
        },
    ]

    # Test Anthropic conversion
    system, anthropic_msgs = _to_anthropic_messages(messages)
    tool_use_block = anthropic_msgs[0]["content"][0]
    assert tool_use_block["type"] == "tool_use"
    assert isinstance(tool_use_block["input"], dict)
    assert tool_use_block["input"] == {"path": "/path/to/file.py"}

    # Test Google conversion
    system_g, google_contents = _to_contents(messages)
    call_part = google_contents[0]["parts"][0]
    assert "functionCall" in call_part
    assert isinstance(call_part["functionCall"]["args"], dict)
    assert call_part["functionCall"]["args"] == {"path": "/path/to/file.py"}


def test_capability_profile_enforcement():
    """Verify profile constraints for Groq and Mistral."""
    groq_profile = get_capability_profile("groq", "llama-3.1-8b-instant")
    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 16000,
        "tools": [{"type": "function", "function": {"name": f"tool_{i}"}} for i in range(150)],
        "parallel_tool_calls": True,
        "stream_options": {"include_usage": True},
    }
    constrained = apply_capability_profile(payload, groq_profile)

    # Groq max_tokens clamped to 8192
    assert constrained["max_tokens"] <= 8192
    # Groq tools capped to 128
    assert len(constrained["tools"]) == 128
    # Unsupported stream_options stripped
    assert "stream_options" not in constrained
    # parallel_tool_calls is supported
    assert constrained["parallel_tool_calls"] is True


def test_minimal_payload_reconstruction():
    """build_minimal_payload strips optional parameters while keeping messages and model."""
    heavy_payload = {
        "model": "mistral-large-latest",
        "messages": [{"role": "user", "content": "Solve this"}],
        "temperature": 0.7,
        "top_p": 0.9,
        "tool_choice": "auto",
        "parallel_tool_calls": True,
        "stream_options": {"include_usage": True},
        "reasoning_effort": "high",
        "tools": [{"type": "function", "function": {"name": "test"}}],
    }
    minimal = build_minimal_payload(heavy_payload)
    assert minimal["model"] == "mistral-large-latest"
    assert minimal["messages"] == [{"role": "user", "content": "Solve this"}]
    assert "temperature" not in minimal
    assert "top_p" not in minimal
    assert "tool_choice" not in minimal
    assert "parallel_tool_calls" not in minimal
    assert "stream_options" not in minimal
    assert "reasoning_effort" not in minimal


def test_recoverable_4xx_detection():
    """Verify is_sanitization_recoverable_4xx identifies gateway schema errors vs auth/quota errors."""
    # 400 with schema error -> recoverable
    assert is_sanitization_recoverable_4xx(400, "Extra inputs are not permitted") is True
    assert is_sanitization_recoverable_4xx(400, "Assistant message must have either content or tool_calls") is True
    assert is_sanitization_recoverable_4xx(422, "Unprocessable Entity: invalid parameter stream_options") is True

    # 401/403 or auth/quota -> NOT recoverable
    assert is_sanitization_recoverable_4xx(401, "Unauthorized: invalid api key") is False
    assert is_sanitization_recoverable_4xx(403, "Forbidden") is False
    assert is_sanitization_recoverable_4xx(400, "Out of quota: rate limit exceeded") is False
    assert is_sanitization_recoverable_4xx(400, "Maximum context length exceeded: 35000 > 32000") is False


@pytest.mark.asyncio
async def test_idle_connection_reset_retry(monkeypatch):
    """When an idle connection drops on attempt 0, http client immediately retries on a fresh socket."""
    attempts = 0

    async def mock_post(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            # Simulate socket closed / reset by server on stale keepalive
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        req = httpx.Request("POST", "https://api.example.com/v1/chat/completions")
        return httpx.Response(200, request=req, json={"choices": [{"message": {"content": "Fresh response"}}]})

    mock_client = MagicMock()
    mock_client.post = mock_post

    monkeypatch.setattr("backend.runtime.http._client", lambda base_url: mock_client)

    result = await post_json(
        "https://api.example.com/v1/chat/completions",
        payload={"model": "test", "messages": []},
        headers={},
        timeout=10.0,
        max_retries=2,
    )
    assert attempts == 2
    assert result["choices"][0]["message"]["content"] == "Fresh response"


@pytest.mark.asyncio
async def test_gateway_400_minimal_payload_recovery(monkeypatch):
    """Gateway 400 on attempt 0 automatically triggers minimal payload retry and succeeds."""
    attempts = 0
    received_payloads = []

    async def mock_post(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        payload = kwargs.get("json", {})
        received_payloads.append(payload)
        req = httpx.Request("POST", "https://api.example.com/v1/chat/completions")
        if attempts == 1:
            # First attempt fails with 400 Bad Request due to unsupported field
            return httpx.Response(
                400,
                request=req,
                json={"error": {"message": "Invalid parameter: stream_options not supported"}},
            )
        return httpx.Response(
            200,
            request=req,
            json={"choices": [{"message": {"content": "Success after minimal payload"}}]},
        )

    mock_client = MagicMock()
    mock_client.post = mock_post
    monkeypatch.setattr("backend.runtime.http._client", lambda base_url: mock_client)

    initial_payload = {
        "model": "test-model",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream_options": {"include_usage": True},
        "parallel_tool_calls": True,
    }
    result = await post_json(
        "https://api.example.com/v1/chat/completions",
        payload=initial_payload,
        headers={},
        timeout=10.0,
        max_retries=1,
    )

    assert attempts == 2
    assert "stream_options" in received_payloads[0]
    assert "stream_options" not in received_payloads[1]
    assert result["choices"][0]["message"]["content"] == "Success after minimal payload"


def test_obsolete_model_remapping(monkeypatch):
    """_validate_model remaps retired gateway models to active models."""
    from backend.api.main import _validate_model

    monkeypatch.setattr("backend.api.main.is_known_provider", lambda p: True)

    # opencode-zen retired space-bunny-free -> mimo-v2.6-flash-free
    remapped_zen = _validate_model("opencode-zen", "space-bunny-free")
    assert remapped_zen == "mimo-v2.6-flash-free"

    # nvidia retired nemotron-3-super-120b-a12b -> deepseek-ai/deepseek-v4.1-flash
    remapped_nv = _validate_model("nvidia", "nvidia/nemotron-3-super-120b-a12b")
    assert remapped_nv == "deepseek-ai/deepseek-v4.1-flash"


@pytest.mark.asyncio
async def test_warmup_provider_endpoint(monkeypatch):
    """POST /api/providers/warmup validates model and warms connectors."""
    from backend.api.main import WarmupRequest, warmup_provider

    monkeypatch.setattr("backend.api.main.is_known_provider", lambda p: True)
    monkeypatch.setattr("backend.runtime.registry.resolve", lambda *a, **k: MagicMock())

    req = WarmupRequest(provider="opencode-zen", model="space-bunny-free")
    resp = await warmup_provider(req)
    assert resp["warmed"] is True
    assert resp["provider"] == "opencode-zen"
    assert resp["model"] == "mimo-v2.6-flash-free"
