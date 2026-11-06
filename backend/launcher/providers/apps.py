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
from backend.launcher.wox_matcher import wox_fuzzy_match

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
        q = query.strip()
        if not q:
            # Yield top installed apps
            for app in self._apps_cache[:20]:
                yield self._to_result(app, score=50.0)
            return

        scored: list[tuple[DesktopAppEntry, float]] = []
        for app in self._apps_cache:
            score = self._score_app(app, q)
            if score > 0:
                scored.append((app, score))

        # Sort descending by Wox match score
        scored.sort(key=lambda x: x[1], reverse=True)
        for app, score in scored:
            yield self._to_result(app, score)

    def _score_app(self, app: DesktopAppEntry, q: str) -> float:
        # 1. Match app title with Wox fuzzy matcher
        title_res = wox_fuzzy_match(app.name, q)
        best_score = title_res.score if title_res.is_match else 0.0

        # 2. Match generic name (e.g. "Web Browser", "Text Editor")
        if app.generic_name:
            gen_res = wox_fuzzy_match(app.generic_name, q)
            if gen_res.is_match and gen_res.score * 0.85 > best_score:
                best_score = gen_res.score * 0.85

        # 3. Match keywords (e.g. "internet", "coding")
        for kw in app.keywords:
            kw_res = wox_fuzzy_match(kw, q)
            if kw_res.is_match and kw_res.score * 0.75 > best_score:
                best_score = kw_res.score * 0.75

        # 4. Executable base name (e.g. "code", "google-chrome")
        exec_name = Path(app.clean_exec.split()[0]).name if app.clean_exec else ""
        if exec_name:
            exec_res = wox_fuzzy_match(exec_name, q)
            if exec_res.is_match and exec_res.score * 0.9 > best_score:
                best_score = exec_res.score * 0.9

        # 5. Comment / description
        if app.comment and best_score < 40.0:
            com_res = wox_fuzzy_match(app.comment, q)
            if com_res.is_match and com_res.score * 0.5 > best_score:
                best_score = com_res.score * 0.5

        return best_score

    def _to_result(self, app: DesktopAppEntry, score: float) -> LauncherResult:
        subtitle = app.generic_name or app.comment or app.clean_exec
        icon_url = f"/api/launcher/icon?name={app.icon}" if app.icon and app.icon != "app" else None
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
                "icon_url": icon_url,
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
