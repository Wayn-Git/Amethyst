"""Local Today tracking. Provider reads never sit in the dashboard's critical path."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.db.connection import get_connection, transaction


def now() -> str:
    return datetime.now(UTC).isoformat()


class TodayItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    kind: Literal["email", "message", "project", "recommendation"] = "email"
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(default="", max_length=4000)
    source: str = Field(default="Manual", min_length=1, max_length=80)
    external_id: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=2000)
    state: Literal["needs_reply", "waiting", "backlog", "done"] = "needs_reply"
    priority: bool = False
    occurred_at: str | None = None
    follow_up_at: str | None = None
    snoozed_until: str | None = None

    @field_validator("url")
    @classmethod
    def safe_url(cls, value):
        if value and (
            urlsplit(value).scheme not in ("http", "https") or not urlsplit(value).netloc
        ):
            raise ValueError("Use a full http or https link")
        return value

    @field_validator("occurred_at", "follow_up_at", "snoozed_until")
    @classmethod
    def timestamp(cls, value):
        if not value:
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Dates must include a timezone")
        return parsed.astimezone(UTC).isoformat()


def items() -> list[dict]:
    rows = get_connection().execute("SELECT * FROM today_items ORDER BY updated_at DESC").fetchall()
    return [
        dict(
            json.loads(row["payload"]),
            id=row["id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


def save_item(data: TodayItem, item_id: str | None = None) -> dict:
    stamp = now()
    # Stable identity prevents a connector/agent refresh from duplicating a thread.
    identity = f"{data.kind}:{data.source.casefold()}:{data.external_id}"
    item_id = item_id or (
        hashlib.sha256(identity.encode()).hexdigest()[:32] if data.external_id else uuid.uuid4().hex
    )
    payload = data.model_dump()
    with transaction() as conn:
        prior = conn.execute("SELECT * FROM today_items WHERE id = ?", (item_id,)).fetchone()
        if prior:
            old = json.loads(prior["payload"])
            # Refreshes change evidence, not a person's triage decisions.
            for key in ("priority", "state", "follow_up_at", "snoozed_until"):
                if key not in data.model_fields_set:
                    payload[key] = old.get(key)
            payload["occurred_at"] = payload["occurred_at"] or old.get("occurred_at")
        created = prior["created_at"] if prior else stamp
        conn.execute(
            "INSERT INTO today_items(id,payload,created_at,updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
            (item_id, json.dumps(payload), created, stamp),
        )
    return dict(payload, id=item_id, created_at=created, updated_at=stamp)


def patch_item(item_id: str, patch: dict) -> dict:
    row = (
        get_connection()
        .execute("SELECT payload FROM today_items WHERE id=?", (item_id,))
        .fetchone()
    )
    if not row:
        raise KeyError(item_id)
    return save_item(TodayItem.model_validate({**json.loads(row["payload"]), **patch}), item_id)


def snapshot(key: str) -> dict:
    row = (
        get_connection()
        .execute("SELECT payload FROM today_snapshots WHERE key=?", (key,))
        .fetchone()
    )
    return json.loads(row["payload"]) if row else {}


def save_snapshot(key: str, value: dict) -> None:
    with transaction() as conn:
        conn.execute(
            "INSERT INTO today_snapshots(key,payload) VALUES(?,?) ON "
            "CONFLICT(key) DO UPDATE SET payload=excluded.payload",
            (key, json.dumps(value)),
        )
