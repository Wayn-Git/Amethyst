"""Structured, gated Composio reads; only widget projections enter the shared cache."""

import asyncio
import json
import re
import time
from collections import defaultdict
from datetime import datetime

from backend.agent.read_cache import read_cache
from backend.agent.trace import finish_turn_trace, record_tool_dispatch, start_turn_trace
from backend.config import paths
from backend.dashboard.remote import project_mail
from backend.dashboard.store import settings_read, stamp
from backend.db.connection import transaction
from backend.db.repositories import ExecutionLogRepository
from backend.mcp.client import is_auth_failure_text
from backend.mcp.composio_service import composio_service
from backend.mcp.live import connection, get_manager
from backend.mcp.provider_ownership import is_provider_overridden_by_local
from backend.security.confirmation import ConfirmationService
from backend.tools.base import RiskLevel, ToolContext, ToolSource

# Explicit machine-reader capabilities exclude router/proxy tools and nested writes.
READ_TOOLS = {
    "spotify": {"SPOTIFY_GET_CURRENTLY_PLAYING_TRACK", "SPOTIFY_GET_RECENTLY_PLAYED_TRACKS"},
    "googlecalendar": {"GOOGLECALENDAR_FIND_EVENT"},
    "gmail": {"GMAIL_FETCH_EMAILS"},
    "github": {
        "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
        "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
        "GITHUB_GET_THE_AUTHENTICATED_USER",
        "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        "GITHUB_LIST_ISSUE_COMMENTS",
        "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST",
        "GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST",
    },
    "slack": {
        "SLACK_TEST_AUTH",
        "SLACK_SEARCH_MESSAGES",
        "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
    },
}
READ_SCOPES = {
    "spotify": "user-read-currently-playing,user-read-recently-played",
    "gmail": "https://www.googleapis.com/auth/gmail.readonly",
    "googlecalendar": "https://www.googleapis.com/auth/calendar.readonly",
    "github": "read:user,read:org",
    "gitlab": "read_api,read_user,read_repository",
    "linear": "read",
    "slack": (
        "channels:read,channels:history,groups:read,groups:history,"
        "im:read,im:history,mpim:read,mpim:history,users:read,search:read"
    ),
}
_LOCKS = defaultdict(asyncio.Lock)


class SourceUnavailable(Exception):
    """Connector access is disabled, disconnected, or requires sign-in."""


class ConnectorBackoff(Exception):
    def __init__(self, retry_at):
        self.retry_at = retry_at
        super().__init__("Connector cooling down")


def access_enabled(widget_id="task.agenda"):
    return settings_read(widget_id).get("enabled", True)


def state(toolkit):
    with transaction() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO dashboard_connector_health(toolkit) VALUES(?)", (toolkit,)
        )
        return dict(
            conn.execute(
                "SELECT * FROM dashboard_connector_health WHERE toolkit=?", (toolkit,)
            ).fetchone()
        )


def failed(toolkit, error):
    if is_auth_failure_text(str(error)):
        composio_service.mark_reauth_required(toolkit, reason="Dashboard authentication expired")
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_connector_health SET needs_reconnect=1 WHERE toolkit=?",
                (toolkit,),
            )
        return SourceUnavailable()
    current = state(toolkit)
    failures = current["failures"] + 1
    limited = bool(re.search(r"\b429\b|rate.?limit|too many requests", str(error), re.I))
    delay = min(30 * 2 ** min(failures - 1, 5), 900) if limited else (60 if failures >= 3 else 0)
    response = getattr(error, "response", None)
    if limited and response is not None:
        try:
            delay = max(delay, min(float(response.headers.get("Retry-After", 0)), 86400))
        except (TypeError, ValueError):
            pass
    retry_at = time.time() + delay if delay else 0
    with transaction() as conn:
        conn.execute(
            "UPDATE dashboard_connector_health SET failures=?,retry_at=? WHERE toolkit=?",
            (failures, retry_at, toolkit),
        )
    return ConnectorBackoff(retry_at) if delay else RuntimeError("Connector read failed")


