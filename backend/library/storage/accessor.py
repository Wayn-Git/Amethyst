"""File content accessor and local cache manager.

Coordinates transparent reading, writing, and on-demand caching of files
across local filesystem and cloud storage providers.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import BinaryIO

from backend.config import paths
from backend.db.connection import get_connection
from backend.library.storage.base import (
    StorageError,
    StorageNotFoundError,
    StorageProvider,
    StorageUnavailableError,
)
from backend.library.storage.local import LocalStorageProvider
from backend.library.store import LibraryStore

log = logging.getLogger(__name__)


class FileContentAccessor:
    """Manages file resolution and caching for Library items."""

    def __init__(
        self,
        cache_dir: Path | None = None,
        local_provider: StorageProvider | None = None,
        gdrive_provider: StorageProvider | None = None,
    ) -> None:
        self.cache_dir = (cache_dir or (paths().home / "cache" / "library")).resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.local_provider = local_provider or LocalStorageProvider()
        self._gdrive_provider = gdrive_provider

    def _get_gdrive_provider(self) -> StorageProvider:
        if self._gdrive_provider is not None:
            return self._gdrive_provider
        from backend.library.storage.config import StorageConfigStore
        from backend.library.storage.gdrive import GoogleDriveProvider

        cfg = StorageConfigStore().get_config()
        self._gdrive_provider = GoogleDriveProvider(root_folder_id=cfg.get("gdrive_root_id"))
        return self._gdrive_provider

    def _get_provider_for_name(self, provider_name: str | None) -> StorageProvider:
        if provider_name == "google_drive":
            return self._get_gdrive_provider()
        return self.local_provider

    async def get_text(self, item_id: int) -> str:
        """Retrieve the markdown/text content for a library item."""
        store = LibraryStore()
        row = store.get(item_id)
        if row is None:
            raise StorageNotFoundError(f"Library item {item_id} not found")

        provider_name = row["storage_provider"] or "local"
        text_path_str = row["text_path"]
        external_id = row["external_id"]

        # 1. Local provider: read from disk directly
        if provider_name == "local" and text_path_str:
            p = Path(text_path_str).expanduser()
            if p.is_file():
                return p.read_text(encoding="utf-8", errors="replace")

        # 2. Check local cache
        cache_file = self.cache_dir / f"{item_id:06d}-text.md"
        if cache_file.is_file():
            return cache_file.read_text(encoding="utf-8", errors="replace")

        # 3. Cloud fetch via external_id
        if not external_id:
            # Check manifest for explicit text external_id
            with get_connection() as conn:
                m_row = conn.execute(
                    "SELECT external_id FROM storage_migration_manifest WHERE item_id = ? AND file_type = 'text' AND status = 'completed'",
                    (item_id,),
                ).fetchone()
            if m_row and m_row["external_id"]:
                provider_name = "google_drive"
                external_id = m_row["external_id"]

        if not external_id:
            # Fall back to text_path if local file still exists
            if text_path_str and Path(text_path_str).is_file():
                return Path(text_path_str).read_text(encoding="utf-8", errors="replace")
            return ""

        provider = self._get_provider_for_name(provider_name)
        try:
            content_bytes = await provider.read(external_id)
            cache_file.write_bytes(content_bytes)
            store.update(item_id, cached_locally=1)
            return content_bytes.decode("utf-8", errors="replace")
        except Exception as exc:
            log.warning("Could not download text for item %s from %s: %s", item_id, provider_name, exc)
            raise StorageUnavailableError(f"Cloud text unavailable: {exc}") from exc

    async def get_media_path(self, item_id: int) -> Path | None:
        """Resolve a local file path for media streaming."""
        store = LibraryStore()
        row = store.get(item_id)
        if row is None:
            return None

        # 1. Check media_path on local disk
        media_path_str = row["media_path"]
        if media_path_str:
            p = Path(media_path_str).expanduser()
            if p.is_file() and p.stat().st_size > 1000:
                return p

        # 2. Check standard media_dir for files matching item_id
        from backend.library.store import media_path
        for ext in (".mp4", ".webm", ".mov", ".mkv"):
            candidate = media_path(item_id, ext)
            if candidate.is_file() and candidate.stat().st_size > 1000:
                store.update(item_id, media_path=str(candidate))
                return candidate

        # 3. Check cache directory
        cache_pattern = [
            f for f in self.cache_dir.glob(f"{item_id:06d}-media.*")
            if f.is_file() and f.stat().st_size > 1000
        ]
        if cache_pattern:
            return cache_pattern[0]

        # 4. Check storage_migration_manifest for existing local_path or external_id
        m_row = None
        with get_connection() as conn:
            m_row = conn.execute(
                "SELECT external_id, local_path, status FROM storage_migration_manifest WHERE item_id = ? AND file_type = 'media'",
                (item_id,),
            ).fetchone()

        if m_row and m_row["local_path"]:
            p = Path(m_row["local_path"]).expanduser()
            if p.is_file() and p.stat().st_size > 1000:
                store.update(item_id, media_path=str(p))
                return p

        # 5. On-demand cloud download if external_id exists (in manifest or library_items)
        external_id = m_row["external_id"] if (m_row and m_row["external_id"]) else None
        provider_name = row["storage_provider"] or ("google_drive" if external_id else "local")
        if not external_id and provider_name == "google_drive":
            external_id = row["external_id"]

        if external_id and provider_name == "google_drive":
            try:
                provider = self._get_provider_for_name(provider_name)
                content = await provider.read(external_id)
                ext = ".mp4"
                if media_path_str and Path(media_path_str).suffix:
                    ext = Path(media_path_str).suffix
                elif m_row and m_row["local_path"] and Path(m_row["local_path"]).suffix:
                    ext = Path(m_row["local_path"]).suffix
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                target = self.cache_dir / f"{item_id:06d}-media{ext}"
                target.write_bytes(content)
                store.update(item_id, cached_locally=1, media_path=str(target))
                return target
            except Exception as exc:
                log.warning("Failed to fetch cloud media for item %s: %s", item_id, exc)

        return None

    async def get_thumbnail_path(self, item_id: int) -> Path | None:
        """Resolve a local file path for thumbnail."""
        store = LibraryStore()
        row = store.get(item_id)
        if row is None:
            return None

        thumb_str = row["thumbnail_path"]
        if thumb_str:
            p = Path(thumb_str).expanduser()
            if p.is_file():
                return p

        cache_thumb = self.cache_dir / f"{item_id:06d}-thumb.jpg"
        if cache_thumb.is_file():
            return cache_thumb

        return None
