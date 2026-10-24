"""Chat pins use reviewed writes, isolated renderer declarations and durable SQLite."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.agent.widgets import to_envelope
from backend.dashboard import pins, service
from backend.dashboard.router import router
from backend.dashboard.store import layout_read
from backend.db.connection import get_connection, reset_connection
from backend.db.repositories import ConversationRepository, MessageRepository


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as value:
        yield value
    service.IN_FLIGHT.clear()


def answer(text, role="assistant"):
    cid = ConversationRepository().create("test", "test")
    mid = MessageRepository().append(cid, role, text)
    return {"conversation_id": cid, "message_id": mid}


def propose(client, body, action="add"):
    response = client.post(f"/api/widgets/dash.pin/actions/{action}", json=body)
    assert response.status_code == 200, response.text
    return response.json()["draft_id"]


def decide(client, draft, approved=True):
    return client.post(f"/api/widgets/dash.pin/drafts/{draft}", json={"approved": approved})


async def test_pin_drafts_gate_durability_renderer_and_removal(client, monkeypatch):
    body = answer("A saved <answer> & details")
    draft = propose(client, body)
    assert await pins.provide() == {"items": []}
    assert not any(w["id"] == "dash.pin" for w in layout_read("default")["widgets"])
    assert decide(client, draft, False).json() == {"state": "denied"}
    assert decide(client, draft).status_code == 409
    assert await pins.provide() == {"items": []}
    draft = propose(client, body)
    assert decide(client, draft).json() == {"state": "applied"}
    assert decide(client, draft).status_code == 409
    assert sum(w["id"] == "dash.pin" for w in layout_read("default")["widgets"]) == 1
    reset_connection()
    calls = []
    original = pins.generate_sandboxed_ui

    async def generate(args, ctx):
        calls.append(args)
        assert ctx.extra == {} and ctx.conversation_id is None
        return await original(args, ctx)

    monkeypatch.setattr(pins, "generate_sandboxed_ui", generate)
    value = await service.local_provider("dash.pin")
    assert len(value["items"]) == len(calls) == 1
    item = value["items"][0]
    assert item["data"]["html"] == "<pre>A saved &lt;answer&gt; &amp; details</pre>"
    saved = get_connection().execute("SELECT * FROM dashboard_pins").fetchone()
    declarations = json.loads(saved["tool_calls_json"])
    assert declarations == [{"name": "generate_sandboxed_ui", "arguments": item["data"]}]
    await service.refresh("dash.pin")
    assert client.get("/api/widgets/dash.pin/data").json()["state"] == "ok"
    remove = propose(client, {"id": item["id"]}, "delete")
    assert decide(client, remove, False).json() == {"state": "denied"}
    assert len((await pins.provide())["items"]) == 1
    remove = propose(client, {"id": item["id"]}, "delete")
    assert decide(client, remove).json() == {"state": "applied"}
    reset_connection()
    assert await pins.provide() == {"items": []}
    assert (
        get_connection()
        .execute("SELECT count(*) FROM execution_logs WHERE tool_name='dashboard_item'")
        .fetchone()[0]
        >= 4
    )


async def test_generated_answer_keeps_only_renderer_declaration_and_redacts(client):
    secret = "sk-" + "x" * 24
    content = to_envelope(
        "sandboxed_ui",
        {
            "title": "Fixture chart",
            "html": f"<p>{secret}</p>",
            "js": "fetch('https://example.com', {headers: {Authorization: 'secret'}})",
            "scripts": ["https://example.com/library.js"],
        },
    )
    body = answer("Before\n" + content + "\nAfter")
    draft = propose(client, body)
    stored = (
        get_connection()
        .execute("SELECT body_json FROM widget_action_drafts WHERE id=?", (draft,))
        .fetchone()[0]
    )
    assert secret not in stored and "Authorization" not in stored
    assert decide(client, draft).json()["state"] == "applied"
    data = (await pins.provide())["items"][0]["data"]
    assert data["title"] == "Fixture chart"
    assert data["js"] == "" and data["scripts"] == []
    assert data["html"] == "<p>[redacted]</p>"


def test_pin_input_rejects_credentials_other_tools_and_wrong_messages(client):
    body = answer("Valid answer")
    for extra in ({"credentials": "private"}, {"tool_calls": [{"name": "run_shell_command"}]}):
        assert (
            client.post("/api/widgets/dash.pin/actions/add", json={**body, **extra}).status_code
            == 422
        )
    assert (
        client.post(
            "/api/widgets/dash.pin/actions/add", json=answer("User text", "user")
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/widgets/dash.pin/actions/add", json={**body, "conversation_id": "other"}
        ).status_code
        == 404
    )
    assert client.post("/api/widgets/dash.pin/actions/add", json={}).status_code == 422
    assert client.post("/api/widgets/dash.pin/actions/delete", json=body).status_code == 422
    assert client.post("/api/widgets/dash.pin/actions/execute", json={}).status_code == 404


async def test_expired_changed_and_undeclared_pins_fail_closed(client):
    draft = propose(client, answer("Saved"))
    get_connection().execute(
        "UPDATE widget_action_drafts SET created_at='2000-01-01T00:00:00+00:00' WHERE id=?",
        (draft,),
    )
    get_connection().commit()
    assert decide(client, draft).status_code == 409
    draft = propose(client, answer("Saved"))
    assert decide(client, draft).json()["state"] == "applied"
    pin_id = (await pins.provide())["items"][0]["id"]
    remove = propose(client, {"id": pin_id}, "delete")
    get_connection().execute(
        "UPDATE dashboard_pins SET tool_calls_json=? WHERE id=?",
        ('[{"name":"run_shell_command"}]', pin_id),
    )
    get_connection().commit()
    assert decide(client, remove).status_code == 409
    with pytest.raises(ValueError, match="Undeclared"):
        await pins.provide()
