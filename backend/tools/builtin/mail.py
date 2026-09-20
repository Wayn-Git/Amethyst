"""Mail tools: Gmail (user's personal mail) + AgentMail (agent's own inbox).

**Why these exist.** `backend/mail/gmail.py` was reachable from the screen and
from nowhere else -- there were REST routes and a Mail view, and no tool. So an
agent asked to "email me the briefing" had no call to make, and an automation
told to do it produced the briefing, said `ok`, and sent nothing. Every tool
here is a thin translation onto the mail modules, which is the same code the
Mail view reads, so the two cannot drift.

**Two providers, distinct purposes.**
- Gmail tools (`search_email`, `read_email`, `send_email`, `reply_email`, `draft_email`)
  operate on the user's connected Google account. Query syntax is Gmail's.
- AgentMail tools (`search_agentmail`, `read_agentmail`, `send_agentmail`,
  `reply_agentmail`, `draft_agentmail`) operate on the agent's own @agentmail.to
  inbox (requires `AGENTMAIL_API_KEY`). Query syntax is free-text.

**Nothing is faked when mail is unavailable.** `MailUnavailable` carries a
sentence naming the missing piece and it is returned as a tool *error* with that
sentence in it. The model is then told, in words, that the mail did not go out,
which is the difference between a run that reports `partial` and a run that
lies. The one thing these must never do is answer as though a message were
sent.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.mail import agentmail, gmail
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

log = logging.getLogger(__name__)

#: Long enough to act on, short enough not to spend the turn's context on one
#: inbox. A model that needs the whole message asks for it by id.
PREVIEW_CHARS = 600


def _unavailable(exc: Exception) -> ToolResult:
    return ToolResult.error(f"Mail is not available: {exc}")


# --- Gmail tools (user's personal mail) ---

async def search_email(args: dict[str, Any], _: ToolContext) -> ToolResult:
    query = (args.get("query") or "in:inbox").strip()
    limit = max(1, min(int(args.get("limit") or 10), 25))
    try:
        found = await gmail.threads(query=query, limit=limit)
    except gmail.MailUnavailable as exc:
        return _unavailable(exc)
    if not found:
        return ToolResult.ok(f"No messages match '{query}'.")
    lines = [f"{len(found)} thread(s) matching '{query}':"]
    for item in found:
        lines.append(
            f"- id={item.get('thread_id') or item.get('id')}"
            f" from={item.get('from') or 'unknown'}"
            f" subject={item.get('subject') or '(none)'}"
            f" unread={bool(item.get('unread'))}"
            f"\n  {(item.get('snippet') or '')[:200]}"
        )
    return ToolResult.ok("\n".join(lines))


async def read_email(args: dict[str, Any], _: ToolContext) -> ToolResult:
    thread_id = (args.get("thread_id") or "").strip()
    if not thread_id:
        return ToolResult.error("read_email needs a thread_id, from search_email.")
    try:
        conversation = await gmail.thread(thread_id)
    except gmail.MailUnavailable as exc:
        return _unavailable(exc)
    parts = [f"Subject: {conversation.get('subject') or '(none)'}"]
    for message in conversation.get("messages") or []:
        parts.append(
            f"\n--- from {message.get('from')} at {message.get('date')} ---\n"
            f"{(message.get('body') or message.get('snippet') or '')[:PREVIEW_CHARS * 4]}"
        )
    return ToolResult.ok("\n".join(parts))


async def send_email(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Send one message via Gmail. The result is Gmail's answer, or the failure."""
    body = args.get("body") or ""
    subject = (args.get("subject") or "").strip()
    if not body.strip():
        return ToolResult.error("send_email needs a body.")
    if not subject:
        return ToolResult.error("send_email needs a subject.")
    try:
        sent = await gmail.send(
            body,
            subject=subject,
            to=args.get("to"),
            cc=args.get("cc"),
        )
    except gmail.MailUnavailable as exc:
        return _unavailable(exc)
    except Exception as exc:  # a network failure is still a message not sent
        log.exception("send_email failed")
        return ToolResult.error(f"The message was not sent: {type(exc).__name__}: {exc}")
    return ToolResult.ok(
        f"Sent to {sent['to']} from {sent['from']}."
        f" Subject: {sent['subject']}. Gmail message id {sent['id']}."
    )


async def reply_email(args: dict[str, Any], _: ToolContext) -> ToolResult:
    thread_id = (args.get("thread_id") or "").strip()
    body = args.get("body") or ""
    if not thread_id or not body.strip():
        return ToolResult.error("reply_email needs a thread_id and a body.")
    try:
        sent = await gmail.reply(thread_id, body)
    except gmail.MailUnavailable as exc:
        return _unavailable(exc)
    except Exception as exc:
        log.exception("reply_email failed")
        return ToolResult.error(f"The reply was not sent: {type(exc).__name__}: {exc}")
    return ToolResult.ok(f"Replied in thread {sent['thread_id']}, message id {sent['id']}.")


