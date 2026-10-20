"""Tight defaults enforcement for agent tool calls.

Ensures that tools invoked without explicit pagination or date bounds receive
safe, compact defaults rather than unbounded queries that blow up context.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from backend.agent.config import agent_config


def is_pagination_requested(user_prompt: str | None) -> bool:
    """Return True if the user explicitly asked for pagination or additional items."""
    if not user_prompt:
        return False
    lower = user_prompt.lower()
    keywords = (
        "more", "next page", "page 2", "page 3", "page 4", "page 5",
        "second page", "third page", "fourth page", "load more", "show more",
        "get more", "fetch more", "older", "previous page", "paginate",
        "offset", "continue", "next "
    )
    return any(kw in lower for kw in keywords)


def apply_tool_defaults(
    tool_name: str,
    arguments: dict[str, Any] | None,
    user_prompt: str | None = None,
) -> dict[str, Any]:
    """Return a new dict with tight defaults applied based on tool intent."""
    args = dict(arguments or {})
    name = (tool_name or "").lower()

    # Block model-initiated offset/page pagination unless the user explicitly requested more
    if not is_pagination_requested(user_prompt):
        if "offset" in args:
            try:
                if int(args["offset"]) > 0:
                    args["offset"] = 0
            except (ValueError, TypeError):
                args.pop("offset", None)
        if "skip" in args:
            try:
                if int(args["skip"]) > 0:
                    args["skip"] = 0
            except (ValueError, TypeError):
                args.pop("skip", None)
        if "start_index" in args:
            try:
                if int(args["start_index"]) > 0:
                    args["start_index"] = 0
            except (ValueError, TypeError):
                args.pop("start_index", None)
        if "startIndex" in args:
            try:
                if int(args["startIndex"]) > 0:
                    args["startIndex"] = 0
            except (ValueError, TypeError):
                args.pop("startIndex", None)
        if "page" in args:
            try:
                if int(args["page"]) > 1:
                    args["page"] = 1
            except (ValueError, TypeError):
                args.pop("page", None)
        if "page_number" in args:
            try:
                if int(args["page_number"]) > 1:
                    args["page_number"] = 1
            except (ValueError, TypeError):
                args.pop("page_number", None)
        if "pageNumber" in args:
            try:
                if int(args["pageNumber"]) > 1:
                    args["pageNumber"] = 1
            except (ValueError, TypeError):
                args.pop("pageNumber", None)
        for token_key in ("page_token", "pageToken", "next_page_token", "nextPageToken", "cursor", "after"):
            if token_key in args:
                args.pop(token_key, None)

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
