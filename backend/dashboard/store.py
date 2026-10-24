"""SQLite cache, layouts, and the settings used by the shipped shell widgets."""

import json
from datetime import UTC, datetime

from backend.db.connection import get_connection, transaction


def stamp():
    return datetime.now(UTC).isoformat()


def cache_read(widget_id):
    row = (
        get_connection()
        .execute("SELECT * FROM widget_cache WHERE widget_id=?", (widget_id,))
        .fetchone()
    )
    if not row:
        return {"payload": None, "state": "loading", "error": None, "synced_at": None}
    return {
        "payload": json.loads(row["payload_json"]),
        "state": row["state"],
        "error": row["error"],
        "synced_at": row["synced_at"],
    }


def cache_write(widget_id, payload, state, error=None, synced_at=None):
    with transaction() as conn:
        conn.execute(
            "INSERT INTO widget_cache VALUES(?,?,?,?,?) ON CONFLICT(widget_id) DO UPDATE SET "
            "payload_json=excluded.payload_json,state=excluded.state,error=excluded.error,"
            "synced_at=excluded.synced_at",
            (widget_id, json.dumps(payload), state, error, synced_at),
        )


def settings_read(widget_id):
    row = (
        get_connection()
        .execute("SELECT settings_json FROM widget_settings WHERE widget_id=?", (widget_id,))
        .fetchone()
    )
    return json.loads(row[0]) if row else {}


def settings_write(widget_id, value):
    with transaction() as conn:
        conn.execute(
            "INSERT INTO widget_settings VALUES(?,?) ON CONFLICT(widget_id) DO UPDATE SET "
            "settings_json=excluded.settings_json",
            (widget_id, json.dumps(value)),
        )


def layout_read(mode):
    row = (
        get_connection().execute("SELECT layout_json FROM layouts WHERE mode=?", (mode,)).fetchone()
    )
    if row:
        return json.loads(row[0])
    return {
        "widgets": [
            {"id": name, "size": "m", "height": 4 if name == "dash.quiet" else 3}
            for name in (
                "glance.clock",
                "dash.sync",
                "dash.quiet",
                "dash.shortcuts",
                "dash.gallery",
            )
        ]
    }


def layout_write(mode, value):
    with transaction() as conn:
        conn.execute(
            "INSERT INTO layouts VALUES(?,?,?) ON CONFLICT(mode) DO UPDATE SET "
            "layout_json=excluded.layout_json,updated_at=excluded.updated_at",
            (mode, json.dumps(value), stamp()),
        )
