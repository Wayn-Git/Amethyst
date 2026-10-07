from backend.agent.trace import TurnTrace
from backend.dashboard import director


async def test_feed_uses_existing_traces(monkeypatch):
    trace = TurnTrace(conversation_id="test", user_message="Test turn")
    monkeypatch.setattr(director, "get_recent_traces", lambda: [trace])
    result = await director.provide("agent.feed")
    assert result["items"][0]["title"] == "Test turn"
    monkeypatch.setattr(director, "get_recent_traces", lambda: [])
    assert await director.provide("agent.feed") == {"items": []}
