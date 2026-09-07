"""Background web research; save a sourced Library note only after review."""

import re
import time

from fastapi import HTTPException

from backend.agent.trace import finish_turn_trace, record_tool_dispatch, start_turn_trace
from backend.dashboard import delegated, jobs
from backend.dashboard.items import save_draft
from backend.db.connection import get_connection
from backend.db.repositories import ExecutionLogRepository
from backend.security.confirmation import ConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext
from backend.tools.registry import ToolRegistry

WEB_TOOLS = frozenset({"research_web", "search_web", "web_search", "extract_page", "fetch_url"})


def available():
    from backend.tools.builtin.web import tools

    return any(tool.name in WEB_TOOLS for tool in tools())


def draft(action, body):
    if not available():
        raise HTTPException(409, "Research not available")
    if action != "add" or body.id or not body.title.strip() or not body.prompt.strip():
        raise HTTPException(422, "Title and research question are required")
    if body.run_at or body.interval_s:
        raise HTTPException(422, "Research runs once in the background")
    return save_draft("agent.research", action, body, body.model_dump(mode="json"))


def apply(conn, action, body):
    if not available():
        raise HTTPException(409, "Research not available")
    delegated.apply(conn, action, body)
    job_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute("INSERT INTO dashboard_research(job_id) VALUES(?)", (job_id,))


async def provide():
    payload = await delegated.provide(include_research=True)
    rows = {
        r["job_id"]: r["note_id"]
        for r in get_connection().execute("SELECT * FROM dashboard_research")
    }
    return {
        "available": available(),
        "items": [
            {**item, "note_id": rows[item["id"]]} for item in payload["items"] if item["id"] in rows
        ],
        "message": None if available() else "not available",
    }


def restrict(director, callback):
    registry = ToolRegistry(
        confirmation=ConfirmationService(
            callback=callback, preferences=jobs.NoStandingWrites(), require_write_approval=True
        )
    )
    for name in WEB_TOOLS:
        tool = director.registry.get(name)
        if tool is not None and tool.name not in registry._tools:
            registry.register(tool)
    if not registry._tools:
        raise RuntimeError("Research not available")
    director.registry = registry
    director.retrieval = False
    director.memory = False


def sources(content):
    return set(re.findall(r'https?://[^\s<>"\]\)]+', content))


async def save(job, answer, urls, callback):
    from backend.library.service import LibraryService

    if not answer.strip() or not urls:
        raise RuntimeError("Research produced no sourced result; no note saved")
    text = answer[:40000] + "\n\nSources\n" + "\n".join(sorted(urls)[:50])

    async def unused(*_):
        raise RuntimeError("Save only after approval")

    tool = Tool(
        name="dashboard_research_note",
        description="Save sourced research to Library",
        parameters={},
        handler=unused,
        risk=RiskLevel.HIGH,
    )
    trace, watchdog, token = start_turn_trace("dashboard", "agent.research: save note")
    started = time.monotonic()
    outcome, error = None, None
    try:
        outcome = await ConfirmationService(
            callback=callback, preferences=jobs.NoStandingWrites(), require_write_approval=True
        ).check(tool, {"title": job["title"], "text": text}, ToolContext())
        if not outcome.allowed:
            raise RuntimeError("Library note denied; no note saved")
        captured = await LibraryService().log_manual(title=job["title"], text=text)
        if not captured.item.get("text_path"):
            raise RuntimeError("Library note could not be saved")
        conn = get_connection()
        conn.execute(
            "UPDATE dashboard_research SET note_id=? WHERE job_id=?",
            (captured.item["id"], job["id"]),
        )
        conn.commit()
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        record_tool_dispatch(tool.name, (time.monotonic() - started) * 1000)
        finish_turn_trace(trace, watchdog, token)
        ExecutionLogRepository().record(
            tool_name=tool.name,
            tool_source="native",
            error=error,
            confirmation_decision=outcome.decision if outcome else "gate_error",
            duration_ms=int((time.monotonic() - started) * 1000),
        )