def toolkits():
    from backend.dashboard.registry import REGISTRY

    declared = set()
    for entry in REGISTRY.values():
        sources = entry["manifest"].get("source", [])
        for source in sources if isinstance(sources, list) else [sources]:
            if source.get("type") == "composio" and source.get("toolkit"):
                declared.add(source["toolkit"])
    return set(composio_service.get_enabled_toolkits()) | declared


async def accounts(*, include_reauth=False, force=False):
    started = time.monotonic()
    succeeded = False
    try:
        result = await composio_service.get_connections_async(
            include_reauth=include_reauth, force=force
        )
        succeeded = True
        return result
    finally:
        ExecutionLogRepository().record(
            tool_name="composio_connection_health",
            tool_source="mcp",
            arguments={},
            result_summary="Connection health checked" if succeeded else None,
            error=None if succeeded else "Connection health unavailable",
            duration_ms=int((time.monotonic() - started) * 1000),
            risk_level="low",
            confirmation_decision="auto",
        )


async def read(widget_id, toolkit, slug, arguments):
    async with _LOCKS[(str(paths().db), toolkit)]:
        return await _read(widget_id, toolkit, slug, arguments)


async def _read(widget_id, toolkit, slug, arguments):
    from backend.dashboard.registry import REGISTRY

    started = time.monotonic()
    succeeded = False
    outcome = None
    tool = None
    trace, watchdog, token = start_turn_trace("dashboard", f"Read {widget_id}")
    try:
        sources = REGISTRY[widget_id]["manifest"]["source"]
        sources = sources if isinstance(sources, list) else [sources]
        if slug not in READ_TOOLS.get(toolkit, ()) or not any(
            s.get("type") == "composio" and s.get("toolkit") == toolkit for s in sources
        ):
            raise RuntimeError("Connector reader must be read-only")
        current = state(toolkit)
        if not access_enabled(widget_id) or not composio_service.is_configured():
            raise SourceUnavailable
        if (
            toolkit not in composio_service.get_enabled_toolkits()
            or is_provider_overridden_by_local(toolkit)
        ):
            raise SourceUnavailable
        if current["needs_reconnect"] or composio_service.is_reauth_required(toolkit):
            raise SourceUnavailable
        if current["retry_at"] > time.time():
            raise ConnectorBackoff(current["retry_at"])
        if connection("composio") is None:
            raise RuntimeError("Connector transport unavailable")
        if toolkit not in await accounts():
            raise SourceUnavailable
        tool = get_manager().registry.resolve_tool(slug)
        if not tool or tool.server_name != "composio" or tool.source != ToolSource.MCP:
            raise SourceUnavailable
        if tool.risk != RiskLevel.LOW:
            raise RuntimeError("Connector reader must be read-only")

        async def refuse_prompt(_request):
            return False

        context = ToolContext(read_only=True)
        outcome = await ConfirmationService(callback=refuse_prompt).check(tool, arguments, context)
        if not outcome.allowed:
            raise SourceUnavailable
        try:
            # Retain structured fields for projection; never cache this raw response.
            cache_args = {**arguments, "dashboard_home": str(paths().db)}
            cached = (
                read_cache.get("dashboard_" + slug, cache_args)
                if toolkit in ("gmail", "github", "slack", "googlecalendar")
                else None
            )
            result = None if cached else await tool.handler(arguments, context)
            if result and result.is_error:
                raise RuntimeError(result.content)
            value = json.loads(cached.content if cached else result.content)
            if toolkit == "gmail" and not cached:
                if isinstance(value, dict):
                    value = value.get("data", value)
                rows = (
                    value if isinstance(value, list) else value.get("messages", value.get("emails"))
                )
                if not isinstance(rows, list):
                    raise ValueError("Invalid mail response")
                # Never turn a full body into a snippet or retain raw connector responses.
                value = {
                    "messages": [
                        project_mail(
                            {
                                **{
                                    key: row[key]
                                    for key in (
                                        "id",
                                        "message_id",
                                        "threadId",
                                        "thread_id",
                                        "from",
                                        "to",
                                        "sender",
                                        "subject",
                                        "date",
                                        "headers",
                                        "labelIds",
                                        "label_ids",
                                        "snippet",
                                    )
                                    if key in row
                                },
                                "payload": {"headers": row.get("payload", {}).get("headers", [])},
                            }
                        )
                        for row in rows
                    ]
                }
                read_cache.set("dashboard_" + slug, cache_args, json.dumps(value))
            if toolkit in ("github", "slack", "googlecalendar") and not cached:
                from backend.dashboard.remote import project

                value = project(slug, value, arguments)
                read_cache.set("dashboard_" + slug, cache_args, json.dumps(value))
        except Exception as exc:
            raise failed(toolkit, exc) from None
        if not access_enabled(widget_id) or composio_service.is_reauth_required(toolkit):
            raise SourceUnavailable
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_connector_health SET last_success=?,failures=0,retry_at=0 "
                "WHERE toolkit=?",
                (stamp(), toolkit),
            )
        succeeded = True
        return value
    finally:
        elapsed = int((time.monotonic() - started) * 1000)
        ExecutionLogRepository().record(
            tool_name=slug if slug in READ_TOOLS.get(toolkit, ()) else "dashboard_connector_read",
            tool_source="mcp",
            arguments={"widget_id": widget_id, "toolkit": toolkit},
            result_summary=f"Read {widget_id}" if succeeded else None,
            error=None if succeeded else "Connector read unavailable",
            duration_ms=elapsed,
            risk_level=tool.risk.value if tool else "low",
            confirmation_decision=outcome.decision if outcome else "blocked",
        )
        record_tool_dispatch(tool.name if tool else "dashboard_connector_read", elapsed)
        finish_turn_trace(trace, watchdog, token)