async def draft_email(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Write a draft in Gmail instead of sending."""
    body = args.get("body") or ""
    subject = (args.get("subject") or "").strip()
    if not body.strip() or not subject:
        return ToolResult.error("draft_email needs a subject and a body.")
    try:
        draft = await gmail.draft(body, subject=subject, to=args.get("to"))
    except gmail.MailUnavailable as exc:
        return _unavailable(exc)
    except Exception as exc:
        log.exception("draft_email failed")
        return ToolResult.error(f"The draft was not saved: {type(exc).__name__}: {exc}")
    return ToolResult.ok(
        f"Saved a draft to {draft['to']}. Subject: {draft['subject']}."
        f" Gmail draft id {draft['id']}."
    )


# --- AgentMail tools (agent's own inbox) ---

async def search_agentmail(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Search the agent's AgentMail inbox (free-text query)."""
    if not agentmail.configured():
        msg = "AGENTMAIL_API_KEY not set. Add it to .env to enable AgentMail."
        return _unavailable(Exception(msg))
    query = (args.get("query") or "").strip()
    limit = max(1, min(int(args.get("limit") or 10), 25))
    try:
        found = await agentmail.search(query=query, limit=limit)
    except agentmail.MailUnavailable as exc:
        return _unavailable(exc)
    if not found:
        return ToolResult.ok(f"No messages match '{query}'.")
    lines = [f"{len(found)} thread(s) matching '{query}':"]
    for item in found:
        sender = (
            item.get("from")
            or (item.get("senders", ["unknown"])[0] if item.get("senders") else "unknown")
        )
        lines.append(
            f"- id={item.get('thread_id') or item.get('id')}"
            f" from={sender}"
            f" subject={item.get('subject') or '(none)'}"
            f" unread={bool(item.get('unread'))}"
            f"\n  {(item.get('snippet') or item.get('preview') or '')[:200]}"
        )
    return ToolResult.ok("\n".join(lines))


async def read_agentmail(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Read a thread from the agent's AgentMail inbox."""
    if not agentmail.configured():
        return _unavailable(Exception("AGENTMAIL_API_KEY not set."))
    thread_id = (args.get("thread_id") or "").strip()
    if not thread_id:
        return ToolResult.error("read_agentmail needs a thread_id, from search_agentmail.")
    try:
        conversation = await agentmail.thread(thread_id=thread_id)
    except agentmail.MailUnavailable as exc:
        return _unavailable(exc)
    parts = [f"Subject: {conversation.get('subject') or '(none)'}"]
    for message in conversation.get("messages") or []:
        ts = message.get("date") or message.get("created_at")
        body_text = (
            message.get("body") or message.get("text") or message.get("snippet") or ""
        )[: PREVIEW_CHARS * 4]
        parts.append(f"\n--- from {message.get('from')} at {ts} ---\n{body_text}")
    return ToolResult.ok("\n".join(parts))


async def send_agentmail(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Send an email from the agent's AgentMail inbox."""
    if not agentmail.configured():
        return _unavailable(Exception("AGENTMAIL_API_KEY not set."))
    body = args.get("body") or ""
    subject = (args.get("subject") or "").strip()
    if not body.strip():
        return ToolResult.error("send_agentmail needs a body.")
    if not subject:
        return ToolResult.error("send_agentmail needs a subject.")
    try:
        sent = await agentmail.send(
            body,
            subject=subject,
            to=args.get("to"),
            cc=args.get("cc"),
        )
    except agentmail.MailUnavailable as exc:
        return _unavailable(exc)
    except Exception as exc:
        log.exception("send_agentmail failed")
        return ToolResult.error(f"The message was not sent: {type(exc).__name__}: {exc}")
    return ToolResult.ok(
        f"Sent to {sent['to']} from {sent['from']}."
        f" Subject: {sent['subject']}. AgentMail message id {sent['message_id']}."
    )


async def reply_agentmail(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Reply to a thread in the agent's AgentMail inbox."""
    if not agentmail.configured():
        return _unavailable(Exception("AGENTMAIL_API_KEY not set."))
    thread_id = (args.get("thread_id") or "").strip()
    body = args.get("body") or ""
    if not thread_id or not body.strip():
        return ToolResult.error("reply_agentmail needs a thread_id and a body.")
    try:
        sent = await agentmail.reply(thread_id, body)
    except agentmail.MailUnavailable as exc:
        return _unavailable(exc)
    except Exception as exc:
        log.exception("reply_agentmail failed")
        return ToolResult.error(f"The reply was not sent: {type(exc).__name__}: {exc}")
    return ToolResult.ok(f"Replied in thread {sent['thread_id']}, message id {sent['message_id']}.")


async def draft_agentmail(args: dict[str, Any], _: ToolContext) -> ToolResult:
    """Save a draft in the agent's AgentMail inbox."""
    if not agentmail.configured():
        return _unavailable(Exception("AGENTMAIL_API_KEY not set."))
    body = args.get("body") or ""
    subject = (args.get("subject") or "").strip()
    if not body.strip() or not subject:
        return ToolResult.error("draft_agentmail needs a subject and a body.")
    try:
        draft = await agentmail.draft(body, subject=subject, to=args.get("to"))
    except agentmail.MailUnavailable as exc:
        return _unavailable(exc)
    except Exception as exc:
        log.exception("draft_agentmail failed")
        return ToolResult.error(f"The draft was not saved: {type(exc).__name__}: {exc}")
    return ToolResult.ok(
        f"Saved a draft to {draft['to']}. Subject: {draft['subject']}."
        f" AgentMail draft id {draft['draft_id']}."
    )


def available() -> tuple[bool, str]:
    """Whether mail can be used at all, and the sentence to show if it cannot.

    Read by the automation editor, so "Send email" is offered as a grant the
    user can see is unavailable rather than as a switch that fails at 7:30am.
    """
    # Prefer AgentMail for automation grants when configured (agent's own identity)
    if agentmail.configured():
        return True, "AgentMail"
    try:
        found = gmail.accounts()
    except Exception as exc:
        return False, f"Mail could not be checked: {exc}"
    if not found:
        return False, "No Google account is signed in. Connect Gmail under Skills & connectors."
    account = found[0]
    if not account.can_send:
        return False, (
            f"{account.address} is signed in with read access only."
            " Sign in again and grant the send scope."
        )
    return True, account.address


def tools() -> list[Tool]:
    return [
        # Gmail tools (user's personal mail)
        Tool(
            name="search_email",
            description=(
                "Search the user's Gmail and return matching threads with ids, senders, "
                "subjects and snippets. Gmail query syntax: 'is:unread in:inbox', "
                "'from:someone@example.com newer_than:2d'."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Gmail query. Default in:inbox."},
                    "limit": {"type": "integer", "description": "Threads to return, up to 25."},
                },
            },
            handler=search_email,
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="read_email",
            description="Read one Gmail thread in full, by the thread_id search_email returned.",
            parameters={
                "type": "object",
                "properties": {"thread_id": {"type": "string"}},
                "required": ["thread_id"],
            },
            handler=read_email,
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="send_email",
            description=(
                "Send an email via the user's Gmail. Leave 'to' empty to send to the user's "
                "own address (what a briefing or digest wants). The message is really sent, "
                "and the result carries the Gmail message id."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "body": {"type": "string", "description": "Plain text."},
                    "to": {"type": "string", "description": "Defaults to the user."},
                    "cc": {"type": "string"},
                },
                "required": ["subject", "body"],
            },
            handler=send_email,
            risk=RiskLevel.HIGH,
        ),
        Tool(
            name="reply_email",
            description=(
                "Reply to a Gmail thread, in the thread. Use read_email first so the reply "
                "answers what was actually said."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["thread_id", "body"],
            },
            handler=reply_email,
            risk=RiskLevel.HIGH,
        ),
        Tool(
            name="draft_email",
            description=(
                "Save an email as a draft in Gmail without sending it. Prefer this when the "
                "user asked for drafts to review, or when an automation is "
                "configured to draft rather than send."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                    "to": {"type": "string", "description": "Defaults to the user."},
                },
                "required": ["subject", "body"],
            },
            handler=draft_email,
            risk=RiskLevel.MEDIUM,
        ),
        # AgentMail tools (agent's own inbox)
        Tool(
            name="search_agentmail",
            description=(
                "Search the agent's own AgentMail inbox (@agentmail.to address) and return "
                "matching threads. Uses free-text search (not Gmail syntax). "
                "Requires AGENTMAIL_API_KEY in .env."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Free-text search query."},
                    "limit": {"type": "integer", "description": "Threads to return, up to 25."},
                },
            },
            handler=search_agentmail,
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="read_agentmail",
            description=(
                "Read one AgentMail thread in full, by the thread_id "
                "search_agentmail returned."
            ),
            parameters={
                "type": "object",
                "properties": {"thread_id": {"type": "string"}},
                "required": ["thread_id"],
            },
            handler=read_agentmail,
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="send_agentmail",
            description=(
                "Send an email from the agent's own AgentMail inbox. Leave 'to' empty to send "
                "to the agent's own address. The message is really sent, and the result carries "
                "the AgentMail message id. Requires AGENTMAIL_API_KEY in .env."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "body": {"type": "string", "description": "Plain text."},
                    "to": {"type": "string", "description": "Defaults to the agent's inbox."},
                    "cc": {"type": "string"},
                },
                "required": ["subject", "body"],
            },
            handler=send_agentmail,
            risk=RiskLevel.HIGH,
        ),
        Tool(
            name="reply_agentmail",
            description=(
                "Reply to an AgentMail thread, in the thread. Use read_agentmail first so the "
                "reply answers what was actually said."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["thread_id", "body"],
            },
            handler=reply_agentmail,
            risk=RiskLevel.HIGH,
        ),
        Tool(
            name="draft_agentmail",
            description=(
                "Save an email as a draft in the agent's AgentMail inbox without sending it. "
                "Requires AGENTMAIL_API_KEY in .env."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                    "to": {"type": "string", "description": "Defaults to the agent's inbox."},
                },
                "required": ["subject", "body"],
            },
            handler=draft_agentmail,
            risk=RiskLevel.MEDIUM,
        ),
    ]