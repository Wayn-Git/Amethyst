"""Publishing what a control device needs to show.

The rest of the sync layer emits an op when something is written, at the point
it is written. That works for a setting, which is changed by one endpoint, and
would be miserable for a transcript: messages are written from the agent loop,
the tool dispatcher, the automation runner and the subagent runner, and
threading an emit through all of them would put the sync layer inside the parts
of this system that change most.

So the transcript is published by *sweeping* instead, once per poll. It costs
one indexed query against a watermark, it cannot be forgotten by a new caller,
and it keeps `backend/agent/` unaware that any of this exists.

The watermarks live in `app_settings` and are not on the sync allowlist -- they
describe how far *this* device has published, which is the one thing that must
never be the same on two devices.

Nothing here decides what a phone may see beyond the entity's own field list.
What stops a control device reading a conversation it should not is that there
is only one user; the boundary this system defends is the relay, not the phone.
"""

from __future__ import annotations

import logging
import uuid as uuidlib

from backend.sync import ops
from backend.sync.registry import MAX_SYNCED_CONTENT, TRUNCATION_MARKER

log = logging.getLogger(__name__)

#: `messages.id` is an autoincrementing integer, so "what is new" is a number
#: rather than a timestamp -- no clock skew, no ties, no rows missed because two
#: landed in the same second.
MESSAGE_WATERMARK = "sync.watermark.messages"

#: Conversations and runs have no such counter, so these hold the `updated_at`
#: of the last row published. Compared with `>=` and deduplicated by the merge,
#: because a row written in the same second as the watermark must not be missed
#: -- re-publishing one costs an op that changes nothing on the far side.
CONVERSATION_WATERMARK = "sync.watermark.conversations"
RUN_WATERMARK = "sync.watermark.runs"
LIBRARY_WATERMARK = "sync.watermark.library"

#: How many rows one poll publishes. A machine that has been running for a month
#: before its first phone is paired catches up over several polls rather than
#: building one op batch the relay would refuse.
BATCH = 50


def _watermark(conn, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row and row[0] is not None else default


def _set_watermark(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


def _cap(content: str | None) -> str | None:
    """A transcript is text; a tool result can be a megabyte of JSON."""
    if content is None or len(content) <= MAX_SYNCED_CONTENT:
        return content
    return content[:MAX_SYNCED_CONTENT] + TRUNCATION_MARKER


def publish(conn, clock, *, limit: int = BATCH) -> int:
    """Emit ops for what has changed since the last sweep. Returns how many.

    Called from the poller before the outbox is sealed, so a message written a
    second ago leaves on the poll that follows it rather than the one after.
    """
    return (
        _publish_conversations(conn, clock, limit)
        + _publish_messages(conn, clock, limit)
        + _publish_runs(conn, clock, limit)
        + _publish_library(conn, clock, limit)
    )


def _publish_conversations(conn, clock, limit: int) -> int:
    mark = _watermark(conn, CONVERSATION_WATERMARK)
    rows = conn.execute(
        "SELECT id, title, provider, model, pinned, archived, updated_at"
        " FROM conversations WHERE updated_at >= ? ORDER BY updated_at LIMIT ?",
        (mark, limit),
    ).fetchall()
    published = 0
    for row in rows:
        emitted = ops.emit(conn, clock, "conversations", row[0], {
            "title": row[1], "provider": row[2], "model": row[3],
            "pinned": row[4], "archived": row[5],
        })
        if emitted is not None:
            published += 1
        _set_watermark(conn, CONVERSATION_WATERMARK, row[6])
    return published


def _publish_messages(conn, clock, limit: int) -> int:
    mark = int(_watermark(conn, MESSAGE_WATERMARK, "0") or 0)
    rows = conn.execute(
        "SELECT id, uuid, conversation_id, role, content, created_at, seq"
        " FROM messages WHERE id > ? ORDER BY id LIMIT ?",
        (mark, limit),
    ).fetchall()
    published = 0
    for row_id, row_uuid, conversation_id, role, content, created_at, row_seq in rows:
        if not row_uuid:
            row_uuid = str(uuidlib.uuid4())
            conn.execute("UPDATE messages SET uuid = ? WHERE id = ?", (row_uuid, row_id))
        if row_seq != row_id:
            conn.execute("UPDATE messages SET seq = ? WHERE id = ?", (row_id, row_id))
        emitted = ops.emit(conn, clock, "messages", row_uuid, {
            "conversation_id": conversation_id,
            "role": role,
            "content": _cap(content),
            "created_at": created_at,
            # The write order, explicitly. See the column's comment in
            # schema.sql: a phone sorting on `created_at` alone renders the
            # answer above the question whenever both land in one second.
            "seq": row_id,
        })
        if emitted is not None:
            published += 1
        _set_watermark(conn, MESSAGE_WATERMARK, row_id)
    return published


def _publish_runs(conn, clock, limit: int) -> int:
    """So a phone can say "it is thinking" rather than nothing at all."""
    mark = _watermark(conn, RUN_WATERMARK)
    rows = conn.execute(
        "SELECT id, conversation_id, phase, link, error, updated_at"
        " FROM agent_runs WHERE updated_at >= ? ORDER BY updated_at LIMIT ?",
        (mark, limit),
    ).fetchall()
    published = 0
    for row in rows:
        emitted = ops.emit(conn, clock, "agent_runs", row[0], {
            "conversation_id": row[1], "phase": row[2], "link": row[3], "error": row[4],
        })
        if emitted is not None:
            published += 1
        _set_watermark(conn, RUN_WATERMARK, row[5])
    return published


def _publish_library(conn, clock, limit: int) -> int:
    """What you have saved, so a phone can look it up while away from the disk.

    Metadata only -- `registry.py`'s field list is what keeps the files out of
    it. A row with no uuid gets one here, the same late backfill messages use.
    """
    mark = _watermark(conn, LIBRARY_WATERMARK)
    rows = conn.execute(
        "SELECT id, uuid, kind, title, url, author, site, published_on, consumed_on,"
        " notes, rating, summary, tags, word_count, duration_seconds, source_ref, updated_at"
        " FROM library_items WHERE updated_at >= ? ORDER BY updated_at LIMIT ?",
        (mark, limit),
    ).fetchall()
    published = 0
    for row in rows:
        row_uuid = row[1]
        if not row_uuid:
            row_uuid = str(uuidlib.uuid4())
            conn.execute("UPDATE library_items SET uuid = ? WHERE id = ?", (row_uuid, row[0]))
        emitted = ops.emit(conn, clock, "library", row_uuid, {
            "kind": row[2], "title": row[3], "url": row[4], "author": row[5],
            "site": row[6], "published_on": row[7], "consumed_on": row[8],
            "notes": row[9], "rating": row[10], "summary": row[11], "tags": row[12],
            "word_count": row[13], "duration_seconds": row[14], "source_ref": row[15],
        })
        if emitted is not None:
            published += 1
        _set_watermark(conn, LIBRARY_WATERMARK, row[16])
    return published
