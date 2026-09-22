from __future__ import annotations

import pytest
from backend.agent.tool_selector import select_tools
from backend.mcp.guidance import forget
from backend.tools.base import ToolContext
from backend.tools.builtin.mail import search_email
from backend.tools.builtin.tasks import find_free_slot_tool, list_calendar
from backend.tools.registry import ToolRegistry, ToolSchema, build_default_registry


@pytest.fixture(autouse=True)
def reset_caches():
    forget()
    yield
    forget()


@pytest.mark.asyncio
async def test_composio_ownership_withholds_local_mail_and_calendar_tools(monkeypatch):
    """When Gmail and Google Calendar are connected on Composio and not overridden by local,

    local mail and calendar tools must be withheld from registry schemas, select_tools,
    and redirected if dispatched.
    """
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {
            "gmail": {"status": "ACTIVE"},
            "googlecalendar": {"status": "ACTIVE"},
        },
    )
    monkeypatch.setattr("backend.mcp.provider_ownership.is_provider_overridden_by_local", lambda p: False)

    reg = build_default_registry()
    schemas = reg.schemas()
    schema_names = [s.name for s in schemas]

    # 1. Local mail tools must NOT be offered in registry.schemas()
    for tool_name in ["search_email", "read_email", "send_email", "reply_email", "draft_email"]:
        assert tool_name not in schema_names, f"{tool_name} should be withheld when Composio owns Gmail"

    # 2. Local calendar tools must NOT be offered in registry.schemas()
    for tool_name in ["create_calendar_event", "list_calendar", "find_free_slot"]:
        assert tool_name not in schema_names, f"{tool_name} should be withheld when Composio owns Google Calendar"

    # 3. select_tools must NOT offer local tools on user queries
    kept_mail, _ = select_tools(schemas, "Check my inbox for emails")
    kept_mail_names = [s.name for s in kept_mail]
    assert "search_email" not in kept_mail_names
    assert "send_email" not in kept_mail_names

    kept_cal, _ = select_tools(schemas, "What events do I have on my calendar today?")
    kept_cal_names = [s.name for s in kept_cal]
    assert "list_calendar" not in kept_cal_names
    assert "find_free_slot" not in kept_cal_names

    # 4. If invoked directly (from past context/memory), local tools must return instructional error
    mail_res = await search_email({"query": "in:inbox"}, ToolContext())
    assert mail_res.is_error
    assert "Composio" in mail_res.content
    assert "COMPOSIO_SEARCH_TOOLS" in mail_res.content

    cal_res = await list_calendar({}, ToolContext())
    assert cal_res.is_error
    assert "Composio" in cal_res.content
    assert "COMPOSIO_SEARCH_TOOLS" in cal_res.content

    slot_res = await find_free_slot_tool({"duration_minutes": 30}, ToolContext())
    assert slot_res.is_error
    assert "Composio" in slot_res.content
    assert "COMPOSIO_SEARCH_TOOLS" in slot_res.content

    # 5. guidance.ready_connectors_block must withhold local servers when Composio owns them
    from backend.mcp.guidance import ready_connectors_block
    from backend.mcp import live

    forget()
    monkeypatch.setattr(live, "ready_connectors", lambda: {"google-workspace": 10, "composio": 1})
    desc = ready_connectors_block()
    assert desc is not None
    assert "google-workspace" not in desc
    assert "composio:gmail" in desc
    assert "composio:googlecalendar" in desc
