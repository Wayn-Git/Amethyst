"""AgentMail — the agent's own email inbox.

**Why not through a connector.** AgentMail is an API-first email platform built for
AI agents. It gives the agent its own identity (an @agentmail.to address) that can
send, receive, and act on email without piggybacking on a human's Gmail account.
The same code the Mail view reads powers the tools, so the two cannot drift.

**Where the credentials come from.** The `AGENTMAIL_API_KEY` environment variable
holds an org-wide bearer key (created in the AgentMail dashboard). This module reads
it and never writes it. If the key is missing or invalid, every call raises
`MailUnavailable` with a sentence saying why — the model is told, in words, that
mail did not go out.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

from backend.mail.gmail import MailUnavailable
from backend.runtime.http import _client

log = logging.getLogger(__name__)

API = "https://api.agentmail.to/v0"

# --- exception is MailUnavailable from gmail, reused deliberately ---


@dataclass(frozen=True)
class AgentMailInbox:
    inbox_id: str
    email: str
    display_name: str | None


def _api_key() -> str | None:
    return os.environ.get("AGENTMAIL_API_KEY") or os.environ.get("AGENTMAIL_API_KEY")


def _headers() -> dict[str, str]:
    key = _api_key()
    if not key:
        raise MailUnavailable(
            "AGENTMAIL_API_KEY is not set. Add it to .env to enable AgentMail."
        )
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def configured() -> bool:
    """Whether the AgentMail key is present (does not verify reachability)."""
    return bool(_api_key())


async def inboxes() -> list[AgentMailInbox]:
    """List all inboxes in the organization."""
    resp = await _client(30.0).get(f"{API}/inboxes", headers=_headers())
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return [
        AgentMailInbox(
            inbox_id=i["inbox_id"],
            email=i["email"],
            display_name=i.get("display_name"),
        )
        for i in data.get("inboxes", [])
    ]


async def _preferred_inbox() -> AgentMailInbox:
    found = await inboxes()
    if not found:
        raise MailUnavailable(
            "No AgentMail inboxes exist. Create one in the AgentMail dashboard."
        )
    env_choice = os.environ.get("AMETHYST_AGENTMAIL_INBOX")
    if env_choice:
        for i in found:
            if i.inbox_id == env_choice or i.email == env_choice:
                return i
        raise MailUnavailable(
            f"AMETHYST_AGENTMAIL_INBOX={env_choice!r} not found among inboxes."
        )
    return found[0]


def _summarise_thread(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "thread_id": t.get("thread_id"),
        "subject": t.get("subject") or "(no subject)",
        "senders": t.get("senders") or [],
        "recipients": t.get("recipients") or [],
        "preview": t.get("preview") or "",
        "last_message_at": t.get("last_message_at"),
        "message_count": t.get("message_count"),
        "unread": t.get("unread"),
    }


async def threads(
    inbox_id: str | None = None, limit: int = 25
) -> list[dict[str, Any]]:
    """Newest threads in an inbox, summarised."""
    box = inbox_id or (await _preferred_inbox()).inbox_id
    resp = await _client(30.0).get(
        f"{API}/inboxes/{box}/threads",
        headers=_headers(),
        params={"limit": max(1, min(limit, 100))},
    )
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return [_summarise_thread(t) for t in data.get("threads", [])]


async def thread(inbox_id: str | None, thread_id: str) -> dict[str, Any]:
    """One conversation with every message's body."""
    box = inbox_id or (await _preferred_inbox()).inbox_id
    resp = await _client(30.0).get(
        f"{API}/inboxes/{box}/threads/{thread_id}", headers=_headers()
    )
    if resp.status_code == 404:
        raise MailUnavailable("Thread not found or was deleted.")
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    t = resp.json()
    messages = t.get("messages") or []
    out = []
    for m in messages:
        out.append(
            {
                "message_id": m.get("message_id"),
                "thread_id": m.get("thread_id"),
                "from": m.get("from"),
                "to": m.get("to") or [],
                "cc": m.get("cc") or [],
                "subject": m.get("subject"),
                "text": m.get("text") or "",
                "html": m.get("html") or "",
                "created_at": m.get("created_at"),
                "attachments": m.get("attachments") or [],
            }
        )
    return {
        "thread_id": t.get("thread_id"),
        "subject": out[0].get("subject") if out else t.get("subject") or "(no subject)",
        "messages": out,
    }


