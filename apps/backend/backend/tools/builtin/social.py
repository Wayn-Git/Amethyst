"""Reading Reddit and X, through the readers that hold a session.

Two tools rather than one because the two questions are different: `read_social`
is "open this link", `search_social` is "find me links". A search that returned
one post and a read that returned a list would each be the wrong shape.

Neither reimplements a client. `backend/web/social.py` routes to `rdt-cli` and
`twitter-cli`, and the module docstring there says why: these sites are an
anti-bot arms race, and AMETHYST is not going to win it quietly on a Tuesday.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.config import load_social
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.web.social import READERS, SocialError, read, search

SOURCES = tuple(sorted(reader.source for reader in READERS))


def _workspace(ctx: ToolContext) -> str:
    return str(Path(ctx.workspace_root or Path.cwd()).expanduser().resolve())


async def read_social(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    url = (args.get("url") or "").strip()
    if not url:
        return ToolResult.error("read_social needs a url")
    try:
        text, reader = await read(url, workspace=_workspace(ctx), allowed=load_social().allow)
    except SocialError as exc:
        return ToolResult.error(str(exc))
    return ToolResult.ok(f"[{reader.source}, via {reader.binary}]\n\n{text}")


async def search_social(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = (args.get("source") or "").strip()
    if not source:
        return ToolResult.error(f"search_social needs a source: {', '.join(SOURCES)}")
    try:
        text, reader = await search(
            source,
            args.get("query") or "",
            limit=int(args.get("limit") or 5),
            workspace=_workspace(ctx),
            allowed=load_social().allow,
        )
    except SocialError as exc:
        return ToolResult.error(str(exc))
    except (TypeError, ValueError) as exc:
        return ToolResult.error(f"could not search: {exc}")
    return ToolResult.ok(f"[{reader.source}, via {reader.binary}]\n\n{text}")


def tools() -> list[Tool]:
    return [
        Tool(
            name="read_social",
            description=(
                "Read a Reddit post or an X thread, with its replies. These sites"
                " refuse anonymous readers, so this goes through a signed-in"
                " reader on this machine and only for sites the user has allowed."
                " Ordinary web pages go through fetch_url instead."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Link to the post or thread.",
                    }
                },
                "required": ["url"],
            },
            handler=read_social,
            # Reads only, but it acts as the signed-in user on a real account,
            # which is not the same promise as fetching a public page. MEDIUM so
            # the gate asks the first time and the audit log has a row.
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="search_social",
            description=(
                "Search Reddit or X for posts about something, and get back links"
                " with enough of each to tell which is worth opening. Use"
                " read_social on the one that is. For the open web, use"
                " search_web."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "enum": list(SOURCES),
                        "description": "Which site to search.",
                    },
                    "query": {"type": "string", "description": "What to look for."},
                    "limit": {
                        "type": "integer",
                        "description": "How many results. Default 5.",
                    },
                },
                "required": ["source", "query"],
            },
            handler=search_social,
            risk=RiskLevel.MEDIUM,
        ),
    ]
