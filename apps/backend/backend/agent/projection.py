"""Field projection for agent tool results.

Strips bulky metadata, raw MIME trees, base64 payloads, full header blocks,
and redundant attributes before tool results are fed into the model's context.
Keeps only the essential fields needed for accurate reasoning and answers.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.mcp.composio_sanitizer import (
    decode_email_data,
    html_to_plain_text,
    sanitize_composio_content,
)

log = logging.getLogger(__name__)


def _extract_header(headers: list[dict[str, str]] | dict[str, str] | None, name: str) -> str:
    """Extract a header value case-insensitively."""
    if not headers:
        return ""
    if isinstance(headers, dict):
        for k, v in headers.items():
            if k.lower() == name.lower():
                return str(v)
        return ""
    if isinstance(headers, list):
        target = name.lower()
        for h in headers:
            if isinstance(h, dict) and h.get("name", "").lower() == target:
                return str(h.get("value", ""))
    return ""


def _extract_date_str(val: Any) -> str:
    """Normalize date representations from API responses."""
    if isinstance(val, dict):
        return str(val.get("dateTime") or val.get("date") or "")
    return str(val or "")


def project_email_item(item: dict[str, Any]) -> dict[str, Any]:
    """Project a single email object to its minimal essential fields."""
    headers = None
    payload = item.get("payload")
    if isinstance(payload, dict):
        headers = payload.get("headers")
    if not headers:
        headers = item.get("headers")

    sender = (
        item.get("from")
        or item.get("sender")
        or _extract_header(headers, "from")
        or "unknown"
    )
    subject = (
        item.get("subject")
        or _extract_header(headers, "subject")
        or "(no subject)"
    )
    date = (
        item.get("date")
        or _extract_header(headers, "date")
        or ""
    )
    snippet = item.get("snippet") or ""
    if not snippet and "body" in item:
        body = item["body"]
        if isinstance(body, str):
            snippet = body
        elif isinstance(body, dict) and "data" in body:
            snippet = decode_email_data(body["data"])

    if snippet:
        snippet = html_to_plain_text(snippet).strip()
        if len(snippet) > 300:
            snippet = snippet[:297] + "..."

    msg_id = item.get("id") or item.get("message_id") or ""
    thread_id = item.get("threadId") or item.get("thread_id") or ""

    projected: dict[str, Any] = {
        "id": msg_id,
        "from": sender,
        "subject": subject,
        "date": date,
        "snippet": snippet,
    }
    if thread_id and thread_id != msg_id:
        projected["thread_id"] = thread_id

    label_ids = item.get("labelIds") or item.get("label_ids")
    if label_ids and isinstance(label_ids, list):
        if "UNREAD" in label_ids:
            projected["unread"] = True

    return projected


def project_calendar_item(item: dict[str, Any]) -> dict[str, Any]:
    """Project a single calendar event object to its minimal essential fields."""
    title = (
        item.get("summary")
        or item.get("title")
        or item.get("name")
        or "(untitled event)"
    )
    start = _extract_date_str(item.get("start") or item.get("start_datetime") or item.get("starts_at"))
    end = _extract_date_str(item.get("end") or item.get("end_datetime") or item.get("ends_at"))
    event_id = item.get("id") or item.get("event_id") or ""

    projected: dict[str, Any] = {
        "id": event_id,
        "title": title,
        "start": start,
        "end": end,
    }

    location = item.get("location")
    if location:
        projected["location"] = str(location)

    status = item.get("status")
    if status and status != "confirmed":
        projected["status"] = str(status)

    link = item.get("htmlLink") or item.get("link")
    if link:
        projected["link"] = str(link)

    attendees = item.get("attendees")
    if isinstance(attendees, list) and attendees:
        emails = [
            a.get("email") if isinstance(a, dict) else str(a)
            for a in attendees
            if a
        ]
        if emails:
            projected["attendees"] = emails[:5]

    return projected


def project_github_item(item: dict[str, Any]) -> dict[str, Any]:
    """Project a single GitHub issue, pull request, or commit to essential fields."""
    number = item.get("number")
    title = item.get("title") or item.get("name") or ""
    state = item.get("state") or ""

    author = ""
    user = item.get("user")
    if isinstance(user, dict):
        author = user.get("login") or ""
    elif isinstance(user, str):
        author = user

    created_at = item.get("created_at") or ""
    body = item.get("body") or ""
    if isinstance(body, str) and body:
        body = body.strip()
        if len(body) > 300:
            body = body[:297] + "..."

    projected: dict[str, Any] = {
        "title": title,
    }
    if number is not None:
        projected["number"] = number
    if state:
        projected["state"] = state
    if author:
        projected["author"] = author
    if created_at:
        projected["created_at"] = created_at
    if body:
        projected["snippet"] = body
    if item.get("html_url"):
        projected["url"] = item["html_url"]

    labels = item.get("labels")
    if isinstance(labels, list) and labels:
        label_names = [l.get("name") if isinstance(l, dict) else str(l) for l in labels]
        projected["labels"] = label_names

    return projected


def _find_list_in_data(data: Any) -> list[Any] | None:
    """Find the primary list payload in a nested response dictionary."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "events", "messages", "threads", "results", "response_data", "data"):
            val = data.get(key)
            if isinstance(val, list):
                return val
            if isinstance(val, dict):
                nested = _find_list_in_data(val)
                if nested is not None:
                    return nested
    return None


def project_tool_payload(
    payload: Any,
    tool_name: str = "",
) -> Any:
    """Project an already-parsed JSON payload to its projected representation."""
    name = (tool_name or "").lower()

    # 1. Mail projection
    if any(k in name for k in ("mail", "email", "gmail")):
        items = _find_list_in_data(payload)
        if items is not None:
            return [project_email_item(it) if isinstance(it, dict) else it for it in items]
        if isinstance(payload, dict):
            # Single email details
            if "id" in payload or "snippet" in payload or "payload" in payload or "subject" in payload:
                return project_email_item(payload)

    # 2. Calendar projection
    elif "calendar" in name:
        items = _find_list_in_data(payload)
        if items is not None:
            return [project_calendar_item(it) if isinstance(it, dict) else it for it in items]
        if isinstance(payload, dict) and ("summary" in payload or "start" in payload):
            return project_calendar_item(payload)

    # 3. GitHub projection
    elif "github" in name:
        items = _find_list_in_data(payload)
        if items is not None:
            return [project_github_item(it) if isinstance(it, dict) else it for it in items]
        if isinstance(payload, dict) and ("number" in payload or "title" in payload):
            return project_github_item(payload)

    return payload


def project_tool_result_content(
    content: str,
    *,
    tool_name: str = "",
    arguments: dict[str, Any] | None = None,
) -> str:
    """Apply field projection and sanitization to tool result content string.

    Parses JSON content, strips heavy bloat, projects essential fields,
    and returns a clean, compact serialized JSON string.
    """
    if not content or not content.strip():
        return content

    # Pre-clean Composio MIME/CSS if applicable
    sanitized = sanitize_composio_content(content, tool_name=tool_name, arguments=arguments)

    trimmed = sanitized.strip()
    if not ((trimmed.startswith("{") and trimmed.endswith("}")) or (trimmed.startswith("[") and trimmed.endswith("]"))):
        return sanitized

    try:
        data = json.loads(trimmed)
    except Exception:
        return sanitized

    projected = project_tool_payload(data, tool_name=tool_name)
    try:
        return json.dumps(projected, indent=2, ensure_ascii=False)
    except Exception:
        return sanitized
