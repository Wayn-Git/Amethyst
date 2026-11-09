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
from backend.launcher.wox_matcher import flow_file_match, wox_fuzzy_match
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
        self.home = Path.home()
        if search_roots is None:
            candidates = [
                self.home / "Documents",
                self.home / "Downloads",
                self.home / "Desktop",
                self.home / "Projects",
            ]
            self.search_roots = [p for p in candidates if p.exists() and p.is_dir()]
            if not self.search_roots:
                self.search_roots = [self.home]
        else:
            self.search_roots = [Path(p) for p in search_roots if Path(p).exists()]

        self._has_fd = shutil.which("fd") is not None or shutil.which("fdfind") is not None
        self._fd_cmd = shutil.which("fd") or shutil.which("fdfind")

    def _find_recent_files(self, limit: int = 15) -> list[Path]:
        """Collect recent files across primary directories."""
        recent: list[tuple[float, Path]] = []
        for root in self.search_roots:
            try:
                for entry in root.iterdir():
                    if entry.name.startswith(".") or entry.name in IGNORED_DIRS:
                        continue
                    try:
                        st = entry.stat()
                        recent.append((st.st_mtime, entry))
                    except Exception:
                        pass
            except Exception:
                pass
        recent.sort(key=lambda x: x[0], reverse=True)
        return [p for _, p in recent[:limit]]

    def _search_with_fd(self, pattern: str, limit: int = 50) -> list[Path]:
        """Execute ultra-fast global search using fd."""
        if not self._fd_cmd:
            return []
        roots = [str(r) for r in self.search_roots] if self.search_roots else [str(self.home)]
        tokens = pattern.strip().split()
        if len(tokens) > 1:
            import re
            regex_pat = ".*" + ".*".join(re.escape(t) for t in tokens) + ".*"
            cmd = [
                self._fd_cmd,
                "--exclude", ".git",
                "--exclude", "node_modules",
                "--exclude", ".cache",
                "--exclude", "__pycache__",
                "--exclude", ".gemini",
                "--max-results", str(limit),
                "-i",
                regex_pat,
                *roots,
            ]
        else:
            cmd = [
                self._fd_cmd,
                "--exclude", ".git",
                "--exclude", "node_modules",
                "--exclude", ".cache",
                "--exclude", "__pycache__",
                "--exclude", ".gemini",
                "--max-results", str(limit),
                "-i",
                pattern,
                *roots,
            ]
        if pattern.startswith("."):
            cmd.insert(1, "--hidden")
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=1.5)
            paths: list[Path] = []
            for line in res.stdout.strip().splitlines():
                if line.strip():
                    paths.append(Path(line.strip()))
            return paths
        except Exception as e:
            log.debug("fd file search error: %s", e)
            return []

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        is_explicit = False
        term = raw
        if raw.lower().startswith("f ") or raw.lower().startswith("file "):
            is_explicit = True
            term = raw.split(None, 1)[1] if " " in raw else ""

        # Empty query: yield recent files
        if not term:
            recents = self._find_recent_files(15)
            for fpath in recents:
                res = self._build_file_result(fpath, score=50.0)
                if res:
                    yield res
            return

        # Flow Launcher Explorer: Direct path navigation (~/, /, ./)
        if term.startswith("~/") or term.startswith("/") or term.startswith("./"):
            expanded_str = os.path.expanduser(term)
            p = Path(expanded_str)
            target_dir = None
            filter_stem = ""
            if p.is_dir():
                target_dir = p
            elif p.parent.is_dir():
                target_dir = p.parent
                filter_stem = p.name.lower()

            if target_dir and target_dir.exists():
                count = 0
                try:
                    for child in sorted(target_dir.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
                        if child.name.startswith(".") and not term.startswith("."):
                            continue
                        if filter_stem and filter_stem not in child.name.lower():
                            continue
                        res = self._build_file_result(child, score=98.0 - count)
                        if res:
                            yield res
                            count += 1
                            if count >= 30:
                                break
                    return
                except Exception as e:
                    log.debug("Directory navigation error: %s", e)

        term_lower = term.lower()
        candidates: list[Path] = []

        if self._has_fd:
            candidates = self._search_with_fd(term, limit=50)
        else:
            # Fallback walk
            for root in self.search_roots:
                for dirpath, dirnames, filenames in os.walk(str(root)):
                    dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".")]
                    for fname in filenames:
                        if term_lower in fname.lower():
                            candidates.append(Path(dirpath) / fname)
                            if len(candidates) >= 30:
                                break
                    if len(candidates) >= 30:
                        break

        scored: list[tuple[Path, float]] = []
        for fpath in candidates:
            match = flow_file_match(fpath.name, str(fpath.parent), term)
            if match.is_match:
                scored.append((fpath, match.score))
            elif term_lower in str(fpath).lower():
                scored.append((fpath, 35.0))

        scored.sort(key=lambda x: x[1], reverse=True)

        for fpath, score in scored[:30]:
            final_score = score + 30.0 if is_explicit else score
            res = self._build_file_result(fpath, final_score)
            if res:
                yield res

    def _build_file_result(self, fpath: Path, score: float) -> LauncherResult | None:
        try:
            fname = fpath.name
            if fname.startswith("."):
                return None
            is_dir = fpath.is_dir()
            ext = "" if is_dir else fpath.suffix.lower()
            badge = "FOLDER" if is_dir else (ext[1:].upper() if ext else "FILE")
            icon = "folder" if is_dir else ICON_MAP.get(ext, "file")

            size_str = ""
            mod_str = ""
            snippet = ""
            try:
                st = fpath.stat()
                mod_time = time.strftime("%b %d, %Y", time.localtime(st.st_mtime))
                mod_str = f"Modified {mod_time}"
                if not is_dir:
                    if st.st_size >= 1024 * 1024:
                        size_str = f"{st.st_size / (1024 * 1024):.1f} MB"
                    else:
                        size_str = f"{max(1, int(st.st_size / 1024))} KB"
                    if ext in {".txt", ".md", ".json", ".py", ".sh", ".js", ".jsx", ".ts", ".tsx", ".css", ".html"} and st.st_size < 40000:
                        snippet = fpath.read_text(encoding="utf-8", errors="replace")[:1200]
            except Exception:
                pass

            preview_md = f"### {fname}\n\n- **Path:** `{fpath}`\n"
            if size_str:
                preview_md += f"- **Size:** {size_str}\n"
            if mod_str:
                preview_md += f"- **Date:** {mod_str}\n"
            if snippet:
                preview_md += f"\n```text\n{snippet[:800]}\n```"

            actions = [
                LauncherAction(
                    id="open",
                    title="Open File" if not is_dir else "Open Folder",
                    shortcut="↵",
                    is_primary=True,
                    handler_payload={"path": str(fpath)},
                ),
                LauncherAction(
                    id="reveal",
                    title="Show in File Manager",
                    shortcut="Cmd+O",
                    is_primary=False,
                    handler_payload={"path": str(fpath.parent if not is_dir else fpath)},
                ),
                LauncherAction(
                    id="copy_path",
                    title="Copy Path",
                    shortcut="Cmd+C",
                    is_primary=False,
                    handler_payload={"text": str(fpath)},
                ),
            ]

            return LauncherResult(
                id=f"file:{fpath}",
                provider_id=self.id,
                title=fname,
                subtitle=str(fpath.parent).replace(str(self.home), "~"),
                icon=icon,
                badge=badge,
                score=score,
                preview_type="markdown",
                preview_data={
                    "name": fname,
                    "path": str(fpath),
                    "parent": str(fpath.parent).replace(str(self.home), "~"),
                    "size_str": size_str,
                    "mod_str": mod_str,
                    "is_dir": is_dir,
                    "snippet": snippet,
                    "markdown": preview_md,
                },
                actions=actions,
            )
        except Exception:
            return None

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
