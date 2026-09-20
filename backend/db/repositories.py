"""Repository layer. Nothing above this module issues SQL directly.

Split by domain from the start rather than accumulating into one file, which is
the one thing Khoj's otherwise-good adapters layer got wrong.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from backend.agent.state import STATE_VERSION, TERMINAL, AgentState, UnknownStateVersion
from backend.db.connection import get_connection, transaction

log = logging.getLogger(__name__)

#: Rendered once for the two queries that ask for a live run.
_TERMINAL_SQL = ", ".join(f"'{phase}'" for phase in sorted(TERMINAL))


def _conn(conn: sqlite3.Connection | None) -> sqlite3.Connection:
    return conn or get_connection()


def _now() -> str:
    """Local naive, to the second.

    Every timestamp in this schema is local naive and compared as a string by
    SQLite. A UTC value on one side of such a comparison is off by the machine's
    offset and fails silently -- which is how reminders once arrived late by
    five and a half hours.
    """
    return datetime.now().isoformat(sep=" ", timespec="seconds")


def _today() -> str:
    """Local calendar date. "Today" is the one the user's clock shows.

    Not `date('now')`. SQLite's is UTC, and every timestamp compared against it
    here is local -- so for the machine's offset either side of midnight the two
    disagreed and the day's buckets emptied themselves. East of Greenwich that
    window is the small hours; west of it, the evening.
    """
    return datetime.now().date().isoformat()


def _fold_list_name(name: str | None) -> str:
    """A list name reduced to what a person would actually type.

    Leading emoji, symbols and punctuation go; case goes; surrounding space
    goes. Only *leading* decoration is stripped, so "Q1 2026" keeps its digits
    and "College 2026" still differs from "College Admin".
    """
    text = (name or "").strip()
    while text and not text[0].isalnum():
        text = text[1:].lstrip()
    return text.casefold()


#: The To Do list that *is* My Day.
#:
#: My Day is not a flag on a task and not a tag: it is one list, kept in
#: Microsoft To Do beside the others, which both AMETHYST and the phone open. That
#: is the only arrangement where the same tasks appear in both places without a
#: gesture unique to one of them -- To Do's own My Day is an overlay its API
#: does not expose (see `backend/sync/microsoft_todo.py`), so anything built on it
#: is invisible from here.
#:
#: Matched by name, folded the same way every other list name is, so "🌞 My Day"
#: answers to it. "Today" is accepted because it is the other name people give
#: the same list.
MY_DAY_LIST_NAMES = ("my day", "today")


def is_my_day_list(name: str | None) -> bool:
    return _fold_list_name(name) in MY_DAY_LIST_NAMES


# --------------------------------------------------------------------------
# conversations + messages
# --------------------------------------------------------------------------


@dataclass
class Message:
    id: int
    role: str
    content: str | None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    is_error: bool = False
    pinned: bool = False

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Message:
        keys = row.keys()
        return cls(
            id=row["id"],
            role=row["role"],
            content=row["content"],
            tool_calls=json.loads(row["tool_calls"]) if row["tool_calls"] else None,
            tool_call_id=row["tool_call_id"],
            tool_name=row["tool_name"],
            is_error=bool(row["is_error"]),
            # Read defensively: a row selected before the column existed, or by
            # a query that does not ask for it, is not a reason to raise.
            pinned=bool(row["pinned"]) if "pinned" in keys else False,
        )


class ConversationRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def create(
        self,
        provider: str,
        model: str,
        title: str | None = None,
        automation_id: str | None = None,
    ) -> str:
        cid = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO conversations (id, title, provider, model, automation_id)"
            " VALUES (?, ?, ?, ?, ?)",
            (cid, title, provider, model, automation_id),
        )
        self.conn.commit()
        return cid

    def get(self, conversation_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()

    def list(
        self,
        limit: int = 50,
        *,
        include_automations: bool = False,
        archived: bool = False,
    ) -> list[sqlite3.Row]:
        """Conversations, newest first. Scheduled runs are excluded by default.

        They share this list's fixed limit, and a pair of automations on a
        15-minute interval writes roughly 192 a day -- enough to push every
        conversation a person actually had off the end of it. They are listed
        per automation instead, by `runs_of`.

        Pinned first, so a pinned conversation cannot fall off the end of the
        limit -- which is the one thing a pin is for.
        """
        arch_val = 1 if archived else 0
        if include_automations:
            return self.conn.execute(
                "SELECT * FROM conversations WHERE archived = ?"
                " ORDER BY pinned DESC, updated_at DESC LIMIT ?",
                (arch_val, limit),
            ).fetchall()
        return self.conn.execute(
            "SELECT * FROM conversations WHERE automation_id IS NULL AND archived = ?"
            " ORDER BY pinned DESC, updated_at DESC LIMIT ?",
            (arch_val, limit),
        ).fetchall()

    def set_archived(self, conversation_id: str, archived: bool) -> bool:
        cursor = self.conn.execute(
            "UPDATE conversations SET archived = ? WHERE id = ?",
            (1 if archived else 0, conversation_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def set_pinned(self, conversation_id: str, pinned: bool) -> bool:
        """Keep this conversation at the top of the history column, or stop.

        Deliberately not a `touch` -- pinning is not a change to the
        conversation, and moving `updated_at` would reorder the very list the
        pin exists to hold still.
        """
        cursor = self.conn.execute(
            "UPDATE conversations SET pinned = ? WHERE id = ?",
            (1 if pinned else 0, conversation_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def runs_of(self, automation_id: str, limit: int = 50) -> list[sqlite3.Row]:
        """Every conversation one automation has written, newest first."""
        return self.conn.execute(
            "SELECT * FROM conversations WHERE automation_id = ?"
            " ORDER BY created_at DESC LIMIT ?",
            (automation_id, limit),
        ).fetchall()

    def prune_runs(self, automation_id: str, keep: int) -> int:
        """Drop all but the newest `keep` runs of one automation.

        Nothing pruned these before, so they accumulated for as long as the
        automation was enabled. Comparing a failed run against the one before it
        is the usual reason to look, so a handful are kept rather than one.
        """
        stale = self.conn.execute(
            "SELECT id FROM conversations WHERE automation_id = ?"
            " ORDER BY created_at DESC LIMIT -1 OFFSET ?",
            (automation_id, keep),
        ).fetchall()
        if not stale:
            return 0
        ids = [row["id"] for row in stale]
        with transaction(self.conn):
            for start in range(0, len(ids), 400):
                batch = ids[start : start + 400]
                placeholders = ",".join("?" * len(batch))
                self.conn.execute(
                    f"DELETE FROM conversations WHERE id IN ({placeholders})", batch
                )
                self.conn.execute(
                    f"DELETE FROM capability_state WHERE scope IN ({placeholders})", batch
                )
                self.conn.execute(
                    f"DELETE FROM memory_state WHERE scope IN ({placeholders})", batch
                )
        return len(ids)

    def update(
        self,
        conversation_id: str,
        *,
        title: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        fallback: list[str] | None = None,
    ) -> bool:
        """Change the conversation's title, its provider/model pair, or its chain.

        Provider and model are plain strings the loop re-resolves on every turn,
        so switching model mid-conversation is this write and nothing else
        (ai-runtime.md, "Switching models").

        `fallback` is stored as JSON. An empty list is meaningful and different
        from None -- it means "do not fall back at all for this conversation" --
        so it is written rather than treated as absent.
        """
        fields: dict[str, Any] = {"title": title, "provider": provider, "model": model}
        if fallback is not None:
            fields["fallback"] = json.dumps(fallback)
        updates = {k: v for k, v in fields.items() if v is not None}
        if not updates:
            return self.get(conversation_id) is not None

        assignments = ", ".join(f"{k} = ?" for k in updates)
        cursor = self.conn.execute(
            f"UPDATE conversations SET {assignments}, updated_at = datetime('now')"
            " WHERE id = ?",
            (*updates.values(), conversation_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def delete(self, conversation_id: str) -> bool:
        """Remove a conversation and everything scoped to it.

        Messages cascade through the foreign key, but two tables key on the
        conversation id as a plain scope string rather than a reference --
        capability_state and memory_state -- so a deleted conversation would
        otherwise leave rows nothing can ever reach again.         Extracted memories
        are deliberately kept: a fact learned in a conversation outlives it,
        which is why memories.conversation_id is not a foreign key.

        The three deletes run inside one transaction. On the single connection
        the process shares, an interleaved commit from another thread could
        land between the conversation's DELETE and its scoped-row cleanup, so a
        crash mid-sequence left exactly the orphaned rows this shape exists to
        prevent.
        """
        with transaction(self.conn):
            cursor = self.conn.execute(
                "DELETE FROM conversations WHERE id = ?", (conversation_id,)
            )
            if cursor.rowcount:
                self.conn.execute(
                    "DELETE FROM capability_state WHERE scope = ?", (conversation_id,)
                )
                self.conn.execute(
                    "DELETE FROM memory_state WHERE scope = ?", (conversation_id,)
                )
        return cursor.rowcount > 0

    def delete_all(self, *, include_automations: bool = False) -> int:
        """Delete every conversation, one at a time. Returns how many went.

        Row by row rather than one `DELETE FROM conversations`, because the
        scoped rows in `capability_state` and `memory_state` key on the id as a
        plain string and no foreign key will take them with it. A bulk statement
        would leave those behind for every conversation at once -- the same leak
        `delete` exists to prevent, multiplied.

        Automation runs are excluded by default for the same reason they are
        excluded from the rail: they are the record of what a rule did, not a
        conversation anyone had, and they are already pruned per automation.
        """
        sql = "SELECT id FROM conversations"
        if not include_automations:
            sql += " WHERE automation_id IS NULL"
        rows = self.conn.execute(sql).fetchall()
        # Scoped rows are cleaned with two bulk deletes inside the same
        # transaction as the conversations, rather than three statements per
        # conversation each with their own commit: "clear all" on a few hundred
        # conversations was hundreds of WAL fsyncs on the shared connection.
        ids = [row["id"] for row in rows]
        if not ids:
            return 0
        with transaction(self.conn):
            for start in range(0, len(ids), 400):
                batch = ids[start : start + 400]
                placeholders = ",".join("?" * len(batch))
                self.conn.execute(
                    f"DELETE FROM conversations WHERE id IN ({placeholders})", batch
                )
                self.conn.execute(
                    f"DELETE FROM capability_state WHERE scope IN ({placeholders})", batch
                )
                self.conn.execute(
                    f"DELETE FROM memory_state WHERE scope IN ({placeholders})", batch
                )
        return len(ids)

    def touch(self, conversation_id: str) -> None:
        self.conn.execute(
            "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
            (conversation_id,),
        )
        self.conn.commit()


class MessageRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def append(
        self,
        conversation_id: str,
        role: str,
        content: str | None = None,
        *,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_call_id: str | None = None,
        tool_name: str | None = None,
        is_error: bool = False,
        token_count: int | None = None,
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id,"
            " tool_name, is_error, token_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                conversation_id,
                role,
                content,
                json.dumps(tool_calls) if tool_calls else None,
                tool_call_id,
                tool_name,
                int(is_error),
                token_count,
            ),
        )
        self.conn.commit()
        return cur.lastrowid

    def set_pinned(self, conversation_id: str, message_id: int, pinned: bool) -> bool:
        """Pin or unpin one message.

        Scoped by conversation as well as by id so a pin cannot be applied to a
        message in a conversation the caller did not name -- message ids are
        global integers, and an interface that has the wrong one open would
        otherwise silently pin somebody else's turn.
        """
        cursor = self.conn.execute(
            "UPDATE messages SET pinned = ? WHERE id = ? AND conversation_id = ?",
            (int(pinned), message_id, conversation_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def pinned(self, conversation_id: str) -> list[Message]:
        return [
            Message.from_row(r)
            for r in self.conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? AND pinned = 1 ORDER BY id",
                (conversation_id,),
            )
        ]

    def history(self, conversation_id: str, limit: int | None = None) -> list[Message]:
        sql = "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id"
        params: tuple = (conversation_id,)
        if limit:
            # newest N, returned oldest-first
            sql = (
                "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ?"
                " ORDER BY id DESC LIMIT ?) ORDER BY id"
            )
            params = (conversation_id, limit)
        return [Message.from_row(r) for r in self.conn.execute(sql, params).fetchall()]


class ArtifactRepository:
    """Panel artifacts: metadata only, because the file is the artifact.

    Keyed by (conversation, resolved path). Writing the same document a second
    time is version 2 of one artifact, not a second artifact -- which is what
    lets the panel step back through revisions, and what a fresh row per write
    could never express.
    """

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    @staticmethod
    def identify(conversation_id: str, path: str) -> str:
        """The artifact's stable id.

        Derived rather than random so the id is the same before and after the
        row exists: the stream announces an artifact while the tool call is
        still arriving, and the row is only written once the file has actually
        been written. An id minted at write time would mean the frame that
        opened the panel named something different from the row that persists
        it.
        """
        import hashlib

        digest = hashlib.sha256(f"{conversation_id}\x00{path}".encode())
        return digest.hexdigest()[:32]

    def record(
        self,
        conversation_id: str,
        path: str,
        *,
        title: str | None = None,
        media_type: str = "text/markdown",
        language: str | None = None,
        size: int = 0,
    ) -> dict[str, Any]:
        """Note that this path was written, and say which version that makes it.

        The version is incremented by the database rather than read-then-written
        by the caller: two tool calls landing on one path in the same turn would
        otherwise both read version 1 and both write version 2.
        """
        artifact_id = self.identify(conversation_id, path)
        self.conn.execute(
            "INSERT INTO artifacts (id, conversation_id, path, title, media_type,"
            " language, version, bytes) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
            " ON CONFLICT(conversation_id, path) DO UPDATE SET"
            " version = artifacts.version + 1,"
            " title = COALESCE(excluded.title, artifacts.title),"
            " media_type = excluded.media_type,"
            " language = COALESCE(excluded.language, artifacts.language),"
            " bytes = excluded.bytes,"
            " updated_at = datetime('now')",
            (artifact_id, conversation_id, path, title, media_type, language, size),
        )
        self.conn.commit()
        row = self.get(artifact_id)
        assert row is not None  # just written
        return row

    def get(self, artifact_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM artifacts WHERE id = ?", (artifact_id,)
        ).fetchone()
        return dict(row) if row else None

    def list(self, conversation_id: str) -> list[dict[str, Any]]:
        """Every artifact in one conversation, newest first."""
        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM artifacts WHERE conversation_id = ?"
                " ORDER BY updated_at DESC, id",
                (conversation_id,),
            )
        ]


class ResponseArtifactRepository:
    """Response artifacts and version history.

    Promotes substantial responses to interactive documents with versioning,
    enabling editing, full-screen review, AI transforms, and multi-format exports.
    """

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    @staticmethod
    def identify(conversation_id: str, message_id: int) -> str:
        import hashlib
        digest = hashlib.sha256(f"resp_{conversation_id}_{message_id}".encode())
        return digest.hexdigest()[:24]

    def get_or_create(
        self,
        conversation_id: str,
        message_id: int,
        content: str,
        *,
        artifact_type: str = "response",
        format: str = "markdown",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        artifact_id = self.identify(conversation_id, message_id)
        existing = self.get(artifact_id)
        if existing is not None:
            return existing

        meta_json = json.dumps(metadata or {})
        self.conn.execute(
            "INSERT INTO response_artifacts (id, conversation_id, message_id, type, format,"
            " original_content, current_content, version, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)"
            " ON CONFLICT(conversation_id, message_id) DO NOTHING",
            (artifact_id, conversation_id, message_id, artifact_type, format, content, content, meta_json),
        )
        self.conn.execute(
            "INSERT INTO artifact_versions (artifact_id, version, content, author, change_summary)"
            " VALUES (?, 1, ?, 'assistant', 'Original response')",
            (artifact_id, content),
        )
        self.conn.commit()
        return self.get(artifact_id) or {}

    def get(self, artifact_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM response_artifacts WHERE id = ?",
            (artifact_id,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["metadata"] = json.loads(d.get("metadata") or "{}")
        d["versions"] = self.list_versions(artifact_id)
        return d

    def get_by_message(self, conversation_id: str, message_id: int) -> dict[str, Any] | None:
        artifact_id = self.identify(conversation_id, message_id)
        return self.get(artifact_id)

    def list_versions(self, artifact_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id, version, content, author, change_summary, created_at"
            " FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC",
            (artifact_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def save_version(
        self,
        artifact_id: str,
        content: str,
        author: str = "user",
        change_summary: str | None = None,
    ) -> dict[str, Any]:
        artifact = self.get(artifact_id)
        if not artifact:
            raise ValueError(f"No response artifact found with id {artifact_id}")

        new_version = int(artifact.get("version", 1)) + 1
        summary = change_summary or (f"Edited by {author}" if author != "assistant" else "Regenerated")

        self.conn.execute(
            "INSERT INTO artifact_versions (artifact_id, version, content, author, change_summary)"
            " VALUES (?, ?, ?, ?, ?)",
            (artifact_id, new_version, content, author, summary),
        )
        self.conn.execute(
            "UPDATE response_artifacts SET version = ?, current_content = ?, updated_at = datetime('now')"
            " WHERE id = ?",
            (new_version, content, artifact_id),
        )
        self.conn.execute(
            "UPDATE messages SET content = ? WHERE id = ? AND conversation_id = ?",
            (content, artifact["message_id"], artifact["conversation_id"]),
        )
        self.conn.commit()
        return self.get(artifact_id) or {}

    def revert_to_version(self, artifact_id: str, target_version: int) -> dict[str, Any]:
        row = self.conn.execute(
            "SELECT content FROM artifact_versions WHERE artifact_id = ? AND version = ?",
            (artifact_id, target_version),
        ).fetchone()
        if not row:
            raise ValueError(f"Version {target_version} not found for artifact {artifact_id}")

        target_content = row["content"]
        return self.save_version(
            artifact_id,
            target_content,
            author="user",
            change_summary=f"Reverted to version {target_version}",
        )


# --------------------------------------------------------------------------
# permissions + audit
# --------------------------------------------------------------------------


class ConfirmationPreferenceRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def get(self, operation_key: str) -> str | None:
        row = self.conn.execute(
            "SELECT decision FROM confirmation_preferences WHERE operation_key = ?",
            (operation_key,),
        ).fetchone()
        return row["decision"] if row else None

    def list(self) -> list[sqlite3.Row]:
        """Every standing decision, newest first.

        "Don't ask again" is a grant the user made once and then cannot see;
        without a way to read it back there is no way to notice a tool that
        stopped asking, and no way to take it back.
        """
        return self.conn.execute(
            "SELECT operation_key, decision, risk_level, created_at"
            " FROM confirmation_preferences ORDER BY created_at DESC"
        ).fetchall()

    def remember(self, operation_key: str, decision: str, risk_level: str) -> None:
        self.conn.execute(
            "INSERT INTO confirmation_preferences (operation_key, decision, risk_level)"
            " VALUES (?, ?, ?) ON CONFLICT(operation_key) DO UPDATE SET"
            " decision = excluded.decision, risk_level = excluded.risk_level",
            (operation_key, decision, risk_level),
        )
        self.conn.commit()

    def clear(self, operation_key: str | None = None) -> None:
        if operation_key:
            self.conn.execute(
                "DELETE FROM confirmation_preferences WHERE operation_key = ?", (operation_key,)
            )
        else:
            self.conn.execute("DELETE FROM confirmation_preferences")
        self.conn.commit()


class ExecutionLogRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def record(
        self,
        *,
        tool_name: str,
        tool_source: str,
        conversation_id: str | None = None,
        message_id: int | None = None,
        arguments: dict[str, Any] | None = None,
        result_summary: str | None = None,
        error: str | None = None,
        risk_level: str | None = None,
        confirmation_decision: str | None = None,
        duration_ms: int | None = None,
    ) -> int:
        from backend.secrets import redact

        cur = self.conn.execute(
            "INSERT INTO execution_logs (conversation_id, message_id, tool_name, tool_source,"
            " arguments, result_summary, error, risk_level, confirmation_decision, duration_ms)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                conversation_id,
                message_id,
                tool_name,
                tool_source,
                json.dumps(redact(arguments)) if arguments is not None else None,
                redact(result_summary[:2000]) if result_summary else None,
                redact(error) if error else None,
                risk_level,
                confirmation_decision,
                duration_ms,
            ),
        )
        self.conn.commit()
        return cur.lastrowid

    def recent(self, limit: int = 50) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM execution_logs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()

    def prune(self, *, keep: int = 5000) -> int:
        """Keep only the newest `keep` audit rows.

        Nothing retired these before, and every tool call from every source
        writes one -- an unattended automation on a 15-minute interval writes
        roughly a hundred a day, and years of them grow a table nothing reads
        past its first page.
        """
        cursor = self.conn.execute(
            "DELETE FROM execution_logs WHERE id <"
            " (SELECT COALESCE(MIN(id), 0) FROM"
            "  (SELECT id FROM execution_logs ORDER BY id DESC LIMIT ?))",
            (keep,),
        )
        self.conn.commit()
        return cursor.rowcount


class McpTrustRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def is_trusted(self, server_name: str) -> bool:
        return (
            self.conn.execute(
                "SELECT 1 FROM mcp_trusted_servers WHERE server_name = ?", (server_name,)
            ).fetchone()
            is not None
        )

    def trust(self, server_name: str) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO mcp_trusted_servers (server_name) VALUES (?)", (server_name,)
        )
        self.conn.commit()


class AgentRunRepository:
    """One row per turn, so a turn is not lost with the process running it.

    The state itself is a JSON blob rather than a column per field, which is the
    opposite of what `messages` does -- and deliberately. A transcript is read
    back selectively, budgeted and truncated by query, which is why ADR-0017
    normalizes it. This is read back whole or not at all: the loop wants every
    counter at once, and nothing else ever asks for one of them on its own.
    """

    #: Newest runs kept. A turn writes one row and updates it in place, so this
    #: grows with turns taken rather than with work done inside them -- but
    #: nothing reads past the current one, and years of finished bookkeeping is
    #: not worth keeping for a single-user install.
    KEEP = 500

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def open(self, state: AgentState) -> None:
        self.conn.execute(
            "INSERT INTO agent_runs (id, conversation_id, phase, state_version, state, link,"
            " error, checkpoint, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                state.id,
                state.conversation_id,
                state.phase,
                STATE_VERSION,
                json.dumps(state.to_json()),
                state.link,
                state.error,
                state.checkpoint,
                state.created_at,
                state.updated_at,
            ),
        )
        self.conn.commit()

    def save(self, state: AgentState) -> None:
        """Write the state as it now stands, and count the write.

        `checkpoint` is bumped here rather than by the caller so that every
        durable version of a state is numbered, including the ones written by a
        code path that forgot it was checkpointing.
        """
        state.checkpoint += 1
        state.updated_at = _now()
        self.conn.execute(
            "UPDATE agent_runs SET phase = ?, state_version = ?, state = ?, link = ?,"
            " error = ?, checkpoint = ?, updated_at = ? WHERE id = ?",
            (
                state.phase,
                STATE_VERSION,
                json.dumps(state.to_json()),
                state.link,
                state.error,
                state.checkpoint,
                state.updated_at,
                state.id,
            ),
        )
        self.conn.commit()
        if state.terminal:
            self.prune()

    def get(self, run_id: str) -> AgentState | None:
        row = self.conn.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
        return self._load(row) if row else None

    def latest(self, conversation_id: str) -> AgentState | None:
        row = self.conn.execute(
            "SELECT * FROM agent_runs WHERE conversation_id = ?"
            " ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (conversation_id,),
        ).fetchone()
        return self._load(row) if row else None

    def live(self) -> list[AgentState]:
        rows = self.conn.execute(
            f"SELECT * FROM agent_runs WHERE phase NOT IN ({_TERMINAL_SQL})"
            " ORDER BY created_at"
        ).fetchall()
        return [state for state in (self._load(row) for row in rows) if state is not None]

    def interrupt_live(self) -> list[str]:
        """End every run the last process left running, and say whose they were.

        Called once at startup. With one uvicorn worker -- a non-negotiable, see
        CLAUDE.md -- a run still in a live phase when the process boots cannot be
        one somebody else is driving: it is a turn whose process died. Left alone
        it reads as permanently in flight, which is exactly the "Thinking
        forever" the interface used to show for a dropped stream.

        Returns the conversation ids, because each of those conversations may
        also be holding a tool call nothing answered -- the `finally` that
        repairs that is skipped by a kill.
        """
        conversations: list[str] = []
        for row in self.conn.execute(
            f"SELECT * FROM agent_runs WHERE phase NOT IN ({_TERMINAL_SQL})"
        ).fetchall():
            conversations.append(row["conversation_id"])
            state = self._load(row)
            if state is None:
                # Unreadable, but it must not stay live: a row nothing can load
                # would be swept again on every boot from here to forever.
                self.conn.execute(
                    "UPDATE agent_runs SET phase = 'interrupted', updated_at = ? WHERE id = ?",
                    (_now(), row["id"]),
                )
                self.conn.commit()
                continue
            state.enter("interrupted")
            state.error = state.error or "the process running this turn stopped"
            self.save(state)
        return conversations

    def prune(self, *, keep: int | None = None) -> int:
        cursor = self.conn.execute(
            "DELETE FROM agent_runs WHERE rowid <"
            " (SELECT COALESCE(MIN(rowid), 0) FROM"
            "  (SELECT rowid FROM agent_runs ORDER BY rowid DESC LIMIT ?))",
            (keep if keep is not None else self.KEEP,),
        )
        self.conn.commit()
        return cursor.rowcount

    @staticmethod
    def _load(row: sqlite3.Row) -> AgentState | None:
        """Read one row back, or nothing.

        A state this build cannot read is not an error the caller has to handle:
        the turn it described is over, and the only cost of answering `None` is
        that the interface offers no pickup for it. Raising here would take down
        a conversation list or a startup sweep instead.
        """
        try:
            return AgentState.from_json(json.loads(row["state"]))
        except (UnknownStateVersion, ValueError, TypeError) as exc:
            log.warning("could not read agent run %s: %s", row["id"], exc)
            return None


# --------------------------------------------------------------------------
# tasks + calendar
# --------------------------------------------------------------------------


class TaskRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def create(
        self,
        title: str,
        *,
        notes: str | None = None,
        due_at: str | None = None,
        scheduled_at: str | None = None,
        duration_estimate_minutes: int | None = None,
        priority: str | None = None,
        source: str = "user",
        reminder_at: str | None = None,
        external_source: str | None = None,
        external_id: str | None = None,
        external_etag: str | None = None,
        list_id: int | None = None,
        important: bool = False,
        external_categories: str | None = None,
        completed_at: str | None = None,
        status: str | None = None,
        dirty_at: str | None = None,
    ) -> int:
        try:
            cur = self.conn.execute(
                "INSERT INTO tasks (title, notes, due_at, scheduled_at, duration_estimate_minutes,"
                " priority, source, reminder_at, external_source, external_id, external_etag,"
                " list_id, important, external_categories, completed_at, dirty_at,"
                " status, last_synced_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'todo'),"
                " CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)",
                (
                    title,
                    notes,
                    due_at,
                    scheduled_at,
                    duration_estimate_minutes,
                    priority,
                    source,
                    reminder_at,
                    external_source,
                    external_id,
                    external_etag,
                    list_id,
                    1 if important else 0,
                    external_categories,
                    completed_at,
                    dirty_at,
                    status,
                    external_id,
                ),
            )
        except sqlite3.IntegrityError:
            # Graph has no idempotency key, so a caller that already created this
            # task upstream (e.g. two calls racing on the same title, or a retry
            # after an apparently-failed request that actually landed) hands back
            # an external_id already sitting on a local row. Adopting it is the
            # same at-least-once story as the sync push's adopt-by-title -- a
            # second insert would only fail again, and the task is not lost, it
            # is just already here.
            if external_source and external_id:
                existing = self.by_external(external_source, external_id)
                if existing is not None:
                    return existing["id"]
            raise
        self.conn.commit()
        return cur.lastrowid

    def get(self, task_id: int) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    def update(self, task_id: int, **fields: Any) -> None:
        allowed = {
            "title",
            "notes",
            "due_at",
            "scheduled_at",
            "duration_estimate_minutes",
            "status",
            "priority",
            "calendar_event_id",
            "reminder_at",
            "reminded_at",
            "external_etag",
            "last_synced_at",
            "list_id",
            "important",
            "external_categories",
            "completed_at",
            "dirty_at",
        }
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return
        # `completed_at` is a fact about the status, not a field a caller should
        # have to remember to pass -- and one that has to be cleared when a task
        # is reopened, or a re-completed task keeps the first date.
        if "status" in sets and "completed_at" not in sets:
            sets["completed_at"] = _now() if sets["status"] == "done" else None
        clause = ", ".join(f"{k} = ?" for k in sets)
        self.conn.execute(
            f"UPDATE tasks SET {clause}, updated_at = datetime('now') WHERE id = ?",
            (*sets.values(), task_id),
        )
        self.conn.commit()

    def upcoming(self, limit: int = 20, include_done: bool = False) -> list[sqlite3.Row]:
        sql = "SELECT * FROM tasks"
        if not include_done:
            sql += " WHERE status IN ('todo', 'in_progress')"
        sql += " ORDER BY (due_at IS NULL), due_at, id LIMIT ?"
        return self.conn.execute(sql, (limit,)).fetchall()

    def due_reminders(self, now: str) -> list[sqlite3.Row]:
        """Open tasks whose reminder has come round and has not been given.

        `reminder_at` when it is set, otherwise `due_at` -- so a plain deadline
        is announced without anyone having to set a second field, and a task
        with neither is never announced at all.
        """
        return self.conn.execute(
            "SELECT * FROM tasks"
            " WHERE status IN ('todo', 'in_progress')"
            "   AND reminded_at IS NULL"
            "   AND COALESCE(reminder_at, due_at) IS NOT NULL"
            "   AND COALESCE(reminder_at, due_at) <= ?"
            " ORDER BY COALESCE(reminder_at, due_at), id",
            (now,),
        ).fetchall()

    def mark_reminded(self, task_id: int, when: str) -> bool:
        """Claim a reminder. False if something already claimed it.

        The `reminded_at IS NULL` predicate is the claim: two ticks overlapping,
        or a tick racing a restart, cannot both win it, so nobody is told twice.
        """
        cur = self.conn.execute(
            "UPDATE tasks SET reminded_at = ?, updated_at = datetime('now')"
            " WHERE id = ? AND reminded_at IS NULL",
            (when, task_id),
        )
        self.conn.commit()
        return cur.rowcount > 0

    def by_external(self, source: str, external_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM tasks WHERE external_source = ? AND external_id = ?",
            (source, external_id),
        ).fetchone()

    def external_ids(self, source: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT id, external_id, status FROM tasks WHERE external_source = ?",
            (source,),
        ).fetchall()

    # ---------------------------------------------------------------- buckets
    #
    # The five views the Tasks page is made of. They live here rather than in
    # the view because the counts and the rows have to agree: a sidebar saying
    # "Missed 5" over a list showing four is worse than no count at all, and the
    # only way to guarantee they match is one predicate, used twice.
    #
    # Missed is computed, never stored. A stored "missed" flag needs a job to
    # set it, a rule for unsetting it, and a migration for rows that predate
    # both -- and it is wrong for exactly as long as that job is not running.

    OPEN = "status IN ('todo', 'in_progress')"

    # Today is bound in as `:today` rather than written as `date('now')`.
    # SQLite's `now` is UTC; every column these compare against holds local
    # naive time. The two agree for most of the day and disagree either side of
    # midnight by the machine's offset -- at UTC+5:30 that is 00:00 to 05:30
    # local, during which My Day read empty, the sun did nothing visible, and
    # Missed forgot the previous evening's deadlines. Nothing announced it,
    # because there is no error in comparing two well-formed dates.

    #: My Day is the contents of one list, and nothing else.
    #:
    #: It used to be a date stamp (`my_day_on`) fed by three different gestures
    #: -- a sun in AMETHYST writing a "My Day" category, a `#myday` hashtag, and a
    #: list of this name -- which meant the page could disagree with the phone
    #: about what was in today, and usually did: tasks added through To Do's own
    #: My Day carry none of the three, because that overlay is not in its API.
    #: One list is the only version both ends can see. Cancelled rows are the
    #: tasks a pull no longer found upstream, so they are not in the list any
    #: more either.
    _MY_DAY = "list_id = :my_day_list AND status != 'cancelled'"
    _MISSED = "due_at IS NOT NULL AND due_at < :today"
    _IMPORTANT = "important = 1"
    #: Everything nobody has scheduled or claimed for today. `:my_day_list` is
    #: null when no such list exists, and `IS NOT` against null would then hide
    #: every unfiled task, so the comparison is guarded rather than written bare.
    _GENERAL = (
        "due_at IS NULL AND scheduled_at IS NULL"
        " AND (:my_day_list IS NULL OR list_id IS NOT :my_day_list)"
    )

    def my_day_list_id(self) -> int | None:
        """The local id of the list that is My Day, or None if there is none.

        Read on every bucket query rather than cached: the list can arrive from
        a sync at any moment, and a stale cache would leave My Day empty until
        a restart with nothing on screen explaining why.
        """
        for row in self.conn.execute(
            "SELECT id, name FROM task_lists WHERE retired_at IS NULL ORDER BY position, id"
        ):
            if is_my_day_list(row["name"]):
                return int(row["id"])
        return None

    def _bucket_where(
        self, bucket: str, list_id: int | None = None, *, my_day_list: int | None = None
    ) -> tuple[str, dict]:
        """`my_day_list` is read once per `counts()` pass and passed through:
        computing it per bucket re-ran the task_lists scan six times for one
        sidebar redraw."""
        params = {
            "today": _today(),
            "list_id": list_id,
            "my_day_list": self.my_day_list_id() if my_day_list is None else my_day_list,
        }
        if bucket == "my_day":
            return self._MY_DAY, params
        if bucket == "missed":
            return f"{self.OPEN} AND {self._MISSED}", params
        if bucket == "important":
            return f"{self.OPEN} AND {self._IMPORTANT}", params
        if bucket == "general":
            return f"{self.OPEN} AND {self._GENERAL}", params
        if bucket == "completed":
            # Cancelled is not completed. `upcoming(include_done=True)` conflates
            # them, which made "Showing done" quietly mean "showing everything
            # including things you gave up on".
            return "status = 'done'", params
        if bucket == "list":
            return f"{self.OPEN} AND list_id IS :list_id", params
        if bucket == "all":
            return self.OPEN, params
        raise ValueError(f"unknown task bucket '{bucket}'")

    #: Overdue first, then by deadline, then undated. `id` last so the order is
    #: total -- without it two tasks due the same minute swap places between
    #: reads and the list appears to shuffle itself.
    _ORDER = "ORDER BY important DESC, (due_at IS NULL), due_at, id"

    #: My Day mixes open work with what was finished today, and the two are not
    #: peers: the open ones are the list, the done ones are the record. Sorting
    #: them together buried a task still to do underneath three that were
    #: already crossed off. Done sinks; the rest keeps the usual order.
    _MY_DAY_ORDER = (
        "ORDER BY (status = 'done'), important DESC, (due_at IS NULL), due_at, id"
    )

    def bucket(
        self, name: str, *, list_id: int | None = None, limit: int = 200
    ) -> list[sqlite3.Row]:
        where, params = self._bucket_where(name, list_id)
        if name == "completed":
            order = "ORDER BY completed_at DESC, id DESC"
        elif name == "my_day":
            order = self._MY_DAY_ORDER
        else:
            order = self._ORDER
        return self.conn.execute(
            f"SELECT * FROM tasks WHERE {where} {order} LIMIT :limit", {**params, "limit": limit}
        ).fetchall()

    def counts(self) -> dict[str, int]:
        """Every bucket count in one pass, plus one per list.

        One query per bucket would be six round trips for a sidebar that redraws
        on every mutation.
        """
        my_day = self.my_day_list_id()
        out: dict[str, int] = {}
        for name in ("my_day", "missed", "important", "general", "completed", "all"):
            where, params = self._bucket_where(name, my_day_list=my_day)
            row = self.conn.execute(
                f"SELECT count(*) FROM tasks WHERE {where}", params
            ).fetchone()
            out[name] = row[0]
        for row in self.conn.execute(
            f"SELECT list_id, count(*) AS n FROM tasks WHERE {self.OPEN} GROUP BY list_id"
        ):
            out[f"list:{row['list_id']}"] = row["n"]
        return out

    def completed_between(self, start: str, end: str) -> list[sqlite3.Row]:
        """Tasks marked done inside a window, oldest first.

        `completed_at` is written by `_now()` -- local naive, space separator --
        so the bounds must be too. SQLite compares these as plain strings, so a
        bound in the wrong shape silently returns nothing rather than failing.
        """
        return self.conn.execute(
            "SELECT * FROM tasks WHERE completed_at IS NOT NULL"
            " AND completed_at >= ? AND completed_at <= ?"
            " ORDER BY completed_at",
            (start, end),
        ).fetchall()

    def open_with_due_before(self, cutoff: str, limit: int = 200) -> list[sqlite3.Row]:
        """Still open, and already past its deadline. Same clock as above."""
        return self.conn.execute(
            f"SELECT * FROM tasks WHERE {self.OPEN} AND due_at IS NOT NULL AND due_at < ?"
            " ORDER BY due_at LIMIT ?",
            (cutoff, limit),
        ).fetchall()

    def dirty(self, source: str, limit: int = 200) -> list[sqlite3.Row]:
        """Rows changed locally since they last reached the connector."""
        return self.conn.execute(
            "SELECT * FROM tasks WHERE dirty_at IS NOT NULL AND external_source = ?"
            " ORDER BY dirty_at LIMIT ?",
            (source, limit),
        ).fetchall()

    def unsynced(self, limit: int = 200) -> list[sqlite3.Row]:
        """Local rows that never reached the connector at all.

        Created while nothing was signed in, or while the upstream write failed.
        They are the other half of the push: `dirty` updates what exists there,
        this creates what does not.
        """
        return self.conn.execute(
            f"SELECT * FROM tasks WHERE external_id IS NULL AND {self.OPEN}"
            " ORDER BY id LIMIT ?",
            (limit,),
        ).fetchall()

    def adopt_external(
        self, task_id: int, *, source: str, external_id: str, external_etag: str | None
    ) -> None:
        """Attach an upstream identity to a row that was created locally.

        `update`'s allowlist deliberately excludes these -- an identity is not a
        field anyone edits -- so the one legitimate case has its own method.
        """
        self.conn.execute(
            "UPDATE tasks SET external_source = ?, external_id = ?, external_etag = ?,"
            " last_synced_at = ?, dirty_at = NULL, updated_at = datetime('now')"
            " WHERE id = ?",
            (source, external_id, external_etag, _now(), task_id),
        )
        self.conn.commit()

    def in_list(self, list_id: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM tasks WHERE list_id = ?", (list_id,)
        ).fetchall()


class TaskListRepository:
    """The lists tasks live in.

    Mirrors Microsoft To Do when an account is signed in -- `external_id` is the
    Graph list id -- and stands alone when none is. The two cases share one
    table because a machine that signs in later should adopt its local lists
    rather than growing a second set beside them.
    """

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def create(
        self,
        name: str,
        *,
        external_source: str | None = None,
        external_id: str | None = None,
        is_default: bool = False,
        position: int | None = None,
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO task_lists (name, external_source, external_id, is_default, position)"
            " VALUES (?, ?, ?, ?, ?)",
            (name, external_source, external_id, 1 if is_default else 0, position),
        )
        self.conn.commit()
        return cur.lastrowid

    def get(self, list_id: int) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM task_lists WHERE id = ?", (list_id,)
        ).fetchone()

    def all(self, *, include_retired: bool = False) -> list[sqlite3.Row]:
        sql = "SELECT * FROM task_lists"
        if not include_retired:
            sql += " WHERE retired_at IS NULL"
        sql += " ORDER BY is_default DESC, (position IS NULL), position, name COLLATE NOCASE"
        return self.conn.execute(sql).fetchall()

    def by_external(self, source: str, external_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM task_lists WHERE external_source = ? AND external_id = ?",
            (source, external_id),
        ).fetchone()

    def by_name(self, name: str) -> sqlite3.Row | None:
        """Exact, then folded, then a unique folded prefix.

        "groceries" has to find "Groceries", and "college" has to find "College
        2026" when that is the only candidate -- but never when there are two,
        because silently picking one of two lists is how a task ends up
        somewhere the user cannot find it.

        Folding also drops a decorative prefix. Real To Do lists are named
        "🛒 Groceries" and "📚 College", and nobody types the emoji: without
        this, asking for "groceries" matched nothing, made a second list called
        "groceries", and quietly split the user's shopping across two places.
        """
        wanted = _fold_list_name(name)
        if not wanted:
            return None
        rows = self.all()
        for row in rows:
            if row["name"] == (name or "").strip():
                return row
        folded = [r for r in rows if _fold_list_name(r["name"]) == wanted]
        if len(folded) == 1:
            return folded[0]
        if folded:
            return None  # genuinely ambiguous; asking beats guessing
        prefixed = [r for r in rows if _fold_list_name(r["name"]).startswith(wanted)]
        return prefixed[0] if len(prefixed) == 1 else None

    def default(self) -> sqlite3.Row | None:
        row = self.conn.execute(
            "SELECT * FROM task_lists WHERE is_default = 1 AND retired_at IS NULL"
        ).fetchone()
        if row is not None:
            return row
        rows = self.all()
        return rows[0] if rows else None

    def update(self, list_id: int, **fields: Any) -> None:
        allowed = {"name", "external_source", "external_id", "is_default", "position", "retired_at"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return
        clause = ", ".join(f"{k} = ?" for k in sets)
        self.conn.execute(
            f"UPDATE task_lists SET {clause}, updated_at = datetime('now') WHERE id = ?",
            (*sets.values(), list_id),
        )
        self.conn.commit()

    def clear_default(self) -> None:
        self.conn.execute("UPDATE task_lists SET is_default = 0 WHERE is_default = 1")
        self.conn.commit()

    def retire(self, list_id: int) -> None:
        """Mark a list gone upstream without losing the tasks that pointed at it.

        Same rule as a vanished task: an outage and a deleted list produce the
        same empty response, and only one of them is recoverable.
        """
        self.conn.execute(
            "UPDATE task_lists SET retired_at = ?, updated_at = datetime('now')"
            " WHERE id = ? AND retired_at IS NULL",
            (_now(), list_id),
        )
        self.conn.commit()

    def external_rows(self, source: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM task_lists WHERE external_source = ? AND retired_at IS NULL",
            (source,),
        ).fetchall()


class CalendarRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def create(
        self,
        title: str,
        starts_at: str,
        ends_at: str,
        *,
        all_day: bool = False,
        location: str | None = None,
        busy: bool = True,
        source: str = "local",
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO calendar_events (title, starts_at, ends_at, all_day, location, busy,"
            " source) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (title, starts_at, ends_at, int(all_day), location, int(busy), source),
        )
        self.conn.commit()
        return cur.lastrowid

    def overlapping(self, starts_at: str, ends_at: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM calendar_events WHERE busy = 1 AND starts_at < ? AND ends_at > ?"
            " ORDER BY starts_at",
            (ends_at, starts_at),
        ).fetchall()

    def in_window(self, starts_at: str, ends_at: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM calendar_events WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at",
            (ends_at, starts_at),
        ).fetchall()


class SubagentSessionRepository:
    """CRUD for subagent_sessions table."""

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = _conn(conn)

    def create(
        self,
        *,
        session_id: str,
        parent_conversation_id: str,
        parent_message_id: str | None = None,
        agent_type: str,
        title: str | None = None,
        depth: int = 0,
        model: str | None = None,
        provider: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.conn.execute(
            "INSERT INTO subagent_sessions"
            " (id, parent_conversation_id, parent_message_id, agent_type, title,"
            "  depth, model, provider, metadata)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session_id,
                parent_conversation_id,
                parent_message_id,
                agent_type,
                title,
                depth,
                model,
                provider,
                json.dumps(metadata) if metadata else None,
            ),
        )
        self.conn.commit()

    def get(self, session_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM subagent_sessions WHERE id = ?", (session_id,)
        ).fetchone()

    def children(self, parent_conversation_id: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM subagent_sessions WHERE parent_conversation_id = ?"
            " ORDER BY created_at",
            (parent_conversation_id,),
        ).fetchall()

    def update_status(
        self,
        session_id: str,
        status: str,
        *,
        result: str | None = None,
        error: str | None = None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        cost: float | None = None,
        metadata: str | None = None,
    ) -> None:
        fields: dict[str, Any] = {"status": status}
        if result is not None:
            fields["result"] = result
        if error is not None:
            fields["error"] = error
        if tokens_input is not None:
            fields["tokens_input"] = tokens_input
        if tokens_output is not None:
            fields["tokens_output"] = tokens_output
        if cost is not None:
            fields["cost"] = cost
        if metadata is not None:
            fields["metadata"] = metadata
        if status in ("completed", "failed", "cancelled"):
            fields["completed_at"] = _now()

        sets = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE subagent_sessions SET {sets} WHERE id = ?",
            (*fields.values(), session_id),
        )
        self.conn.commit()

    def depth(self, session_id: str) -> int:
        """Walk parent chain and return depth."""
        depth = 0
        current = session_id
        while True:
            row = self.conn.execute(
                "SELECT parent_conversation_id FROM subagent_sessions WHERE id = ?",
                (current,),
            ).fetchone()
            if not row or not row["parent_conversation_id"]:
                break
            # Check if parent is itself a subagent
            parent = self.conn.execute(
                "SELECT id FROM subagent_sessions WHERE id = ?",
                (row["parent_conversation_id"],),
            ).fetchone()
            if not parent:
                break
            depth += 1
            current = parent["id"]
        return depth

    def active_in_conversation(self, conversation_id: str) -> list[sqlite3.Row]:
        """Running subagents for a conversation."""
        return self.conn.execute(
            "SELECT * FROM subagent_sessions"
            " WHERE parent_conversation_id = ? AND status = 'running'"
            " ORDER BY created_at",
            (conversation_id,),
        ).fetchall()

    def list_recent(self, limit: int = 50) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM subagent_sessions ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    def update_heartbeat(self, session_id: str) -> None:
        """Update the heartbeat timestamp for a running subagent."""
        self.conn.execute(
            "UPDATE subagent_sessions SET last_heartbeat = datetime('now') WHERE id = ?",
            (session_id,),
        )
        self.conn.commit()

    def stale_sessions(self, idle_seconds: int = 1200) -> list[sqlite3.Row]:
        """Find running subagents with no heartbeat within idle_seconds."""
        return self.conn.execute(
            "SELECT * FROM subagent_sessions"
            " WHERE status = 'running'"
            " AND last_heartbeat IS NOT NULL"
            " AND julianday('now') - julianday(last_heartbeat) > ?",
            (idle_seconds / 86400.0,),
        ).fetchall()
