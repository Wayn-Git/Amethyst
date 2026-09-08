"""Searching what the user has already looked at.

Bookmarks are captured into the library and found by `search_library` and
`search_documents` like everything else, so they need no tool here. History is
the other half and is deliberately *not* indexed -- sixteen thousand pages is an
embedding bill and a large index for material that is mostly noise -- so the one
way to reach it is this substring search, run against a copy of the browser's
own database at the moment it is asked.

Gated on the browser setting rather than always available. History is the most
private file on the machine, and its titles and URLs would otherwise flow into a
model prompt on a tool call nobody switched on.
"""

from __future__ import annotations

from typing import Any

from backend.browser.places import PlacesError, find_profile, history
from backend.config import load_browser
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

DISABLED = (
    "browser history is switched off. AMETHYST reads it from the browser's own"
    " database on this machine, and it stays off until it is turned on in"
    " settings."
)


async def search_history(args: dict[str, Any], _: ToolContext) -> ToolResult:
    query = (args.get("query") or "").strip()
    if not query:
        return ToolResult.error("search_history needs something to search for")

    settings = load_browser()
    if not settings.enabled:
        return ToolResult.error(DISABLED)

    try:
        profile = find_profile(settings.profile_dir or None)
        hits = history(
            profile,
            query,
            limit=int(args.get("limit") or 20),
            since_days=int(args["since_days"]) if args.get("since_days") else None,
        )
    except PlacesError as exc:
        return ToolResult.error(str(exc))
    except (TypeError, ValueError) as exc:
        return ToolResult.error(f"could not search history: {exc}")

    if not hits:
        return ToolResult.ok(f"Nothing in browser history matches {query!r}.")

    lines = []
    for visit in hits:
        when = f"{visit.last_visit:%Y-%m-%d}" if visit.last_visit else "unknown date"
        title = visit.title or "(no title)"
        plural = "visit" if visit.visits == 1 else "visits"
        lines.append(f"{when}  {visit.visits} {plural}  {title}\n    {visit.url}")
    return ToolResult.ok("\n".join(lines))


def tools() -> list[Tool]:
    return [
        Tool(
            name="search_history",
            description=(
                "Search the pages the user has visited in their browser, by a"
                " substring of the title or URL. Use it for 'what was that site"
                " about X' and 'the page I read last Tuesday'. It searches only"
                " what was actually visited on this machine, and nothing is"
                " uploaded. Bookmarked pages are in the library instead --"
                " search_library and search_documents find those, with their text."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Substring to look for in the page title or URL.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "How many pages to return. Default 20, most recent first.",
                    },
                    "since_days": {
                        "type": "integer",
                        "description": "Only pages visited in the last N days.",
                    },
                },
                "required": ["query"],
            },
            handler=search_history,
            risk=RiskLevel.LOW,
        ),
    ]
