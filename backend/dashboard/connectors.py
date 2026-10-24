"""Structured read-only calls through the live, gated and audited Composio tools."""

import json
import time

from backend.agent.trace import finish_turn_trace, record_tool_dispatch, start_turn_trace
from backend.dashboard.store import settings_read
from backend.db.repositories import ExecutionLogRepository
from backend.mcp.client import is_auth_failure_text
from backend.mcp.composio_service import composio_service
from backend.mcp.live import connection, get_manager
from backend.mcp.provider_ownership import is_provider_overridden_by_local
from backend.security.confirmation import ConfirmationService
from backend.tools.base import RiskLevel, ToolContext, ToolSource


class SourceUnavailable(Exception):
    """Connector access is disabled, disconnected, or requires sign-in."""


def access_enabled(widget_id="task.agenda"):
    return settings_read(widget_id).get("enabled", True)


async def read(widget_id, toolkit, slug, arguments):
    if not access_enabled(widget_id) or not composio_service.is_configured():
        raise SourceUnavailable
    if toolkit not in composio_service.get_enabled_toolkits() or is_provider_overridden_by_local(
        toolkit
    ):
        raise SourceUnavailable
    if composio_service.is_reauth_required(toolkit):
        raise SourceUnavailable
    if connection("composio") is None:
        raise RuntimeError("Connector transport unavailable")
    if toolkit not in await composio_service.get_connections_async():
        raise SourceUnavailable
    manager = get_manager()
    tool = manager.registry.resolve_tool(slug)
    if not tool or tool.server_name != "composio" or tool.source != ToolSource.MCP:
        raise SourceUnavailable
    if tool.risk != RiskLevel.LOW:
        raise RuntimeError("Connector reader must be read-only")

    async def refuse_prompt(_request):
        return False

    context = ToolContext(read_only=True)
    trace, watchdog, token = start_turn_trace("dashboard", f"Read {widget_id}")
    started = time.monotonic()
    succeeded = False
    outcome = None
    try:
        outcome = await ConfirmationService(callback=refuse_prompt).check(tool, arguments, context)
        if not outcome.allowed:
            raise SourceUnavailable
        # Registry dispatch projects/truncates results for LLM context; this machine reader
        # uses the same registered handler and gate, retaining structured source fields.
        result = await tool.handler(arguments, context)
        succeeded = not result.is_error
    finally:
        elapsed = int((time.monotonic() - started) * 1000)
        ExecutionLogRepository().record(
            tool_name=tool.name,
            tool_source=tool.source.value,
            arguments=arguments,
            result_summary=f"Read {widget_id}" if succeeded else None,
            error=None if succeeded else "Connector read unavailable",
            duration_ms=elapsed,
            risk_level=tool.risk.value,
            confirmation_decision=outcome.decision if outcome else "gate_error",
        )
        record_tool_dispatch(tool.name, elapsed, arguments=arguments)
        finish_turn_trace(trace, watchdog, token)
    if not access_enabled(widget_id) or composio_service.is_reauth_required(toolkit):
        raise SourceUnavailable
    if result.is_error:
        if is_auth_failure_text(result.content):
            raise SourceUnavailable
        raise RuntimeError("Calendar read failed")
    return json.loads(result.content)
