"""Library-save hook for Amethyst local backend.

Mirrors saved items into Turso library_mirror and batches saved items
over a 10-minute window to deliver exactly one email per batch.
Completely non-blocking and fail-safe: failures never affect library operations.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

from notifier.db import TursoDB
from notifier.mailer import Mailer

log = logging.getLogger("amethyst.notifier.library_hook")

# Default 10-minute batch window (600 seconds)
DEFAULT_BATCH_WINDOW_SECONDS = 600.0

_LOCK = threading.Lock()
_BATCH: list[dict[str, Any]] = []
_TIMER: threading.Timer | None = None


def get_batch_window_seconds() -> float:
    env_val = os.getenv("NOTIFIER_LIBRARY_BATCH_SECONDS")
    if env_val:
        try:
            return float(env_val)
        except ValueError:
            pass
    return DEFAULT_BATCH_WINDOW_SECONDS


def _format_batch_email(items: list[dict[str, Any]]) -> tuple[str, str]:
    count = len(items)
    item_str = "item" if count == 1 else "items"
    subject = f"You saved {count} {item_str} to your library"

    lines = [
        f"You saved {count} {item_str}, want to look at them on your laptop?",
        "",
    ]
    for it in items:
        title = it.get("title") or "Untitled item"
        url = it.get("url")
        if url:
            lines.append(f"- [{title}]({url})")
        else:
            lines.append(f"- **{title}**")

    lines.extend([
        "",
        "---",
        "Amethyst Library Notifier",
    ])
    return subject, "\n".join(lines)


def flush_library_batch(mailer: Mailer | None = None) -> int:
    """Flush the accumulated library batch immediately and send one email."""
    global _BATCH, _TIMER

    with _LOCK:
        if _TIMER is not None:
            _TIMER.cancel()
            _TIMER = None

        if not _BATCH:
            return 0

        items_to_send = list(_BATCH)
        _BATCH.clear()

    subject, body = _format_batch_email(items_to_send)
    try:
        mailer = mailer or Mailer()
        res = mailer.send_email(
            subject=subject,
            text=body,
            urgent=False,
        )
        log.info("Batched library save email sent: %s (status=%s)", subject, res.status)
    except Exception as exc:
        log.error("Failed to send batched library save email: %s", exc)

    return len(items_to_send)


def _on_timer_fire() -> None:
    try:
        flush_library_batch()
    except Exception as exc:
        log.error("Error in library batch timer handler: %s", exc)


def on_library_item_saved(
    item_id: int,
    title: str,
    url: str | None = None,
    kind: str | None = None,
    db: TursoDB | None = None,
) -> None:
    """Invoked whenever an item is created in the local library.

    1. Asynchronously mirrors item into Turso library_mirror.
    2. Buffers item in the 10-minute batch window.
    """
    # 1. Mirror to Turso in background thread
    def _mirror() -> None:
        try:
            target_db = db or TursoDB()
            target_db.insert_library_mirror(item_id=item_id, title=title, url=url)
            log.debug("Mirrored library item #%d to Turso", item_id)
        except Exception as exc:
            log.warning("Could not mirror library item #%d to Turso: %s", item_id, exc)

    threading.Thread(target=_mirror, daemon=True).start()

    # 2. Add to batch buffer and ensure timer is running
    global _BATCH, _TIMER
    with _LOCK:
        _BATCH.append({
            "id": item_id,
            "title": title,
            "url": url,
            "kind": kind,
        })
        # If no active timer, schedule one
        if _TIMER is None:
            window = get_batch_window_seconds()
            _TIMER = threading.Timer(window, _on_timer_fire)
            _TIMER.daemon = True
            _TIMER.start()
            log.info("Started %0.1fs library batch timer for %d items", window, len(_BATCH))
        else:
            log.info("Appended item #%d to active library batch (%d items)", item_id, len(_BATCH))
