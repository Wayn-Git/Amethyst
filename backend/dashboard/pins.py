"""Reviewed, offline chat pins. Persist declarations, never connector sessions."""

import json
import re
from html import escape

from fastapi import HTTPException
from pydantic import Field

from backend.agent.widgets import SandboxedUi, parse_envelope
from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.dashboard.store import layout_read, stamp
from backend.db.connection import get_connection
from backend.secrets import redact
from backend.tools.base import ToolContext
from backend.tools.builtin.generative_ui import generate_sandboxed_ui


class PinInput(StrictModel):
    id: int | None = Field(default=None, gt=0)
    conversation_id: str | None = Field(default=None, min_length=1, max_length=100)
    message_id: int | None = Field(default=None, gt=0)


def draft(action, body):
    if action not in ("add", "delete"):
        raise HTTPException(404, "Unknown pin action")
    if action == "delete":
        if body.id is None or body.conversation_id or body.message_id:
            raise HTTPException(422, "Specify only the pin id")
        row = (
            get_connection()
            .execute("SELECT id,tool_calls_json FROM dashboard_pins WHERE id=?", (body.id,))
            .fetchone()
        )
        if row is None:
            raise HTTPException(404, "Pin not found")
        payload = {"id": body.id, "expected": dict(row)}
    else:
        if body.id or not body.conversation_id or not body.message_id:
            raise HTTPException(422, "Specify a conversation and saved answer")
        row = (
            get_connection()
            .execute(
                "SELECT content FROM messages "
                "WHERE id=? AND conversation_id=? AND role='assistant'",
                (body.message_id, body.conversation_id),
            )
            .fetchone()
        )
        if row is None or not row["content"]:
            raise HTTPException(404, "Saved answer not found")
        text = redact(row["content"])
        # Only the renderer declaration is replayable; conversation tool calls may contain auth.
        envelopes = [
            parse_envelope(match[0])
            for match in re.finditer(r"```amethyst:widget\s*\n.*?```", text, re.DOTALL)
        ]
        generated = next((e for e in envelopes if e and e["type"] == "sandboxed_ui"), None)
        if generated:
            arguments = SandboxedUi.model_validate(generated["data"]).model_dump()
        else:
            arguments = SandboxedUi(
                title="Chat answer",
                html=f"<pre>{escape(text)}</pre>",
                css="pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }",
            ).model_dump()
        # Pins are inert snapshots: arbitrary generated JS can navigate even under connect-src none.
        arguments.update(js="", scripts=[])
        arguments = redact(arguments)
        if len(json.dumps(arguments)) > 200_000:
            raise HTTPException(422, "Answer is too large to pin")
        payload = {"tool_calls": [{"name": "generate_sandboxed_ui", "arguments": arguments}]}
    return save_draft("dash.pin", action, body, payload)


def apply(conn, action, body):
    if action == "add":
        conn.execute(
            "INSERT INTO dashboard_pins(tool_calls_json,created_at) VALUES(?,?)",
            (json.dumps(body["tool_calls"]), stamp()),
        )
        layout = layout_read("default")
        if not any(w["id"] == "dash.pin" for w in layout["widgets"]):
            layout["widgets"].append({"id": "dash.pin", "size": "l", "height": 6})
            conn.execute(
                "INSERT INTO layouts VALUES(?,?,?) ON CONFLICT(mode) DO UPDATE SET "
                "layout_json=excluded.layout_json,updated_at=excluded.updated_at",
                ("default", json.dumps(layout), stamp()),
            )
    elif action == "delete":
        current = conn.execute(
            "SELECT id,tool_calls_json FROM dashboard_pins WHERE id=?", (body["id"],)
        ).fetchone()
        if current is None or dict(current) != body["expected"]:
            raise HTTPException(409, "Pin changed. Review a new draft.")
        conn.execute("DELETE FROM dashboard_pins WHERE id=?", (body["id"],))
    else:
        raise HTTPException(404, "Unknown pin action")
    conn.execute("DELETE FROM widget_cache WHERE widget_id='dash.pin'")


async def provide():
    items = []
    for row in get_connection().execute("SELECT * FROM dashboard_pins ORDER BY id"):
        calls = json.loads(row["tool_calls_json"])
        if len(calls) != 1 or calls[0].get("name") != "generate_sandboxed_ui":
            raise ValueError("Undeclared pin tool")
        args = SandboxedUi.model_validate(calls[0]["arguments"]).model_dump()
        result = await generate_sandboxed_ui(args, ToolContext())
        if result.is_error:
            raise ValueError("Pin could not render")
        envelope = parse_envelope(result.content[result.content.index("```amethyst:widget") :])
        items.append({"id": row["id"], "data": envelope["data"]})
    return {"items": items}
