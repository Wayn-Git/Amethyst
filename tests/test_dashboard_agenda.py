"""Isolated calendar fixtures; no live accounts, network, or external writes."""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard import agenda, connectors, service
from backend.dashboard.router import router
from backend.dashboard.store import cache_read, cache_write, settings_write
from backend.mcp.composio_service import composio_service
from backend.tools.base import RiskLevel, Tool, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry


@pytest.fixture
def calendar(db, monkeypatch):
    from backend.tools import registry as tools

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_enabled_toolkits", lambda: ["googlecalendar"])
    monkeypatch.setattr(
        composio_service, "get_connections", lambda **kwargs: {"googlecalendar": {}}
    )
    monkeypatch.setattr(composio_service, "is_reauth_required", lambda slug: False)

    async def accounts(**kwargs):
        return {"googlecalendar": {}}

    monkeypatch.setattr(composio_service, "get_connections_async", accounts)
    monkeypatch.setattr(tools, "_connector_enabled", lambda *args: True)
    monkeypatch.setattr(tools, "_unsigned_connectors", lambda: set())
    monkeypatch.setattr(connectors, "is_provider_overridden_by_local", lambda *args: False)
    calls = []
    payload = {"items": []}

    async def read(arguments, context):
        assert context.read_only
        calls.append(arguments)
        return ToolResult.ok(json.dumps(payload))

    registry = ToolRegistry()
    registry.confirmation.mcp_trust.trust("composio")
    registry.register(
        Tool(
            name="GOOGLECALENDAR_FIND_EVENT",
            description="Read calendar",
            parameters={"type": "object"},
            handler=read,
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    manager = SimpleNamespace(
        registry=registry, connections={"composio": SimpleNamespace(connected=True)}
    )
    from backend.mcp import live

    monkeypatch.setattr(live, "_manager", manager)
    yield payload, calls, registry
    service.IN_FLIGHT.clear()
    service.RETRY_AFTER.clear()


async def test_week_window_minimal_fields_order_and_audit(db, calendar):
    payload, calls, _ = calendar
    settings_write("dash.quiet", {"timezone": "Asia/Kolkata"})
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    monday = (now - timedelta(days=now.weekday())).date().isoformat()
    payload["items"] = [
        {
            "id": "timed",
            "summary": "Meeting fixture",
            "start": {"dateTime": monday + "T11:00:00+05:30"},
            "end": {"dateTime": monday + "T12:00:00+05:30"},
            "attendees": ["private"],
            "description": "private",
        },
        {
            "id": "day",
            "summary": "All day fixture",
            "start": {"date": monday},
            "end": {
                "date": (datetime.fromisoformat(monday) + timedelta(days=1)).date().isoformat()
            },
        },
        {"id": "cancelled", "status": "cancelled"},
    ]
    await service.refresh("task.agenda")
    value = cache_read("task.agenda")
    assert value["state"] == "ok"
    items = value["payload"]["items"]
    assert [row["id"] for row in items] == ["day", "timed"]
    assert items[0]["all_day"]
    assert "description" not in items[1] and "attendees" not in items[1]
    assert calls[0]["single_events"] and calls[0]["max_results"] == 100
    assert calls[0]["time_min"] == monday + "T00:00:00+05:30"
    assert calls[0]["calendar_id"] == "primary"
    log = db.execute(
        "SELECT * FROM execution_logs WHERE tool_name='GOOGLECALENDAR_FIND_EVENT'"
    ).fetchone()
    assert log is not None and not log["error"]


async def test_empty_disconnected_and_reconnect(db, calendar, monkeypatch):
    _, calls, _ = calendar
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["state"] == "empty"
    settings_write("task.agenda", {"enabled": False})
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["state"] == "not-connected"
    assert cache_read("task.agenda")["payload"] is None
    assert len(calls) == 1
    settings_write("task.agenda", {"enabled": True})
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["state"] == "empty"


async def test_malformed_response_retains_stale_cache(db, calendar):
    payload, _, _ = calendar
    payload["items"] = [{"id": "broken", "start": {}}]
    cache_write(
        "task.agenda", {"items": [{"id": "saved"}]}, "ok", synced_at="2020-01-01T00:00:00+00:00"
    )
    await service.refresh("task.agenda")
    value = service.read_data("task.agenda")
    assert value["state"] == "stale" and value["payload"]["items"][0]["id"] == "saved"


async def test_no_connection_never_reads(db, calendar, monkeypatch):
    _, calls, _ = calendar
    monkeypatch.setattr(connectors, "connection", lambda name: None)
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["state"] == "error"
    assert not calls
    cache_write(
        "task.agenda", {"items": [{"id": "saved"}]}, "ok", synced_at="2020-01-01T00:00:00+00:00"
    )
    await service.refresh("task.agenda")
    assert service.read_data("task.agenda")["state"] == "stale"
    assert cache_read("task.agenda")["payload"]["items"][0]["id"] == "saved"


def test_stop_deletes_cache_and_rejects_event_writes(db, calendar):
    app = FastAPI()
    app.include_router(router)
    cache_write("task.agenda", {"items": [{"title": "private"}]}, "ok")
    with TestClient(app) as client:
        assert (
            client.put("/api/widgets/task.agenda/settings", json={"enabled": False}).status_code
            == 200
        )
        assert cache_read("task.agenda")["payload"] is None
        assert client.get("/api/widgets/task.agenda/settings").json() == {"enabled": False}
        assert (
            client.post(
                "/api/widgets/task.agenda/actions/add", json={"title": "No write"}
            ).status_code
            == 404
        )
        assert (
            client.put(
                "/api/widgets/task.agenda/settings", json={"enabled": True, "tool": "delete"}
            ).status_code
            == 422
        )


@pytest.mark.parametrize("fails", [False, True])
async def test_read_error_after_stop_cannot_restore_deleted_data(db, calendar, fails):
    _, _, registry = calendar

    async def fail_after_stop(arguments, context):
        settings_write("task.agenda", {"enabled": False})
        cache_write("task.agenda", None, "not-connected")
        if fails:
            raise RuntimeError("offline")
        return ToolResult.ok(json.dumps({"items": []}))

    registry.resolve_tool("GOOGLECALENDAR_FIND_EVENT").handler = fail_after_stop
    cache_write("task.agenda", {"items": [{"title": "private"}]}, "ok")
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["payload"] is None
    assert cache_read("task.agenda")["state"] == "not-connected"


async def test_untrusted_and_mutating_tool_are_never_called(db, calendar):
    _, calls, registry = calendar
    tool = registry.resolve_tool("GOOGLECALENDAR_FIND_EVENT")
    tool.risk = RiskLevel.HIGH
    await service.refresh("task.agenda")
    assert not calls
    assert cache_read("task.agenda")["state"] == "error"
    tool.risk = RiskLevel.LOW
    # No trust grant can be manufactured by a background refresh.
    db.execute("DELETE FROM mcp_trusted_servers WHERE server_name='composio'")
    db.commit()
    await service.refresh("task.agenda")
    assert not calls
    assert cache_read("task.agenda")["state"] == "not-connected"


async def test_disconnected_refresh_backs_off(db, calendar, monkeypatch):
    from fastapi import BackgroundTasks

    monkeypatch.setattr(composio_service, "get_enabled_toolkits", lambda: [])
    await service.refresh("task.agenda")
    tasks = BackgroundTasks()
    service.schedule("task.agenda", tasks)
    assert tasks.tasks == []
    service.schedule("task.agenda", tasks, force=True)
    assert len(tasks.tasks) == 1


async def test_events_wrapper_pagination_and_auth_loss(db, calendar):
    payload, _, registry = calendar
    payload.clear()
    payload.update(events=[], nextPageToken="another-page")
    value = await agenda.provide("task.agenda")
    assert value["items"] == [] and value["limited"]

    async def auth_error(arguments, context):
        return ToolResult.error("401 Unauthorized")

    registry.resolve_tool("GOOGLECALENDAR_FIND_EVENT").handler = auth_error
    cache_write("task.agenda", {"items": [{"title": "private"}]}, "ok")
    await service.refresh("task.agenda")
    assert cache_read("task.agenda")["state"] == "not-connected"
    assert cache_read("task.agenda")["payload"] is None


async def test_next_event_reuses_agenda_and_stops_access(db, calendar):
    from backend.dashboard.agenda import next_event
    from backend.dashboard.connectors import SourceUnavailable

    _, calls, _ = calendar
    now = datetime.now(ZoneInfo("UTC"))
    cache_write("task.agenda", {"items": [
        {"id": "past", "start": (now - timedelta(hours=1)).isoformat()},
        {"id": "next", "start": (now + timedelta(minutes=30)).isoformat()},
        {"id": "later", "start": (now + timedelta(hours=1)).isoformat()},
    ], "timezone": "UTC"}, "ok", synced_at=now.isoformat())
    assert [item["id"] for item in (await next_event())["items"]] == ["next"]
    assert calls == []
    settings_write("task.agenda", {"enabled": False})
    with pytest.raises(SourceUnavailable):
        await next_event()


async def test_next_event_fetches_empty_agenda_once(db, calendar):
    from backend.dashboard.agenda import next_event

    _, calls, _ = calendar
    assert (await next_event())["items"] == []
    assert (await next_event())["items"] == []
    assert len(calls) == 1
