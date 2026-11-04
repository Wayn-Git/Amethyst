"""Composio Google Drive Action Bridge.

Translates high-level Google Drive operations to Composio Google Drive actions,
enforces strict root folder scoping, and maps connection states.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Coroutine

from backend.library.storage.base import (
    StorageError,
    StorageNotFoundError,
    StorageUnavailableError,
)
from backend.mcp.composio_service import composio_service

log = logging.getLogger(__name__)


class GoogleDriveBridge:
    """Bridge for Google Drive operations via Composio toolkit."""

    def __init__(
        self,
        action_executor: Callable[[str, dict[str, Any]], Coroutine[Any, Any, Any]] | None = None,
    ) -> None:
        self._action_executor = action_executor
        self._folder_cache: dict[str, str] = {}

    def is_connected(self) -> bool:
        """Check if Google Drive is authorized and active in Composio."""
        if not composio_service.is_configured():
            return False
        conns = composio_service.get_connections()
        gdrive = conns.get("googledrive")
        if not gdrive or gdrive.get("status") != "ACTIVE":
            return False
        if composio_service.is_reauth_required("googledrive"):
            return False
        return True

    def get_connection_status(self) -> dict[str, Any]:
        """Get detailed connection health and account info."""
        if not composio_service.is_configured():
            return {"configured": False, "connected": False, "account_email": None}

        conns = composio_service.get_connections()
        gdrive = conns.get("googledrive") or {}
        is_active = gdrive.get("status") == "ACTIVE"
        needs_reauth = composio_service.is_reauth_required("googledrive")

        return {
            "configured": True,
            "connected": is_active and not needs_reauth,
            "needs_reauth": needs_reauth,
            "account_id": gdrive.get("id"),
            "account_email": gdrive.get("email") or gdrive.get("account_identifier"),
        }

    async def _execute(self, action: str, params: dict[str, Any]) -> Any:
        """Execute a Google Drive action through the provided executor or Composio manager."""
        if self._action_executor:
            return await self._action_executor(action, params)

        if not self.is_connected():
            raise StorageUnavailableError("Google Drive is not connected or requires re-authentication.")

        # Resolve through Composio tool execution
        from backend.mcp.live import get_manager
        from backend.tools.base import ToolContext

        manager = get_manager()
        tool = manager.registry.resolve_tool(action)
        if not tool:
            raise StorageUnavailableError(f"Action {action} is not available in Composio registry.")

        context = ToolContext(read_only=False)
        result = await tool.handler(params, context)
        if result.is_error:
            raise StorageError(f"Google Drive action {action} failed: {result.content}")

        import json
        try:
            return json.loads(result.content)
        except Exception:
            return result.content

    async def ensure_root_folder(self, root_name_or_id: str) -> str:
        """Find or create designated root folder in Google Drive.
        
        If root_name_or_id is a 20+ char alphanumeric ID without '/', treat as folder ID.
        Otherwise, search/create path (e.g. 'Amethyst/Library').
        """
        clean = root_name_or_id.strip()
        if "/" not in clean and len(clean) >= 20 and not clean.startswith("Amethyst"):
            return clean

        if clean in self._folder_cache:
            return self._folder_cache[clean]

        parts = [p.strip() for p in clean.split("/") if p.strip()]
        if not parts:
            parts = ["Amethyst", "Library"]

        parent_id = "root"
        for part in parts:
            found_id = await self._find_folder(part, parent_id)
            if not found_id:
                found_id = await self._create_folder_direct(part, parent_id)
            parent_id = found_id

        self._folder_cache[clean] = parent_id
        return parent_id

    async def _find_folder(self, name: str, parent_id: str) -> str | None:
        """Search for a folder by name within parent_id."""
        query = f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed = false"
        res = await self._execute("googledrive_search_files", {"query": query})
        files = res.get("files", []) if isinstance(res, dict) else []
        if files and isinstance(files[0], dict) and "id" in files[0]:
            return str(files[0]["id"])
        return None

    async def _create_folder_direct(self, name: str, parent_id: str) -> str:
        """Create a new folder directly under parent_id."""
        res = await self._execute(
            "googledrive_create_folder",
            {"name": name, "parent_folder_id": parent_id},
        )
        if isinstance(res, dict) and "id" in res:
            return str(res["id"])
        raise StorageError(f"Failed to create folder '{name}' under '{parent_id}'")

    async def get_or_create_subfolder(self, name: str, parent_root_id: str) -> str:
        """Get or create subfolder (e.g. 'articles', 'media') inside designated root."""
        cache_key = f"{parent_root_id}/{name}"
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        found = await self._find_folder(name, parent_root_id)
        if not found:
            found = await self._create_folder_direct(name, parent_root_id)

        self._folder_cache[cache_key] = found
        return found

    async def list_files_in_folder(self, folder_id: str) -> list[dict[str, Any]]:
        """List files strictly inside folder_id."""
        query = f"'{folder_id}' in parents and trashed = false"
        res = await self._execute("googledrive_search_files", {"query": query})
        if isinstance(res, dict) and "files" in res:
            return list(res["files"])
        return []

    async def upload_file(
        self,
        name: str,
        content: bytes,
        mime_type: str,
        parent_id: str,
    ) -> dict[str, Any]:
        """Upload file content into parent_id."""
        import base64
        params = {
            "name": name,
            "parent_folder_id": parent_id,
            "mime_type": mime_type,
            "content": base64.b64encode(content).decode("ascii"),
            "encoding": "base64",
        }
        res = await self._execute("googledrive_upload_file", params)
        if isinstance(res, dict) and "id" in res:
            return res
        raise StorageError(f"Failed to upload file '{name}' to Google Drive")

    async def download_file(self, file_id: str) -> bytes:
        """Download file binary content by file_id."""
        res = await self._execute("googledrive_download_file", {"file_id": file_id})
        if isinstance(res, bytes):
            return res
        if isinstance(res, str):
            import base64
            try:
                return base64.b64decode(res)
            except Exception:
                return res.encode("utf-8")
        if isinstance(res, dict) and "content" in res:
            raw = res["content"]
            if isinstance(raw, str):
                import base64
                try:
                    return base64.b64decode(raw)
                except Exception:
                    return raw.encode("utf-8")
        raise StorageError(f"Could not download content for file ID '{file_id}'")

    async def delete_file(self, file_id: str) -> bool:
        """Delete or trash a file by file_id."""
        try:
            await self._execute("googledrive_delete_file", {"file_id": file_id})
            return True
        except Exception as exc:
            log.warning("Could not delete file %s from Google Drive: %s", file_id, exc)
            return False
