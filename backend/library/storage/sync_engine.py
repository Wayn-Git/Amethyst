"""Two-way synchronization and ingestion engine for Library cloud storage.

Discovers existing items in Google Drive, deduplicates against local database,
ingests and indexes new cloud items, and synchronizes unmigrated local items to Drive.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import mimetypes
from pathlib import Path
from typing import Any

from backend.db.connection import get_connection
from backend.library.storage.base import StorageError, StorageUnavailableError
from backend.library.storage.gdrive_bridge import GoogleDriveBridge, MARKER_FILE_NAME
from backend.library.store import LibraryStore, library_dir

log = logging.getLogger(__name__)

STANDARD_SUBFOLDERS = ("articles", "books", "notes", "media", "other")


class LibrarySyncEngine:
    """Orchestrates two-way sync between Google Drive and Amethyst Library."""

    _is_running: bool = False
    _cancelled: bool = False
    _status: dict[str, Any] = {
        "is_running": False,
        "stage": "idle",
        "found_drive_items": 0,
        "inbound_imported": 0,
        "uploaded_outbound": 0,
        "skipped_duplicates": 0,
        "errors": [],
        "last_error": None,
    }

    def __init__(self, bridge: GoogleDriveBridge | None = None) -> None:
        self.bridge = bridge or GoogleDriveBridge()

    def get_status(self) -> dict[str, Any]:
        """Get live synchronization metrics."""
        st = dict(self._status)
        st["is_running"] = self._is_running
        return st

    def cancel(self) -> None:
        """Signal running synchronization to cancel."""
        LibrarySyncEngine._cancelled = True

    async def scan_drive_items(self, root_folder_id: str) -> list[dict[str, Any]]:
        """Discover all files in Drive root and standard subfolders."""
        discovered: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        # 1. Top-level files in root
        root_files = await self.bridge.list_files_in_folder(root_folder_id)
        for f in root_files:
            fid = f.get("id")
            fname = f.get("name", "")
            if fid and fid not in seen_ids and fname != MARKER_FILE_NAME:
                if f.get("mimeType") != "application/vnd.google-apps.folder":
                    item = dict(f)
                    item["parent_folder"] = ""
                    discovered.append(item)
                    seen_ids.add(fid)

        # 2. Standard subfolders
        for sub in STANDARD_SUBFOLDERS:
            sub_id = await self.bridge._find_folder(sub, root_folder_id)
            if sub_id:
                sub_files = await self.bridge.list_files_in_folder(sub_id)
                for f in sub_files:
                    fid = f.get("id")
                    fname = f.get("name", "")
                    if fid and fid not in seen_ids and fname != MARKER_FILE_NAME:
                        if f.get("mimeType") != "application/vnd.google-apps.folder":
                            item = dict(f)
                            item["parent_folder"] = sub
                            discovered.append(item)
                            seen_ids.add(fid)

        return discovered

    async def ingest_inbound_item(self, drive_file: dict[str, Any]) -> dict[str, Any]:
        """Ingest a single Google Drive file into Amethyst Library with deduplication."""
        drive_id = drive_file.get("id")
        if not drive_id:
            return {"status": "error", "error": "Missing file ID"}

        name = drive_file.get("name", "Untitled")
        ext = Path(name).suffix.lower()
        parent_folder = drive_file.get("parent_folder", "")
        file_checksum = drive_file.get("md5Checksum") or drive_file.get("sha256Checksum") or ""

        conn = get_connection()
        store = LibraryStore(conn)

        # 1. Match by external_id
        existing = conn.execute(
            "SELECT id, title, checksum FROM library_items WHERE external_id = ?",
            (drive_id,),
        ).fetchone()
        if existing:
            return {"status": "skipped", "reason": "already_synced", "item_id": existing["id"]}

        # 2. Match by checksum
        if file_checksum:
            existing_sum = conn.execute(
                "SELECT id, title FROM library_items WHERE checksum = ?",
                (file_checksum,),
            ).fetchone()
            if existing_sum:
                store.update(
                    existing_sum["id"],
                    external_id=drive_id,
                    storage_provider="google_drive",
                    sync_state="synced",
                )
                conn.commit()
                return {"status": "skipped", "reason": "checksum_match", "item_id": existing_sum["id"]}

        # 3. Match by normalized title & kind
        title_candidate = Path(name).stem.replace("-", " ").replace("_", " ").strip()
        existing_title = conn.execute(
            "SELECT id FROM library_items WHERE LOWER(title) = LOWER(?)",
            (title_candidate,),
        ).fetchone()
        if existing_title:
            store.update(
                existing_title["id"],
                external_id=drive_id,
                storage_provider="google_drive",
                sync_state="synced",
            )
            conn.commit()
            return {"status": "skipped", "reason": "title_match", "item_id": existing_title["id"]}

        # Determine item kind
        if parent_folder == "articles":
            kind = "article"
        elif parent_folder == "books":
            kind = "book"
        elif parent_folder == "notes":
            kind = "note"
        elif parent_folder == "media":
            kind = "music" if ext in (".mp3", ".m4a", ".wav", ".flac") else "video"
        else:
            if ext in (".md", ".txt"):
                kind = "note"
            elif ext in (".pdf", ".epub"):
                kind = "book"
            elif ext in (".mp3", ".m4a", ".wav"):
                kind = "music"
            elif ext in (".mp4", ".mov", ".webm"):
                kind = "video"
            else:
                kind = "article"

        # Download file payload
        content = await self.bridge.download_file(drive_id)
        computed_checksum = hashlib.sha256(content).hexdigest()

        # Cache file locally
        cache_dir = Path("~/.amethyst/cache/library").expanduser()
        cache_dir.mkdir(parents=True, exist_ok=True)
        cached_file_path = cache_dir / f"{drive_id}_{name}"
        cached_file_path.write_bytes(content)

        # For text markdown, also write to library_dir to preserve ADR-0004 local file guarantees
        local_text_path: Path | None = None
        extracted_title = title_candidate
        if ext in (".md", ".txt", ".html"):
            lib_dir = library_dir()
            lib_dir.mkdir(parents=True, exist_ok=True)
            local_text_path = lib_dir / f"{drive_id[:8]}-{name}"
            local_text_path.write_bytes(content)
            # Try reading first heading
            try:
                text_str = content.decode("utf-8")
                for line in text_str.splitlines():
                    trimmed = line.strip()
                    if trimmed.startswith("# "):
                        extracted_title = trimmed[2:].strip()
                        break
            except Exception:
                pass

        # Create library item
        item_id = store.create(
            kind=kind,
            title=extracted_title or title_candidate,
            category="general",
            url=drive_file.get("webViewLink") or None,
        )

        update_kwargs: dict[str, Any] = {
            "storage_provider": "google_drive",
            "external_id": drive_id,
            "checksum": computed_checksum,
            "cached_locally": 1,
            "sync_state": "synced",
        }
        if local_text_path:
            update_kwargs["text_path"] = str(local_text_path)
        else:
            update_kwargs["media_path"] = str(cached_file_path)

        store.update(item_id, **update_kwargs)
        conn.commit()

        # Background enrichment & indexing (non-blocking)
        try:
            from backend.library.enrich import enrich_library_item
            asyncio.create_task(enrich_library_item(item_id))
        except Exception as exc:
            log.debug("Enrichment dispatch skipped for item %s: %s", item_id, exc)

        try:
            from backend.retrieval.indexer import Indexer
            indexer = Indexer()
            if local_text_path and hasattr(indexer, "index_item"):
                asyncio.create_task(indexer.index_item(item_id))
        except Exception as exc:
            log.debug("Indexing dispatch skipped for item %s: %s", item_id, exc)

        return {"status": "imported", "item_id": item_id, "title": extracted_title}

    async def run_two_way_sync(self, root_folder_id: str | None = None) -> dict[str, Any]:
        """Execute complete two-way synchronization."""
        if LibrarySyncEngine._is_running:
            return self.get_status()

        LibrarySyncEngine._is_running = True
        LibrarySyncEngine._cancelled = False
        LibrarySyncEngine._status = {
            "is_running": True,
            "stage": "scanning",
            "found_drive_items": 0,
            "inbound_imported": 0,
            "uploaded_outbound": 0,
            "skipped_duplicates": 0,
            "errors": [],
            "last_error": None,
        }

        try:
            # 1. Resolve root folder ID
            root_id = root_folder_id
            if not root_id:
                detect = await self.bridge.detect_library_root(mode="auto")
                root_id = detect.get("folder_id")
                if not root_id:
                    root_id = await self.bridge.ensure_verified_root("Amethyst/Library", write_marker=True)

            if LibrarySyncEngine._cancelled:
                LibrarySyncEngine._status["stage"] = "cancelled"
                return self.get_status()

            # 2. Inbound Discovery
            drive_files = await self.scan_drive_items(root_id)
            LibrarySyncEngine._status["found_drive_items"] = len(drive_files)
            LibrarySyncEngine._status["stage"] = "importing"

            # Inbound ingestion
            for df in drive_files:
                if LibrarySyncEngine._cancelled:
                    break
                try:
                    res = await self.ingest_inbound_item(df)
                    if res.get("status") == "imported":
                        LibrarySyncEngine._status["inbound_imported"] += 1
                    elif res.get("status") == "skipped":
                        LibrarySyncEngine._status["skipped_duplicates"] += 1
                except Exception as exc:
                    log.warning("Inbound sync item failed: %s", exc)
                    LibrarySyncEngine._status["errors"].append(str(exc))
                    LibrarySyncEngine._status["last_error"] = str(exc)

            if LibrarySyncEngine._cancelled:
                LibrarySyncEngine._status["stage"] = "cancelled"
                return self.get_status()

            # 3. Outbound Migration of Local Items
            LibrarySyncEngine._status["stage"] = "uploading"
            from backend.library.storage.migration import MigrationEngine

            mig = MigrationEngine()
            await mig.build_manifest()

            while not LibrarySyncEngine._cancelled:
                batch = await mig.step(batch_size=5)
                completed = batch.get("completed", 0)
                failed = batch.get("failed", 0)
                LibrarySyncEngine._status["uploaded_outbound"] += completed
                if batch.get("error"):
                    LibrarySyncEngine._status["last_error"] = batch["error"]
                    break
                if completed == 0 and failed == 0:
                    break

            LibrarySyncEngine._status["stage"] = "complete" if not LibrarySyncEngine._cancelled else "cancelled"

        except Exception as exc:
            log.exception("Two-way library sync failed: %s", exc)
            LibrarySyncEngine._status["stage"] = "failed"
            LibrarySyncEngine._status["last_error"] = str(exc)
            LibrarySyncEngine._status["errors"].append(str(exc))
        finally:
            LibrarySyncEngine._is_running = False
            LibrarySyncEngine._status["is_running"] = False

        return self.get_status()
