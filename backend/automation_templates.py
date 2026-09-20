"""Automation templates: reusable configurations for common automations.

Each template defines a prompt, schedule, and metadata that feed into the
automation creation flow. Templates are not magic -- they are convenience
shortcuts that create a real automation with a real prompt.

The morning briefing is the first fully functional template. Others follow
as the integration ecosystem grows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class AutomationTemplate:
    """A reusable automation configuration."""

    id: str
    name: str
    description: str
    icon: str
    category: str
    prompt: str
    schedule_type: str = "daily_at"
    daily_at_time: str = "07:00"
    #: 0=Mon .. 6=Sun, for `schedule_type == "weekly_at"`. This field was
    #: missing while two templates already passed it, so importing this module
    #: raised TypeError -- which the templates endpoint turned into a 500 and
    #: the interface turned into an empty Templates section, silently, because
    #: the fetch was wrapped in a bare catch.
    weekly_day: int | None = None
    every_minutes: int = 60
    notification: str = "app"
    #: Tool names the template grants the automation it creates. Only ones the
    #: machine really has: a template that grants a tool nobody implemented is
    #: a card promising something that will record `blocked` at 7am.
    actions: list[str] = field(default_factory=list)
    #: What has to be connected before this can work, by connector id. The card
    #: says so, and the editor says so again next to the grant.
    required_integrations: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "category": self.category,
            "prompt": self.prompt,
            "schedule_type": self.schedule_type,
            "daily_at_time": self.daily_at_time,
            "weekly_day": self.weekly_day,
            "every_minutes": self.every_minutes,
            "notification": self.notification,
            "actions": self.actions,
            "required_integrations": self.required_integrations,
            "tags": self.tags,
        }


TEMPLATES: list[AutomationTemplate] = [
    AutomationTemplate(
        id="morning_briefing",
        name="Morning Brief",
        description="Top world, business, and tech headlines with one-line summaries, market moves, and weather.",
        icon="sun",
        category="news",
        prompt=(
            "Put together my morning brief: the top world, business, and tech "
            "headlines from the last 24 hours with one-line summaries, any major "
            "overnight market moves, and today's weather for my location. End with "
            "one story worth reading in depth and why. Keep the whole thing scannable."
        ),
        schedule_type="daily_at",
        daily_at_time="07:30",
        notification="email+app",
        # Nothing granted: searching the web and reading the calendar are
        # read-only, and the email is delivered by the engine from the
        # notification setting rather than by a tool call.
        tags=["email", "web"],
    ),
    AutomationTemplate(
        id="email_digest",
        name="Email Auto-Responder",
        description="Draft concise replies for important email threads each morning.",
        icon="envelope",
        category="productivity",
        prompt=(
            "Search my mail for unread messages from the last day with"
            " search_email. Read the ones that look like they need an answer"
            " with read_email. For each, save a concise, helpful reply as a"
            " draft with draft_email -- do not send anything. Finish with a"
            " list of who you drafted to and what you said, so I can review the"
            " drafts in Gmail."
        ),
        schedule_type="daily_at",
        daily_at_time="08:00",
        notification="app",
        # Drafting, deliberately, not sending: a model answering strangers on a
        # schedule is a different decision from one writing answers down for
        # somebody to read first. Swap draft_email for reply_email in the
        # editor if that is what you want, and it will say so on the card.
        actions=["search_email", "read_email", "draft_email"],
        required_integrations=["gmail"],
        tags=["email"],
    ),
    AutomationTemplate(
        id="daily_stock_tracker",
        name="Daily Stock Tracker",
        description="Prices, sentiment, and catalysts for your watchlist every day.",
        icon="chart-line-up",
        category="finance",
        prompt=(
            "Research current stock prices and market sentiment for major indices "
            "(S&P 500, NASDAQ, Dow) and top tech stocks (AAPL, MSFT, GOOGL, NVDA, "
            "META, AMZN, TSLA). Include any significant after-hours moves, notable "
            "pre-market activity, and key catalysts driving today's market."
        ),
        schedule_type="daily_at",
        daily_at_time="14:00",
        notification="app",
    ),
    AutomationTemplate(
        id="weekly_review",
        name="Weekly Review",
        description="Wrap the week: what you did, loose ends, and next priorities.",
        icon="calendar-check",
        category="productivity",
        prompt=(
            "Do my weekly review. Read what I completed and what is still open"
            " with list_upcoming, and this week's calendar with list_calendar."
            " Summarise the themes, name the loose ends, and suggest three to"
            " five priorities for next week. Keep it honest and concise."
        ),
        schedule_type="weekly_at",
        daily_at_time="16:00",
        weekly_day=4,  # Friday
        notification="app",
    ),
    AutomationTemplate(
        id="ai_news_digest",
        name="AI News Digest",
        description="Model releases, research, and funding that actually matter.",
        icon="cpu",
        category="news",
        prompt=(
            "Research the latest AI news from the past 24 hours. Cover model "
            "releases, research papers, funding rounds, and regulatory developments. "
            "Focus on what matters practically -- skip the hype, highlight the "
            "signals. Format as a scannable digest."
        ),
        schedule_type="daily_at",
        daily_at_time="08:00",
        notification="app",
    ),
    AutomationTemplate(
        id="x_trends_digest",
        name="X Trends Digest",
        description="The five most interesting conversations on X right now.",
        icon="trend-up",
        category="news",
        prompt=(
            "Research what's trending on X (formerly Twitter) right now. Find the "
            "5 most interesting or significant conversations happening. For each, "
            "explain what it's about, why it matters, and who's involved. "
            "Skip celebrity gossip unless it has broader implications."
        ),
        schedule_type="daily_at",
        daily_at_time="12:00",
        notification="app",
    ),
    AutomationTemplate(
        id="competitor_watch",
        name="Competitor Watch",
        description="Weekly digest of competitor launches, pricing, and hires.",
        icon="binoculars",
        category="research",
        prompt=(
            "Research recent competitor activity in the AI/automation space. "
            "Cover new product launches, pricing changes, notable hires, and "
            "funding announcements. Focus on companies building personal AI "
            "assistants, automation platforms, and productivity tools. "
            "Format as a competitive intelligence brief."
        ),
        schedule_type="weekly_at",
        daily_at_time="09:00",
        weekly_day=0,  # Monday
        notification="app",
    ),
    AutomationTemplate(
        id="task_extractor",
        name="Task Extractor",
        description="Extract action items from recent messages and summarize next steps.",
        icon="list-checks",
        category="productivity",
        prompt=(
            "Search my recent conversations for action items and follow-ups that"
            " were mentioned and never written down. Check list_upcoming first so"
            " you do not duplicate a task I already have. Create the ones that are"
            " genuinely missing with create_tasks, then list what you added and"
            " what you skipped as already present."
        ),
        schedule_type="daily_at",
        daily_at_time="09:00",
        notification="app",
        actions=["create_task", "create_tasks"],
        tags=["tasks"],
    ),
    AutomationTemplate(
        id="daily_planner",
        name="Daily Planner",
        description="A realistic plan for today with focus blocks and quick wins.",
        icon="clock",
        category="productivity",
        prompt=(
            "Read today's calendar with list_calendar and my open tasks with"
            " list_upcoming, then write a realistic plan for the day. Suggest"
            " focus blocks around the meetings that are actually there, identify"
            " quick wins I can clear early, and flag anything due today. Be"
            " honest about what fits in one day."
        ),
        schedule_type="daily_at",
        daily_at_time="07:00",
        notification="app",
    ),
    AutomationTemplate(
        id="daily_summary",
        name="Daily Summary",
        description="What happened today, what's pending, and what's tomorrow.",
        icon="notebook",
        category="productivity",
        prompt=(
            "Summarise today: what I finished, what is still open (list_upcoming),"
            " and what tomorrow looks like (list_calendar). Keep it brief."
        ),
        schedule_type="daily_at",
        daily_at_time="18:00",
        notification="app",
    ),
]

# Index by ID for fast lookup
_TEMPLATE_BY_ID: dict[str, AutomationTemplate] = {t.id: t for t in TEMPLATES}
_CATEGORY_ORDER = ["all", "news", "productivity", "finance", "research", "lifestyle"]


def list_templates(category: str | None = None) -> list[AutomationTemplate]:
    """Return all templates, optionally filtered by category."""
    if category and category != "all":
        return [t for t in TEMPLATES if t.category == category]
    return list(TEMPLATES)


def get_template(template_id: str) -> AutomationTemplate | None:
    """Get a template by ID."""
    return _TEMPLATE_BY_ID.get(template_id)


def categories() -> list[str]:
    """Return the list of categories in display order."""
    return list(_CATEGORY_ORDER)