async def search(
    query: str, inbox_id: str | None = None, limit: int = 25
) -> list[dict[str, Any]]:
    """Free-text search across messages in an inbox."""
    box = inbox_id or (await _preferred_inbox()).inbox_id
    resp = await _client(30.0).get(
        f"{API}/inboxes/{box}/messages/search",
        headers=_headers(),
        params={"q": query, "limit": max(1, min(limit, 100))},
    )
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return [_summarise_thread(t) for t in data.get("threads", [])]


async def send(
    body: str,
    *,
    subject: str,
    to: str | list[str] | None = None,
    cc: str | list[str] | None = None,
    bcc: str | list[str] | None = None,
    html: str | None = None,
    inbox_id: str | None = None,
) -> dict[str, Any]:
    """Send a new message. Returns AgentMail's message_id and thread_id.

    `to` defaults to the agent's own inbox (the common case for a briefing).
    """
    box = inbox_id or (await _preferred_inbox()).inbox_id

    def norm(v: str | list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return [x.strip() for x in v if x.strip()]

    payload = {
        "to": norm(to) or [box],
        "subject": subject or "(no subject)",
        "text": body,
    }
    if norm(cc):
        payload["cc"] = norm(cc)
    if norm(bcc):
        payload["bcc"] = norm(bcc)
    if html:
        payload["html"] = html

    resp = await _client(30.0).post(
        f"{API}/inboxes/{box}/messages/send", headers=_headers(), json=payload
    )
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return {
        "message_id": data.get("message_id"),
        "thread_id": data.get("thread_id"),
        "to": payload["to"],
        "from": box,
        "subject": payload["subject"],
    }


async def reply(
    thread_id: str,
    body: str,
    *,
    inbox_id: str | None = None,
) -> dict[str, Any]:
    """Reply to the last message in a thread, in the thread."""
    box = inbox_id or (await _preferred_inbox()).inbox_id
    # Get the thread to find the last message_id
    t = await thread(box, thread_id)
    messages = t.get("messages") or []
    if not messages:
        raise MailUnavailable("That thread has no messages to reply to.")
    last_msg_id = messages[-1].get("message_id")
    if not last_msg_id:
        raise MailUnavailable("Last message in thread has no ID.")

    resp = await _client(30.0).post(
        f"{API}/inboxes/{box}/messages/{last_msg_id}/reply",
        headers=_headers(),
        json={"text": body},
    )
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return {
        "message_id": data.get("message_id"),
        "thread_id": data.get("thread_id"),
    }


async def draft(
    body: str,
    *,
    subject: str,
    to: str | list[str] | None = None,
    cc: str | list[str] | None = None,
    bcc: str | list[str] | None = None,
    html: str | None = None,
    inbox_id: str | None = None,
) -> dict[str, Any]:
    """Save a draft without sending."""
    box = inbox_id or (await _preferred_inbox()).inbox_id

    def norm(v: str | list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return [x.strip() for x in v if x.strip()]

    payload = {
        "to": norm(to) or [box],
        "subject": subject or "(no subject)",
        "text": body,
    }
    if norm(cc):
        payload["cc"] = norm(cc)
    if norm(bcc):
        payload["bcc"] = norm(bcc)
    if html:
        payload["html"] = html

    resp = await _client(30.0).post(
        f"{API}/inboxes/{box}/drafts", headers=_headers(), json=payload
    )
    if resp.status_code == 401:
        raise MailUnavailable("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.")
    if resp.status_code >= 400:
        raise MailUnavailable(f"AgentMail answered {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return {
        "draft_id": data.get("draft_id"),
        "to": payload["to"],
        "from": box,
        "subject": payload["subject"],
    }


async def available() -> tuple[bool, str]:
    """Whether AgentMail can be used, and the sentence to show if not.

    Read by the automation editor, so "Send email" is offered as a grant the
    user can see is unavailable rather than as a switch that fails at 7:30am.
    """
    if not configured():
        return False, "AGENTMAIL_API_KEY is not set. Add it to .env to enable AgentMail."
    try:
        found = await inboxes()
    except MailUnavailable as exc:
        return False, str(exc)
    except Exception as exc:
        return False, f"AgentMail could not be checked: {exc}"
    if not found:
        return False, "No AgentMail inboxes exist. Create one in the AgentMail dashboard."
    return True, found[0].email