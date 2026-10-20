"""Tests for Task 16: Retries with Exponential Backoff & Jitter.

Verifies:
1. Exponential backoff calculation with jitter bounded by config limits.
2. Handling of retry-after headers in _delay_for with jitter.
3. Transient errors (429, 5xx, network timeouts) are retried with backoff.
4. Client validation errors (400, 401, 403, 404, 422) are NEVER retried and return precise feedback immediately.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.agent.config import agent_config
from backend.agent.director import Director
from backend.db.repositories import ConversationRepository, MessageRepository
from backend.runtime import http
from backend.runtime.failures import FailureKind
from backend.runtime.http import (
    ProviderHTTPError,
    _delay_for,
    backoff,
    is_retryable,
    post_json,
)
from backend.tools.registry import ToolRegistry


def test_backoff_exponential_growth_and_jitter():
    """backoff increases exponentially with attempt and applies jitter."""
    delays_attempt_0 = [backoff(0, base=1.0, max_delay=8.0) for _ in range(20)]
    delays_attempt_1 = [backoff(1, base=1.0, max_delay=8.0) for _ in range(20)]
    delays_attempt_2 = [backoff(2, base=1.0, max_delay=8.0) for _ in range(20)]
    delays_attempt_5 = [backoff(5, base=1.0, max_delay=8.0) for _ in range(20)]

    # Attempt 0: base is 1.0 -> raw delay is 1.0 * (0.5 to 1.0) -> between 0.5 and 1.0
    for d in delays_attempt_0:
        assert 0.5 <= d <= 1.0

    # Attempt 1: base 1.0 * 2^1 = 2.0 -> raw delay is 2.0 * (0.5 to 1.0) -> between 1.0 and 2.0
    for d in delays_attempt_1:
        assert 1.0 <= d <= 2.0

    # Attempt 2: base 1.0 * 2^2 = 4.0 -> between 2.0 and 4.0
    for d in delays_attempt_2:
        assert 2.0 <= d <= 4.0

    # Attempt 5: clamped at max_delay 8.0 -> between 4.0 and 8.0
    for d in delays_attempt_5:
        assert 4.0 <= d <= 8.0

    # Jitter variance check: not all values are identical
    assert len(set(delays_attempt_1)) > 1


def test_delay_for_honors_retry_after_header():
    """_delay_for parses retry-after header and incorporates jitter."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.headers = httpx.Headers({"retry-after": "5.5"})

    delay = _delay_for(mock_response, 0)
    assert delay >= 5.5

    mock_response_str = MagicMock(spec=httpx.Response)
    mock_response_str.headers = httpx.Headers({"x-ratelimit-reset-requests": "12s"})
    delay_str = _delay_for(mock_response_str, 0)
    assert delay_str >= 12.0


def test_is_retryable_classification():
    """4xx validation errors are not retryable; 5xx, rate limits, and network errors are."""
    # Never retry client errors
    assert not is_retryable(400, "Bad Request: invalid_parameters")
    assert not is_retryable(401, "Unauthorized: invalid api key")
    assert not is_retryable(403, "Forbidden")
    assert not is_retryable(404, "Not Found: model unknown")
    assert not is_retryable(422, "Unprocessable Entity")

    # Retry server errors and retryable rate limits
    assert is_retryable(500, "Internal Server Error")
    assert is_retryable(502, "Bad Gateway")
    assert is_retryable(503, "Service Unavailable")
    assert is_retryable(504, "Gateway Timeout")
    assert is_retryable(429, "Rate limit reached: requests per minute")

    # Do not retry quota exhaustion
    assert not is_retryable(429, "insufficient_quota: please top up your account")


@pytest.mark.asyncio
async def test_post_json_never_retries_400_validation_error(monkeypatch):
    """post_json must fail immediately on 400 validation error without sleeping or retrying."""
    sleep_mock = AsyncMock()
    monkeypatch.setattr(asyncio, "sleep", sleep_mock)

    call_count = 0

    class MockClient:
        async def post(self, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            return httpx.Response(
                status_code=400,
                text='{"error": {"message": "Invalid parameter: max_tokens must be positive"}}',
                headers={"content-type": "application/json"},
                request=httpx.Request("POST", "https://api.test/v1/chat"),
            )

    monkeypatch.setattr(http, "_client", lambda timeout: MockClient())

    with pytest.raises(ProviderHTTPError) as exc_info:
        await post_json(
            "https://api.test/v1/chat",
            headers={},
            payload={},
            timeout=10.0,
            max_retries=3,
        )

    # Must be attempted exactly ONCE
    assert call_count == 1
    # Must NEVER have slept
    assert sleep_mock.call_count == 0
    # Must have preserved precise validation message
    err = exc_info.value
    assert err.status == 400
    assert err.kind == FailureKind.NON_RETRYABLE
    assert "Invalid parameter: max_tokens must be positive" in err.body


@pytest.mark.asyncio
async def test_post_json_retries_transient_500_with_backoff(monkeypatch):
    """post_json retries on 500 and succeeds when server recovers."""
    sleep_mock = AsyncMock()
    monkeypatch.setattr(asyncio, "sleep", sleep_mock)

    call_count = 0

    class MockClient:
        async def post(self, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                return httpx.Response(
                    status_code=500,
                    text="Internal server error",
                    request=httpx.Request("POST", "https://api.test/v1/chat"),
                )
            return httpx.Response(
                status_code=200,
                json={"choices": [{"message": {"content": "ok"}}]},
                request=httpx.Request("POST", "https://api.test/v1/chat"),
            )

    monkeypatch.setattr(http, "_client", lambda timeout: MockClient())

    result = await post_json(
        "https://api.test/v1/chat",
        headers={},
        payload={},
        timeout=10.0,
        max_retries=3,
    )

    assert result["choices"][0]["message"]["content"] == "ok"
    assert call_count == 3
    # Slept twice between the 3 attempts
    assert sleep_mock.call_count == 2


@pytest.mark.asyncio
async def test_post_json_retries_timeout_and_fails_after_max_retries(monkeypatch):
    """post_json retries network timeouts and raises UNREACHABLE once retries exhaust."""
    sleep_mock = AsyncMock()
    monkeypatch.setattr(asyncio, "sleep", sleep_mock)

    call_count = 0

    class MockClient:
        async def post(self, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            raise httpx.ConnectTimeout("Connection timed out")

    monkeypatch.setattr(http, "_client", lambda timeout: MockClient())

    with pytest.raises(ProviderHTTPError) as exc_info:
        await post_json(
            "https://api.test/v1/chat",
            headers={},
            payload={},
            timeout=10.0,
            max_retries=2,
        )

    # 1 initial + 2 retries = 3 calls
    assert call_count == 3
    assert sleep_mock.call_count == 2
    assert exc_info.value.kind == FailureKind.UNREACHABLE