async def health():
    configured = composio_service.is_configured()
    connections = await accounts(include_reauth=True) if configured else {}
    items = []
    for toolkit in sorted(toolkits() | set(connections)):
        if is_provider_overridden_by_local(toolkit):
            continue
        current = state(toolkit)
        account = connections.get(toolkit)
        if account and current["reconnect_started"]:
            updated = account.get("updated_at") or account.get("created_at")
            try:
                changed = updated and datetime.fromisoformat(
                    updated.replace("Z", "+00:00")
                ) > datetime.fromisoformat(current["reconnect_started"])
            except (ValueError, TypeError):
                changed = False
            if account.get("id") != current["account_id"] or changed:
                composio_service.clear_reauth_required(toolkit)
                with transaction() as conn:
                    conn.execute(
                        "UPDATE dashboard_connector_health SET needs_reconnect=0,"
                        "reconnect_started=NULL,"
                        "failures=0,retry_at=0 WHERE toolkit=?",
                        (toolkit,),
                    )
                current = state(toolkit)
        status = (
            "needs reconnect"
            if current["needs_reconnect"] or composio_service.is_reauth_required(toolkit)
            else "connected"
            if account
            else "not set up"
        )
        items.append(
            {
                "id": toolkit,
                "status": status,
                "last_success": current["last_success"],
                "retry_at": current["retry_at"] if current["retry_at"] > time.time() else None,
                "circuit_open": current["failures"] >= 3 and current["retry_at"] > time.time(),
                "can_connect": configured and toolkit in READ_SCOPES,
            }
        )
    return {"items": items, "configured": configured}


async def connect(toolkit):
    if toolkit not in toolkits() or toolkit not in READ_SCOPES:
        raise SourceUnavailable("Read-only connection is not available for this toolkit")
    started = time.monotonic()
    succeeded = False
    state(toolkit)
    try:
        connections = await accounts(include_reauth=True, force=True)
        url = await asyncio.to_thread(
            composio_service.initiate_connection, toolkit, scopes=READ_SCOPES[toolkit]
        )
        enabled = composio_service.get_enabled_toolkits()
        if toolkit not in enabled:
            await asyncio.to_thread(composio_service.update_toolkits, [*enabled, toolkit])
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_connector_health SET reconnect_started=?,account_id=? "
                "WHERE toolkit=?",
                (stamp(), connections.get(toolkit, {}).get("id"), toolkit),
            )
        succeeded = True
        return {"redirect_url": url}
    finally:
        ExecutionLogRepository().record(
            tool_name="composio_connect_link",
            tool_source="mcp",
            arguments={"toolkit": toolkit},
            result_summary="Connect Link created" if succeeded else None,
            error=None if succeeded else "Connect Link unavailable",
            duration_ms=int((time.monotonic() - started) * 1000),
            risk_level="low",
            confirmation_decision="user_requested",
        )
