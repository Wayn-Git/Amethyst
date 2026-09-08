"""Connector widget API contract, with isolated Composio fixtures."""

import test_dashboard_connectors as connector_tests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard.router import router
from backend.mcp.composio_service import composio_service

calendar = connector_tests.calendar
account_state = connector_tests.account_state


def test_health_and_connect_api(db, calendar, account_state, monkeypatch):
    app = FastAPI()
    app.include_router(router)
    monkeypatch.setattr(
        composio_service,
        "initiate_connection",
        lambda *args, **kwargs: "https://connect.composio.dev/link/test",
    )
    with TestClient(app) as client:
        assert (
            next(
                r
                for r in client.get("/api/connectors/health").json()["items"]
                if r["id"] == "googlecalendar"
            )["status"]
            == "connected"
        )
        assert client.post("/api/connectors/googlecalendar/connect").status_code == 200
        assert client.post("/api/connectors/unknown/connect").status_code == 422
        assert client.post("/api/widgets/sys.connectors/actions/send", json={}).status_code == 404
        assert client.post("/api/widgets/sys.connectors/refresh").status_code == 200
        payload = client.get("/api/widgets/sys.connectors/data").json()["payload"]
        assert any(r["id"] == "googlecalendar" for r in payload["items"])


def test_connect_errors_are_sanitized(db, calendar, account_state, monkeypatch):
    app = FastAPI()
    app.include_router(router)

    def fail(*args, **kwargs):
        raise ValueError("private-token-fixture")

    monkeypatch.setattr(composio_service, "initiate_connection", fail)
    with TestClient(app) as client:
        response = client.post("/api/connectors/googlecalendar/connect")
        assert response.status_code == 503
        assert "private-token-fixture" not in response.text
        rows = db.execute(
            "SELECT * FROM execution_logs WHERE tool_name='composio_connect_link'"
        ).fetchall()
        assert len(rows) == 1 and rows[0]["error"] == "Connect Link unavailable"
