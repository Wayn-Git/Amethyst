import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard import focus, items
from backend.dashboard.router import router
from backend.db.connection import reset_connection


@pytest.fixture
def clock(db, monkeypatch):
    now = [datetime(2026, 10, 25, 23, 59, tzinfo=ZoneInfo("Asia/Kolkata"))]
    monkeypatch.setattr(items, "local_now", lambda: now[0])
    monkeypatch.setattr("backend.notify._desktop_notify", AsyncMock(return_value=True))
    return now


def test_timer_gate_restart_completion(clock, db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:

        def act(action, body, approved=True):
            response = client.post(f"/api/widgets/task.focus/actions/{action}", json=body)
            assert response.status_code == 200, response.text
            return client.post(
                "/api/widgets/task.focus/drafts/" + response.json()["draft_id"],
                json={"approved": approved},
            )

        assert act("start", {}, False).json()["state"] == "denied"
        assert focus.provide()["items"] == []
        assert act("configure", {"focus_minutes": 1, "break_minutes": 2}).status_code == 200
        assert act("start", {}).status_code == 200
        reset_connection()
        assert focus.provide()["items"][0]["started_at"] == clock[0].isoformat()
        clock[0] += timedelta(minutes=1)
        asyncio.run(focus.complete_due())
        asyncio.run(focus.complete_due())
        assert focus.provide()["items"][0]["completed"] == 1
        from backend.db.connection import get_connection

        assert (
            get_connection()
            .execute("SELECT count(*) FROM notifications WHERE source_key LIKE 'focus:%'")
            .fetchone()[0]
            == 1
        )
        assert act("start", {"mode": "break"}).status_code == 200
        assert focus.provide()["items"][0]["duration_s"] == 120
        assert act("stop", {}).status_code == 200
        assert (
            client.post(
                "/api/widgets/task.focus/actions/configure", json={"focus_minutes": 0}
            ).status_code
            == 422
        )
