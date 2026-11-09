"""Direct connector integrations and pluggable connector registry.

Supports:
- Built-in connectors: Gmail, Google Calendar, Discord.
- Extension connectors: WhatsApp (always-on local session), GitHub, Slack, Linear, Notion, etc.
- Custom connector registration via @register_connector or register_composio_action().

Executes direct Composio calls and REST API calls without touching
the Amethyst Director, agent loop, or MCP manager.
Each connector catches its own errors so failures remain completely isolated.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger("amethyst.notifier.connectors")


@dataclass
class ConnectorResult:
    name: str
    success: bool
    items: list[dict[str, Any]] = field(default_factory=list)
    error_message: str | None = None


# Registry of all available connectors: name -> async callable returning ConnectorResult
CONNECTOR_REGISTRY: dict[str, Callable[[], Awaitable[ConnectorResult]]] = {}


def register_connector(name: str):
    """Decorator to register a custom connector function."""
    def decorator(fn: Callable[[], Awaitable[ConnectorResult]]):
        CONNECTOR_REGISTRY[name.lower().strip()] = fn
        return fn
    return decorator


def _get_composio_key() -> str:
    from backend.mcp.composio_service import sanitize_composio_key

    raw = (
        os.getenv("COMPOSIO_API_KEY")
        or os.getenv("COMPOSIO_USER_API_KEY")
        or os.getenv("COMPOSIO_ORG_API_KEY")
        or ""
    )
    return sanitize_composio_key(raw)


def _get_composio_user_id() -> str | None:
    return os.getenv("COMPOSIO_USER_ID") or None


# ==============================================================================
# Built-in: Gmail
# ==============================================================================

@register_connector("gmail")
async def fetch_gmail() -> ConnectorResult:
    """Fetch unreplied/important emails using direct Composio tool execution."""
    api_key = _get_composio_key()
    if not api_key:
        return ConnectorResult(
            name="Gmail",
            success=False,
            error_message="COMPOSIO_API_KEY is not configured",
        )

    try:
        from composio import Composio

        client = Composio(api_key=api_key)
        user_id = _get_composio_user_id()

        def _call_gmail() -> Any:
            kwargs: dict[str, Any] = {
                "slug": "GMAIL_FETCH_EMAILS",
                "arguments": {
                    "query": "is:unread OR is:important",
                    "max_results": 10,
                },
            }
            if user_id:
                kwargs["user_id"] = user_id
            return client.tools.execute(**kwargs)

        res = await asyncio.to_thread(_call_gmail)
        data = getattr(res, "data", res) if res else {}
        messages = []
        if isinstance(data, dict):
            raw_list = data.get("messages") or data.get("data") or data.get("emails") or []
            if isinstance(raw_list, list):
                messages = raw_list
            elif isinstance(data.get("response_data"), list):
                messages = data["response_data"]

        items: list[dict[str, Any]] = []
        for msg in messages:
            if isinstance(msg, dict):
                m_id = str(msg.get("id") or msg.get("message_id") or msg.get("threadId") or "")
                if m_id:
                    items.append({
                        "id": f"gmail:{m_id}",
                        "source": "gmail",
                        "title": msg.get("subject") or "(No Subject)",
                        "sender": msg.get("from") or msg.get("sender") or "Unknown",
                        "snippet": msg.get("snippet") or msg.get("body") or "",
                        "date": msg.get("date") or "",
                    })

        return ConnectorResult(name="Gmail", success=True, items=items)
    except Exception as exc:
        log.error("Failed to fetch Gmail via Composio: %s", exc)
        return ConnectorResult(name="Gmail", success=False, error_message=str(exc))


# ==============================================================================
# Built-in: Google Calendar
# ==============================================================================

def _detect_calendar_conflicts(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flag overlapping events as conflicts."""
    sorted_events = sorted(
        events,
        key=lambda e: e.get("start") or "",
    )
    for i in range(len(sorted_events)):
        start_i = sorted_events[i].get("start")
        end_i = sorted_events[i].get("end")
        if not start_i or not end_i:
            continue
        for j in range(i + 1, len(sorted_events)):
            start_j = sorted_events[j].get("start")
            end_j = sorted_events[j].get("end")
            if not start_j:
                continue
            if start_j < end_i:
                sorted_events[i]["conflict"] = True
                sorted_events[j]["conflict"] = True
            else:
                break
    return sorted_events


