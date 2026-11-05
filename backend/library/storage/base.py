"""Storage provider interface and internal models.

Establishes provider-independent contracts for file storage across local disk
and cloud providers (e.g. Google Drive).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, BinaryIO


class StorageError(Exception):
    """Base exception for storage provider operations."""


class StorageUnavailableError(StorageError):
    """Provider is offline, disconnected, or credentials expired."""


class StorageNotFoundError(StorageError):
    """Requested object does not exist in storage."""


@dataclass(frozen=True)
class StorageObject:
    """Normalized metadata for a file or folder in a storage provider."""

    external_id: str
    name: str
    size_bytes: int
    mime_type: str
    checksum: str | None
    modified_at: str
    parent_folder_id: str | None = None
    is_folder: bool = False
    extra: dict[str, Any] | None = None


@dataclass(frozen=True)
class StorageCapabilities:
    """Declared feature capabilities of a storage provider."""

    supports_checksum: bool = True
    supports_streaming_download: bool = True
    supports_folders: bool = True
    supports_resumable_upload: bool = True


class StorageProvider(ABC):
    """Abstract interface for all file storage providers."""

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Unique provider identifier (e.g. 'local', 'google_drive')."""

    @property
    @abstractmethod
    def capabilities(self) -> StorageCapabilities:
        """Provider capabilities."""

    @abstractmethod
    async def get_object(self, external_id: str) -> StorageObject | None:
        """Retrieve metadata for an object by its provider ID."""

    @abstractmethod
    async def read(self, external_id: str) -> bytes:
        """Read and return full content of an object."""

    @abstractmethod
    async def write(
        self,
        name: str,
        data: bytes | BinaryIO,
        mime_type: str = "application/octet-stream",
        parent_folder_id: str | None = None,
        expected_checksum: str | None = None,
    ) -> StorageObject:
        """Write an object to storage."""

    @abstractmethod
    async def delete(self, external_id: str) -> bool:
        """Delete an object from storage."""

    @abstractmethod
    async def create_folder(self, name: str, parent_folder_id: str | None = None) -> StorageObject:
        """Create a folder in storage."""

    @abstractmethod
    async def list_folder(self, folder_id: str) -> list[StorageObject]:
        """List immediate child items of a folder."""
