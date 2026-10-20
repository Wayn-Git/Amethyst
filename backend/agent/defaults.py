"""Tight defaults enforcement for agent tool calls.

Ensures that tools invoked without explicit pagination or date bounds receive
safe, compact defaults rather than unbounded queries that blow up context.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from backend.agent.config import agent_config


def apply_tool_defaults(tool_name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    """Return a new dict with tight defaults applied based on tool intent."""
    args = dict(arguments or {})
    name = (tool_name or "").lower()

    max_results = agent_config.default_max_results

    # 1. Google Calendar / Calendar search
    if "calendar" in name and any(k in name for k in ("find", "list", "search", "event", "slot")):
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        if "time_min" not in args or not args["time_min"]:
            args["time_min"] = now.isoformat()
        if "time_max" not in args or not args["time_max"]:
            args["time_max"] = (now + timedelta(days=agent_config.default_date_window_days)).isoformat()
        if "max_results" not in args or not args["max_results"]:
            args["max_results"] = max_results
        else:
            try:
                args["max_results"] = min(int(args["max_results"]), max_results)
            except (ValueError, TypeError):
                args["max_results"] = max_results
        if "single_events" not in args:
            args["single_events"] = True

    # 2. Gmail / Email search
    elif any(k in name for k in ("mail", "email", "gmail")):
        if "max_results" not in args or not args["max_results"]:
            if "limit" in args and args["limit"]:
                try:
                    args["limit"] = min(int(args["limit"]), max_results)
                except (ValueError, TypeError):
                    args["limit"] = max_results
            else:
                args["max_results"] = max_results
        else:
            try:
                args["max_results"] = min(int(args["max_results"]), max_results)
            except (ValueError, TypeError):
                args["max_results"] = max_results
        # Concise snippets by default
        if "verbose" not in args:
            args["verbose"] = False

    # 3. Web search / search tools
    elif "search" in name or "web" in name:
        if "limit" in args and args["limit"]:
            try:
                args["limit"] = min(int(args["limit"]), max_results)
            except (ValueError, TypeError):
                args["limit"] = max_results
        elif "max_results" in args and args["max_results"]:
            try:
                args["max_results"] = min(int(args["max_results"]), max_results)
            except (ValueError, TypeError):
                args["max_results"] = max_results
        elif "count" in args and args["count"]:
            try:
                args["count"] = min(int(args["count"]), max_results)
            except (ValueError, TypeError):
                args["count"] = max_results
        elif "page_size" in args and args["page_size"]:
            try:
                args["page_size"] = min(int(args["page_size"]), max_results)
            except (ValueError, TypeError):
                args["page_size"] = max_results

    # 4. General listing / pagination fields clamping across any tool
    for key in ("max_results", "limit", "count", "page_size", "per_page"):
        if key in args and args[key] is not None:
            try:
                args[key] = min(int(args[key]), max_results)
            except (ValueError, TypeError):
                pass

    return args
