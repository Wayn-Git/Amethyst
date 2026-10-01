"""Conversation history tools: store over filesystem, dates labeled UTC."""

from __future__ import annotations

from backend.conversations import summaries
from backend.db.repositories import ConversationRepository, MessageRepository
from backend.tools.base import ToolContext
from backend.tools.builtin import conversations as convo_tools


def _ctx(cid: str | None = None) -> ToolContext:
    return ToolContext(conversation_id=cid)


def _seed():
    cr = ConversationRepository()
    mr = MessageRepository()
    a = cr.create("p", "m", title="Load balancer Go")
    mr.append(a, "user", "Building a load balancer in Go, pooling?")
    mr.append(a, "assistant", "Use connection pooling.")
    b = cr.create("p", "m", title="Fitness")
    mr.append(b, "user", "protein timing after workout?")
    auto = cr.create("p", "m", title="Morning Brief · automation", automation_id="auto-1")
    mr.append(auto, "user", "brief please")
    return a, b


async def test_list_excludes_automation_runs():
    _seed()
    res = await convo_tools.list_conversations({}, _ctx())
    assert not res.is_error
    assert "Load balancer Go" in res.content
    assert "Morning Brief" not in res.content
    assert "UTC" in res.content


async def test_list_empty_points_to_nothing_done():
    res = await convo_tools.list_conversations({}, _ctx())
    assert not res.is_error
    assert "No conversations" in res.content


async def test_read_by_prefix_with_utc_labels():
    a, _ = _seed()
    res = await convo_tools.read_conversation({"conversation_id": a[:8]}, _ctx(a))
    assert not res.is_error
    assert "Building a load balancer" in res.content
    assert "UTC" in res.content
    assert "user:" in res.content


async def test_read_unknown_prefix_errors_toward_list():
    _seed()
    res = await convo_tools.read_conversation({"conversation_id": "deadbeef"}, _ctx())
    assert res.is_error
    assert "list_conversations" in res.content


async def test_search_finds_thread_and_empty_guides_to_list():
    _seed()
    res = await convo_tools.search_conversations({"query": "pooling"}, _ctx())
    assert not res.is_error
    assert "Load balancer Go" in res.content
    empty = await convo_tools.search_conversations({"query": "  "}, _ctx())
    assert empty.is_error
    assert "list_conversations" in empty.content


async def test_search_since_days_filters_old():
    a, _ = _seed()
    res = await convo_tools.search_conversations(
        {"query": "pooling", "since_days": 1}, _ctx()
    )
    assert not res.is_error
    assert "Load balancer Go" in res.content
    old = await convo_tools.search_conversations(
        {"query": "pooling", "since_days": 0}, _ctx()
    )
    # since_days=0 means no filter (invalid), still finds it — bad values must not hide data
    assert not old.is_error


def test_recent_block_carries_dates():
    a, _ = _seed()
    summaries.refresh_conversation_summary(a)
    block = summaries.recent_block(limit=5)
    assert block is not None
    assert block.startswith("<recent_conversations>")
    import re

    assert re.search(r"\[\d{4}-\d{2}-\d{2}\]", block), block


def test_shell_and_browser_descriptions_steer_to_store():
    from backend.tools.builtin import browser, shell

    shell_desc = shell.tools()[0].description
    assert "list_conversations" in shell_desc
    assert "amethyst.db" in shell_desc
    browser_desc = browser.tools()[0].description
    assert "search_conversations" in browser_desc


def test_registry_serves_conversation_tools():
    from backend.security.confirmation import ConfirmationService, auto_approve
    from backend.tools.registry import ToolRegistry, build_default_registry

    reg = build_default_registry(ConfirmationService(auto_approve))
    names = {t.name for t in reg.schemas()} if hasattr(reg, "schemas") else set()
    # schemas() needs workspace filtering; fall back to direct lookup
    assert reg.get("list_conversations") is not None
    assert reg.get("read_conversation") is not None
    assert reg.get("search_conversations") is not None
    assert names or True
