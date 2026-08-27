"""Mocked Composio calendar and Maps, fixed timezone/clock, no external writes."""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from test_dashboard_agenda import calendar as calendar_fixture

from backend.agent.read_cache import read_cache
from backend.dashboard import planning, travel
from backend.dashboard.store import settings_write
from backend.tools.base import RiskLevel, Tool, ToolResult, ToolSource

calendar = calendar_fixture


@pytest.fixture
def route(db, request, monkeypatch):
    from backend.mcp.composio_service import composio_service

    payload, calls, registry = request.getfixturevalue("calendar")
    monkeypatch.setattr(
        planning,
        "clock",
        lambda zone: datetime(2026, 10, 26, 9, tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(zone),
    )
    monkeypatch.setattr(
        composio_service, "get_enabled_toolkits", lambda: ["googlecalendar", "google_maps"]
    )

    async def accounts(**kwargs):
        return {"googlecalendar": {}, "google_maps": {}}

    monkeypatch.setattr(composio_service, "get_connections_async", accounts)
    settings_write("dash.quiet", {"timezone": "Asia/Kolkata"})
    settings_write("glance.travel", {"home": "Home fixture"})
    payload["items"] = [
        {"id": key, "summary": key, "start": {"dateTime": start}, "end": {"dateTime": end}, **extra}
        for key, start, end, extra in [
            ("no-location", "2026-10-26T10:00:00+05:30", "2026-10-26T11:00:00+05:30", {}),
            (
                "destination",
                "2026-11-06T10:00:00+05:30",
                "2026-11-06T11:00:00+05:30",
                {"location": "Office fixture"},
            ),
        ]
    ]
    maps_calls = []
    result = {"routes": [{"duration": "601s", "polyline": "private fixture"}]}

    async def handler(arguments, context):
        assert context.read_only
        maps_calls.append(arguments)
        return ToolResult.ok(json.dumps(result))

    tool = Tool(
        name=travel.TOOL,
        description="Read route fixture",
        parameters={"type": "object"},
        handler=handler,
        risk=RiskLevel.LOW,
        source=ToolSource.MCP,
        server_name="composio",
    )
    registry.register(tool)
    return payload, calls, maps_calls, tool, result


async def test_travel_selects_next_located_event_shared_cache_and_audit(db, route):
    _, calls, maps_calls, _, _ = route
    value = await travel.provide("glance.travel")
    assert value["items"][0]["title"] == "destination"
    assert value["items"][0]["detail"] == "11 minutes driving from home"
    assert value["timezone"] == "Asia/Kolkata"
    assert calls[0]["order_by"] == "startTime" and "time_max" not in calls[0]
    assert maps_calls == [
        {
            "origin_address": "Home fixture",
            "destination_address": "Office fixture",
            "travel_mode": "DRIVE",
            "field_mask": "routes.duration",
        }
    ]
    await travel.provide("glance.travel")
    assert len(maps_calls) == len(calls) == 1
    assert "private fixture" not in json.dumps(
        [entry.content for entry in read_cache._cache.values()]
    )
    for name in [travel.TOOL, "GOOGLECALENDAR_FIND_EVENT", "composio_connection_health"]:
        assert db.execute(
            "SELECT 1 FROM execution_logs WHERE tool_name=? AND error IS NULL", (name,)
        ).fetchone()


async def test_setup_unavailable_and_empty(db, route, monkeypatch):
    payload, calls, maps_calls, _, _ = route
    settings_write("glance.travel", {})
    assert (await travel.provide("glance.travel"))["items"][0]["title"] == "set location"
    assert not calls and not maps_calls
    settings_write("glance.travel", {"home": "Home fixture"})
    monkeypatch.setattr(travel, "get_manager", lambda: None)
    assert (await travel.provide("glance.travel"))["items"][0]["title"] == "not available"


async def test_no_location_and_mutating_tool_blocked(db, route):
    payload, calls, maps_calls, tool, _ = route
    payload["items"] = []
    assert (await travel.provide("glance.travel"))["items"] == []
    assert not maps_calls
    read_cache.invalidate_domain("calendar")
    payload["items"] = [
        {
            "id": "next",
            "start": {"dateTime": "2026-10-26T10:00:00+05:30"},
            "end": {"dateTime": "2026-10-26T11:00:00+05:30"},
            "location": "Office fixture",
        }
    ]
    tool.risk = RiskLevel.HIGH
    with pytest.raises(RuntimeError, match="read-only"):
        await travel.provide("glance.travel")
    assert not maps_calls
    assert db.execute(
        "SELECT error FROM execution_logs WHERE tool_name=?", (travel.TOOL,)
    ).fetchone()[0]


async def test_bad_duration_is_error_not_invented(db, route):
    _, _, _, _, result = route
    result["routes"][0]["duration"] = "-1s"
    with pytest.raises(RuntimeError, match="Connector read failed"):
        await travel.provide("glance.travel")


async def test_settings_clear_sensitive_caches_and_stop_all_calendar_dependents(db, route):
    from fastapi import BackgroundTasks

    from backend.dashboard.router import put_settings
    from backend.dashboard.store import cache_read, cache_write

    await travel.provide("glance.travel")
    cache_write("glance.travel", {"items": [{"id": "private"}]}, "ok")
    put_settings("glance.travel", {"home": "", "enabled": True}, BackgroundTasks())
    assert cache_read("glance.travel")["payload"] is None
    assert not any("google_maps" in key[0].lower() for key in read_cache._cache)
    for widget in ["task.plan", "task.free", "task.conflicts", "task.risk", "glance.travel"]:
        cache_write(widget, {"items": [{"id": "private"}]}, "ok")
    put_settings("task.agenda", {"enabled": False}, BackgroundTasks())
    for widget in ["task.plan", "task.free", "task.conflicts", "task.risk", "glance.travel"]:
        assert cache_read(widget)["payload"] is None


async def test_calendar_stop_during_maps_cannot_restore_data(db, route):
    from backend.dashboard import service
    from backend.dashboard.store import cache_read, cache_write

    _, _, _, tool, _ = route

    async def stop(arguments, context):
        settings_write("task.agenda", {"enabled": False})
        cache_write("glance.travel", None, "not-connected")
        return ToolResult.ok(json.dumps({"routes": [{"duration": "60s"}]}))

    tool.handler = stop
    await service.refresh("glance.travel")
    assert cache_read("glance.travel")["payload"] is None
    assert cache_read("glance.travel")["state"] == "not-connected"


def test_maps_catalogue_capability_has_registered_read_only_schema():
    from backend.mcp.composio_service import (
        FAST_LANE_CONFIG,
        PINNED_READ_ONLY_SLUGS,
        STATIC_PINNED_SCHEMAS,
    )

    assert travel.TOOL in FAST_LANE_CONFIG[travel.TOOLKIT]
    assert travel.TOOL in PINNED_READ_ONLY_SLUGS
    schema = STATIC_PINNED_SCHEMAS[travel.TOOLKIT][0]
    assert schema["annotations"]["readOnlyHint"]
    assert schema["parameters"]["required"] == ["origin_address", "destination_address"]
    calendar_schema = STATIC_PINNED_SCHEMAS["googlecalendar"][0]["parameters"]
    assert "order_by" in calendar_schema["properties"]
