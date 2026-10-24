"""The agent and the dashboard share one local tracking store."""

import json

from pydantic import ValidationError

from backend.today import TodayItem, items, patch_item, save_item
from backend.tools.base import RiskLevel, Tool, ToolResult


async def list_today_items(args, ctx):
    return ToolResult.ok(json.dumps(items()))


async def track_today_item(args, ctx):
    try:
        return ToolResult.ok(json.dumps(save_item(TodayItem.model_validate(args))))
    except (ValidationError, ValueError) as exc:
        return ToolResult.error(str(exc))


async def update_today_item(args, ctx):
    try:
        return ToolResult.ok(json.dumps(patch_item(args["id"], args["patch"])))
    except (KeyError, ValidationError, ValueError) as exc:
        return ToolResult.error(str(exc))


def tools():
    return [
        Tool(
            name="list_today_items",
            description=(
                "Read local Today priorities, waiting threads, project "
                "backlog, and video recommendations. Check before creating "
                "duplicates."
            ),
            parameters={"type": "object", "properties": {}},
            handler=list_today_items,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="track_today_item",
            description=(
                "Keep an item on the user's Today dashboard: a priority "
                "email (e.g. GitHub support), "
                "a message or group summary, a project, or a video recommendation. "
                "Read actual source data through connected tools first. "
                "Include a source link and stable external_id. "
                "For recommendations, explain the real viewing or saved-item evidence in summary. "
                "Never infer needs_reply from unread alone. Use state "
                "waiting for their reply, needs_reply for ours, "
                "backlog for projects. Dates must have a timezone. This "
                "saves locally. Native Gmail threads refresh while Today is open; other sources "
                "are not monitored. A later source refresh must "
                "explicitly update changed state; omitted triage fields "
                "are preserved."
            ),
            parameters=TodayItem.model_json_schema(),
            handler=track_today_item,
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="update_today_item",
            description=(
                "Update a tracked Today item's priority, summary, "
                "follow_up_at, snoozed_until, or state (needs_reply, "
                "waiting, backlog, done). Local only; does not send "
                "messages."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {
                        "type": "object",
                        "properties": TodayItem.model_json_schema()["properties"],
                        "additionalProperties": False,
                    },
                },
                "required": ["id", "patch"],
            },
            handler=update_today_item,
            risk=RiskLevel.MEDIUM,
        ),
    ]
