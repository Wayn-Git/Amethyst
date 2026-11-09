"""Cloud state client for Amethyst Notifier using Turso / libSQL.

Supports stateless CI runs and local execution.
Stores notified items for deduplication, daily send counters for cap enforcement,
and mirrored library items for weekly digests.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

log = logging.getLogger("amethyst.notifier.db")


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _turso_arg(val: Any) -> dict[str, Any]:
    if val is None:
        return {"type": "null"}
    elif isinstance(val, bool):
        return {"type": "integer", "value": str(int(val))}
    elif isinstance(val, int):
        return {"type": "integer", "value": str(val)}
    elif isinstance(val, float):
        return {"type": "float", "value": val}
    return {"type": "text", "value": str(val)}


def _turso_val(cell: dict[str, Any] | Any) -> Any:
    if not isinstance(cell, dict):
        return cell
    cell_type = cell.get("type")
    if cell_type == "null":
        return None
    val = cell.get("value")
    if cell_type == "integer":
        return int(val) if val is not None else 0
    elif cell_type == "float":
        return float(val) if val is not None else 0.0
    return val


class TursoDB:
    """Turso / libSQL client with HTTP pipeline support and local SQLite fallback."""

    def __init__(self, db_url: str | None = None, auth_token: str | None = None) -> None:
        raw_url = db_url or os.getenv("TURSO_DATABASE_URL") or os.getenv("TURSO_DB_URL") or ""
        self.auth_token = auth_token or os.getenv("TURSO_AUTH_TOKEN") or ""
        self.raw_url = raw_url.strip()

        self.is_local = (
            not self.raw_url
            or self.raw_url == ":memory:"
            or self.raw_url.startswith("sqlite:")
            or self.raw_url.endswith(".db")
        )

        if not self.is_local:
            # Normalize URL to https
            url = self.raw_url
            if url.startswith("libsql://"):
                url = "https://" + url[len("libsql://") :]
            elif not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url
            url = url.rstrip("/")
            if not url.endswith("/v2/pipeline"):
                url = f"{url}/v2/pipeline"
            self.endpoint = url
        else:
            local_path = ":memory:"
            if self.raw_url.startswith("sqlite:///"):
                local_path = self.raw_url[len("sqlite:///") :]
            elif self.raw_url.startswith("sqlite://"):
                local_path = self.raw_url[len("sqlite://") :]
            elif self.raw_url and self.raw_url != ":memory:":
                local_path = self.raw_url
            self._local_conn = sqlite3.connect(local_path, check_same_thread=False)
            self._local_conn.row_factory = sqlite3.Row
            self._local_lock = threading.Lock()

        self._schema_initialized = False
        self._initializing_schema = False

    def _execute_local(self, sql: str, args: list[Any] | None = None) -> list[dict[str, Any]]:
        with self._local_lock:
            cursor = self._local_conn.execute(sql, args or [])
            self._local_conn.commit()
            if cursor.description:
                cols = [col[0] for col in cursor.description]
                return [dict(zip(cols, row)) for row in cursor.fetchall()]
            return []

    def _execute_local_batch(self, stmts: list[tuple[str, list[Any]]]) -> None:
        with self._local_lock:
            for sql, args in stmts:
                self._local_conn.execute(sql, args or [])
            self._local_conn.commit()

    def execute_batch(self, stmts: list[tuple[str, list[Any]]]) -> list[list[dict[str, Any]]]:
        """Execute multiple SQL statements in a single batch transaction/pipeline."""
        if not stmts:
            return []

        if not self._schema_initialized and not self._initializing_schema:
            self._initializing_schema = True
            try:
                self.ensure_schema()
            finally:
                self._initializing_schema = False

        if self.is_local:
            results = []
            for sql, args in stmts:
                results.append(self._execute_local(sql, args))
            return results

        requests = []
        for sql, args in stmts:
            turso_args = [_turso_arg(a) for a in (args or [])]
            requests.append({
                "type": "execute",
                "stmt": {
                    "sql": sql,
                    "args": turso_args,
                },
            })
        requests.append({"type": "close"})

        headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(self.endpoint, json={"requests": requests}, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        all_results: list[list[dict[str, Any]]] = []
        for item in data.get("results", []):
            if item.get("type") == "error":
                err = item.get("error", {})
                raise RuntimeError(f"Turso error: {err.get('message', 'Unknown error')}")
            res = item.get("response", {}).get("result", {})
            cols = [c.get("name", "") for c in res.get("cols", [])]
            rows = []
            for raw_row in res.get("rows", []):
                vals = [_turso_val(cell) for cell in raw_row]
                rows.append(dict(zip(cols, vals)))
            all_results.append(rows)

        return all_results

    def execute(self, sql: str, args: list[Any] | None = None) -> list[dict[str, Any]]:
        """Execute a single SQL statement."""
        batch_res = self.execute_batch([(sql, args or [])])
        return batch_res[0] if batch_res else []

    def ensure_schema(self) -> None:
        """Create necessary tables and index if they do not exist."""
        self._schema_initialized = True
        stmts = [
            (
                """
                CREATE TABLE IF NOT EXISTS notified_items (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    notified_at TEXT NOT NULL
                );
                """,
                [],
            ),
            (
                """
                CREATE INDEX IF NOT EXISTS idx_notified_items_id ON notified_items(id);
                """,
                [],
            ),
            (
                """
                CREATE TABLE IF NOT EXISTS send_counter (
                    date TEXT PRIMARY KEY,
                    count INTEGER NOT NULL DEFAULT 0
                );
                """,
                [],
            ),
            (
                """
                CREATE TABLE IF NOT EXISTS library_mirror (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    url TEXT,
                    saved_at TEXT NOT NULL,
                    opened_at TEXT
                );
                """,
                [],
            ),
        ]
        self.execute_batch(stmts)

    def purge_old_notified_items(self, days: int = 30) -> int:
        """Purge notified_items older than N days."""
        cutoff = (datetime.now(UTC) - timedelta(days=days)).replace(microsecond=0).isoformat()
        res = self.execute("DELETE FROM notified_items WHERE notified_at < ?", [cutoff])
        return len(res)

    def filter_unnotified_items(self, item_ids: list[str]) -> list[str]:
        """Return subset of item_ids that have not yet been notified."""
        if not item_ids:
            return []
        # Query in chunks if large, or IN clause
        placeholders = ", ".join(["?"] * len(item_ids))
        sql = f"SELECT id FROM notified_items WHERE id IN ({placeholders})"
        rows = self.execute(sql, item_ids)
        seen = {r["id"] for r in rows}
        return [i for i in item_ids if i not in seen]

    def record_notified_items(self, items: list[tuple[str, str, str | None]]) -> None:
        """Batch record notified items (id, source, notified_at). Avoids per-item checks."""
        if not items:
            return
        now = _now_iso()
        stmts = [
            (
                "INSERT OR IGNORE INTO notified_items (id, source, notified_at) VALUES (?, ?, ?)",
                [item_id, source, notified_at or now],
            )
            for item_id, source, notified_at in items
        ]
        self.execute_batch(stmts)

    def get_daily_send_count(self, date_str: str) -> int:
        """Get the send count for a given date (YYYY-MM-DD)."""
        rows = self.execute("SELECT count FROM send_counter WHERE date = ?", [date_str])
        if rows:
            return int(rows[0]["count"])
        return 0

    def increment_daily_send_count(self, date_str: str, increment: int = 1) -> int:
        """Atomically increment the send counter for a given date and return the new count."""
        stmts = [
            (
                """
                INSERT INTO send_counter (date, count) VALUES (?, ?)
                ON CONFLICT(date) DO UPDATE SET count = count + excluded.count;
                """,
                [date_str, increment],
            ),
            (
                "SELECT count FROM send_counter WHERE date = ?",
                [date_str],
            ),
        ]
        results = self.execute_batch(stmts)
        rows = results[1] if len(results) > 1 else []
        if rows:
            return int(rows[0]["count"])
        return 0

    def insert_library_mirror(
        self,
        item_id: int,
        title: str,
        url: str | None = None,
        saved_at: str | None = None,
    ) -> None:
        """Mirror a library item into Turso."""
        saved_time = saved_at or _now_iso()
        sql = (
            "INSERT INTO library_mirror (id, title, url, saved_at, opened_at) VALUES (?, ?, ?, ?, NULL) "
            "ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url"
        )
        self.execute(sql, [item_id, title, url, saved_time])

    def get_unopened_library_items(self, limit: int = 50) -> list[dict[str, Any]]:
        """Fetch items saved in library_mirror that have never been opened."""
        sql = (
            "SELECT id, title, url, saved_at FROM library_mirror "
            "WHERE opened_at IS NULL ORDER BY saved_at DESC LIMIT ?"
        )
        return self.execute(sql, [limit])

    def mark_library_items_opened(self, item_ids: list[int]) -> None:
        """Mark library items as opened."""
        if not item_ids:
            return
        now = _now_iso()
        stmts = [
            ("UPDATE library_mirror SET opened_at = ? WHERE id = ?", [now, i])
            for i in item_ids
        ]
        self.execute_batch(stmts)
