"""Tests for TypeSafe Jev routing and Generative Sandboxed UI."""

from __future__ import annotations

import pytest
import httpx

from backend.agent.jev import (
    ALLOWED_PRESENTATIONS,
    _format_context,
    _parse_decision,
    classify_presentation,
    resolve_typesafe_key,
)
from backend.agent.widgets import SandboxedUi, to_envelope, parse_envelope
from backend.tools.base import ToolContext
from backend.tools.builtin.generative_ui import generate_sandboxed_ui

pytestmark = pytest.mark.anyio


def test_sandboxed_ui_schema_validation():
    data = {
        "title": "3D Airplane Controls",
        "initial_height": 450,
        "html": "<canvas id='plane'></canvas>",
        "css": "body { margin: 0; }",
        "js": "initPlane();",
        "scripts": ["https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"],
    }
    widget = SandboxedUi(**data)
    assert widget.title == "3D Airplane Controls"
    assert widget.initial_height == 450
    assert widget.scripts[0].endswith("three.min.js")


def test_sandboxed_ui_envelope_roundtrip():
    data = {
        "title": "Mortgage Calculator",
        "initial_height": 380,
        "html": "<input id='principal' type='number' />",
        "css": "input { padding: 8px; }",
        "js": "calculate();",
        "scripts": [],
    }
    env = to_envelope("sandboxed_ui", data, [])
    parsed = parse_envelope(env)
    assert parsed is not None
    assert parsed["type"] == "sandboxed_ui"
    assert parsed["data"]["title"] == "Mortgage Calculator"


def test_format_context():
    messages = [
        {"role": "user", "content": "Hello there"},
        {"role": "assistant", "content": "Hi! How can I help?"},
        {"role": "user", "content": "Compare Apple and Google stocks in a chart"},
    ]
    formatted = _format_context(messages)
    assert "User: Hello there" in formatted
    assert "Assistant: Hi! How can I help?" in formatted
    assert "User: Compare Apple and Google stocks in a chart" in formatted


def test_parse_decision_shapes():
    # Shape 1
    assert _parse_decision({"decisions": {"visualization": "chart"}}) == "chart"
    assert _parse_decision({"decisions": {"visualization": {"choice": "calculator"}}}) == "calculator"
    # Shape 2
    assert _parse_decision({"questions": {"visualization": {"choice": "diagram"}}}) == "diagram"
    # Shape 3
    assert _parse_decision({"visualization": {"choice": "simulation"}}) == "simulation"
    # Shape 4
    assert _parse_decision({"answers": {"visualization": "table"}}) == "table"
    # Fallback to text on invalid/unknown
    assert _parse_decision({"decisions": {"visualization": "unknown_mode"}}) == "text"
    assert _parse_decision(None) == "text"
    assert _parse_decision({}) == "text"


async def test_classify_presentation_no_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    # Generic conversational text routes to text
    res_generic = await classify_presentation("Hello how are you doing today?", api_key=None)
    assert res_generic == "text"
    # Local heuristic routes chart keywords to chart even without key
    res_chart = await classify_presentation("Show me a chart of sales", api_key=None)
    assert res_chart == "chart"


async def test_classify_presentation_network_error(monkeypatch):
    async def mock_post(*args, **kwargs):
        raise httpx.ConnectError("Connection refused")

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    # Generic text falls back to text on error
    res_generic = await classify_presentation("Tell me a story", api_key="sk-test-key")
    assert res_generic == "text"
    # Local heuristic recovers presentation intent on error
    res_3d = await classify_presentation("Draw a 3d model", api_key="sk-test-key")
    assert res_3d == "simulation"


async def test_classify_presentation_success(monkeypatch):
    class MockResponse:
        status_code = 200

        def json(self):
            return {"decisions": {"visualization": "chart"}}

    async def mock_post(*args, **kwargs):
        return MockResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    res = await classify_presentation("Plot a bar chart of 2024 revenue", api_key="sk-test-key")
    assert res == "chart"


async def test_generate_sandboxed_ui_tool():
    ctx = ToolContext()
    args = {
        "title": "Expense Calculator",
        "initial_height": 420,
        "html": "<div id='app'></div>",
        "css": "#app { color: red; }",
        "js": "document.getElementById('app').innerText = '0';",
    }
    result = await generate_sandboxed_ui(args, ctx)
    assert not result.is_error
    assert "Generated interactive tool 'Expense Calculator'" in result.content
    assert "```amethyst:widget" in result.content
    assert '"type": "sandboxed_ui"' in result.content


async def test_jev_classifies_expanded_presentations():
    assert "comparison" in ALLOWED_PRESENTATIONS
    assert "recipe" in ALLOWED_PRESENTATIONS
    assert "step_guide" in ALLOWED_PRESENTATIONS
    assert "quiz" in ALLOWED_PRESENTATIONS

    assert await classify_presentation("Compare React vs Svelte vs Vue") == "comparison"
    assert await classify_presentation("Recipe for sourdough bread with ingredients and steps") == "recipe"
    assert await classify_presentation("Step by step guide to install Docker on Debian") == "step_guide"
    assert await classify_presentation("Quiz me on world capitals trivia") == "quiz"
    assert await classify_presentation("Plan a 4-day road trip from SF to LA") == "itinerary"
