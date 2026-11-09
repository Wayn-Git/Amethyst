"""Bounded native Gmail refresh for tracked threads. No model or external writes."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from backend.today import items, now, patch_item, save_snapshot, snapshot

MAX_THREADS = 20
REFRESH_SECONDS = 300


def due_threads() -> list[dict]:
    candidates = []
    for item in items():
        if item["kind"] != "email" or item["source"].casefold() != "gmail":
            continue
        if item["state"] == "done" or not item.get("external_id"):
            continue
        status = snapshot(f"thread:{item['id']}")
        checked = status.get("checked_at")
        elapsed = (
            (datetime.now(UTC) - datetime.fromisoformat(checked)).total_seconds()
            if checked
            else float("inf")
        )
        if elapsed >= REFRESH_SECONDS:
            candidates.append((checked or "", item))
    return [item for _, item in sorted(candidates, key=lambda pair: pair[0])[:MAX_THREADS]]


async def refresh_threads(pending: list[dict]) -> None:
    from backend.mail import thread

    gate = asyncio.Semaphore(4)

    async def refresh(item):
        key = f"thread:{item['id']}"
        previous = snapshot(key)
        async with gate:
            try:
                result = await asyncio.wait_for(thread(item["external_id"]), timeout=8)
                messages = result.get("messages") or []
                if not messages:
                    raise ValueError("No messages returned")
                # Gmail returns thread messages in chronological order.
                latest = messages[-1]
                message_id = latest.get("id")
                if not message_id:
                    raise ValueError("Message identity unavailable")
                changed = message_id != previous.get("message_id")
                if changed:
                    patch = {
                        "summary": f"{latest.get('from', 'Unknown sender')}\n{latest.get('snippet') or latest.get('body') or ''}"[
                            :4000
                        ]
                    }
                    if latest.get("date"):
                        stamp = parsedate_to_datetime(latest["date"])
                        if stamp.tzinfo is not None:
                            patch["occurred_at"] = stamp.astimezone(UTC).isoformat()
                    # Only evidence changes. Priority, follow-up, snooze and reply state remain yours.
                    patch_item(item["id"], patch)
                save_snapshot(key, {"checked_at": now(), "message_id": message_id, "error": None})
            except Exception:
                save_snapshot(
                    key,
                    {
                        **previous,
                        "checked_at": now(),
                        "error": "Could not check this Gmail thread. Showing the last recorded activity.",
                    },
                )

    await asyncio.gather(*(refresh(item) for item in pending))
