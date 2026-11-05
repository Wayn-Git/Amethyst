"""Google Drive storage provider implementation conforming to StorageProvider."""

from __future__ import annotations

import hashlib
from typing import BinaryIO

from backend.library.storage.base import (
    StorageCapabilities,
    StorageError,
    StorageObject,
    StorageProvider,
)
from backend.library.storage.gdrive_bridge import GoogleDriveBridge


def _compute_sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


class GoogleDriveProvider(StorageProvider):
    """Storage provider delegating to Google Drive through Composio bridge."""

    def __init__(
        self,
        bridge: GoogleDriveBridge | None = None,
        root_folder_id: str | None = None,
    ) -> None:
        self.bridge = bridge or GoogleDriveBridge()
        self.root_folder_id = root_folder_id

    @property
    def provider_id(self) -> str:
        return "google_drive"

    @property
    def capabilities(self) -> StorageCapabilities:
        return StorageCapabilities(
            supports_checksum=True,
            supports_streaming_download=False,
            supports_folders=True,
            supports_resumable_upload=True,
        )

    async def _resolve_parent_id(self, parent_folder_id: str | None) -> str:
        """Resolve destination folder ID, ensuring it lives within root folder."""
        if not self.root_folder_id:
            self.root_folder_id = await self.bridge.ensure_root_folder("Amethyst/Library")

        if not parent_folder_id or parent_folder_id in ("root", "/"):
            return self.root_folder_id

        # If parent_folder_id is a named facet (e.g. 'articles', 'media', 'notes', 'books')
        if "/" not in parent_folder_id and len(parent_folder_id) < 20:
            return await self.bridge.get_or_create_subfolder(parent_folder_id, self.root_folder_id)

        return parent_folder_id

    def _normalize_object(self, data: dict, parent_folder_id: str | None = None) -> StorageObject:
        raw_size = data.get("size", 0)
        try:
            size_bytes = int(raw_size)
        except (ValueError, TypeError):
            size_bytes = 0

        is_folder = data.get("mimeType") == "application/vnd.google-apps.folder"

        return StorageObject(
            external_id=str(data.get("id")),
            name=str(data.get("name", "untitled")),
            size_bytes=size_bytes,
            mime_type=str(data.get("mimeType", "application/octet-stream")),
            checksum=data.get("md5Checksum") or data.get("sha256Checksum"),
            modified_at=str(data.get("modifiedTime", "")),
            parent_folder_id=parent_folder_id,
            is_folder=is_folder,
            extra=data,
        )

    async def get_object(self, external_id: str) -> StorageObject | None:
        # Check if file exists via search by ID
        query = f"'{external_id}' in parents or id = '{external_id}'"
        files = await self.bridge.list_files_in_folder(external_id)
        if files:
            return self._normalize_object(files[0])
        return None

    async def read(self, external_id: str) -> bytes:
        return await self.bridge.download_file(external_id)

    async def write(
        self,
        name: str,
        data: bytes | BinaryIO,
        mime_type: str = "application/octet-stream",
        parent_folder_id: str | None = None,
        expected_checksum: str | None = None,
    ) -> StorageObject:
        content = data.read() if hasattr(data, "read") else data
        if isinstance(content, str):
            content = content.encode("utf-8")

        resolved_parent = await self._resolve_parent_id(parent_folder_id)
        res = await self.bridge.upload_file(
            name=name,
            content=content,
            mime_type=mime_type,
            parent_id=resolved_parent,
        )
        obj = self._normalize_object(res, parent_folder_id=resolved_parent)

        if expected_checksum:
            actual = _compute_sha256(content)
            if actual != expected_checksum:
                await self.delete(obj.external_id)
                raise StorageError(f"Checksum mismatch: expected {expected_checksum}, got {actual}")

        return obj

    async def delete(self, external_id: str) -> bool:
        return await self.bridge.delete_file(external_id)

    async def create_folder(self, name: str, parent_folder_id: str | None = None) -> StorageObject:
        resolved_parent = await self._resolve_parent_id(parent_folder_id)
        folder_id = await self.bridge.get_or_create_subfolder(name, resolved_parent)
        return StorageObject(
            external_id=folder_id,
            name=name,
            size_bytes=0,
            mime_type="application/vnd.google-apps.folder",
            checksum=None,
            modified_at="",
            parent_folder_id=resolved_parent,
            is_folder=True,
        )

    async def list_folder(self, folder_id: str) -> list[StorageObject]:
        resolved_folder = await self._resolve_parent_id(folder_id)
        raw_files = await self.bridge.list_files_in_folder(resolved_folder)
        return [self._normalize_object(f, parent_folder_id=resolved_folder) for f in raw_files]
