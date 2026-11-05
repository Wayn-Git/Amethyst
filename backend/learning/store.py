"""Learning proposals: what the post-turn review suggested, before it counts.

A row per suggestion, not a row per review. The review itself is disposable --
it happens once and its transcript is the conversation it just read -- but a
proposal a person has not answered yet has to survive a restart, because "I will
look at that tomorrow" is the normal way to answer it.

The table keeps `body` rather than pointing at the conversation, so deleting a
chat does not turn a pending skill idea into an unreadable row. Nothing here
applies a write; `backend.learning.service` does that, and only for a row a
person approved.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any

from backend.db.connection import get_connection

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
FAILED = "failed"
STATUSES = (PENDING, APPROVED, REJECTED, FAILED)


@dataclass
class Proposal:
    id: int
    kind: str
    title: str
    body: str = ""
    name: str | None = None
    conversation_id: str | None = None
    run_id: str | None = None
    rationale: str | None = None
    status: str = PENDING
    created_at: str | None = None
    decided_at: str | None = None
    applied_at: str | None = None
    error: str | None = None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Proposal":
        data = dict(row)
        return cls(
            id=int(data["id"]),
            kind=data["kind"],
            title=data["title"],
            body=data.get("body") or "",
            name=data.get("name"),
            conversation_id=data.get("conversation_id"),
            run_id=data.get("run_id"),
            rationale=data.get("rationale"),
            status=data.get("status") or PENDING,
            created_at=data.get("created_at"),
            decided_at=data.get("decided_at"),
            applied_at=data.get("applied_at"),
            error=data.get("error"),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "body": self.body,
            "name": self.name,
            "conversation_id": self.conversation_id,
            "run_id": self.run_id,
            "rationale": self.rationale,
            "status": self.status,
            "created_at": self.created_at,
            "decided_at": self.decided_at,
            "applied_at": self.applied_at,
            "error": self.error,
        }


class LearningStore:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or get_connection()

    def add(
        self,
        *,
        kind: str,
        title: str,
        body: str = "",
        name: str | None = None,
        conversation_id: str | None = None,
        run_id: str | None = None,
        rationale: str | None = None,
    ) -> Proposal:
        cursor = self.conn.execute(
            "INSERT INTO learning_proposals"
            " (conversation_id, run_id, kind, name, title, body, rationale)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (conversation_id, run_id, kind, name, title, body, rationale),
        )
        self.conn.commit()
        return self.get(int(cursor.lastrowid))

    def get(self, proposal_id: int) -> Proposal | None:
        row = self.conn.execute(
            "SELECT * FROM learning_proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
        return Proposal.from_row(row) if row else None

    def list(self, *, status: str | None = PENDING, limit: int = 100) -> list[Proposal]:
        sql = "SELECT * FROM learning_proposals"
        params: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC, id DESC LIMIT ?"
        params.append(limit)
        return [Proposal.from_row(r) for r in self.conn.execute(sql, params).fetchall()]

    def counts(self) -> dict[str, int]:
        return {
            row["status"]: row["n"]
            for row in self.conn.execute(
                "SELECT status, COUNT(*) AS n FROM learning_proposals GROUP BY status"
            )
        }

    def decide(self, proposal_id: int, status: str, *, error: str | None = None) -> Proposal:
        if status not in (APPROVED, REJECTED, FAILED):
            raise ValueError(f"not a decision: {status}")
        self.conn.execute(
            "UPDATE learning_proposals SET status = ?, decided_at = datetime('now'),"
            " applied_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE applied_at END,"
            " error = ? WHERE id = ?",
            (status, status, error, proposal_id),
        )
        self.conn.commit()
        found = self.get(proposal_id)
        if found is None:
            raise KeyError(f"no learning proposal {proposal_id}")
        return found

    def prune(self, *, keep: int = 500) -> int:
        """Keep the newest `keep` answered rows. Pending ones are never pruned."""
        cursor = self.conn.execute(
            "DELETE FROM learning_proposals WHERE status != 'pending' AND id NOT IN"
            " (SELECT id FROM learning_proposals ORDER BY id DESC LIMIT ?)",
            (keep,),
        )
        self.conn.commit()
        return cursor.rowcount
