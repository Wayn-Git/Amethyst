from __future__ import annotations

import configparser
import logging
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)

log = logging.getLogger(__name__)

# Standard field codes to remove from Exec keys: %f, %F, %u, %U, %d, %D, %n, %N, %i, %c, %k, %v, %m
FIELD_CODE_PATTERN = re.compile(r"%[fFuUdDnNickvm]")


@dataclass
class DesktopAppEntry:
    path: Path
    name: str
    generic_name: str | None = None
    comment: str | None = None
    exec_cmd: str = ""
    clean_exec: str = ""
    icon: str = "app"
    terminal: bool = False
    no_display: bool = False
    categories: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)


def parse_desktop_file(file_path: Path) -> DesktopAppEntry | None:
    """Parse a Linux .desktop INI file safely."""
    if not file_path.exists() or not file_path.name.endswith(".desktop"):
        return None

    config = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        config.read(str(file_path), encoding="utf-8")
    except Exception:
        try:
            config.read(str(file_path), encoding="latin-1")
        except Exception:
            return None

    section = "Desktop Entry"
    if not config.has_section(section):
        return None

    entry_type = config.get(section, "Type", fallback="Application").strip()
    if entry_type.lower() != "application":
        return None

    name = config.get(section, "Name", fallback="").strip()
    if not name:
        return None

    exec_raw = config.get(section, "Exec", fallback="").strip()
    if not exec_raw:
        return None

    clean_exec = FIELD_CODE_PATTERN.sub("", exec_raw).strip()
    # Normalize multiple whitespace
    clean_exec = re.sub(r"\s+", " ", clean_exec)

    no_display_val = config.get(section, "NoDisplay", fallback="false").lower()
    no_display = no_display_val in ("true", "1", "yes")

    terminal_val = config.get(section, "Terminal", fallback="false").lower()
    terminal = terminal_val in ("true", "1", "yes")

    generic_name = config.get(section, "GenericName", fallback=None)
    comment = config.get(section, "Comment", fallback=None)
    icon = config.get(section, "Icon", fallback="app").strip()

    raw_categories = config.get(section, "Categories", fallback="")
    categories = [c.strip() for c in raw_categories.split(";") if c.strip()]

    raw_keywords = config.get(section, "Keywords", fallback="")
    keywords = [k.strip().lower() for k in raw_keywords.split(";") if k.strip()]

    return DesktopAppEntry(
        path=file_path,
        name=name,
        generic_name=generic_name.strip() if generic_name else None,
        comment=comment.strip() if comment else None,
        exec_cmd=exec_raw,
        clean_exec=clean_exec,
        icon=icon if icon else "app",
        terminal=terminal,
        no_display=no_display,
        categories=categories,
        keywords=keywords,
    )


def default_desktop_directories() -> list[Path]:
    dirs = [
        Path("/usr/share/applications"),
        Path("/usr/local/share/applications"),
        Path.home() / ".local/share/applications",
        Path("/var/lib/flatpak/exports/share/applications"),
        Path.home() / ".local/share/flatpak/exports/share/applications",
        Path("/var/lib/snapd/desktop/applications"),
    ]
    return [d for d in dirs if d.exists()]


class AppProvider(BaseLauncherProvider):
    id = "apps"
    name = "Applications"
    priority = 90

    def __init__(self, search_dirs: list[Path] | None = None) -> None:
        self.search_dirs = (
            search_dirs
            if search_dirs is not None
            else default_desktop_directories()
        )
        self._apps_cache: list[DesktopAppEntry] = []
        self.reload_index()

    def reload_index(self) -> None:
        """Scan directories and build memory cache."""
        seen_ids: set[str] = set()
        apps: list[DesktopAppEntry] = []

        for d in self.search_dirs:
            if not d.exists():
                continue
            for f in d.glob("*.desktop"):
                app = parse_desktop_file(f)
                if app and not app.no_display:
                    # Deduplicate by app name or desktop file base
                    app_id = f.name
                    if app_id not in seen_ids:
                        seen_ids.add(app_id)
                        apps.append(app)

        self._apps_cache = apps

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        q = query.strip().lower()
        if not q:
            # Yield top 8 recently used or standard apps
            for app in self._apps_cache[:8]:
                yield self._to_result(app, score=50.0)
            return

        for app in self._apps_cache:
            score = self._score_app(app, q)
            if score > 0:
                yield self._to_result(app, score)

    def _score_app(self, app: DesktopAppEntry, q: str) -> float:
        name_lower = app.name.lower()
        if name_lower == q:
            return 120.0
        if name_lower.startswith(q):
            return 100.0
        if q in name_lower:
            return 80.0

        if app.generic_name and q in app.generic_name.lower():
            return 70.0

        for kw in app.keywords:
            if kw.startswith(q):
                return 65.0
            if q in kw:
                return 55.0

        if app.comment and q in app.comment.lower():
            return 40.0

        return 0.0

    def _to_result(self, app: DesktopAppEntry, score: float) -> LauncherResult:
        subtitle = app.generic_name or app.comment or app.clean_exec
        return LauncherResult(
            id=f"app:{app.path}",
            provider_id=self.id,
            title=app.name,
            subtitle=subtitle,
            icon=app.icon,
            badge="App",
            score=score,
            preview_type="app_info",
            preview_data={
                "name": app.name,
                "generic_name": app.generic_name,
                "comment": app.comment,
                "exec": app.clean_exec,
                "categories": app.categories,
                "path": str(app.path),
                "terminal": app.terminal,
            },
            actions=[
                LauncherAction(
                    id="launch",
                    title="Open Application",
                    is_primary=True,
                    handler_payload={
                        "clean_exec": app.clean_exec,
                        "desktop_path": str(app.path),
                        "terminal": app.terminal,
                    },
                ),
                LauncherAction(
                    id="copy_path",
                    title="Copy Desktop File Path",
                    shortcut="Cmd+C",
                    handler_payload={"text": str(app.path)},
                ),
            ],
        )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if action_id == "launch":
            desktop_path = payload.get("desktop_path")
            clean_exec = payload.get("clean_exec", "")

            # If gio launch exists, prefer it for XDG desktop compliance
            if desktop_path and shutil.which("gio"):
                try:
                    subprocess.Popen(
                        ["gio", "launch", desktop_path],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        start_new_session=True,
                    )
                    return {"status": "ok", "method": "gio"}
                except Exception as e:
                    log.warning("gio launch failed: %s; falling back to Exec", e)

            if clean_exec:
                args = shlex.split(clean_exec)
                subprocess.Popen(
                    args,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                return {"status": "ok", "method": "exec"}

            return {"status": "error", "message": "No executable specified"}

        if action_id == "copy_path":
            return {"status": "ok", "copied": payload.get("text", "")}

        raise ValueError(f"Unknown action {action_id}")
