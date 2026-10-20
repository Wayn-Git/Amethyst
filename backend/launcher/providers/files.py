from __future__ import annotations

import logging
import os
import shutil
import subprocess
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

IGNORED_DIRS = {
    "node_modules",
    ".git",
    ".venv",
    ".cache",
    "__pycache__",
    "target",
    "build",
    "dist",
    ".gemini",
    ".local",
}

ICON_MAP = {
    ".pdf": "file-text",
    ".doc": "file-text",
    ".docx": "file-text",
    ".txt": "file-text",
    ".md": "file-text",
    ".py": "code",
    ".js": "code",
    ".jsx": "code",
    ".ts": "code",
    ".tsx": "code",
    ".html": "code",
    ".css": "code",
    ".json": "code",
    ".sql": "code",
    ".sh": "terminal",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".svg": "image",
    ".mp4": "film",
    ".mkv": "film",
    ".mp3": "music",
    ".wav": "music",
    ".zip": "archive",
    ".tar": "archive",
    ".gz": "archive",
}


class FileProvider(BaseLauncherProvider):
    id = "files"
    name = "Local Files"
    priority = 60

    def __init__(self, search_roots: list[Path | str] | None = None):
        if search_roots is None:
            home = Path.home()
            candidates = [
                home / "Documents",
                home / "Downloads",
                home / "Desktop",
            ]
            self.search_roots = [p for p in candidates if p.exists() and p.is_dir()]
        else:
            self.search_roots = [Path(p) for p in search_roots if Path(p).exists()]

        self._cached_files: list[Path] = []
        self._last_index_time: float = 0.0
        self._index_ttl: float = 60.0  # 60s cache

    def _refresh_index_if_needed(self) -> None:
        now = time.time()
        if self._cached_files and (now - self._last_index_time < self._index_ttl):
            return

        files: list[Path] = []
        for root in self.search_roots:
            try:
                for dirpath, dirnames, filenames in os.walk(str(root)):
                    # Filter out ignored dirs in-place to avoid descending
                    dirnames[:] = [
                        d for d in dirnames
                        if d not in IGNORED_DIRS and not d.startswith(".")
                    ]
                    # Enforce max depth of 4 from root
                    try:
                        rel = Path(dirpath).relative_to(root)
                        if len(rel.parts) > 3:
                            dirnames.clear()
                            continue
                    except ValueError:
                        pass

                    for fname in filenames:
                        if fname.startswith("."):
                            continue
                        files.append(Path(dirpath) / fname)
                        if len(files) >= 5000:
                            break
                    if len(files) >= 5000:
                        break
            except Exception as e:
                log.debug("Error indexing directory %s: %s", root, e)

        self._cached_files = files
        self._last_index_time = now

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        if not raw:
            return

        is_explicit = False
        term = raw
        if raw.lower().startswith("f ") or raw.lower().startswith("file "):
            is_explicit = True
            term = raw.split(None, 1)[1] if " " in raw else ""

        if not is_explicit and len(term) < 3:
            return

        term_lower = term.lower()
        self._refresh_index_if_needed()

        count = 0
        for fpath in self._cached_files:
            fname = fpath.name
            fname_lower = fname.lower()
            if term_lower not in fname_lower:
                continue

            score = 0.0
            if is_explicit:
                if fname_lower.startswith(term_lower):
                    score = 95.0
                else:
                    score = 85.0
            else:
                if fname_lower.startswith(term_lower):
                    score = 80.0
                else:
                    score = 65.0

            ext = fpath.suffix.lower()
            badge = ext[1:].upper() if ext else "FILE"
            icon = ICON_MAP.get(ext, "file")

            # Try to read small snippet if text
            preview_md = f"### {fname}\n\n- **Path:** `{fpath}`\n"
            try:
                stat = fpath.stat()
                size_kb = stat.st_size / 1024
                preview_md += f"- **Size:** {size_kb:.1f} KB\n"
                if ext in {".txt", ".md", ".json", ".py", ".sh", ".js"} and stat.st_size < 30000:
                    sample = fpath.read_text(encoding="utf-8", errors="replace")[:800]
                    preview_md += f"\n```text\n{sample}\n```"
            except Exception:
                pass

            actions = [
                LauncherAction(
                    id="open",
                    title="Open File",
                    shortcut="↵",
                    is_primary=True,
                    handler_payload={"path": str(fpath)},
                ),
                LauncherAction(
                    id="reveal",
                    title="Show in File Manager",
                    shortcut="Cmd+O",
                    is_primary=False,
                    handler_payload={"path": str(fpath.parent)},
                ),
                LauncherAction(
                    id="copy_path",
                    title="Copy File Path",
                    shortcut="Cmd+C",
                    is_primary=False,
                    handler_payload={"text": str(fpath)},
                ),
            ]

            yield LauncherResult(
                id=f"file:{fpath}",
                provider_id=self.id,
                title=fname,
                subtitle=str(fpath.parent),
                icon=icon,
                badge=badge,
                score=score,
                preview_type="markdown",
                preview_data={"markdown": preview_md},
                actions=actions,
            )

            count += 1
            if count >= 20:
                break

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if action_id == "copy_path":
            text = payload.get("text", "")
            return set_clipboard(text)

        target_path = payload.get("path")
        if not target_path:
            return {"ok": False, "error": "No file path provided"}

        opener = shutil.which("gio") or shutil.which("xdg-open")
        if not opener:
            return {"ok": False, "error": "Neither gio nor xdg-open available to open files"}

        try:
            cmd = [opener, "open", target_path] if "gio" in opener else [opener, target_path]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return {"ok": res.returncode == 0, "path": target_path}
        except Exception as e:
            log.exception(f"Failed to open file {target_path}")
            return {"ok": False, "error": str(e)}
