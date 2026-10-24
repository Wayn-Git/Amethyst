"""Validated manifests; a broken entry is disabled rather than crashing startup."""

import logging

from jsonschema import Draft202012Validator

from backend.dashboard.models import Manifest

log = logging.getLogger(__name__)
MANIFEST_SCHEMA = Manifest.model_json_schema()
# Encode the polling invariant in JSON Schema as well as the Python model.
MANIFEST_SCHEMA["$defs"]["Refresh"]["allOf"] = [
    {
        "if": {"properties": {"mode": {"const": "poll"}}},
        "then": {"required": ["interval_s"], "properties": {"interval_s": {"type": "integer"}}},
    }
]


def manifest(widget_id, title, sizes):
    return dict(
        id=widget_id,
        title=title,
        group="glance" if widget_id.startswith("glance.") else "dashboard",
        tier="mvp",
        sizes=sizes,
        source={"type": "local"},
        refresh={"mode": "poll", "interval_s": 60},
        requires=[],
        actions=[],
        empty="Nothing to show yet.",
    )


def need_manifest(widget_id, title):
    value = manifest(widget_id, title, ["m", "l"])
    value["group"] = "needs-you"
    value["empty"] = "No items."
    return value


def task_manifest(widget_id, title):
    value = manifest(widget_id, title, ["m", "l"])
    value["group"] = "tasks"
    value["actions"] = [
        dict(id=a, label=a.title(), gate=True) for a in ("add", "edit", "complete", "delete")
    ]
    value["empty"] = "No items."
    return value


def library_manifest(widget_id, title):
    value = manifest(widget_id, title, ["m", "l"])
    value.update(group="library", source={"type": "library"}, empty="No saved items.")
    if widget_id == "lib.capture":
        value["actions"] = [dict(id="add", label="Save note", gate=True)]
        value["empty"] = "Capture a note to the vault."
    return value


def agenda_manifest():
    value = manifest("task.agenda", "Agenda and week view", ["m", "l"])
    value.update(
        group="tasks",
        source={"type": "composio", "toolkit": "googlecalendar"},
        refresh={"mode": "poll", "interval_s": 900},
        requires=["connector:googlecalendar"],
        empty="No events this week.",
    )
    return value


def developer_manifest(widget_id, title, source="local"):
    value = manifest(widget_id, title, ["m", "l"])
    value.update(group="developer", source={"type": source}, empty="No items.")
    if widget_id == "dev.recovery":
        value["actions"] = [
            dict(id=a, label=a.title(), gate=True) for a in ("add", "edit", "complete", "delete")
        ]
    if widget_id == "dev.appeal":
        value["source"] = [
            {"type": "local"},
            {"type": "composio", "toolkit": "gmail"},
            {"type": "llm"},
        ]
        value["refresh"] = {"mode": "poll", "interval_s": 900}
        value["actions"] = [
            dict(id=a, label=a.title(), gate=True) for a in ("add", "reply", "follow-up", "unwatch")
        ]
    return value


MANIFESTS = [
    manifest("glance.clock", "Clock", ["s", "m", "l"]),
    developer_manifest("dev.appeal", "Support cases"),
    developer_manifest("dev.recovery", "Recovery checklist"),
    library_manifest("lib.inbox", "Saved items inbox"),
    library_manifest("lib.resurface", "Resurfaced old notes"),
    library_manifest("lib.capture", "Quick capture"),
    library_manifest("lib.search", "Library search"),
    library_manifest("lib.recent", "Recently edited notes"),
    library_manifest("lib.dupes", "Duplicates found"),
    need_manifest("need.overdue", "Overdue items"),
    need_manifest("need.snoozed", "Snoozed items returning today"),
    agenda_manifest(),
    task_manifest("task.today", "Today list"),
    task_manifest("task.backlog", "Backlog"),
    task_manifest("task.deadlines", "Deadline countdowns"),
    task_manifest("task.reminders", "Reminders"),
    manifest("dash.gallery", "Widget gallery", ["m", "l"]),
    manifest("dash.sync", "Refresh status", ["s", "m", "l"]),
    manifest("dash.quiet", "Quiet hours", ["m", "l"]),
    manifest("dash.shortcuts", "Keyboard shortcuts", ["m", "l"]),
]


def validate_registry(entries):
    result = {}
    validator = Draft202012Validator(MANIFEST_SCHEMA)
    for index, raw in enumerate(entries):
        widget_id = (
            raw.get("id", f"invalid-{index}") if isinstance(raw, dict) else f"invalid-{index}"
        )
        if not isinstance(widget_id, str):
            widget_id = f"invalid-{index}"
        try:
            validator.validate(raw)
            parsed = Manifest.model_validate(raw)
            if widget_id in result:
                raise ValueError("Duplicate widget id")
            result[widget_id] = {"manifest": parsed.model_dump(), "enabled": True, "error": None}
        except Exception as exc:
            # Do not expose arbitrary manifest contents in logs or API errors.
            log.error("dashboard manifest disabled: %s (%s)", widget_id, type(exc).__name__)
            result[widget_id] = {
                "manifest": {"id": widget_id, "title": widget_id},
                "enabled": False,
                "error": "Invalid widget manifest",
            }
    return result


REGISTRY = validate_registry(MANIFESTS)
