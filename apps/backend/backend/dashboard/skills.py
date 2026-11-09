"""Installed skill visibility uses the Director's existing capability state."""

from fastapi import HTTPException
from pydantic import Field

from backend.capabilities import GLOBAL_SCOPE, CapabilityService
from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.dashboard.rules import tools
from backend.db.connection import get_connection
from backend.skills.loader import scan


class SkillInput(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    enabled: bool


def current(conn, name):
    row = conn.execute(
        "SELECT * FROM capability_state WHERE scope=? AND kind='skill' AND name=?",
        (GLOBAL_SCOPE, name),
    ).fetchone()
    return dict(row) if row else None


def draft(action, body):
    if action != "toggle":
        raise HTTPException(404, "Unknown skill action")
    found, _ = scan()
    if body.name not in {skill.name for skill in found}:
        raise HTTPException(404, "Skill is not installed")
    return save_draft(
        "agent.skills",
        action,
        body,
        {
            **body.model_dump(),
            "expected": current(get_connection(), body.name),
        },
    )


def apply(conn, action, body):
    if action != "toggle":
        raise HTTPException(404, "Unknown skill action")
    found, _ = scan()
    if body["name"] not in {skill.name for skill in found}:
        raise HTTPException(409, "Skill is no longer installed")
    if current(conn, body["name"]) != body["expected"]:
        raise HTTPException(409, "Skill changed; review a new draft")
    conn.execute(
        "INSERT INTO capability_state(scope,kind,name,enabled) VALUES(?,'skill',?,?) "
        "ON CONFLICT(scope,kind,name) DO UPDATE SET "
        "enabled=excluded.enabled,updated_at=datetime('now')",
        (GLOBAL_SCOPE, body["name"], int(body["enabled"])),
    )
    conn.execute("DELETE FROM widget_cache WHERE widget_id='agent.skills'")


async def provide():
    inventory = sorted(await tools())
    service = CapabilityService()
    return {
        "items": [
            {
                "id": item.name,
                "title": item.name,
                "enabled": item.enabled,
                "detail": item.description,
                "tools": inventory,
            }
            for item in service.skills()
        ],
        "tool_note": ("Skills are prompt text. They share the tools available to the Director; "
                      "every tool keeps its permission gate."),
    }