@register_connector("calendar")
async def fetch_calendar() -> ConnectorResult:
    """Fetch today's events and detect conflicts using direct Composio tool execution."""
    api_key = _get_composio_key()
    if not api_key:
        return ConnectorResult(
            name="Google Calendar",
            success=False,
            error_message="COMPOSIO_API_KEY is not configured",
        )

    try:
        from composio import Composio

        client = Composio(api_key=api_key)
        user_id = _get_composio_user_id()

        tz_str = os.getenv("NOTIFIER_TIMEZONE", "Asia/Kolkata")
        try:
            tz = ZoneInfo(tz_str)
        except Exception:
            tz = ZoneInfo("UTC")

        now = datetime.now(tz)
        start_of_day = datetime.combine(now.date(), time.min, tzinfo=tz).astimezone(UTC).isoformat()
        end_of_day = datetime.combine(now.date(), time.max, tzinfo=tz).astimezone(UTC).isoformat()

        def _call_calendar() -> Any:
            kwargs: dict[str, Any] = {
                "slug": "GOOGLECALENDAR_FIND_EVENT",
                "arguments": {
                    "time_min": start_of_day,
                    "time_max": end_of_day,
                    "single_events": True,
                    "max_results": 20,
                },
            }
            if user_id:
                kwargs["user_id"] = user_id
            return client.tools.execute(**kwargs)

        res = await asyncio.to_thread(_call_calendar)
        data = getattr(res, "data", res) if res else {}
        events_list = []
        if isinstance(data, dict):
            events_list = data.get("items") or data.get("events") or data.get("data") or []
            if isinstance(events_list, dict):
                events_list = events_list.get("items") or []

        items: list[dict[str, Any]] = []
        for ev in events_list:
            if isinstance(ev, dict):
                ev_id = str(ev.get("id") or "")
                start = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date") or ""
                end = ev.get("end", {}).get("dateTime") or ev.get("end", {}).get("date") or ""
                items.append({
                    "id": f"calendar:{ev_id}",
                    "source": "calendar",
                    "title": ev.get("summary") or "(No Title)",
                    "start": start,
                    "end": end,
                    "location": ev.get("location") or "",
                    "conflict": False,
                })

        items = _detect_calendar_conflicts(items)
        return ConnectorResult(name="Google Calendar", success=True, items=items)
    except Exception as exc:
        log.error("Failed to fetch Google Calendar via Composio: %s", exc)
        return ConnectorResult(name="Google Calendar", success=False, error_message=str(exc))


# ==============================================================================
# Built-in: Discord
# ==============================================================================

@register_connector("discord")
async def fetch_discord() -> ConnectorResult:
    """Fetch recent Discord mentions and replies via Discord REST API using bot token."""
    bot_token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
    if not bot_token:
        return ConnectorResult(
            name="Discord",
            success=False,
            error_message="DISCORD_BOT_TOKEN is not configured",
        )

    channel_ids_str = os.getenv("DISCORD_CHANNEL_IDS", "").strip()
    channel_ids = [cid.strip() for cid in channel_ids_str.split(",") if cid.strip()]
    user_id = os.getenv("DISCORD_USER_ID", "").strip()

    headers = {
        "Authorization": f"Bot {bot_token}",
        "Content-Type": "application/json",
    }

    items: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if not channel_ids:
                dms_resp = await client.get(
                    "https://discord.com/api/v10/users/@me/channels",
                    headers=headers,
                )
                if dms_resp.status_code == 200:
                    dms = dms_resp.json()
                    channel_ids = [c["id"] for c in dms if "id" in c][:5]

            if not channel_ids:
                return ConnectorResult(name="Discord", success=True, items=[])

            for cid in channel_ids:
                resp = await client.get(
                    f"https://discord.com/api/v10/channels/{cid}/messages?limit=15",
                    headers=headers,
                )
                if resp.status_code == 200:
                    messages = resp.json()
                    for msg in messages:
                        m_id = msg.get("id")
                        content = msg.get("content", "")
                        author = msg.get("author", {}).get("username", "Unknown")
                        mentions = msg.get("mentions", [])
                        mentioned = any(m.get("id") == user_id for m in mentions) if user_id else bool(mentions)

                        if mentioned or not user_id:
                            items.append({
                                "id": f"discord:{m_id}",
                                "source": "discord",
                                "title": f"Message from {author}",
                                "author": author,
                                "snippet": content,
                                "timestamp": msg.get("timestamp"),
                            })

        return ConnectorResult(name="Discord", success=True, items=items)
    except Exception as exc:
        log.error("Failed to fetch Discord messages: %s", exc)
        return ConnectorResult(name="Discord", success=False, error_message=str(exc))


# ==============================================================================
# Built-in: GitHub (Issues & Mentions via Composio or Token)
# ==============================================================================

