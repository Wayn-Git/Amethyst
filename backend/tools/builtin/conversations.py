"""Conversation history tools: what did we talk about.

The store is the transcript table, never the filesystem. A "what did we talk
about yesterday" turn must never cost file-mtime probes, browser-history
searches, or raw sqlite through the shell: one `list_conversations` plus one
`read_conversation` (or a single `search_conversations`) answers it in two
model round trips instead of twelve tool calls across six.

Dates are stored UTC and rendered with an explicit UTC label. Rendering them
bare once mislabeled an afternoon block as morning; the label is load-bearing.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.db.connection import get_connection
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

_LIST_WHEN_TO_USE = (
    "Use for 'what did we talk about', 'yesterday's threads', 'find that"
    " conversation about X'. This is the conversation store — never use"
    " filesystem mtimes, browser history, or raw sqlite/shell on amethyst.db"
    " for conversation history."
)

_MSG_CHARS = 600


def _utc_day(dt_str: str | None) -> str:
    """Date part of a UTC timestamp, or 'unknown date'."""
    if not dt_str:
        return "unknown date"
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(dt_str))
    return m.group(1) if m else "unknown date"


def _utc_stamp(dt_str: str | None) -> str:
    if not dt_str:
        return "unknown date"
    m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", str(dt_str))
    return f"{m.group(1)} UTC" if m else "unknown date"


def _since_cutoff(since_days: Any) -> str | None:
    try:
        days = int(since_days)
    except (TypeError, ValueError):
        return None
    if days <= 0:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def _resolve_id(conn, ref: str) -> tuple[str | None, str]:
    """Full id or unique prefix to conversation id. Returns (id, error)."""
    ref = (ref or "").strip()
    if not ref:
        return None, "Pass a conversation id (or its first 8 characters from list_conversations)."
    row = conn.execute("SELECT id FROM conversations WHERE id = ?", (ref,)).fetchone()
    if row:
        return row["id"], ""
    like = f"{ref}%"
    rows = conn.execute(
        "SELECT id, title FROM conversations WHERE id LIKE ? LIMIT 10", (like,)
    ).fetchall()
    if not rows:
        return None, f"No conversation starts with {ref!r}. Use list_conversations to find it."
    if len(rows) > 1:
        cands = ", ".join(f"{r['id'][:8]} ({(r['title'] or 'untitled')[:40]})" for r in rows)
        return None, f"Prefix {ref!r} matches several: {cands}. Pass more characters."
    return rows[0]["id"], ""


async def list_conversations(args: dict[str, Any], _: ToolContext) -> ToolResult:
    try:
        limit = max(1, min(int(args.get("limit") or 15), 50))
    except (TypeError, ValueError):
        return ToolResult.error("limit must be a number between 1 and 50.")
    cutoff = _since_cutoff(args.get("since_days"))
    conn = get_connection()
    sql = (
        "SELECT c.id, c.title, c.updated_at, s.summary FROM conversations c"
        " LEFT JOIN conversation_summaries s ON s.conversation_id = c.id"
        " WHERE c.automation_id IS NULL"
    )
    params: list = []
    if cutoff:
        sql += " AND c.updated_at >= ?"
        params.append(cutoff)
    sql += " ORDER BY c.updated_at DESC LIMIT ?"
    params.append(limit)
    try:
        rows = conn.execute(sql, params).fetchall()
    except Exception as exc:
        return ToolResult.error(f"could not list conversations: {exc}")
    if not rows:
        return ToolResult.ok("No conversations in range. Nothing discussed yet.")
    lines = []
    for r in rows:
        day = _utc_day(r["updated_at"])
        short = (r["id"] or "")[:8]
        title = (r["title"] or "untitled").strip() or "untitled"
        summary = (r["summary"] or "").strip()
        line = f"{day}  {short}  {title}"
        if summary:
            line += f" — {summary[:160]}"
        lines.append(line)
    return ToolResult.ok(
        "Recent conversations (dates UTC; read one with read_conversation):\n" + "\n".join(lines)
    )


async def read_conversation(args: dict[str, Any], _: ToolContext) -> ToolResult:
    try:
        limit = max(1, min(int(args.get("limit") or 30), 100))
    except (TypeError, ValueError):
        return ToolResult.error("limit must be a number between 1 and 100.")
    include_tools = bool(args.get("include_tool_results"))
    conn = get_connection()
    cid, err = _resolve_id(conn, str(args.get("conversation_id") or ""))
    if err:
        return ToolResult.error(err)
    try:
        title_row = conn.execute(
            "SELECT title, updated_at FROM conversations WHERE id = ?", (cid,)
        ).fetchone()
        if limit >= 100:
            rows = conn.execute(
                "SELECT role, content, tool_name, tool_calls, created_at FROM messages"
                " WHERE conversation_id = ? ORDER BY id LIMIT ?",
                (cid, limit),
            ).fetchall()
        else:
            # Newest N, returned oldest-first. Reversed in Python: rowid is not
            # projectable through the subquery, and created_at ties within a turn.
            rows = conn.execute(
                "SELECT role, content, tool_name, tool_calls, created_at"
                " FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
                (cid, limit),
            ).fetchall()[::-1]
    except Exception as exc:
        return ToolResult.error(f"could not read conversation: {exc}")
    if not rows:
        return ToolResult.ok("That conversation has no messages yet.")
    title = ((title_row["title"] if title_row else None) or "untitled").strip()
    out = [f"Conversation {cid[:8]} — {title} ({len(rows)} messages shown, dates UTC):"]
    for m in rows:
        role = m["role"]
        stamp = _utc_stamp(m["created_at"])
        text = (m["content"] or "").strip()
        if role == "tool":
            if not include_tools:
                continue
            name = m["tool_name"] or "tool"
            first = (text.split("\n")[0] if text else "")[:200]
            out.append(f"[{stamp}] tool({name}): {first}")
            continue
        if role == "assistant" and not text and m["tool_calls"]:
            try:
                import json as _json

                calls = _json.loads(m["tool_calls"])
                names = ", ".join(c.get("function", {}).get("name", "?") for c in calls)
                out.append(f"[{stamp}] assistant → tools: {names}")
            except Exception:
                out.append(f"[{stamp}] assistant → tools")
            continue
        if len(text) > _MSG_CHARS:
            text = text[:_MSG_CHARS] + "…"
        out.append(f"[{stamp}] {role}: {text}")
    return ToolResult.ok("\n".join(out))


def _like_escape(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_conversations(args: dict[str, Any], _: ToolContext) -> ToolResult:
    query = (args.get("query") or "").strip()
    if not query:
        return ToolResult.error(
            "search_conversations needs something to search for."
            " For 'everything lately', use list_conversations instead."
        )
    try:
        limit = max(1, min(int(args.get("limit") or 20), 50))
    except (TypeError, ValueError):
        return ToolResult.error("limit must be a number between 1 and 50.")
    cutoff = _since_cutoff(args.get("since_days"))
    conn = get_connection()
    like = f"%{_like_escape(query)}%"
    sql = (
        "SELECT m.content, m.role, m.created_at, c.id AS cid, c.title FROM messages m"
        " JOIN conversations c ON c.id = m.conversation_id"
        " WHERE c.automation_id IS NULL AND m.content LIKE ? ESCAPE '\\'"
    )
    params: list = [like]
    if cutoff:
        sql += " AND m.created_at >= ?"
        params.append(cutoff)
    sql += " ORDER BY m.id DESC LIMIT ?"
    params.append(limit)
    try:
        rows = conn.execute(sql, params).fetchall()
    except Exception as exc:
        return ToolResult.error(f"could not search conversations: {exc}")
    if not rows:
        hint = f"Nothing in any conversation matches {query!r}."
        return ToolResult.ok(hint + " Try list_conversations for a date-ordered overview.")
    out = [f"Matches for {query!r} (dates UTC, newest first):"]
    qlow = query.lower()
    for r in rows:
        text = r["content"] or ""
        idx = text.lower().find(qlow)
        if idx >= 0:
            start = max(0, idx - 100)
            snippet = text[start : idx + len(query) + 100].replace("\n", " ").strip()
            if start > 0:
                snippet = "…" + snippet
            if idx + len(query) + 100 < len(text):
                snippet = snippet + "…"
        else:
            snippet = text[:240].replace("\n", " ").strip()
        title = (r["title"] or "untitled").strip() or "untitled"
        out.append(
            f"{_utc_stamp(r['created_at'])} | {title} ({(r['cid'] or '')[:8]})"
            f" | {r['role']}: {snippet}"
        )
    return ToolResult.ok("\n".join(out))


def tools() -> list[Tool]:
    return [
        Tool(
            name="list_conversations",
            description=(
                _LIST_WHEN_TO_USE
                + " Returns date (UTC), id prefix, title, and one-line summary,"
                " newest first. Follow with read_conversation for detail."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "How many conversations. Default 15, max 50.",
                    },
                    "since_days": {
                        "type": "integer",
                        "description": "Only conversations updated in the last N days.",
                    },
                },
            },
            handler=list_conversations,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="read_conversation",
            description=(
                "Read the transcript of one conversation by id or id prefix."
                " " + _LIST_WHEN_TO_USE
            ),
            parameters={
                "type": "object",
                "properties": {
                    "conversation_id": {
                        "type": "string",
                        "description": "Full id or unique prefix from list_conversations.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "How many messages, oldest-first window. Default 30, max 100.",
                    },
                    "include_tool_results": {
                        "type": "boolean",
                        "description": "Include tool outputs collapsed to one line each. Default false.",
                    },
                },
                "required": ["conversation_id"],
            },
            handler=read_conversation,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="search_conversations",
            description=(
                "Substring search over every conversation transcript."
                " Use for 'when did we discuss X', 'find the thread about Y'."
                " Empty query is an error — use list_conversations for overviews."
                " " + _LIST_WHEN_TO_USE
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Substring to find in message text.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "How many matches. Default 20, max 50.",
                    },
                    "since_days": {
                        "type": "integer",
                        "description": "Only messages from the last N days.",
                    },
                },
                "required": ["query"],
            },
            handler=search_conversations,
            risk=RiskLevel.LOW,
        ),
    ]
