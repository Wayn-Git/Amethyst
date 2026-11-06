"""Composio Google Drive Action Bridge.

Translates high-level Google Drive operations to Composio Google Drive actions,
enforces strict root folder scoping, and maps connection states.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Coroutine

from backend.library.storage.base import (
    StorageError,
    StorageNotFoundError,
    StorageUnavailableError,
)
from backend.mcp.composio_service import composio_service

log = logging.getLogger(__name__)

MARKER_FILE_NAME = ".amethyst-library.json"
MARKER_PAYLOAD = json.dumps(
    {"app": "amethyst", "type": "library_root", "version": 1},
    separators=(",", ":"),
).encode("utf-8")


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
        gdrive = conns.get("googledrive") or conns.get("google_drive")
        if not gdrive or gdrive.get("status") != "ACTIVE":
            try:
                conns = composio_service._fetch_connections_sync()
                gdrive = conns.get("googledrive") or conns.get("google_drive")
            except Exception:
                pass
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
        gdrive = conns.get("googledrive") or conns.get("google_drive") or {}
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
        """Execute a Google Drive action through custom executor, MCP tool, or Composio SDK."""
        if self._action_executor:
            return await self._action_executor(action, params)

        if not self.is_connected():
            raise StorageUnavailableError("Google Drive is not connected or requires re-authentication.")

        # 1. Try MCP tool registry if active
        try:
            from backend.mcp.live import get_manager
            from backend.tools.base import ToolContext

            manager = get_manager()
            if manager and hasattr(manager, "registry"):
                tool = manager.registry.resolve_tool(action) or manager.registry.resolve_tool(action.lower())
                if tool:
                    context = ToolContext(read_only=False)
                    result = await tool.handler(params, context)
                    if result.is_error:
                        raise StorageError(f"Google Drive action {action} failed: {result.content}")
                    try:
                        return json.loads(result.content)
                    except Exception:
                        return result.content
        except StorageError:
            raise
        except Exception as exc:
            log.debug("MCP tool invocation skipped for %s: %s", action, exc)

        # 2. Direct Composio SDK execution
        try:
            client = composio_service._get_client()
            uid = composio_service._get_stable_user_id()

            def _run():
                return client.tools.execute(
                    slug=action,
                    arguments=params,
                    user_id=uid,
                    dangerously_skip_version_check=True,
                )

            res = await asyncio.to_thread(_run)
            if isinstance(res, dict):
                if res.get("error"):
                    raise StorageError(f"Google Drive action {action} failed: {res['error']}")
                return res.get("data", res)
            return res
        except Exception as exc:
            if isinstance(exc, (StorageError, StorageUnavailableError)):
                raise
            log.exception("Composio SDK execute failed for action %s: %s", action, exc)
            raise StorageError(f"Google Drive action {action} failed: {exc}") from exc

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

        parent_id: str | None = None
        for part in parts:
            found_id = await self._find_folder(part, parent_id)
            if not found_id:
                found_id = await self._create_folder_direct(part, parent_id)
            parent_id = found_id

        self._folder_cache[clean] = str(parent_id)
        return str(parent_id)

    async def detect_library_root(
        self, mode: str = "auto", custom_path: str | None = None
    ) -> dict[str, Any]:
        """Detect or verify the Google Drive library root folder.

        In 'auto' mode:
        1. Checks if a marker file (.amethyst-library.json) exists anywhere in Drive.
           If found, uses its parent folder.
        2. If not found, checks if an "Amethyst" folder exists.
           - If it has a "Library" subfolder, uses "Amethyst/Library".
           - If it has NO "Library" subfolder, treats it as a pre-existing unverified personal folder
             and refuses to use it directly, returning a warning.
        3. If no folder exists, returns standard default "Amethyst/Library".

        In 'custom' mode:
        Resolves custom_path or folder ID, checks if target exists and if marker is present.
        """
        if mode == "custom" and custom_path:
            clean = custom_path.strip()
            folder_id: str | None = None
            if "/" not in clean and len(clean) >= 20 and not clean.startswith("Amethyst"):
                folder_id = clean
            else:
                parts = [p.strip() for p in clean.split("/") if p.strip()]
                parent = None
                for part in parts:
                    parent = await self._find_folder(part, parent)
                    if not parent:
                        break
                folder_id = parent

            if not folder_id:
                return {
                    "verified": False,
                    "folder_id": None,
                    "folder_path": clean,
                    "marker_present": False,
                    "file_count": 0,
                    "warning": f"Folder '{clean}' was not found in your Google Drive.",
                }

            # Check if marker file is present in this custom folder
            has_marker = False
            try:
                res = await self._execute(
                    "GOOGLEDRIVE_FIND_FILE",
                    {"q": f"'{folder_id}' in parents and name = '{MARKER_FILE_NAME}' and trashed = false"},
                )
                files = res.get("files", []) if isinstance(res, dict) else []
                has_marker = len(files) > 0
            except Exception:
                pass

            files_in_folder = await self.list_files_in_folder(folder_id)
            count = len([f for f in files_in_folder if f.get("name") != MARKER_FILE_NAME])

            return {
                "verified": True,
                "folder_id": folder_id,
                "folder_path": clean,
                "marker_present": has_marker,
                "file_count": count,
                "warning": None if has_marker else "Selected folder does not have an Amethyst marker. Marker will be added upon synchronization.",
            }

        # Auto detection mode
        # 1. Look for marker file
        try:
            res = await self._execute(
                "GOOGLEDRIVE_FIND_FILE",
                {"q": f"name = '{MARKER_FILE_NAME}' and trashed = false"},
            )
            files = res.get("files", []) if isinstance(res, dict) else []
            if files and isinstance(files[0], dict):
                parents = files[0].get("parents") or []
                parent_id = parents[0] if parents else None
                if parent_id:
                    files_in_folder = await self.list_files_in_folder(str(parent_id))
                    count = len([f for f in files_in_folder if f.get("name") != MARKER_FILE_NAME])
                    return {
                        "verified": True,
                        "folder_id": str(parent_id),
                        "folder_path": "Amethyst/Library",
                        "marker_present": True,
                        "file_count": count,
                        "warning": None,
                    }
        except Exception as exc:
            log.debug("Marker search failed: %s", exc)

        # 2. Check for existing "Amethyst" or "amethyst" folder
        amethyst_folder = await self._find_folder("Amethyst") or await self._find_folder("amethyst")
        if amethyst_folder:
            # Check for Library subfolder
            lib_sub = await self._find_folder("Library", amethyst_folder) or await self._find_folder("library", amethyst_folder)
            if lib_sub:
                files_in_folder = await self.list_files_in_folder(lib_sub)
                count = len([f for f in files_in_folder if f.get("name") != MARKER_FILE_NAME])
                return {
                    "verified": True,
                    "folder_id": lib_sub,
                    "folder_path": "Amethyst/Library",
                    "marker_present": False,
                    "file_count": count,
                    "warning": None,
                }
            else:
                # Personal unverified folder detected!
                return {
                    "verified": False,
                    "folder_id": None,
                    "folder_path": "Amethyst/Library",
                    "marker_present": False,
                    "file_count": 0,
                    "warning": (
                        "Found an existing unverified personal folder named 'amethyst' without an Amethyst Library structure. "
                        "To protect your personal files, Amethyst will use a dedicated 'Amethyst/Library' folder."
                    ),
                }

        # 3. Default path
        return {
            "verified": True,
            "folder_id": None,
            "folder_path": "Amethyst/Library",
            "marker_present": False,
            "file_count": 0,
            "warning": None,
        }

    async def ensure_verified_root(
        self, root_name_or_id: str = "Amethyst/Library", write_marker: bool = True
    ) -> str:
        """Find or create designated root folder in Google Drive and verify marker."""
        root_id = await self.ensure_root_folder(root_name_or_id)
        if write_marker:
            try:
                # Check if marker exists
                res = await self._execute(
                    "GOOGLEDRIVE_FIND_FILE",
                    {"q": f"'{root_id}' in parents and name = '{MARKER_FILE_NAME}' and trashed = false"},
                )
                files = res.get("files", []) if isinstance(res, dict) else []
                if not files:
                    await self.upload_file(
                        name=MARKER_FILE_NAME,
                        content=MARKER_PAYLOAD,
                        mime_type="application/json",
                        parent_id=root_id,
                    )
            except Exception as exc:
                log.warning("Could not ensure marker file in root %s: %s", root_id, exc)
        return root_id

    async def _find_folder(self, name: str, parent_id: str | None = None) -> str | None:
        """Search for a folder by name within parent_id (case-insensitive fallback)."""
        variations = [name]
        for candidate in (name.lower(), name.capitalize(), name.title(), name.upper()):
            if candidate not in variations:
                variations.append(candidate)

        for cand in variations:
            args: dict[str, Any] = {"name_exact": cand}
            if parent_id and parent_id not in ("root", "/"):
                args["parent_folder_id"] = parent_id

            try:
                res = await self._execute("GOOGLEDRIVE_FIND_FOLDER", args)
                files = res.get("files", []) if isinstance(res, dict) else []
                if files and isinstance(files[0], dict) and "id" in files[0]:
                    return str(files[0]["id"])
            except Exception as exc:
                log.warning("Failed to find folder '%s' under '%s': %s", cand, parent_id, exc)

        # Fallback: if parent_id provided, list contents and check case-insensitively
        if parent_id and parent_id not in ("root", "/"):
            try:
                children = await self.list_files_in_folder(parent_id)
                target_lower = name.strip().lower()
                for c in children:
                    if c.get("mimeType") == "application/vnd.google-apps.folder":
                        if str(c.get("name", "")).strip().lower() == target_lower and c.get("id"):
                            return str(c["id"])
            except Exception:
                pass

        return None

    async def _create_folder_direct(self, name: str, parent_id: str | None = None) -> str:
        """Create a new folder directly under parent_id."""
        args: dict[str, Any] = {"name": name}
        if parent_id and parent_id not in ("root", "/"):
            args["parent_id"] = parent_id

        res = await self._execute("GOOGLEDRIVE_CREATE_FOLDER", args)
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
        """List all files strictly inside folder_id with full pagination support."""
        query = f"'{folder_id}' in parents and trashed = false"
        all_files: list[dict[str, Any]] = []
        page_token = None
        max_pages = 50

        try:
            for _ in range(max_pages):
                params: dict[str, Any] = {"q": query, "pageSize": 500}
                if page_token:
                    params["nextPageToken"] = page_token
                res = await self._execute("GOOGLEDRIVE_FIND_FILE", params)
                if not isinstance(res, dict):
                    break
                files = res.get("files", [])
                if isinstance(files, list):
                    all_files.extend(files)
                page_token = res.get("nextPageToken")
                if not page_token:
                    break
            return all_files
        except Exception as exc:
            log.warning("Could not list files in folder %s: %s", folder_id, exc)
            return all_files

    async def upload_file(
        self,
        name: str,
        content: bytes,
        mime_type: str = "text/markdown",
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload file content into parent_id."""
        args: dict[str, Any] = {
            "file_name": name,
            "mime_type": mime_type,
        }
        if parent_id and parent_id not in ("root", "/"):
            args["parent_id"] = parent_id

        # Text files (.md, .txt, .json, .html, .csv)
        is_text = (
            mime_type.startswith("text/")
            or mime_type in ("application/json", "application/xml")
            or name.endswith((".md", ".txt", ".json", ".html", ".csv"))
        )
        if is_text:
            try:
                args["text_content"] = content.decode("utf-8")
                res = await self._execute("GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", args)
                if isinstance(res, dict) and "id" in res:
                    return res
            except UnicodeDecodeError:
                pass

        # Binary file fallback
        args_create: dict[str, Any] = {
            "name": name,
            "mimeType": mime_type,
        }
        if parent_id and parent_id not in ("root", "/"):
            args_create["parents"] = [parent_id]

        res = await self._execute("GOOGLEDRIVE_CREATE_FILE", args_create)
        if isinstance(res, dict) and "id" in res:
            return res
        raise StorageError(f"Failed to upload file '{name}' to Google Drive")

    async def download_file(self, file_id: str) -> bytes:
        """Download file binary content by file_id."""
        res = await self._execute("GOOGLEDRIVE_DOWNLOAD_FILE", {"fileId": file_id})
        if isinstance(res, bytes):
            return res
        if isinstance(res, str):
            return res.encode("utf-8")
        if isinstance(res, dict):
            # Check for direct content
            if "content" in res:
                c = res["content"]
                return c.encode("utf-8") if isinstance(c, str) else bytes(c)

            # Check for S3 download url
            download_info = res.get("downloaded_file_content")
            if isinstance(download_info, dict) and "s3url" in download_info:
                import httpx
                resp = httpx.get(download_info["s3url"], timeout=30.0)
                if resp.status_code == 200:
                    return resp.content

        raise StorageNotFoundError(f"Could not download content for file ID '{file_id}'")

    async def delete_file(self, file_id: str) -> bool:
        """Delete or trash a file by file_id."""
        try:
            await self._execute("GOOGLEDRIVE_DELETE_FILE", {"fileId": file_id})
            return True
        except Exception as exc:
            log.warning("Could not delete file %s from Google Drive: %s", file_id, exc)
            return False
