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
            actions=[dict(id=a, label=a.title(), gate=True) for a in ("add", "edit", "approve", "remove")],
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
        **manifest("glance.music", "Desktop music", ["s", "m", "l"]),
        "refresh": {"mode": "poll", "interval_s": 10},
        "actions": [
            dict(id=a, label=a.title(), gate=True)
            for a in ("play", "pause", "previous", "next")
        ],
        "empty": "Open a desktop music player to start listening.",
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
        **manifest("glance.weather", "Weather", ["s", "m", "l"]),
        "source": {"type": "api"},
        "refresh": {"mode": "poll", "interval_s": 1800},
        "empty": "Set location.",
    },
    {
        **manifest("glance.pc", "This PC", ["s", "m", "l"]),
        "refresh": {"mode": "poll", "interval_s": 10},
        "empty": "Hardware telemetry unavailable.",
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
    {
        **director_manifest("agent.knows", "What Amethyst knows about me", ("edit", "delete")),
        "tier": "v2",
        "source": {"type": "library"},
    },
    {
        **director_manifest("agent.skills", "Skills", ("toggle",)),
        "tier": "v2",
        "source": {"type": "local"},
    },
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
    {
        **library_manifest("lib.collections", "Collections and tags"),
        "tier": "v2",
        "actions": [
            dict(id="add", label="Create collection", gate=True),
            dict(id="tag", label="Tag note", gate=True),
        ],
    },
    need_manifest("need.overdue", "Overdue items"),
    need_manifest("need.snoozed", "Snoozed items returning today"),
    {
        **planning_manifest("glance.travel", "Travel time to next event"),
        "group": "glance",
        "sizes": ["s", "m", "l"],
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
    {
        **task_manifest("task.focus", "Focus timer"),
        "tier": "v2",
        "actions": [dict(id=a, label=a.title(), gate=True) for a in ("configure", "start", "stop")],
    },
    {
        **task_manifest("task.habits", "Habit streaks"),
        "tier": "v2",
        "actions": [dict(id=a, label=a.title(), gate=True) for a in ("add", "checkin")],
    },
    {
        **task_manifest("task.goals", "Goals"),
        "tier": "v2",
        "actions": [dict(id=a, label=a.title(), gate=True) for a in ("add", "progress")],
    },
    {
        **task_manifest("task.kanban", "Mini kanban per project"),
        "tier": "v2",
        "actions": [
            dict(id=a, label=a.title(), gate=True) for a in ("project", "configure", "move")
        ],
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


# Catalog copy describes capabilities, independently of runtime empty states.
CATALOG = {
    'glance.clock': ('Local time and your saved time zones.', 'clock'),
    'feed.news': ('Headlines from your feeds, grouped by topic.', 'globe'),
    'feed.rss': ('Read and manage your RSS subscriptions.', 'list'),
    'glance.music': ('See and control your desktop music player.', 'music'),
    'glance.air': ('Air quality readings for your saved location.', 'wind'),
    'glance.sun': ('Sunrise and sunset times for your location.', 'sun'),
    'glance.weather': ('Current weather and forecast for your location.', 'cloud'),
    'glance.pc': ('Real-time CPU, memory, and disk telemetry for this PC.', 'monitor'),
    'need.mentions': ('Unanswered mentions from Slack and GitHub.', 'chat'),
    'need.inbox': ('Mail that may need your attention or a reply.', 'mail'),
    'need.drafts': ('Review and approve your saved mail drafts.', 'edit'),
    'need.waiting': ('Track messages and items awaiting a reply.', 'memory'),
    'need.lor-slack': ('Slack direct messages still awaiting your reply.', 'chat-dots'),
    'comm.thread-summary': ('Generate summaries of long mail and Slack threads.', 'paperclip'),
    'comm.newsletters': ('Summarize newsletters from your mailbox.', 'envelope'),
    'comm.contacts': ('Browse contacts from mail, Slack and local notes.', 'user'),
    'comm.reachout': ('Track birthdays and reminders to reach out.', 'bell'),
    'comm.unread': ('See unread mail grouped by person.', 'mail-open'),
    'comm.tone': ('Rewrite a saved draft in a chosen tone.', 'type'),
    'comm.templates': ('Create and reuse local mail draft templates.', 'copy'),
    'sys.connectors': ('Check connected sources and reconnect them.', 'connectors'),
    'sys.model': ('View and switch the active language model.', 'cpu'),
    'sys.notify': ('Review dashboard notifications.', 'tray'),
    'sys.vault': ('Check library storage and vault size.', 'database'),
    'agent.brief': ('Generate a daily brief or evening wrap-up.', 'page'),
    'agent.next': ('Review one suggested next action.', 'arrow-right'),
    'agent.running': ('Follow agent tasks currently in progress.', 'play'),
    'agent.feed': ('Review the agent’s recent activity.', 'menu'),
    'need.decisions': ('Review decisions waiting for your input.', 'crosshair'),
    'need.approvals': ('Approve or deny pending agent tool requests.', 'shield-check'),
    'agent.errors': ('Inspect failed agent actions and retry them.', 'minus-circle'),
    'agent.audit': ('Inspect the agent’s recorded tool calls.', 'code'),
    'agent.usage': ('Review recorded model usage.', 'dash'),
    'agent.knows': ('Review the memory Amethyst keeps about you.', 'brain'),
    'agent.skills': ('Browse installed agent skills.', 'skills'),
    'agent.rules': ('Review and manage tool permission rules.', 'shield'),
    'agent.watchers': ('Manage page and mailbox watchers.', 'eye'),
    'agent.research': ('Track background research and open its results.', 'binoculars'),
    'agent.delegated': ('Review tasks delegated to other agents.', 'share'),
    'agent.jobs': ('Manage scheduled and recurring agent jobs.', 'automations'),
    'dev.ci': ('Check CI runs for your connected repositories.', 'check-circle'),
    'dev.issues': ('See GitHub issues assigned to you.', 'warning'),
    'dev.prs': ('Review pull requests from GitHub.', 'branch'),
    'dev.appeal': ('Track support cases and prepare follow-ups.', 'send'),
    'dev.recovery': ('Manage a local account recovery checklist.', 'wrench'),
    'dev.unpushed': ('Find unpushed commits and working-tree changes.', 'upload'),
    'dev.backup': ('Check recorded backup status.', 'archive'),
    'lib.inbox': ('Review items saved to your library inbox.', 'folder'),
    'lib.resurface': ('Revisit older notes from your library.', 'books'),
    'lib.capture': ('Save a quick note to your library.', 'plus'),
    'lib.search': ('Search saved notes and library items.', 'search'),
    'lib.recent': ('Find recently edited library notes.', 'notebook'),
    'lib.dupes': ('Review potential duplicate library items.', 'layers'),
    'lib.ask': ('Ask questions using your saved library material.', 'sparkle'),
    'lib.readlater': ('Browse articles you saved to read later.', 'bookmark'),
    'lib.highlights': ('Revisit highlights from saved articles.', 'quote'),
    'lib.daily': ('Open or create your daily library note.', 'book'),
    'lib.collections': ('Browse library collections and tags.', 'grid'),
    'need.overdue': ('Review tasks and deadlines past their due date.', 'alert-triangle'),
    'need.snoozed': ('See snoozed items returning today.', 'undo'),
    'glance.travel': ('Estimate travel time to your next calendar event.', 'globe-west'),
    'task.agenda': ('Browse your calendar agenda and week.', 'calendar'),
    'task.plan': ('Review a proposed plan for your day.', 'calendar-check'),
    'task.free': ('Find open slots in your calendar.', 'square'),
    'task.conflicts': ('Identify overlapping calendar events.', 'convert'),
    'task.risk': ('Review deadlines that may be at risk.', 'shield-warning'),
    'glance.next-event': ('See the next event on your calendar.', 'arrow-up-right'),
    'task.focus': ('Run a focus timer for your current task.', 'target'),
    'task.habits': ('Record habit check-ins and review streaks.', 'check-square'),
    'task.goals': ('Track progress toward your saved goals.', 'trend-up'),
    'task.kanban': ('Move project tasks between kanban columns.', 'sidebar'),
    'task.today': ('Manage the tasks on your Today list.', 'tasks'),
    'task.backlog': ('Collect tasks to work on later.', 'download'),
    'task.deadlines': ('See countdowns to your saved deadlines.', 'flag'),
    'task.reminders': ('Manage reminders and their due times.', 'info'),
    'dash.palette': ('Search your workspace and capture new items.', 'command'),
    'dash.pin': ('Keep selected chat answers on Home.', 'pin'),
    'dash.gallery': ('Browse widgets and choose what appears on Home.', 'layout'),
    'dash.sync': ('Check freshness and refresh dashboard sources.', 'refresh'),
    'dash.quiet': ('Set quiet hours and pause dashboard refreshes.', 'moon'),
    'dash.shortcuts': ('Look up Home keyboard shortcuts.', 'keyboard'),
}
for entry in MANIFESTS:
    entry["description"], entry["icon"] = CATALOG[entry["id"]]


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
