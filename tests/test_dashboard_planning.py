"""Fixed-clock capacity tests using the mocked Composio transport."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from test_dashboard_agenda import calendar as calendar_fixture

from backend.dashboard import planning, service
from backend.dashboard.store import cache_read, settings_write

calendar = calendar_fixture


@pytest.fixture
def fixed(db, request, monkeypatch):
    calendar_data = request.getfixturevalue("calendar")
    now = datetime(2026, 10, 26, 9, tzinfo=ZoneInfo("Asia/Kolkata"))
    monkeypatch.setattr(planning, "clock", lambda zone: now.astimezone(zone))
    settings_write(
        "task.free",
        {"start": "09:00", "end": "17:00", "days": [0, 1, 2, 3, 4], "timezone": "Asia/Kolkata"},
    )
    return calendar_data


async def test_plan_read_only_and_no_invented_estimates(db, fixed):
    payload, calls, _ = fixed
    payload["items"] = [
        {
            "id": "busy",
            "summary": "Busy",
            "start": {"dateTime": "2026-10-26T09:00:00+05:30"},
            "end": {"dateTime": "2026-10-26T10:00:00+05:30"},
        }
    ]
    db.execute(
        "INSERT INTO tasks(title,my_day_date,duration_estimate_minutes) "
        "VALUES('Task','2026-10-26',60)"
    )
    db.execute("INSERT INTO tasks(title,my_day_date) VALUES('Unknown','2026-10-26')")
    db.commit()
    value = await planning.provide("task.plan")
    assert value["items"][0]["start"] == "2026-10-26T10:00:00+05:30"
    assert value["items"][1]["detail"] == "Set a duration estimate"
    assert len(calls) == 1
    assert db.execute("SELECT count(*) FROM calendar_events").fetchone()[0] == 0


async def test_settings_and_partial_calendar_fail_closed(db, fixed):
    payload, _, _ = fixed
    payload["nextPageToken"] = "more"
    await service.refresh("task.plan")
    assert cache_read("task.plan")["state"] == "error"
    with pytest.raises(ValueError):
        planning.PlanningSettings(start="17:00", end="09:00", days=[0], timezone="UTC")


def test_plan_settings_and_no_calendar_write(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.dashboard.router import router
    from backend.dashboard.store import settings_read

    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert (
            client.put(
                "/api/widgets/task.plan/settings",
                json={
                    "start": "09:00",
                    "end": "17:00",
                    "days": [0],
                    "timezone": "Asia/Kolkata",
                },
            ).status_code
            == 200
        )
        assert settings_read("task.free")["days"] == [0]
        assert (
            client.put(
                "/api/widgets/task.plan/settings",
                json={
                    "start": "09:00",
                    "end": "17:00",
                    "days": [9],
                    "timezone": "UTC",
                },
            ).status_code
            == 422
        )
        assert client.post("/api/widgets/task.plan/actions/add", json={}).status_code == 404


async def test_free_merges_overlaps_all_day_and_transparent(db, fixed):
    payload, calls, _ = fixed

    def event(key, start, end, **extra):
        return {"id": key, "start": {"dateTime": start}, "end": {"dateTime": end}, **extra}

    payload["items"] = [
        event("a", "2026-10-26T10:00:00+05:30", "2026-10-26T12:00:00+05:30"),
        event("b", "2026-10-26T11:00:00+05:30", "2026-10-26T13:00:00+05:30"),
        event(
            "transparent",
            "2026-10-26T14:00:00+05:30",
            "2026-10-26T16:00:00+05:30",
            transparency="transparent",
        ),
        {"id": "day", "start": {"date": "2026-10-27"}, "end": {"date": "2026-10-28"}},
    ]
    result = await planning.provide("task.free")
    slots = result["items"]
    assert slots[0]["end"] == "2026-10-26T10:00:00+05:30"
    assert slots[1]["start"] == "2026-10-26T13:00:00+05:30"
    assert slots[1]["end"] == "2026-10-26T17:00:00+05:30"
    assert not any(slot["start"].startswith("2026-10-27") for slot in slots)
    await planning.provide("task.plan")
    assert len(calls) == 1


async def test_free_requires_settings_and_calendar_access(db, fixed):
    from backend.dashboard.connectors import SourceUnavailable

    settings_write("task.free", {})
    assert (await planning.provide("task.free"))["set_hours"]
    settings_write("task.agenda", {"enabled": False})
    with pytest.raises(SourceUnavailable):
        await planning.provide("task.free")


async def test_conflicts_overlap_touching_and_deadline_days(db, fixed):
    payload, calls, _ = fixed
    payload["items"] = [
        {
            "id": key,
            "summary": key,
            "start": {"dateTime": f"2026-10-26T{start}:00+05:30"},
            "end": {"dateTime": f"2026-10-26T{end}:00+05:30"},
        }
        for key, start, end in [
            ("a", "10:00", "12:00"),
            ("b", "11:00", "13:00"),
            ("touch", "13:00", "14:00"),
        ]
    ] + [{"id": "day", "start": {"date": "2026-11-02"}, "end": {"date": "2026-11-03"}}]
    db.execute(
        "INSERT INTO deadlines(title,due_at) VALUES('Due fixture','2026-11-02T17:00:00+05:30')"
    )
    db.commit()
    value = await planning.provide("task.conflicts")
    assert len(value["items"]) == 2
    assert value["items"][0]["detail"] == "Overlapping events"
    assert value["items"][1]["detail"].startswith("No free slot on deadline day")
    assert calls[0]["time_max"] == "2026-11-03T00:00:00+05:30"
