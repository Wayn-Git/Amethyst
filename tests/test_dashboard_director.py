from backend.agent.trace import TurnTrace
from backend.dashboard import director


async def test_feed_uses_existing_traces(monkeypatch):
    trace = TurnTrace(conversation_id="test", user_message="Test turn")
    monkeypatch.setattr(director, "get_recent_traces", lambda: [trace])
    result = await director.provide("agent.feed")
    assert result["items"][0]["title"] == "Test turn"
    monkeypatch.setattr(director, "get_recent_traces", lambda: [])
    assert await director.provide("agent.feed") == {"items": []}


async def test_running_uses_durable_director_state(db):
    from backend.agent.state import AgentState
    from backend.db.repositories import AgentRunRepository, ConversationRepository

    conversation = ConversationRepository().create("test", "test")
    run = AgentState(conversation_id=conversation)
    repo = AgentRunRepository()
    repo.open(run)
    result = await director.provide("agent.running")
    assert result["items"][0]["id"] == run.id
    assert "0 tool calls" in result["items"][0]["detail"]
    run.enter("interrupted")
    repo.save(run)
    assert await director.provide("agent.running") == {"items": []}


async def test_audit_reads_persisted_gate_decisions(db):
    from backend.db.repositories import ExecutionLogRepository

    repo = ExecutionLogRepository()
    assert await director.provide("agent.audit") == {"items": []}
    repo.record(tool_name="test_write", tool_source="native", confirmation_decision="denied")
    repo.record(tool_name="test_read", tool_source="native", confirmation_decision="auto")
    rows = (await director.provide("agent.audit"))["items"]
    assert [row["title"] for row in rows] == ["test_read", "test_write"]
    assert "denied" in rows[1]["detail"]
