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


def planning_manifest(widget_id, title):
    value = agenda_manifest()
    value.update(id=widget_id, title=title, tier="v2", empty="No items.")
    value["source"] = [{"type": "local"}, {"type": "composio", "toolkit": "googlecalendar"}]
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


def github_manifest(widget_id, title, empty):
    value = developer_manifest(widget_id, title)
    value.update(
        source={"type": "composio", "toolkit": "github"},
        refresh={"mode": "poll", "interval_s": 900},
        requires=["connector:github"],
        empty=empty,
    )
    return value


def director_manifest(widget_id, title, actions=()):
    value = manifest(widget_id, title, ["m", "l"])
    value.update(
        group="needs-you" if widget_id.startswith("need.") else "agent",
        source={"type": "director"},
        refresh={"mode": "poll", "interval_s": 10},
        empty="No activity.",
        actions=[dict(id=a, label=a.title(), gate=True) for a in actions],
    )
    return value


def system_manifest(widget_id, title, source="local"):
    value = manifest(widget_id, title, ["s", "m", "l"])
    value.update(group="system", source={"type": source}, empty="No notifications.")
    if widget_id == "sys.connectors":
        value.update(
            source={"type": "composio"},
            refresh={"mode": "poll", "interval_s": 10},
            empty="No connectors enabled.",
        )
    if widget_id == "sys.model":
        value["actions"] = [dict(id="switch", label="Switch model", gate=True)]
    return value


def mail_manifest(widget_id, title):
    value = need_manifest(widget_id, title)
    value.update(
        source=[{"type": "composio", "toolkit": "gmail"}, {"type": "llm"}],
        refresh={"mode": "poll", "interval_s": 900},
        requires=["connector:gmail"],
        empty="No mail needs a reply.",
    )
    if widget_id == "comm.templates":
        value.update(
            group="communication",
            source={"type": "local"},
            requires=[],
            empty="No draft templates. Create one here.",
            actions=[
                dict(id=a, label=a.title(), gate=True) for a in ("add", "edit", "delete", "use")
            ],
        )
    if widget_id == "comm.tone":
        value.update(
            group="communication",
            source=[{"type": "local"}, {"type": "llm"}],
            requires=[],
            empty="Save a local mail draft to rewrite its tone.",
            actions=[dict(id="rewrite", label="Rewrite", gate=True)],
        )
    if widget_id == "comm.unread":
        value.update(
            group="communication",
            source={"type": "composio", "toolkit": "gmail"},
            empty="No unread mail.",
        )
    if widget_id == "need.waiting":
        value.update(
            empty="No unanswered mail or manual items.",
            actions=[dict(id=a, label=a.title(), gate=True) for a in ("add", "complete", "nudge")],
        )
    if widget_id == "need.drafts":
        value.update(
            source={"type": "local"},
            requires=[],
            empty="No drafts waiting.",
            actions=[dict(id=a, label=a.title(), gate=True) for a in ("add", "edit", "approve")],
        )
    return value


