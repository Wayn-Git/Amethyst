"""Read personal chat exports locally. Never logs or uploads conversation contents."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field

from backend.today import TodayItem, save_item


class ConversationImport(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    source: Literal["WhatsApp", "Instagram"]
    title: str = Field(min_length=1, max_length=240)
    content: str = Field(min_length=1, max_length=2_000_000)
    state: Literal["needs_reply", "waiting", "backlog"] = "needs_reply"
    day_first: bool = True
    timezone: str = "UTC"


# Android: 24/10/26, 09:40 - Name: text. iOS: [24/10/26, 09:40:00] Name: text.
_HEADER = re.compile(
    r"^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+"
    r"(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\]?\s*(?:-\s*)?(.+)$"
)


def _whatsapp(content: str, day_first: bool, zone: ZoneInfo) -> list[dict]:
    messages = []
    for line in content.replace("\u200e", "").replace("\u202f", " ").splitlines():
        match = _HEADER.match(line)
        if not match:
            if messages:
                messages[-1]["text"] += "\n" + line
            continue
        raw_date, raw_time, body = match.groups()
        if ": " not in body:
            continue  # system notification, not a message
        sender, text = body.split(": ", 1)
        components = re.split(r"[/.-]", raw_date)
        if len(components[0]) == 4:
            year, month, day = map(int, components)
        else:
            first, second, year = map(int, components)
            day, month = (first, second) if day_first else (second, first)
            if year < 100:
                year += 2000
        try:
            clock = re.sub(r"\s*([ap]m)$", r" \1", raw_time, flags=re.I).upper()
            clock_format = "%I:%M" if clock.endswith(("AM", "PM")) else "%H:%M"
            if clock.count(":") == 2:
                clock_format += ":%S"
            if clock.endswith(("AM", "PM")):
                clock_format += " %p"
            parsed = datetime.strptime(clock, clock_format)
            stamp = datetime(
                year, month, day, parsed.hour, parsed.minute, parsed.second, tzinfo=zone
            )
        except ValueError as exc:
            raise ValueError("Could not read an export date. Check the day/month order.") from exc
        messages.append({"sender": sender, "text": text, "at": stamp.astimezone(UTC)})
    return messages


def _instagram(content: str) -> list[dict]:
    try:
        data = json.loads(content)
        rows = data["messages"]
        if not isinstance(rows, list):
            raise ValueError("messages must be a list")
        messages = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("timestamp_ms"):
                continue
            text = row.get("content") or "[Media attachment]"
            if not isinstance(text, str):
                continue
            # Meta exports sometimes encode UTF-8 bytes as Latin-1 escapes.
            try:
                text = text.encode("latin-1").decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
            messages.append(
                {
                    "sender": str(row.get("sender_name") or "Unknown sender"),
                    "text": text,
                    "at": datetime.fromtimestamp(float(row["timestamp_ms"]) / 1000, UTC),
                }
            )
        return messages
    except (ValueError, TypeError, KeyError, OverflowError, OSError) as exc:
        raise ValueError(
            "Choose a conversation's message_1.json from your Instagram export."
        ) from exc


def import_conversation(body: ConversationImport) -> dict:
    try:
        zone = ZoneInfo(body.timezone)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError("Choose a valid timezone for this export.") from exc
    messages = (
        _whatsapp(body.content, body.day_first, zone)
        if body.source == "WhatsApp"
        else _instagram(body.content)
    )
    if not messages:
        raise ValueError(
            "No readable messages found. Use a WhatsApp text or Instagram JSON export."
        )
    messages.sort(key=lambda message: message["at"])
    recent = messages[-3:]
    summary = f"Latest {len(recent)} of {len(messages)} imported messages:\n" + "\n".join(
        f"{m['sender'][:80]}: {m['text'][:600]}" for m in recent
    )
    return save_item(
        TodayItem(
            kind="message",
            title=body.title,
            source=body.source,
            external_id=f"local-export:{body.title.casefold()}",
            state=body.state,
            summary=summary,
            occurred_at=messages[-1]["at"].isoformat(),
        )
    )
