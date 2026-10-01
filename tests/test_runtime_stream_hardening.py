import pytest

from backend.runtime.providers.openai_compat import OpenAICompatClient
from backend.runtime.reasoning_catalog import is_reasoning_model
from backend.runtime.types import ModelParameters


def test_unknown_model_does_not_receive_reasoning_effort():
    client = OpenAICompatClient(base_url="http://provider", api_key=None, model="mistral-small")
    payload = client._build_payload(
        [{"role": "user", "content": "hi"}], None, ModelParameters(reasoning_effort="high")
    )
    assert "reasoning_effort" not in payload
    assert not is_reasoning_model("mistral-small")


def test_known_reasoning_family_receives_effort_without_tools():
    client = OpenAICompatClient(base_url="http://provider", api_key=None, model="o3-mini")
    payload = client._build_payload(
        [{"role": "user", "content": "hi"}], None, ModelParameters(reasoning_effort="high")
    )
    assert payload["reasoning_effort"] == "high"


@pytest.mark.asyncio
async def test_malformed_stream_frame_is_not_silently_dropped(monkeypatch):
    async def fake_stream(*args, **kwargs):
        yield "{not-json"

    monkeypatch.setattr("backend.runtime.providers.openai_compat.stream_sse", fake_stream)
    client = OpenAICompatClient(
        base_url="http://provider", api_key=None, model="o3-mini", max_retries=0
    )
    with pytest.raises(Exception, match="malformed JSON|input stream"):
        [event async for event in client.stream([{"role": "user", "content": "hi"}])]


def test_stream_retry_budget_is_not_forced_above_configured_value():
    client = OpenAICompatClient(
        base_url="http://provider", api_key=None, model="o3-mini", max_retries=0
    )
    assert client.max_retries == 0
