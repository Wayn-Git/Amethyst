from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)
from backend.remote.clipboard import set_clipboard

log = logging.getLogger(__name__)


class ClipboardHistoryStore:
    def __init__(self, db_path: Path | str | None = None):
        if db_path is None:
            config_dir = Path.home() / ".amethyst"
            config_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = config_dir / "clipboard.db"
        else:
            self.db_path = Path(db_path)
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=5.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS clipboard_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    text TEXT NOT NULL UNIQUE,
                    length INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    pinned INTEGER DEFAULT 0
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_clipboard_created ON clipboard_history(created_at DESC)"
            )
            conn.commit()

    def add(self, text: str, pinned: bool = False) -> int | None:
        clean = text.strip()
        if not clean:
            return None

        now = time.time()
        length = len(clean)
        with self._get_connection() as conn:
            # Upsert text to update timestamp if already seen
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO clipboard_history (text, length, created_at, pinned)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(text) DO UPDATE SET
                    created_at = excluded.created_at,
                    pinned = MAX(clipboard_history.pinned, excluded.pinned)
                """,
                (clean, length, now, 1 if pinned else 0),
            )
            # Bound table to 500 items
            conn.execute(
                """
                DELETE FROM clipboard_history
                WHERE id NOT IN (
                    SELECT id FROM clipboard_history
                    ORDER BY pinned DESC, created_at DESC
                    LIMIT 500
                )
                """
            )
            conn.commit()
            return cur.lastrowid

    def count(self) -> int:
        with self._get_connection() as conn:
            cur = conn.execute("SELECT COUNT(*) FROM clipboard_history")
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        q = query.strip()
        with self._get_connection() as conn:
            if not q:
                cur = conn.execute(
                    """
                    SELECT id, text, length, created_at, pinned
                    FROM clipboard_history
                    ORDER BY pinned DESC, created_at DESC
                    LIMIT ?
                    """,
                    (limit,),
                )
            else:
                like_term = f"%{q}%"
                cur = conn.execute(
                    """
                    SELECT id, text, length, created_at, pinned
                    FROM clipboard_history
                    WHERE text LIKE ?
                    ORDER BY pinned DESC, created_at DESC
                    LIMIT ?
                    """,
                    (like_term, limit),
                )
            return [dict(row) for row in cur.fetchall()]


class ClipboardProvider(BaseLauncherProvider):
    id = "clipboard"
    name = "Clipboard History"
    priority = 70

    def __init__(self, store: ClipboardHistoryStore | None = None):
        self.store = store or ClipboardHistoryStore()

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        if not raw:
            return

        is_explicit = False
        search_term = raw
        if raw.lower().startswith("cb ") or raw.lower().startswith("clip "):
            is_explicit = True
            search_term = raw.split(None, 1)[1] if " " in raw else ""

        if not is_explicit and len(search_term) < 2:
            return

        items = self.store.search(search_term, limit=15)
        for item in items:
            text = item["text"]
            first_line = text.splitlines()[0] if text else ""
            title = first_line[:60] + ("…" if len(first_line) > 60 else "")
            
            # Score calculation
            if is_explicit:
                score = 95.0
            else:
                score = 75.0 if search_term.lower() in text.lower() else 60.0

            actions = [
                LauncherAction(
                    id="copy",
                    title="Copy to Clipboard",
                    shortcut="↵",
                    is_primary=True,
                    handler_payload={"text": text},
                ),
                LauncherAction(
                    id="paste",
                    title="Copy and Prepare Paste",
                    shortcut="Cmd+↵",
                    is_primary=False,
                    handler_payload={"text": text},
                ),
            ]

            yield LauncherResult(
                id=f"clipboard:{item['id']}",
                provider_id=self.id,
                title=title or "(Empty text)",
                subtitle=f"{item['length']} chars",
                icon="clipboard",
                badge="Clipboard",
                score=score,
                preview_type="markdown",
                preview_data={
                    "markdown": f"```text\n{text[:1200]}\n```\n\n*{item['length']} characters*"
                },
                actions=actions,
            )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        text = payload.get("text", "")
        if not text:
            return {"ok": False, "error": "No text provided to copy"}

        res = set_clipboard(text)
        return {
            "ok": res.get("ok", False),
            "copied": True,
            "action": action_id,
            "length": len(text),
        }
