"""Tests for the unified intent router in AMETHYST."""

from __future__ import annotations

import pytest

from backend.agent.intent_router import (
    IntentRoute,
    route_intent_fast,
    resolve_intent_route,
    VISUALIZATION_STEER_INSTRUCTIONS,
)
from backend.agent.tool_selector import select_tools
from backend.runtime.types import ToolSchema


def test_lane_classification_chat():
    for msg in ("hi", "hello there", "thanks!", "good morning", "what is 2 + 2"):
        route, need_jev, need_extract = route_intent_fast(msg)
        assert route.lane == "chat", f"Expected chat for {msg!r}, got {route.lane}"
        assert route.step_budget <= 10
        assert route.presentation == "text"
        assert not need_jev
        assert not need_extract


def test_lane_classification_connector():
    connector_messages = (
        "what's on my calendar today",
        "check my latest email",
        "summarize my inbox",
        "create a github issue for the crash",
        "send a message to the general slack channel",
        "search notion for the Q3 roadmap",
        "update my linear ticket",
    )
    for msg in connector_messages:
        route, need_jev, need_extract = route_intent_fast(msg)
        assert route.lane == "connector", f"Expected connector for {msg!r}, got {route.lane}"
        assert route.step_budget <= 15
        assert route.tool_filter == "connector"
        assert not need_jev, f"Expected need_jev=False for connector query: {msg!r}"
        assert not need_extract, f"Expected need_extract=False for connector query: {msg!r}"


def test_lane_classification_widget_local_heuristic():
    chart_route, need_jev, need_extract = route_intent_fast("Plot a bar chart of 2024 revenue")
    assert chart_route.lane == "widget"
    assert chart_route.presentation == "chart"
    assert not need_jev  # Local heuristic matched, no remote call needed
    assert not need_extract  # Generative UI chart, doesn't need classify_and_extract

    calc_route, need_jev, need_extract = route_intent_fast("Calculate mortgage for 500k at 6% interest")
    assert calc_route.lane == "widget"
    assert calc_route.presentation == "calculator"
    assert not need_jev
    assert not need_extract

    recipe_route, need_jev, need_extract = route_intent_fast("Recipe for sourdough bread with ingredients")
    assert recipe_route.lane == "widget"
    assert recipe_route.presentation == "recipe"
    assert not need_jev
    assert need_extract  # Recipe can be extracted into structured widget envelope


def test_lane_classification_widget_tentative_signals():
    # "visualize" is in widget signals, but not in local heuristic keywords
    route, need_jev, need_extract = route_intent_fast("visualize our quarterly distribution")
    assert route.lane == "widget"
    assert need_jev is True
    assert need_extract is True


def test_lane_classification_agent():
    agent_messages = (
        "fix the bug in auth.py where token expires",
        "refactor database connection pool",
        "run pytest and debug the error",
        "deploy the latest build to production",
        "```python\ndef test(): pass\n```",
    )
    for msg in agent_messages:
        route, need_jev, need_extract = route_intent_fast(msg)
        assert route.lane == "agent", f"Expected agent for {msg!r}, got {route.lane}"
        assert route.step_budget == 20
        assert not need_jev
        assert not need_extract


def test_lane_classification_research():
    research_messages = (
        "search the web for python 3.13 features",
        "look up documentation for react server components",
        "google latest news on deepseek",
        "browse the web for amethyst tutorials",
        "research current ai models",
    )
    for msg in research_messages:
        route, need_jev, need_extract = route_intent_fast(msg)
        assert route.lane == "research", f"Expected research for {msg!r}, got {route.lane}"
        assert route.step_budget == 8
        assert route.tool_filter == "research"
        assert not need_jev
        assert not need_extract


def test_guard_plan_mode_and_attachments():
    # Plan mode forces agent lane
    route, need_jev, need_extract = route_intent_fast("what's on my calendar today", mode="plan")
    assert route.lane == "agent"
    assert not need_jev
    assert not need_extract

    # Attachments force agent lane
    route, need_jev, need_extract = route_intent_fast("hi", attachments=[{"type": "image"}])
    assert route.lane == "agent"
    assert not need_jev
    assert not need_extract


def test_resolve_intent_route_fallthrough_invariant():
    tentative_route = IntentRoute(
        lane="widget",
        presentation="text",
        step_budget=4,
        tool_filter="widget",
        reason="widget signals present",
    )

    # 1. Fallthrough: Jev returned "text" and no widget was extracted
    fell_through = resolve_intent_route(
        tentative_route,
        jev_decision="text",
        widget_extracted=False,
        max_iterations=40,
    )
    assert fell_through.lane == "agent"
    assert fell_through.step_budget == 20
    assert fell_through.presentation == "text"
    assert fell_through.presentation_steer is None

    # 2. Confirmed: Jev returned "diagram"
    confirmed = resolve_intent_route(
        tentative_route,
        jev_decision="diagram",
        widget_extracted=False,
        max_iterations=40,
    )
    assert confirmed.lane == "widget"
    assert confirmed.presentation == "diagram"
    assert confirmed.step_budget == 4
    assert confirmed.presentation_steer == VISUALIZATION_STEER_INSTRUCTIONS["diagram"]


def test_tool_selector_lane_filtering():
    schemas = [
        ToolSchema(name="edit_file", description="Edit a file", parameters={}),
        ToolSchema(name="run_shell_command", description="Run command", parameters={}),
        ToolSchema(name="web_search_with_summary", description="Search web", parameters={}),
        ToolSchema(name="generate_sandboxed_ui", description="Generate UI", parameters={}),
        ToolSchema(name="COMPOSIO_SLACK_SEND_MESSAGE", description="Send slack", parameters={}),
    ]

    # Chat lane withholds edit_file and run_shell_command
    kept_chat, _ = select_tools(schemas, "hi", lane="chat")
    names_chat = {s.name for s in kept_chat}
    assert "edit_file" not in names_chat
    assert "run_shell_command" not in names_chat

    # Connector lane withholds edit_file but keeps composio
    kept_conn, _ = select_tools(schemas, "send slack update", lane="connector")
    names_conn = {s.name for s in kept_conn}
    assert "edit_file" not in names_conn
    assert "COMPOSIO_SLACK_SEND_MESSAGE" in names_conn

    # Widget lane ensures generate_sandboxed_ui is present
    kept_widget, _ = select_tools(schemas, "show mortgage calculator", lane="widget")
    names_widget = {s.name for s in kept_widget}
    assert "generate_sandboxed_ui" in names_widget

    # Agent lane retains edit tools for coding tasks
    kept_agent, _ = select_tools(schemas, "fix the bug in auth.py", lane="agent")
    names_agent = {s.name for s in kept_agent}
    assert "edit_file" in names_agent
    assert "run_shell_command" in names_agent


def test_multiple_reminders_does_not_misclassify_as_calculator():
    msg = "set reminders multiple like 5 random timing from current time"
    route, need_jev, need_extract = route_intent_fast(msg)
    assert route.lane == "connector"
    assert route.presentation == "text"
    assert route.step_budget >= 12
    assert not need_jev
    assert not need_extract

