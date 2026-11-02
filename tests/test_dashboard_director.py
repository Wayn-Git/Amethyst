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


async def test_errors_select_failures_and_existing_trace_errors(db, monkeypatch):
    from backend.db.repositories import ExecutionLogRepository

    repo = ExecutionLogRepository()
    repo.record(tool_name="failed", tool_source="native", error="Test failure")
    repo.record(tool_name="succeeded", tool_source="native")
    trace = TurnTrace(conversation_id="test", user_message="Test", errors=["Test retry failed"])
    monkeypatch.setattr(director, "get_recent_traces", lambda: [trace])
    rows = (await director.provide("agent.errors"))["items"]
    assert [row["title"] for row in rows] == ["failed", "Turn error"]
    assert "Test retry failed" == rows[1]["detail"]


async def test_approvals_reuses_live_gate_snapshot(db, monkeypatch):
    import sys
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    prompt = SimpleNamespace(
        id="pending-test",
        tool_name="test_write",
        risk="high",
        reason="Test gate",
        arguments={"path": "/test"},
        conversation_id="test",
    )
    snapshot = AsyncMock(return_value=[prompt])
    monkeypatch.setitem(
        sys.modules, "backend.api.main", SimpleNamespace(list_confirmations=snapshot)
    )
    rows = (await director.provide("need.approvals"))["items"]
    snapshot.assert_awaited_once_with()
    assert rows[0]["id"] == "pending-test"
    assert "/test" in rows[0]["arguments"]
    snapshot.return_value = []
    assert await director.provide("need.approvals") == {"items": [], "history": []}


async def test_decisions_use_existing_question_waiters(monkeypatch):
    from backend.agent import questions

    ask = {
        "id": "test-question",
        "conversation_id": "test",
        "questions": [{"question": "Which folder?", "options": [], "multi_select": False}],
    }
    monkeypatch.setattr(questions, "outstanding", lambda: [ask])
    rows = (await director.provide("need.decisions"))["items"]
    assert rows[0]["questions"] == ask["questions"]
    monkeypatch.setattr(questions, "outstanding", lambda: [])
    assert await director.provide("need.decisions") == {"items": []}


async def test_registered_director_widgets_cache_independently(db, monkeypatch):
    from backend.dashboard import service
    from backend.dashboard.registry import REGISTRY

    ids = (
        "agent.feed",
        "agent.running",
        "agent.audit",
        "agent.errors",
        "need.approvals",
        "need.decisions",
    )

    async def fixture_provider(widget_id):
        return {"items": [{"id": widget_id, "title": "Test fixture"}]}

    for widget_id in ids:
        assert REGISTRY[widget_id]["enabled"]
        monkeypatch.setitem(service.PROVIDERS, widget_id, fixture_provider)
        await service.refresh(widget_id)
        value = service.read_data(widget_id)
        assert value["state"] == "ok"
        assert value["payload"]["items"][0]["id"] == widget_id


async def test_dashboard_decisions_survive_restart(db, monkeypatch):
    import sys
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from backend.dashboard.items import ItemInput, decide, draft
    from backend.db.connection import reset_connection

    monkeypatch.setitem(
        sys.modules,
        "backend.api.main",
        SimpleNamespace(list_confirmations=AsyncMock(return_value=[])),
    )
    for approved in (False, True):
        saved = draft("task.today", "add", ItemInput(title="Test persistence"))
        await decide("task.today", saved["draft_id"], approved)
    reset_connection()
    audit = (await director.provide("agent.audit"))["items"]
    history = (await director.provide("need.approvals"))["history"]
    assert len(audit) == len(history) == 2
    assert "approved" in history[0]["detail"]
    assert "denied" in history[1]["detail"]


async def test_decisions_actions(monkeypatch):
    from backend.agent import questions
    from backend.dashboard.router import item_action

    calls = []
    monkeypatch.setattr(questions, "answer", lambda ask_id, ans: calls.append(("answer", ask_id, ans)) or True)
    monkeypatch.setattr(questions, "reject", lambda ask_id: calls.append(("reject", ask_id)) or True)

    res1 = await item_action("need.decisions", "answer", {"id": "ask-123", "answer": "Option A"})
    assert res1 == {"settled": True, "id": "ask-123"}
    assert calls[0] == ("answer", "ask-123", ["Option A"])

    res2 = await item_action("need.decisions", "dismiss", {"id": "ask-123"})
    assert res2 == {"settled": True, "id": "ask-123"}
    assert calls[1] == ("reject", "ask-123")


async def test_approvals_actions(monkeypatch):
    import sys
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from backend.dashboard.router import item_action

    decide_mock = AsyncMock(return_value={"status": "recorded"})
    monkeypatch.setitem(
        sys.modules,
        "backend.api.main",
        SimpleNamespace(
            ConfirmationDecision=lambda allow, remember=False: {"allow": allow, "remember": remember},
            decide_confirmation=decide_mock,
        ),
    )

    res1 = await item_action("need.approvals", "approve", {"id": "req-1"})
    assert res1["settled"] is True
    assert res1["id"] == "req-1"
    decide_mock.assert_awaited_with("req-1", {"allow": True, "remember": False})

    res2 = await item_action("need.approvals", "deny", {"id": "req-2"})
    assert res2["settled"] is True
    assert res2["id"] == "req-2"
    decide_mock.assert_awaited_with("req-2", {"allow": False, "remember": False})


