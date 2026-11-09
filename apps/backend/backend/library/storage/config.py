"""Storage configuration repository.

Manages persistent configuration for Library storage providers (local vs. Google Drive)
and Google Drive root folder identifiers in SQLite.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from backend.db.connection import get_connection

DEFAULT_CONFIG: dict[str, Any] = {
    "active_provider": "local",
    "gdrive_root_id": None,
    "gdrive_root_name": "Amethyst/Library",
    "auto_upload_new": 0,
}


class StorageConfigStore:
    def __init__(self, conn: sqlite3.Connection | None = None) -> None:
        self.conn = conn or get_connection()
        self._ensure_row()

    def _ensure_row(self) -> None:
        row = self.conn.execute("SELECT id FROM storage_configurations WHERE id = 1").fetchone()
        if row is None:
            self.conn.execute(
                """
                INSERT OR IGNORE INTO storage_configurations (
                    id, active_provider, gdrive_root_id, gdrive_root_name, auto_upload_new
                ) VALUES (1, 'local', NULL, 'Amethyst/Library', 0)
                """
            )
            self.conn.commit()

    def get_config(self) -> dict[str, Any]:
        row = self.conn.execute(
            """
            SELECT active_provider, gdrive_root_id, gdrive_root_name, auto_upload_new, created_at, updated_at
            FROM storage_configurations
            WHERE id = 1
            """
        ).fetchone()
        if row is None:
            self._ensure_row()
            return dict(DEFAULT_CONFIG)
        return dict(row)

    def update_config(self, **fields: Any) -> dict[str, Any]:
        allowed = {"active_provider", "gdrive_root_id", "gdrive_root_name", "auto_upload_new"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return self.get_config()

        clauses = [f"{k} = ?" for k in updates]
        clauses.append("updated_at = datetime('now')")
        values = list(updates.values())

        query = f"UPDATE storage_configurations SET {', '.join(clauses)} WHERE id = 1"
        self.conn.execute(query, values)
        self.conn.commit()
        return self.get_config()