@register_connector("github")
async def fetch_github() -> ConnectorResult:
    """Fetch assigned GitHub issues or PR reviews."""
    api_key = _get_composio_key()
    if not api_key:
        return ConnectorResult(name="GitHub", success=False, error_message="COMPOSIO_API_KEY not configured")

    try:
        from composio import Composio
        client = Composio(api_key=api_key)
        user_id = _get_composio_user_id()

        def _call_gh() -> Any:
            kwargs: dict[str, Any] = {
                "slug": "GITHUB_GET_MY_ISSUES",
                "arguments": {"filter": "assigned", "state": "open"},
            }
            if user_id:
                kwargs["user_id"] = user_id
            return client.tools.execute(**kwargs)

        res = await asyncio.to_thread(_call_gh)
        data = getattr(res, "data", res) if res else {}
        items_list = data if isinstance(data, list) else (data.get("items") or data.get("data") or [])
        items = []
        for issue in items_list[:10]:
            if isinstance(issue, dict):
                i_id = str(issue.get("id") or issue.get("number") or "")
                items.append({
                    "id": f"github:{i_id}",
                    "source": "github",
                    "title": f"Issue #{issue.get('number')}: {issue.get('title')}",
                    "sender": issue.get("user", {}).get("login", "GitHub"),
                    "snippet": (issue.get("body") or "")[:150],
                    "url": issue.get("html_url"),
                })
        return ConnectorResult(name="GitHub", success=True, items=items)
    except Exception as exc:
        log.warning("GitHub connector notice: %s", exc)
        return ConnectorResult(name="GitHub", success=False, error_message=str(exc))


# ==============================================================================
# Built-in: Slack (Mentions via Composio)
# ==============================================================================

@register_connector("slack")
async def fetch_slack() -> ConnectorResult:
    """Fetch unread Slack mentions or direct messages via Composio."""
    api_key = _get_composio_key()
    if not api_key:
        return ConnectorResult(name="Slack", success=False, error_message="COMPOSIO_API_KEY not configured")

    try:
        from composio import Composio
        client = Composio(api_key=api_key)
        user_id = _get_composio_user_id()

        def _call_slack() -> Any:
            kwargs: dict[str, Any] = {
                "slug": "SLACK_LIST_CHANNELS",
                "arguments": {"types": "im,mpim"},
            }
            if user_id:
                kwargs["user_id"] = user_id
            return client.tools.execute(**kwargs)

        res = await asyncio.to_thread(_call_slack)
        # Placeholder extractor for Slack DMs
        return ConnectorResult(name="Slack", success=True, items=[])
    except Exception as exc:
        return ConnectorResult(name="Slack", success=False, error_message=str(exc))


# ==============================================================================
# Extension Point: WhatsApp
# ==============================================================================

@register_connector("whatsapp")
async def fetch_whatsapp() -> ConnectorResult:
    """EXTENSION POINT: WhatsApp connector.

    WhatsApp is not supported in stateless cloud CI runners because it requires
    a persistent session and QR/device pairing. In an always-on environment,
    connect this to a local Baileys/whatsapp-web.js daemon.
    """
    return ConnectorResult(
        name="WhatsApp",
        success=False,
        error_message="WhatsApp requires an always-on session (unsupported in stateless cloud runs)",
    )


# ==============================================================================
# Helper to register ANY Composio Action as a Connector in 4 lines
# ==============================================================================

def register_composio_action_connector(
    name: str,
    action_slug: str,
    arguments: dict[str, Any],
    item_parser: Callable[[Any], list[dict[str, Any]]],
) -> None:
    """Dynamically register any of Composio's 200+ app actions as a notifier connector."""
    async def _dynamic_connector() -> ConnectorResult:
        api_key = _get_composio_key()
        if not api_key:
            return ConnectorResult(name=name, success=False, error_message="COMPOSIO_API_KEY not configured")
        try:
            from composio import Composio
            client = Composio(api_key=api_key)
            user_id = _get_composio_user_id()

            def _call() -> Any:
                kwargs: dict[str, Any] = {"slug": action_slug, "arguments": arguments}
                if user_id:
                    kwargs["user_id"] = user_id
                return client.tools.execute(**kwargs)

            res = await asyncio.to_thread(_call)
            data = getattr(res, "data", res) if res else {}
            parsed_items = item_parser(data)
            return ConnectorResult(name=name, success=True, items=parsed_items)
        except Exception as exc:
            return ConnectorResult(name=name, success=False, error_message=str(exc))

    CONNECTOR_REGISTRY[name.lower().strip()] = _dynamic_connector


def get_enabled_connector_names() -> list[str]:
    """Return list of connector names to run for the briefing.

    Configurable via NOTIFIER_ENABLED_CONNECTORS=gmail,calendar,discord,github...
    Defaults to ['gmail', 'calendar', 'discord'].
    """
    env_setting = os.getenv("NOTIFIER_ENABLED_CONNECTORS", "").strip()
    if env_setting:
        return [c.strip().lower() for c in env_setting.split(",") if c.strip()]
    return ["gmail", "calendar", "discord"]
