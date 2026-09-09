import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.dashboard import rules
from backend.dashboard.items import decide
from backend.db.connection import reset_connection
from backend.security.confirmation import ConfirmationService, GuardedConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def tool(name, risk):
    return Tool(
        name=name,
        description=name,
        parameters={},
        risk=risk,
        handler=AsyncMock(return_value=ToolResult.ok("fixture")),
    )


async def test_write_tool_cannot_be_always_allowed(db, monkeypatch):
    write = tool("write_fixture", RiskLevel.HIGH)
    low_write = tool("send_fixture", RiskLevel.LOW)
    read = tool("read_fixture", RiskLevel.LOW)
    monkeypatch.setattr(
        rules, "tools", AsyncMock(return_value={t.name: t for t in (write, read, low_write)})
    )
    for name in (write.name, low_write.name):
        with pytest.raises(HTTPException, match="Write tools cannot"):
            await rules.draft("set", rules.RuleInput(tool=name, decision="allow"))
    with pytest.raises(HTTPException):
        await rules.draft("set", rules.RuleInput(tool="unknown", decision="allow"))
    assert db.execute("SELECT count(*) FROM dashboard_permission_rules").fetchone()[0] == 0
    assert all(i["decision"] == "ask" for i in (await rules.provide())["items"])
    draft = await rules.draft("set", rules.RuleInput(tool=read.name, decision="allow"))
    await decide("agent.rules", draft["draft_id"], False)
    assert db.execute("SELECT count(*) FROM dashboard_permission_rules").fetchone()[0] == 0


async def test_rules_enforced_persisted_and_audited(db, monkeypatch):
    read = tool("fixture_read", RiskLevel.LOW)
    monkeypatch.setattr(rules, "tools", AsyncMock(return_value={read.name: read}))
    draft = await rules.draft("set", rules.RuleInput(tool=read.name, decision="deny"))
    await decide("agent.rules", draft["draft_id"], True)
    log = db.execute("SELECT arguments FROM execution_logs ORDER BY id DESC LIMIT 1").fetchone()
    assert json.loads(log["arguments"])["decision"] == "deny"
    reset_connection()
    callback = AsyncMock(return_value=True)
    for gate in (
        ConfirmationService(callback=callback),
        GuardedConfirmationService("full-access", callback=callback),
    ):
        registry = ToolRegistry(confirmation=gate)
        registry.register(read)
        assert (await registry.dispatch(read.name, {}, ToolContext())).is_error
    read.handler.assert_not_called()
    callback.assert_not_called()
    draft = await rules.draft("set", rules.RuleInput(tool=read.name, decision="ask"))
    await decide("agent.rules", draft["draft_id"], True)
    assert (await ConfirmationService(callback=callback).check(read, {})).allowed
    callback.assert_awaited_once()


async def test_stale_allow_never_approves_write_and_scheduled_low_write_asks(db):
    db.execute("INSERT INTO dashboard_permission_rules VALUES('fixture','allow')")
    db.commit()
    callback = AsyncMock(return_value=False)
    write = tool("fixture", RiskLevel.HIGH)
    assert not (await ConfirmationService(callback=callback).check(write, {})).allowed
    assert not (
        await ConfirmationService(callback=callback, require_write_approval=True).check(
            tool("send_fixture", RiskLevel.LOW), {}
        )
    ).allowed
    assert callback.await_count == 2
