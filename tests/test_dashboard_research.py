from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.dashboard import jobs, research
from backend.dashboard.items import decide
from backend.db.connection import reset_connection


async def test_research_unavailable_and_queued(db, monkeypatch):
    monkeypatch.setattr(research, "available", lambda: False)
    assert (await research.provide())["message"] == "not available"
    with pytest.raises(HTTPException):
        research.draft("add", jobs.JobInput(title="Fixture", prompt="Question"))
    monkeypatch.setattr(research, "available", lambda: True)
    draft = research.draft("add", jobs.JobInput(title="Fixture", prompt="Question"))
    await decide("agent.research", draft["draft_id"], True)
    reset_connection()
    assert (await research.provide())["items"][0]["status"] == "queued"
    from backend.dashboard.delegated import provide

    assert await provide() == {"items": []}


async def test_research_note_needs_sources_and_approval(db, monkeypatch):
    from backend.library.service import LibraryService

    save = AsyncMock(return_value=SimpleNamespace(item={"id": 123, "text_path": "fixture.md"}))
    monkeypatch.setattr(LibraryService, "log_manual", save)
    db.execute("INSERT INTO dashboard_jobs(title,prompt) VALUES('Fixture','Question')")
    db.execute("INSERT INTO dashboard_research(job_id) VALUES(1)")
    db.commit()
    job = {"id": 1, "title": "Fixture"}
    approve = AsyncMock(return_value=True)
    with pytest.raises(RuntimeError, match="no sourced result"):
        await research.save(job, "Result", set(), approve)
    approve.assert_not_called()
    denied = AsyncMock(return_value=False)
    with pytest.raises(RuntimeError, match="denied"):
        await research.save(job, "Result", {"https://example.org/source"}, denied)
    save.assert_not_called()
    await research.save(job, "Result", {"https://example.org/source"}, approve)
    assert "Sources\nhttps://example.org/source" in save.call_args.kwargs["text"]
    assert db.execute("SELECT note_id FROM dashboard_research").fetchone()[0] == 123
    assert (
        db.execute(
            "SELECT count(*) FROM execution_logs WHERE tool_name='dashboard_research_note'"
        ).fetchone()[0]
        == 2
    )


def test_research_has_only_existing_web_tools():
    from backend.tools.base import RiskLevel, Tool, ToolResult
    from backend.tools.registry import ToolRegistry

    async def handler(*_):
        return ToolResult.ok("fixture")

    registry = ToolRegistry()
    for name in ("search_web", "write_file"):
        registry.register(
            Tool(name=name, description=name, parameters={}, handler=handler, risk=RiskLevel.LOW)
        )
    director = SimpleNamespace(registry=registry)
    research.restrict(director, AsyncMock())
    assert director.registry.get("search_web")
    assert director.registry.get("write_file") is None