MANIFESTS = [
    manifest("glance.clock", "Clock", ["s", "m", "l"]),
    {
        **manifest("feed.news", "News by topic", ["m", "l"]),
        "group": "feed",
        "source": {"type": "rss"},
        "refresh": {"mode": "poll", "interval_s": 1800},
        "empty": "No feed items. Add and tag feeds in the RSS reader.",
    },
    {
        **manifest("feed.rss", "RSS reader", ["m", "l"]),
        "group": "feed",
        "source": {"type": "rss"},
        "refresh": {"mode": "poll", "interval_s": 1800},
        "actions": [dict(id=a, label=a.title(), gate=True) for a in ("add", "edit", "delete")],
        "empty": "Add a feed. No default feeds are installed.",
    },
    {
        **manifest("glance.music", "Now playing and last played", ["m", "l"]),
        "source": {"type": "composio", "toolkit": "spotify"},
        "requires": ["connector:spotify"],
        "refresh": {"mode": "poll", "interval_s": 60},
        "empty": "Nothing playing or recently played.",
    },
    {
        **manifest("glance.air", "Air quality", ["s", "m", "l"]),
        "source": {"type": "api"},
        "refresh": {"mode": "poll", "interval_s": 3600},
        "empty": "Set location.",
    },
    {
        **manifest("glance.sun", "Sunrise and sunset", ["s", "m", "l"]),
        "source": {"type": "api"},
        "refresh": {"mode": "poll", "interval_s": 3600},
        "empty": "Set location.",
    },
    {
        **manifest("glance.weather", "Weather", ["m", "l"]),
        "source": {"type": "api"},
        "refresh": {"mode": "poll", "interval_s": 1800},
        "empty": "Set location.",
    },
    {
        **need_manifest("need.mentions", "Unanswered mentions"),
        "source": [{"type": "composio", "toolkit": tk} for tk in ("slack", "github")],
        "refresh": {"mode": "poll", "interval_s": 900},
        "empty": "No unanswered mentions.",
    },
    mail_manifest("need.inbox", "Priority inbox"),
    mail_manifest("need.drafts", "Mail drafts to approve"),
    mail_manifest("need.waiting", "Waiting on replies"),
    {
        **manifest("need.lor-slack", "Unreplied Slack DMs", ["m", "l"]),
        "group": "needs-you",
        "tier": "v2",
        "source": [{"type": "composio", "toolkit": "slack"}],
        "refresh": {"mode": "poll", "interval_s": 900},
        "requires": [],
        "empty": "No matching items.",
    },
    {
        **manifest("comm.thread-summary", "Long-thread summaries", ["m", "l"]),
        "group": "communication",
        "tier": "v2",
        "source": [
            {"type": "composio", "toolkit": "gmail"},
            {"type": "composio", "toolkit": "slack"},
            {"type": "llm"},
        ],
        "refresh": {"mode": "poll", "interval_s": 900},
        "requires": [],
        "empty": "No matching items.",
    },
    {
        **manifest("comm.newsletters", "Newsletter digest", ["m", "l"]),
        "group": "communication",
        "tier": "v2",
        "source": [{"type": "composio", "toolkit": "gmail"}, {"type": "llm"}],
        "refresh": {"mode": "poll", "interval_s": 900},
        "requires": [],
        "empty": "No matching items.",
    },
    {
        **manifest("comm.contacts", "Contact cards", ["m", "l"]),
        "group": "communication",
        "tier": "v2",
        "source": [
            {"type": "local"},
            {"type": "composio", "toolkit": "gmail"},
            {"type": "composio", "toolkit": "slack"},
        ],
        "refresh": {"mode": "poll", "interval_s": 900},
        "requires": [],
        "empty": "No matching items.",
    },
    {
        **manifest("comm.reachout", "Birthdays and reach-out nudges", ["m", "l"]),
        "actions": [dict(id="configure", label="Configure local reminders", gate=True)],
        "group": "communication",
        "tier": "v2",
        "source": [
            {"type": "local"},
            {"type": "composio", "toolkit": "gmail"},
            {"type": "composio", "toolkit": "slack"},
        ],
        "refresh": {"mode": "poll", "interval_s": 900},
        "requires": [],
        "empty": "No matching items.",
    },
    mail_manifest("comm.unread", "Unread by person"),
    mail_manifest("comm.tone", "Reply tone picker"),
    mail_manifest("comm.templates", "Draft templates"),
    system_manifest("sys.connectors", "Connector health and reconnect"),
    system_manifest("sys.model", "Active model", "director"),
    system_manifest("sys.notify", "Notification center"),
    system_manifest("sys.vault", "Vault size and storage", "library"),
    {
        **director_manifest("agent.brief", "Daily brief and evening wrap-up"),
        "source": {"type": "llm"},
        "refresh": {"mode": "poll", "interval_s": 60},
        "empty": "Nothing to report from cached widgets.",
    },
    {
        **director_manifest("agent.next", "One suggested next action"),
        "source": {"type": "llm"},
        "refresh": {"mode": "poll", "interval_s": 900},
        "empty": "No existing action to suggest.",
    },
    director_manifest("agent.running", "Running tasks", ("stop",)),
    director_manifest("agent.feed", "Activity feed"),
    director_manifest("need.decisions", "Decisions waiting", ("answer", "dismiss")),
    director_manifest("need.approvals", "Permission approvals", ("approve", "deny")),
    director_manifest("agent.errors", "Errors and retries"),
    director_manifest("agent.audit", "Tool-call audit log"),
    {**director_manifest("agent.usage", "Model usage meter"), "tier": "v2"},
    {**director_manifest("agent.rules", "Permission rules manager", ("set",)), "tier": "v2"},
    {
        **director_manifest("agent.watchers", "Page and mailbox watchers", ("add", "delete")),
        "tier": "v2",
        "refresh": {"mode": "poll", "interval_s": 900},
    },
    {
        **director_manifest("agent.research", "Background research jobs with results", ("add",)),
        "tier": "v2",
    },
    {**director_manifest("agent.delegated", "Delegated tasks board", ("add",)), "tier": "v2"},
    {
        **director_manifest("agent.jobs", "Scheduled and recurring agent jobs", ("add", "delete")),
        "tier": "v2",
    },
    github_manifest("dev.ci", "CI status", "No GitHub repositories."),
    github_manifest("dev.issues", "Assigned issues", "No assigned open issues."),
    github_manifest("dev.prs", "Pull requests", "No PRs awaiting review or open PRs."),
    developer_manifest("dev.appeal", "Support cases"),
    developer_manifest("dev.recovery", "Recovery checklist"),
    developer_manifest("dev.unpushed", "Unpushed commits and dirty branches", "git"),
    developer_manifest("dev.backup", "Backup status", "git"),
    library_manifest("lib.inbox", "Saved items inbox"),
    library_manifest("lib.resurface", "Resurfaced old notes"),
    library_manifest("lib.capture", "Quick capture"),
    library_manifest("lib.search", "Library search"),
    library_manifest("lib.recent", "Recently edited notes"),
    library_manifest("lib.dupes", "Duplicates found"),
    {
        **library_manifest("lib.ask", "Ask your library"),
        "tier": "v2",
        "source": [{"type": "library"}, {"type": "llm"}],
    },
    {
        **library_manifest("lib.readlater", "Read later"),
        "tier": "v2",
        "actions": [dict(id="add", label="Save URL", gate=True)],
        "source": [{"type": "library"}, {"type": "llm"}],
    },
    {
        **library_manifest("lib.highlights", "Article highlights"),
        "tier": "v2",
        "actions": [dict(id="add", label="Add highlight", gate=True)],
    },
    {
        **library_manifest("lib.daily", "Daily note"),
        "tier": "v2",
        "actions": [dict(id="create", label="Create today's note", gate=True)],
    },
    need_manifest("need.overdue", "Overdue items"),
    need_manifest("need.snoozed", "Snoozed items returning today"),
    {
        **planning_manifest("glance.travel", "Travel time to next event"),
        "group": "glance",
        "source": [
            {"type": "composio", "toolkit": "googlecalendar"},
            {"type": "composio", "toolkit": "google_maps"},
        ],
    },
    agenda_manifest(),
    planning_manifest("task.plan", "Proposed day plan"),
    planning_manifest("task.free", "Free-slot finder"),
    planning_manifest("task.conflicts", "Calendar conflicts"),
    planning_manifest("task.risk", "Deadline risk"),
    {
        **agenda_manifest(),
        "id": "glance.next-event",
        "title": "Next event",
        "group": "glance",
        "sizes": ["s", "m", "l"],
        "empty": "No upcoming events this week.",
    },
    task_manifest("task.today", "Today list"),
    task_manifest("task.backlog", "Backlog"),
    task_manifest("task.deadlines", "Deadline countdowns"),
    task_manifest("task.reminders", "Reminders"),
    {
        **manifest("dash.palette", "Command palette and global search", ["m", "l"]),
        "source": [{"type": "local"}, {"type": "library"}],
        "refresh": {"mode": "manual"},
    },
    {
        **manifest("dash.pin", "Pinned answers", ["m", "l"]),
        "source": {"type": "director"},
        "actions": [dict(id=a, label=a.title(), gate=True) for a in ("add", "delete")],
        "empty": "Pin a chat answer to Home.",
    },
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
