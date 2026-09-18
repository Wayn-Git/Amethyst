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

#: Conversations, runs and library items have no such counter, so these hold the
#: `updated_at` *and* the `id` of the last row published, as a strict cursor.
#:
#: It used to be the timestamp alone, compared with `>=` -- because a row written
#: in the same second as the watermark must not be missed -- and the cost was
#: written off as "an op that changes nothing on the far side". That is true of
#: correctness and false of everything else. `>=` against a watermark set to that
#: same row's timestamp matches the row again on the next sweep, and the one
#: after, forever: one library item published 413 times in four hours, seven
#: conversations sixty times each, ~7,700 ops a day out of about forty real
#: changes. Every one is a new op id, a new sealed payload and a new row at the
#: relay, and it is what took a 6MB database over D1's five-million-rows-a-day
#: read limit -- at which point the relay stops answering and sync simply stops.
#:
#: `(updated_at, id) > (mark_ts, mark_id)` misses nothing and repeats nothing: a
#: row written in the same second still qualifies on its id. A watermark left
#: over from the old format parses as `(ts, 0)`, which republishes that second's
#: rows exactly once more and then settles.
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


#: Between the timestamp and the ids in a stored cursor. A unit separator
#: because no timestamp or id may contain one.
_CURSOR_SEP = "\x1f"

#: How many ids from the newest second a cursor remembers. These are rows that
#: share one `updated_at`, so in practice it is one or two -- a turn touching a
#: conversation and its run. The cap stops a pathological second from growing
#: the setting without bound; past it the sweep falls back to a strict `>`,
#: which can miss a row until its next write. Choosing which way to be wrong at
#: fifty rows in one second is choosing between two things that do not happen.
_CURSOR_IDS = 50


def _cursor(conn, key: str) -> tuple[str, list[str]]:
    """How far this sweep got: the last `updated_at`, and the ids seen at it.

    Both halves are load-bearing, and each fixes the other's failure:

    `updated_at >= mark` alone never misses a row and republishes forever. The
    timestamp has second precision, the mark is set to a published row's own
    timestamp, so that row matches itself on the next sweep and every sweep
    after. Measured on a real machine: one library item published 413 times in
    four hours, about 7,700 ops a day out of forty real changes -- which is what
    took a 6MB D1 database past five million rows read in a day, at which point
    the relay stops answering and sync stops with it.

    A strict `(updated_at, id) > (mark_ts, mark_id)` never repeats and can miss:
    a row written in the same second as the mark but sorting earlier by id is
    already behind the cursor, and a missed update is silent and stays missed
    until something writes that row again.

    So the cursor carries the second *and the ids already published within it*.
    Rows after that second are new; rows inside it are new unless named. Nothing
    is missed, nothing repeats.
    """
    raw = _watermark(conn, key)
    if not raw:
        return ("", [])
    stamp, _, ids = raw.partition(_CURSOR_SEP)
    return (stamp, [i for i in ids.split(",") if i])


def _set_cursor(conn, key: str, stamp: str, seen: list[str]) -> None:
    _set_watermark(conn, key, f"{stamp}{_CURSOR_SEP}{','.join(str(i) for i in seen)}")


def _advance(mark: tuple[str, list[str]], stamp, row_id) -> tuple[str, list[str]]:
    """Fold one published row into the cursor."""
    stamp = str(stamp)
    if stamp != mark[0]:
        return (stamp, [str(row_id)])
    return (stamp, [*mark[1], str(row_id)][-_CURSOR_IDS:])


def _unseen(column: str, mark: tuple[str, list[str]]) -> tuple[str, tuple]:
    """The WHERE clause for "after the cursor", and what to bind.

    Written out rather than a row-value comparison because the three tables this
    sweeps disagree about their key type -- `conversations.id` and
    `agent_runs.id` are uuid TEXT, `library_items.id` is INTEGER -- and a row
    value applies the column's affinity to whatever is bound beside it.
    """
    stamp, seen = mark
    if not seen:
        return (f"{column} >= ?", (stamp,))
    marks = ",".join("?" for _ in seen)
    return (
        f"({column} > ? OR ({column} = ? AND id NOT IN ({marks})))",
        (stamp, stamp, *seen),
    )


def _cap(content: str | None) -> str | None:
    """A transcript is text; a tool result can be a megabyte of JSON."""
    if content is None or len(content) <= MAX_SYNCED_CONTENT:
        return content
    return content[:MAX_SYNCED_CONTENT] + TRUNCATION_MARKER


def rewind(conn) -> None:
    """Forget how far this machine has published, so the next sweep starts over.

    Called when a device pairs. A control device begins with an empty replica
    and is only ever sent ops emitted *after* it arrived, so without this it
    joins to a blank transcript and stays blank until somebody happens to edit
    something. The sweep then walks the tables from the beginning at `BATCH` a
    poll -- about 1,600 rows and eight minutes on a machine that has been in use
    a while, once, rather than every poll forever.

    Safe to run with a device already paired: the merge is idempotent by
    construction, so a row it has already seen costs one op and changes nothing.
    """
    for key in (MESSAGE_WATERMARK, CONVERSATION_WATERMARK, RUN_WATERMARK, LIBRARY_WATERMARK):
        conn.execute("DELETE FROM app_settings WHERE key = ?", (key,))


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
    mark = _cursor(conn, CONVERSATION_WATERMARK)
    where, binds = _unseen("updated_at", mark)
    rows = conn.execute(
        "SELECT id, title, provider, model, pinned, archived, updated_at"
        f" FROM conversations WHERE {where} ORDER BY updated_at, id LIMIT ?",
        (*binds, limit),
    ).fetchall()
    published = 0
    for row in rows:
        emitted = ops.emit(conn, clock, "conversations", row[0], {
            "title": row[1], "provider": row[2], "model": row[3],
            "pinned": row[4], "archived": row[5],
        })
        if emitted is not None:
            published += 1
        mark = _advance(mark, row[6], row[0])
        _set_cursor(conn, CONVERSATION_WATERMARK, *mark)
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
    mark = _cursor(conn, RUN_WATERMARK)
    where, binds = _unseen("updated_at", mark)
    rows = conn.execute(
        "SELECT id, conversation_id, phase, link, error, updated_at"
        f" FROM agent_runs WHERE {where} ORDER BY updated_at, id LIMIT ?",
        (*binds, limit),
    ).fetchall()
    published = 0
    for row in rows:
        emitted = ops.emit(conn, clock, "agent_runs", row[0], {
            "conversation_id": row[1], "phase": row[2], "link": row[3], "error": row[4],
        })
        if emitted is not None:
            published += 1
        mark = _advance(mark, row[5], row[0])
        _set_cursor(conn, RUN_WATERMARK, *mark)
    return published


def _publish_library(conn, clock, limit: int) -> int:
    """What you have saved, so a phone can look it up while away from the disk.

    Metadata only -- `registry.py`'s field list is what keeps the files out of
    it. A row with no uuid gets one here, the same late backfill messages use.
    """
    mark = _cursor(conn, LIBRARY_WATERMARK)
    where, binds = _unseen("updated_at", mark)
    rows = conn.execute(
        "SELECT id, uuid, kind, title, url, author, site, published_on, consumed_on,"
        " notes, rating, summary, tags, word_count, duration_seconds, source_ref, updated_at"
        f" FROM library_items WHERE {where} ORDER BY updated_at, id LIMIT ?",
        (*binds, limit),
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
        mark = _advance(mark, row[16], row[0])
        _set_cursor(conn, LIBRARY_WATERMARK, *mark)
    return published
