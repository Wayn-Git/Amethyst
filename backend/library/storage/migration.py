"""Resumable migration engine.

Scans local Library items, constructs an idempotent persistent migration manifest,
and uploads files to Google Drive in verified batches.
"""

from __future__ import annotations

import hashlib
import inspect
import logging
import mimetypes
from pathlib import Path
from typing import Any

from backend.db.connection import get_connection
from backend.library.storage.base import StorageProvider
from backend.library.store import LibraryStore

log = logging.getLogger(__name__)


def _compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(64 * 1024):
            h.update(chunk)
    return h.hexdigest()


class MigrationEngine:
    """Orchestrates persistent, resumable migration of library files to cloud storage."""

    _is_running: bool = False

    def __init__(self, gdrive_provider: StorageProvider | None = None) -> None:
        self._provider = gdrive_provider

    def _get_provider(self) -> StorageProvider:
        if self._provider is not None:
            return self._provider
        from backend.library.storage.config import StorageConfigStore
        from backend.library.storage.gdrive import GoogleDriveProvider

        cfg = StorageConfigStore().get_config()
        self._provider = GoogleDriveProvider(root_folder_id=cfg.get("gdrive_root_id"))
        return self._provider

    async def build_manifest(self) -> int:
        """Scan all local library items and enqueue manifest rows for unmigrated files."""
        conn = get_connection()
        existing = {
            (r["item_id"], r["file_type"])
            for r in conn.execute("SELECT item_id, file_type FROM storage_migration_manifest").fetchall()
        }

        rows = conn.execute(
            """
            SELECT id, kind, title, text_path, media_path, thumbnail_path, storage_provider, external_id
            FROM library_items
            WHERE storage_provider = 'local' OR external_id IS NULL
            """
        ).fetchall()

        inserted = 0
        for r in rows:
            item_id = r["id"]
            kind = r["kind"] or "article"

            # Determine target folder name based on facet
            target_folder = "articles"
            if kind in ("video", "podcast", "music"):
                target_folder = "media"
            elif kind == "book":
                target_folder = "books"
            elif kind in ("note", "idea"):
                target_folder = "notes"

            # 1. Check text_path
            if (item_id, "text") not in existing and r["text_path"]:
                tp = Path(r["text_path"]).expanduser()
                if tp.is_file():
                    size = tp.stat().st_size
                    checksum = _compute_sha256(tp)
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO storage_migration_manifest (
                            item_id, file_type, local_path, file_size, checksum, target_folder, status
                        ) VALUES (?, 'text', ?, ?, ?, ?, 'pending')
                        """,
                        (item_id, str(tp), size, checksum, target_folder),
                    )
                    if cur.rowcount > 0:
                        inserted += 1
                        existing.add((item_id, "text"))

            # 2. Check media_path
            if (item_id, "media") not in existing and r["media_path"]:
                mp = Path(r["media_path"]).expanduser()
                if mp.is_file():
                    size = mp.stat().st_size
                    checksum = _compute_sha256(mp)
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO storage_migration_manifest (
                            item_id, file_type, local_path, file_size, checksum, target_folder, status
                        ) VALUES (?, 'media', ?, ?, ?, 'media', 'pending')
                        """,
                        (item_id, str(mp), size, checksum),
                    )
                    if cur.rowcount > 0:
                        inserted += 1
                        existing.add((item_id, "media"))

        conn.commit()
        return inserted

    async def step(self, batch_size: int = 5) -> dict[str, Any]:
        """Process up to batch_size pending items from the manifest."""
        provider = self._get_provider()
        bridge = getattr(provider, "bridge", None)
        if bridge and hasattr(bridge, "is_connected"):
            res = bridge.is_connected()
            if not inspect.iscoroutine(res) and not res:
                return {
                    "completed": 0,
                    "failed": 0,
                    "error": "Google Drive is not connected or requires re-authentication.",
                }

        conn = get_connection()
        pending = conn.execute(
            """
            SELECT id, item_id, file_type, local_path, file_size, checksum, target_folder, attempt_count
            FROM storage_migration_manifest
            WHERE status = 'pending'
            ORDER BY id ASC
            LIMIT ?
            """,
            (batch_size,),
        ).fetchall()

        completed = 0
        failed = 0
        store = LibraryStore(conn)

        for entry in pending:
            manifest_id = entry["id"]
            item_id = entry["item_id"]
            file_type = entry["file_type"]
            path = Path(entry["local_path"])
            target_folder = entry["target_folder"]
            expected_checksum = entry["checksum"]

            if not path.is_file():
                conn.execute(
                    """
                    UPDATE storage_migration_manifest
                    SET status = 'failed', error_message = 'File missing on local disk', updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (manifest_id,),
                )
                conn.commit()
                failed += 1
                continue

            # Mark in_progress
            conn.execute(
                "UPDATE storage_migration_manifest SET status = 'in_progress' WHERE id = ?",
                (manifest_id,),
            )
            conn.commit()

            try:
                mime_type, _ = mimetypes.guess_type(path.name)
                mime_type = mime_type or (
                    "text/markdown" if file_type == "text" else "application/octet-stream"
                )

                content = path.read_bytes()
                obj = await provider.write(
                    name=path.name,
                    data=content,
                    mime_type=mime_type,
                    parent_folder_id=target_folder,
                    expected_checksum=expected_checksum,
                )

                # Update manifest
                conn.execute(
                    """
                    UPDATE storage_migration_manifest
                    SET status = 'completed', external_id = ?, updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (obj.external_id, manifest_id),
                )

                # Update library_items row
                store.update(
                    item_id,
                    storage_provider="google_drive",
                    external_id=obj.external_id,
                    checksum=expected_checksum,
                    cached_locally=1,
                    sync_state="synced",
                    last_synced_at=conn.execute("SELECT datetime('now')").fetchone()[0],
                )
                conn.commit()
                completed += 1
            except Exception as exc:
                log.exception("Migration failed for item %s file %s: %s", item_id, path, exc)
                conn.execute(
                    """
                    UPDATE storage_migration_manifest
                    SET status = 'failed', error_message = ?, attempt_count = attempt_count + 1, updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (str(exc), manifest_id),
                )
                conn.commit()
                failed += 1
                if isinstance(exc, StorageUnavailableError) or "not connected" in str(exc).lower():
                    # Stop processing rest of batch when provider is disconnected
                    break

        return {"completed": completed, "failed": failed}

    def get_status(self) -> dict[str, Any]:
        """Aggregate migration status counts and failure diagnostics."""
        conn = get_connection()
        rows = conn.execute(
            """
            SELECT status, COUNT(*) AS cnt
            FROM storage_migration_manifest
            GROUP BY status
            """
        ).fetchall()
        counts = {r["status"]: r["cnt"] for r in rows}
        total = sum(counts.values())

        last_err_row = conn.execute(
            """
            SELECT error_message
            FROM storage_migration_manifest
            WHERE status = 'failed' AND error_message IS NOT NULL AND error_message != ''
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()

        last_error = last_err_row["error_message"] if last_err_row else None
        error_category = None
        if last_error:
            lowered = last_error.lower()
            if any(k in lowered for k in ("not connected", "re-authentication", "oauth", "token", "credentials", "unauthorized")):
                error_category = "connectivity"
            elif "missing on local disk" in lowered:
                error_category = "missing_file"
            else:
                error_category = "upload_failed"

        return {
            "total": total,
            "completed": counts.get("completed", 0),
            "pending": counts.get("pending", 0),
            "in_progress": counts.get("in_progress", 0),
            "failed": counts.get("failed", 0),
            "last_error": last_error,
            "error_category": error_category,
            "is_running": MigrationEngine._is_running or counts.get("in_progress", 0) > 0,
        }

    def retry_failed(self) -> int:
        """Reset failed items to pending state for retry."""
        conn = get_connection()
        cur = conn.execute(
            """
            UPDATE storage_migration_manifest
            SET status = 'pending', error_message = NULL, updated_at = datetime('now')
            WHERE status = 'failed'
            """
        )
        conn.commit()
        return cur.rowcount
