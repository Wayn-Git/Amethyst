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
