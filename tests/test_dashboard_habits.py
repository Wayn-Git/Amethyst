from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard import habits, items
from backend.dashboard.router import router
from backend.db.connection import reset_connection


@pytest.fixture
def clock(db, monkeypatch):
    now = [datetime(2026, 10, 25, 23, 59, tzinfo=ZoneInfo("Asia/Kolkata"))]
    monkeypatch.setattr(items, "local_now", lambda: now[0])
    return now


def test_daily_weekly_streaks_gate_and_reload(clock):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:

        def act(action, body, approved=True):
            response = client.post(f"/api/widgets/task.habits/actions/{action}", json=body)
            assert response.status_code == 200, response.text
            return client.post(
                "/api/widgets/task.habits/drafts/" + response.json()["draft_id"],
                json={"approved": approved},
            )

        assert habits.provide()["items"] == []
        assert act("add", {"title": "Denied"}, False).json()["state"] == "denied"
        assert habits.provide()["items"] == []
        act("add", {"title": "Read"})
        act("add", {"title": "Walk", "period": "weekly", "target": 2})
        daily, weekly = habits.provide()["items"]
        act("checkin", {"id": daily["id"]})
        act("checkin", {"id": weekly["id"]})
        act("checkin", {"id": weekly["id"]})
        reset_connection()
        assert [r["streak"] for r in habits.provide()["items"]] == [1, 1]
        clock[0] += timedelta(minutes=2)  # Monday in the user's timezone.
        assert [r["count"] for r in habits.provide()["items"]] == [0, 0]
        assert [r["streak"] for r in habits.provide()["items"]] == [1, 1]
        act("checkin", {"id": daily["id"]})
        assert habits.provide()["items"][0]["streak"] == 2
        clock[0] += timedelta(days=2)
        assert habits.provide()["items"][0]["streak"] == 0
        clock[0] += timedelta(days=7)
        assert habits.provide()["items"][1]["streak"] == 0
        act("checkin", {"id": daily["id"]})
        assert habits.provide()["items"][0]["streak"] == 1
        for body in (
            {"title": " "},
            {"title": "x", "target": 0},
            {"title": "x", "period": "monthly"},
        ):
            assert client.post("/api/widgets/task.habits/actions/add", json=body).status_code == 422


def test_checkin_changed_day_and_replay(clock):
    body = habits.HabitInput(title="Read")
    import asyncio

    from backend.dashboard.items import decide

    async def review(draft):
        return await decide("task.habits", draft["draft_id"], True)

    asyncio.run(review(habits.draft("add", body)))
    habit_id = habits.provide()["items"][0]["id"]
    draft = habits.draft("checkin", habits.HabitInput(id=habit_id))
    clock[0] += timedelta(minutes=2)
    with pytest.raises(Exception) as error:
        asyncio.run(review(draft))
    assert error.value.status_code == 409
    draft = habits.draft("checkin", habits.HabitInput(id=habit_id))
    asyncio.run(review(draft))
    with pytest.raises(Exception) as error:
        asyncio.run(review(draft))
    assert error.value.status_code == 409
    assert habits.provide()["items"][0]["count"] == 1
