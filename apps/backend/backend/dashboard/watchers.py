"""Bounded page and inbox watches, with persistent baselines and sys.notify alerts."""

import asyncio
import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, model_validator

from backend.dashboard.feeds import FeedInput, download
from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.dashboard.store import stamp
from backend.db.connection import get_connection, transaction
from backend.notify import notify

log = logging.getLogger(__name__)


class WatchInput(StrictModel):
    id: int | None = Field(default=None, gt=0)
    title: str = Field(default="", max_length=500)
    kind: Literal["page", "mailbox"] = "page"
    target: str = Field(default="", max_length=2048)
    interval_s: int = Field(default=900, ge=900, le=2592000)

    @model_validator(mode="after")
    def target_valid(self):
        if self.kind == "page" and self.target:
            FeedInput(url=self.target)
        return self


def draft(action, body):
    payload = body.model_dump()
    if action == "add":
        if body.id or not body.title.strip() or not body.target.strip():
            raise HTTPException(422, "Title and page URL or mailbox query are required")
    elif action == "delete":
        row = (
            get_connection()
            .execute("SELECT * FROM dashboard_watchers WHERE id=?", (body.id,))
            .fetchone()
        )
        if row is None:
            raise HTTPException(404, "Watcher not found")
        payload["expected"] = dict(row)
    else:
        raise HTTPException(404, "Unknown watcher action")
    return save_draft("agent.watchers", action, body, payload)


def apply(conn, action, body):
    if action == "add":
        parsed = WatchInput.model_validate(body)
        if conn.execute("SELECT count(*) FROM dashboard_watchers").fetchone()[0] >= 20:
            raise HTTPException(409, "At most 20 watchers")
        conn.execute(
            "INSERT INTO dashboard_watchers(title,kind,target,interval_s,next_poll) "
            "VALUES(?,?,?,?,?)",
            (parsed.title, parsed.kind, parsed.target, parsed.interval_s, stamp()),
        )
    elif action == "delete":
        row = conn.execute("SELECT * FROM dashboard_watchers WHERE id=?", (body["id"],)).fetchone()
        if row is None or dict(row) != body["expected"]:
            raise HTTPException(409, "Watcher changed; review a new draft")
        conn.execute("DELETE FROM dashboard_watchers WHERE id=?", (body["id"],))
    else:
        raise HTTPException(404, "Unknown watcher action")
    conn.execute("DELETE FROM widget_cache WHERE widget_id='agent.watchers'")


async def provide():
    return {
        "items": [
            {
                "id": r["id"],
                "title": r["title"],
                "detail": f"{r['kind']} · {r['interval_s']}s · {r['checked_at'] or 'Not checked'}",
                "error": r["error"],
            }
            for r in get_connection().execute("SELECT * FROM dashboard_watchers ORDER BY id DESC")
        ]
    }


async def poll(row):
    if row["kind"] == "page":
        content, _ = await download(row["target"], row["id"], widget_id="agent.watchers")
        baseline = hashlib.sha256(content).hexdigest()
        changed = row["baseline"] is not None and row["baseline"] != baseline
    else:
        from backend.dashboard.developer import inbox_messages

        messages = await inbox_messages("agent.watchers", row["target"])
        ids = sorted({str(mail["id"]) for mail in messages if mail.get("id")})
        previous = set(json.loads(row["baseline"] or "[]"))
        baseline = json.dumps(ids)
        changed = bool(set(ids) - previous)
    # A watcher removed during its fetch must not emit an alert.
    with transaction() as conn:
        updated = conn.execute(
            "UPDATE dashboard_watchers SET baseline=?,checked_at=?,error=NULL WHERE id=?",
            (baseline, stamp(), row["id"]),
        ).rowcount
    if updated and changed:
        await notify(
            row["title"],
            "Page changed" if row["kind"] == "page" else "Mailbox match",
            source_key=f"watcher:{row['id']}:{row['next_poll']}",
        )
    with transaction() as conn:
        conn.execute("DELETE FROM widget_cache WHERE widget_id IN ('agent.watchers','sys.notify')")


async def tick(now=None):
    now = now or datetime.now(UTC)
    rows = (
        get_connection()
        .execute(
            "SELECT * FROM dashboard_watchers WHERE next_poll<=? ORDER BY next_poll",
            (now.isoformat(),),
        )
        .fetchall()
    )
    for raw in rows:
        row = dict(raw)
        with transaction() as conn:
            claimed = conn.execute(
                "UPDATE dashboard_watchers SET next_poll=? WHERE id=? AND next_poll=?",
                (
                    (now + timedelta(seconds=row["interval_s"])).isoformat(),
                    row["id"],
                    row["next_poll"],
                ),
            ).rowcount
        if not claimed:
            continue
        try:
            async with asyncio.timeout(15):
                await poll(row)
            log.info("widget=agent.watchers id=%s result=ok", row["id"])
        except Exception as exc:
            with transaction() as conn:
                conn.execute(
                    "UPDATE dashboard_watchers SET error=? WHERE id=?", (str(exc)[:500], row["id"])
                )
            log.warning("widget=agent.watchers id=%s result=error", row["id"])


async def run():
    while True:
        try:
            await tick()
        except Exception:
            log.exception("widget=agent.watchers tick failed")
        await asyncio.sleep(10)
