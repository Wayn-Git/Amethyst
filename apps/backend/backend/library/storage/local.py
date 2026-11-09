"""Local filesystem storage provider implementation."""

from __future__ import annotations

import hashlib
import mimetypes
import os
from datetime import datetime
from pathlib import Path
from typing import BinaryIO

from backend.config import paths, write_atomic
from backend.library.storage.base import (
    StorageCapabilities,
    StorageError,
    StorageNotFoundError,
    StorageObject,
    StorageProvider,
)


def _compute_sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _write_atomic_bytes(path: Path, data: bytes) -> None:
    import tempfile
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, scratch = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.replace(scratch, path)
    except Exception:
        try:
            os.unlink(scratch)
        except OSError:
            pass
        raise



class LocalStorageProvider(StorageProvider):
    """Storage provider operating directly against local disk directories."""

    def __init__(self, root_dir: Path | None = None) -> None:
        self.root = (root_dir or paths().library_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @property
    def provider_id(self) -> str:
        return "local"

    @property
    def capabilities(self) -> StorageCapabilities:
        return StorageCapabilities(
            supports_checksum=True,
            supports_streaming_download=True,
            supports_folders=True,
            supports_resumable_upload=False,
        )

    def _resolve_path(self, external_id: str) -> Path:
        p = (self.root / external_id.lstrip("/")).resolve()
        # Prevent directory traversal outside root
        if not str(p).startswith(str(self.root)):
            raise StorageError(f"Path traversal detected: {external_id}")
        return p

    def _to_storage_object(self, path: Path) -> StorageObject:
        rel = str(path.relative_to(self.root))
        stat = path.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
        is_dir = path.is_dir()
        size = 0 if is_dir else stat.st_size
        mime, _ = mimetypes.guess_type(path.name)
        mime = mime or ("inode/directory" if is_dir else "application/octet-stream")

        checksum = None
        if not is_dir and size < 50 * 1024 * 1024:  # Up to 50MB
            try:
                checksum = _compute_sha256(path.read_bytes())
            except Exception:
                checksum = None

        parent_rel = str(path.parent.relative_to(self.root)) if path.parent != self.root else None

        return StorageObject(
            external_id=rel,
            name=path.name,
            size_bytes=size,
            mime_type=mime,
            checksum=checksum,
            modified_at=mtime,
            parent_folder_id=parent_rel,
            is_folder=is_dir,
        )

    async def get_object(self, external_id: str) -> StorageObject | None:
        p = self._resolve_path(external_id)
        if not p.exists():
            return None
        return self._to_storage_object(p)

    async def read(self, external_id: str) -> bytes:
        p = self._resolve_path(external_id)
        if not p.is_file():
            raise StorageNotFoundError(f"File not found: {external_id}")
        return p.read_bytes()

    async def write(
        self,
        name: str,
        data: bytes | BinaryIO,
        mime_type: str = "application/octet-stream",
        parent_folder_id: str | None = None,
        expected_checksum: str | None = None,
    ) -> StorageObject:
        target_dir = self._resolve_path(parent_folder_id) if parent_folder_id else self.root
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / name

        content = data.read() if hasattr(data, "read") else data
        if isinstance(content, str):
            content = content.encode("utf-8")
        _write_atomic_bytes(target_file, content)

        if expected_checksum:
            actual = _compute_sha256(content)
            if actual != expected_checksum:
                target_file.unlink(missing_ok=True)
                raise StorageError(f"Checksum mismatch: expected {expected_checksum}, got {actual}")

        return self._to_storage_object(target_file)

    async def delete(self, external_id: str) -> bool:
        p = self._resolve_path(external_id)
        if not p.exists():
            return False
        if p.is_dir():
            import shutil
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
        return True

    async def create_folder(self, name: str, parent_folder_id: str | None = None) -> StorageObject:
        target_dir = (self._resolve_path(parent_folder_id) if parent_folder_id else self.root) / name
        target_dir.mkdir(parents=True, exist_ok=True)
        return self._to_storage_object(target_dir)

    async def list_folder(self, folder_id: str) -> list[StorageObject]:
        target_dir = self._resolve_path(folder_id) if folder_id else self.root
        if not target_dir.is_dir():
            raise StorageNotFoundError(f"Folder not found: {folder_id}")
        items: list[StorageObject] = []
        for child in target_dir.iterdir():
            items.append(self._to_storage_object(child))
        return items
