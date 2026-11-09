"""Per-tool rules using the existing confirmation service, with audited drafts."""

from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection
from backend.tools.base import RiskLevel
from backend.tools.registry import is_write_action


class RuleInput(StrictModel):
    tool: str = Field(min_length=1, max_length=300)
    decision: Literal["allow", "ask", "deny"] = "ask"


async def tools():
    from backend.api.main import _registry_for

    registry, _ = await _registry_for(None, reuse_any=True)
    return {tool.name: tool for tool in registry.list()}


def can_allow(tool):
    return tool.risk is RiskLevel.LOW and not is_write_action(tool.name, tool)


async def draft(action, body):
    if action != "set":
        raise HTTPException(404, "Unknown rule action")
    tool = (await tools()).get(body.tool)
    if tool is None:
        raise HTTPException(422, "Choose an available tool")
    if body.decision == "allow" and not can_allow(tool):
        raise HTTPException(422, "Write tools cannot be set to always allow")
    row = (
        get_connection()
        .execute("SELECT * FROM dashboard_permission_rules WHERE tool_name=?", (body.tool,))
        .fetchone()
    )
    return save_draft(
        "agent.rules",
        action,
        body,
        {
            **body.model_dump(),
            "expected": dict(row) if row else None,
            "can_allow": can_allow(tool),
        },
    )


def apply(conn, action, body):
    if action != "set":
        raise HTTPException(404, "Unknown rule action")
    rule = RuleInput.model_validate({k: body[k] for k in ("tool", "decision")})
    if rule.decision == "allow" and not body["can_allow"]:
        raise HTTPException(422, "Write tools cannot be set to always allow")
    row = conn.execute(
        "SELECT * FROM dashboard_permission_rules WHERE tool_name=?", (rule.tool,)
    ).fetchone()
    if (dict(row) if row else None) != body["expected"]:
        raise HTTPException(409, "Rule changed; review a new draft")
    conn.execute(
        "INSERT INTO dashboard_permission_rules(tool_name,decision) VALUES(?,?) "
        "ON CONFLICT(tool_name) DO UPDATE SET decision=excluded.decision",
        (rule.tool, rule.decision),
    )
    conn.execute("DELETE FROM widget_cache WHERE widget_id='agent.rules'")


async def provide():
    inventory = await tools()
    rules = {
        r["tool_name"]: r["decision"]
        for r in get_connection().execute("SELECT * FROM dashboard_permission_rules")
    }
    return {
        "items": [
            {
                "id": name,
                "title": name,
                "decision": rules.get(name, "ask"),
                "can_allow": name in inventory and can_allow(inventory[name]),
            }
            for name in sorted(set(inventory) | set(rules))
        ]
    }
