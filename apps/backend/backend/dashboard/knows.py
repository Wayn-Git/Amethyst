"""Review and change the same facts the Director recalls."""

from fastapi import HTTPException
from pydantic import Field

from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection
from backend.retrieval.store import load_extension


class MemoryInput(StrictModel):
    id: int = Field(gt=0)
    fact: str = Field(default="", max_length=10000)


def draft(action, body):
    if action not in ("edit", "delete"):
        raise HTTPException(404, "Unknown memory action")
    if action == "edit" and not body.fact.strip():
        raise HTTPException(422, "A fact is required")
    row = get_connection().execute("SELECT * FROM memories WHERE id=?", (body.id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Memory no longer exists")
    return save_draft("agent.knows", action, body, {**body.model_dump(), "expected": dict(row)})


def apply(conn, action, body):
    row = conn.execute("SELECT * FROM memories WHERE id=?", (body["id"],)).fetchone()
    if row is None or dict(row) != body["expected"]:
        raise HTTPException(409, "Memory changed; review a new draft")
    # Never let an old embedding recall a fact the user edited or deleted.
    if (
        load_extension(conn)
        and conn.execute("SELECT 1 FROM sqlite_master WHERE name='memory_vectors'").fetchone()
    ):
        conn.execute("DELETE FROM memory_vectors WHERE memory_id=?", (body["id"],))
    if action == "edit":
        conn.execute("UPDATE memories SET fact=? WHERE id=?", (body["fact"].strip(), body["id"]))
    elif action == "delete":
        conn.execute("DELETE FROM memories WHERE id=?", (body["id"],))
    else:
        raise HTTPException(404, "Unknown memory action")
    conn.execute("DELETE FROM widget_cache WHERE widget_id='agent.knows'")
    # Resolved drafts must not retain deleted personal facts.
    conn.execute(
        "UPDATE widget_action_drafts SET body_json='{}' "
        "WHERE widget_id='agent.knows' AND decision IS NOT NULL"
    )


async def provide():
    return {
        "items": [
            {
                "id": row["id"],
                "title": row["fact"],
                "fact": row["fact"],
                "detail": "Retired" if row["superseded_at"] else "Active",
            }
            for row in get_connection().execute("SELECT * FROM memories ORDER BY id DESC")
        ]
    }
