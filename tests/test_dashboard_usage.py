from backend.agent.trace import LLMCallRecord, TurnTrace
from backend.config import ProviderConfig
from backend.dashboard import usage
from backend.runtime import models_dev_catalog as catalog


async def test_usage_real_tokens_latency_and_cloud_only_prices(monkeypatch):
    parsed = catalog._parse_catalog(
        {
            "cloud": {"models": {"fixture": {"cost": {"input": 2, "output": 8}}}},
            "local": {"models": {"fixture": {"cost": {"input": 9, "output": 9}}}},
        }
    )
    monkeypatch.setattr(catalog, "_catalog", parsed)
    monkeypatch.setattr(
        usage,
        "configured_providers",
        lambda: {
            "cloud": ProviderConfig(name="cloud", api_key_env="FIXTURE_TOKEN"),
            "local": ProviderConfig(name="local"),
        },
    )
    trace = TurnTrace(
        conversation_id="fixture",
        user_message="Fixture",
        llm_calls=[
            LLMCallRecord(0, "cloud", "fixture", 10, 120, 100, 50),
            LLMCallRecord(1, "cloud", "fixture", 12, 180, 100, 50),
            LLMCallRecord(2, "local", "fixture", 5, 50, 10, 2),
        ],
    )
    monkeypatch.setattr(usage, "get_recent_traces", lambda: [trace])
    items = (await usage.provide())["items"]
    assert items[0]["input_tokens"] == 200
    assert items[0]["output_tokens"] == 100
    assert items[0]["latency_ms"] == 300
    assert items[0]["estimated_cost_usd"] == 0.0012
    assert "estimated_cost_usd" not in items[1]


async def test_usage_unknown_tokens_prices_and_empty(monkeypatch):
    monkeypatch.setattr(usage, "get_recent_traces", lambda: [])
    assert (await usage.provide())["items"] == []
    monkeypatch.setattr(
        usage,
        "configured_providers",
        lambda: {"cloud": ProviderConfig(name="cloud", api_key_env="FIXTURE")},
    )
    monkeypatch.setattr(catalog, "_catalog", {"other/fixture": {"cost": {"input": 2, "output": 8}}})
    assert catalog.lookup_pricing("cloud", "fixture") is None
    trace = TurnTrace(
        conversation_id="fixture",
        user_message="Fixture",
        llm_calls=[LLMCallRecord(0, "cloud", "fixture", 10, 20, None, None)],
    )
    monkeypatch.setattr(usage, "get_recent_traces", lambda: [trace])
    item = (await usage.provide())["items"][0]
    assert item["input_tokens"] is None
    assert item["estimated_cost_usd"] is None


def test_pricing_rejects_invalid_rates(monkeypatch):
    for invalid in (-1, float("nan"), float("inf"), True, "1"):
        monkeypatch.setattr(
            catalog, "_catalog", {"cloud/fixture": {"cost": {"input": invalid, "output": 1}}}
        )
        assert catalog.lookup_pricing("cloud", "fixture") is None
