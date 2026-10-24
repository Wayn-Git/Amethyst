"""Day 1 contracts: local-only providers, independent refresh, and durable shell state."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from backend.dashboard import service
from backend.dashboard.registry import MANIFEST_SCHEMA, MANIFESTS, REGISTRY, validate_registry
from backend.dashboard.router import router
from backend.dashboard.store import cache_read, cache_write, settings_write
from backend.db.connection import reset_connection


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client
    service.IN_FLIGHT.clear()


def test_manifest_schema_disables_invalid_entries_without_crashing():
    Draft202012Validator.check_schema(MANIFEST_SCHEMA)
    invalid = {**MANIFESTS[0], "id": "bad.clock", "refresh": {"mode": "poll"}}
    registry = validate_registry([MANIFESTS[0], invalid, {"id": "broken"}, None])
    assert registry["glance.clock"]["enabled"]
    assert not registry["bad.clock"]["enabled"]
    assert not registry["broken"]["enabled"]
    assert not registry["invalid-3"]["enabled"]
    assert not validate_registry([MANIFESTS[0], MANIFESTS[0]])["glance.clock"]["enabled"]


def test_registry_contains_shipped_local_widgets(client):
    response = client.get("/api/widgets").json()
    assert {entry["manifest"]["id"] for entry in response["widgets"]} == {
        "comm.templates",
        "comm.tone",
        "comm.unread",
        "need.inbox",
        "need.mentions",
        "need.drafts",
        "need.waiting",
        "agent.feed",
        "need.decisions",
        "need.approvals",
        "agent.errors",
        "agent.audit",
        "agent.running",
        "lib.inbox",
        "lib.dupes",
        "lib.recent",
        "lib.search",
        "lib.capture",
        "lib.resurface",
        "dev.prs",
        "dev.backup",
        "dev.unpushed",
        "sys.vault",
        "sys.connectors",
        "sys.notify",
        "sys.model",
        "dev.appeal",
        "dev.recovery",
        "dash.gallery",
        "dash.sync",
        "dash.quiet",
        "dash.shortcuts",
        "glance.clock",
        "task.agenda",
        "glance.next-event",
        "task.today",
        "task.backlog",
        "task.deadlines",
        "task.reminders",
        "need.overdue",
        "need.snoozed",
    }
    assert all(
        all(
            source["type"] in ("local", "library", "composio", "llm", "git", "director")
            for source in (
                entry["manifest"]["source"]
                if isinstance(entry["manifest"]["source"], list)
                else [entry["manifest"]["source"]]
            )
        )
        for entry in response["widgets"]
    )
    assert client.get("/api/widgets/missing/data").status_code == 404
    assert client.post("/api/widgets/glance.clock/actions/send", json={}).status_code == 404


def test_first_read_returns_loading_then_cache_and_refresh(client):
    first = client.get("/api/widgets/glance.clock/data").json()
    assert first["state"] == "loading" and first["refreshing"]
    second = client.get("/api/widgets/glance.clock/data").json()
    assert second["state"] == "ok" and second["synced_at"] and second["payload"]["now"]
    assert client.post("/api/widgets/glance.clock/refresh").status_code == 200


async def test_failed_refresh_preserves_cache_and_other_widget_succeeds(db, monkeypatch):
    old = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    cache_write("dash.gallery", {"saved": True}, "ok", synced_at=old)

    async def fail(_):
        raise RuntimeError("provider failure")

    monkeypatch.setitem(service.PROVIDERS, "dash.gallery", fail)
    await asyncio.gather(service.refresh("dash.gallery"), service.refresh("glance.clock"))
    failed = service.read_data("dash.gallery")
    assert failed["state"] == "stale" and failed["payload"] == {"saved": True}
    assert failed["synced_at"] == old and failed["error"]
    assert service.read_data("glance.clock")["state"] == "ok"


async def test_empty_not_connected_and_error_states(db, monkeypatch):
    async def empty(_):
        return []

    monkeypatch.setitem(service.PROVIDERS, "dash.gallery", empty)
    await service.refresh("dash.gallery")
    assert cache_read("dash.gallery")["state"] == "empty"
    manifest = {**REGISTRY["dash.gallery"]["manifest"], "requires": ["connector:unavailable"]}
    monkeypatch.setitem(REGISTRY, "dash.gallery", {"manifest": manifest, "enabled": True})
    await service.refresh("dash.gallery")
    assert cache_read("dash.gallery")["state"] == "not-connected"

    async def fail(_):
        raise RuntimeError("unavailable")

    monkeypatch.setitem(service.PROVIDERS, "glance.clock", fail)
    await service.refresh("glance.clock")
    assert service.read_data("glance.clock")["state"] == "error"


def test_layout_validation_and_restart_persistence(client):
    layout = {"widgets": [{"id": "glance.clock", "size": "l", "height": 5}]}
    assert client.put("/api/layout?mode=default", json=layout).status_code == 200
    reset_connection()
    assert client.get("/api/layout").json() == layout
    assert client.get("/api/layout?mode=another").json() != layout
    for bad in [
        {"widgets": layout["widgets"] * 2},
        {"widgets": [{"id": "dash.gallery", "size": "s", "height": 3}]},
        {"widgets": [{"id": "glance.clock", "size": "m", "height": 100}]},
    ]:
        assert client.put("/api/layout", json=bad).status_code == 422
    assert client.get("/api/layout?mode=../../private").status_code == 422


def test_quiet_hours_cross_midnight_snooze_expiry_and_timezone():
    settings = {"enabled": True, "start": "22:00", "end": "07:00", "timezone": "Asia/Kolkata"}
    assert service.quiet_active(settings, datetime(2026, 10, 24, 18, tzinfo=UTC))
    assert not service.quiet_active(settings, datetime(2026, 10, 24, 8, tzinfo=UTC))
    assert service.quiet_active(
        {"snoozed_until": "2026-10-24T09:00:00Z"}, datetime(2026, 10, 24, 8, tzinfo=UTC)
    )
    assert not service.quiet_active(
        {"snoozed_until": "2026-10-24T09:00:00Z"}, datetime(2026, 10, 24, 10, tzinfo=UTC)
    )


def test_quiet_pauses_polling_but_manual_refresh_works(db):
    settings_write(
        "dash.quiet", {"snoozed_until": (datetime.now(UTC) + timedelta(hours=1)).isoformat()}
    )
    cache_write(
        "glance.clock",
        {"now": "old"},
        "ok",
        synced_at=(datetime.now(UTC) - timedelta(hours=1)).isoformat(),
    )
    background = BackgroundTasks()
    service.schedule("glance.clock", background)
    assert not background.tasks
    service.schedule("glance.clock", background, force=True)
    assert len(background.tasks) == 1
    service.schedule("glance.clock", background, force=True)
    assert len(background.tasks) == 1
    service.IN_FLIGHT.clear()


def test_settings_validation_and_restart(client):
    assert (
        client.put(
            "/api/widgets/glance.clock/settings", json={"zones": ["Europe/London", "Asia/Kolkata"]}
        ).status_code
        == 200
    )
    reset_connection()
    assert client.get("/api/widgets/glance.clock/settings").json()["zones"] == [
        "Europe/London",
        "Asia/Kolkata",
    ]
    assert (
        client.put("/api/widgets/glance.clock/settings", json={"zones": ["Not/AZone"]}).status_code
        == 422
    )
    assert (
        client.put("/api/widgets/dash.quiet/settings", json={"start": "29:00"}).status_code == 422
    )
    assert (
        client.put(
            "/api/widgets/dash.quiet/settings", json={"snoozed_until": "2026-10-24"}
        ).status_code
        == 422
    )
