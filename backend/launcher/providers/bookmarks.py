"""Browser bookmarks search provider for Amethyst Damon launcher."""

from __future__ import annotations

import json
import logging
import os
import sys
import webbrowser
from pathlib import Path
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)
from backend.remote.clipboard import set_clipboard

log = logging.getLogger(__name__)


def get_chrome_bookmarks_paths() -> list[Path]:
    """Locate Chrome/Chromium/Brave/Edge bookmarks JSON files across platforms."""
    paths: list[Path] = []
    plat = sys.platform
    home = Path.home()

    if plat == "darwin":
        bases = [
            home / "Library/Application Support/Google/Chrome",
            home / "Library/Application Support/BraveSoftware/Brave-Browser",
            home / "Library/Application Support/Microsoft Edge",
            home / "Library/Application Support/Chromium",
            home / "Library/Application Support/Arc/User Data",
        ]
    elif plat == "win32":
        app_data = Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local"))
        bases = [
            app_data / "Google/Chrome/User Data",
            app_data / "BraveSoftware/Brave-Browser/User Data",
            app_data / "Microsoft/Edge/User Data",
            app_data / "Chromium/User Data",
        ]
    else:  # Linux / BSD
        config = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
        bases = [
            config / "google-chrome",
            config / "chromium",
            config / "BraveSoftware/Brave-Browser",
            config / "microsoft-edge",
        ]

    for base in bases:
        if not base.is_dir():
            continue
        # Profile folders: Default, Profile 1, Profile 2, etc.
        for profile in [base / "Default"] + list(base.glob("Profile *")):
            bm_file = profile / "Bookmarks"
            if bm_file.is_file():
                paths.append(bm_file)
    return paths


def parse_chromium_bookmarks(file_path: Path) -> list[dict[str, str]]:
    """Parse bookmarks from Chromium's Bookmarks JSON file."""
    results: list[dict[str, str]] = []
    try:
        data = json.loads(file_path.read_text(encoding="utf-8", errors="replace"))
        roots = data.get("roots", {})

        def extract_nodes(node: dict[str, Any]):
            if not isinstance(node, dict):
                return
            ntype = node.get("type")
            if ntype == "url":
                title = node.get("name", "").strip()
                url = node.get("url", "").strip()
                if title and url and not url.startswith("javascript:"):
                    results.append({"title": title, "url": url, "source": file_path.parent.parent.name})
            elif ntype == "folder":
                for child in node.get("children", []):
                    extract_nodes(child)

        for root_key in ("bookmark_bar", "other", "synced"):
            if root_key in roots:
                extract_nodes(roots[root_key])
    except Exception as e:
        log.debug("Could not read chromium bookmarks from %s: %s", file_path, e)
    return results


class BookmarkProvider(BaseLauncherProvider):
    id = "bookmarks"
    name = "Browser Bookmarks"
    priority = 70

    def __init__(self) -> None:
        self._cached_bookmarks: list[dict[str, str]] = []
        self._last_loaded: float = 0.0

    def _refresh_cache_if_needed(self) -> list[dict[str, str]]:
        import time

        now = time.time()
        # Cache for 60 seconds
        if self._cached_bookmarks and (now - self._last_loaded < 60.0):
            return self._cached_bookmarks

        marks: list[dict[str, str]] = []

        # 1. Chromium based browsers
        for p in get_chrome_bookmarks_paths():
            marks.extend(parse_chromium_bookmarks(p))

        # 2. Firefox bookmarks
        try:
            from backend.browser.places import bookmarks as ff_bookmarks, find_profile
            prof = find_profile()
            if prof:
                for b in ff_bookmarks(prof):
                    if b.title and b.url:
                        marks.append({"title": b.title, "url": b.url, "source": "Firefox"})
        except Exception:
            pass

        # Deduplicate by URL
        seen_urls = set()
        deduped = []
        for m in marks:
            u = m["url"].lower()
            if u not in seen_urls:
                seen_urls.add(u)
                deduped.append(m)

        self._cached_bookmarks = deduped
        self._last_loaded = now
        return self._cached_bookmarks

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        if not raw:
            return

        is_explicit = False
        term = raw.lower()
        if term.startswith("bm "):
            is_explicit = True
            term = term[3:].strip()
        elif term.startswith("bookmark "):
            is_explicit = True
            term = term[9:].strip()

        if not term and not is_explicit:
            return

        all_marks = self._refresh_cache_if_needed()
        if not all_marks:
            return

        if not term and is_explicit:
            # Show top 10 recent/default bookmarks
            for idx, bm in enumerate(all_marks[:10]):
                yield self._to_result(bm, score=90.0 - idx)
            return

        matches: list[tuple[float, dict[str, str]]] = []
        for bm in all_marks:
            title_lower = bm["title"].lower()
            url_lower = bm["url"].lower()

            score = 0.0
            if term == title_lower:
                score = 100.0
            elif title_lower.startswith(term):
                score = 92.0
            elif term in title_lower:
                score = 80.0
            elif term in url_lower:
                score = 65.0
            elif any(w.startswith(term) for w in title_lower.split()):
                score = 75.0

            if score > 0:
                if is_explicit:
                    score += 15.0
                matches.append((score, bm))

        matches.sort(key=lambda x: x[0], reverse=True)
        for score, bm in matches[:12]:
            yield self._to_result(bm, score)

    def _to_result(self, bm: dict[str, str], score: float) -> LauncherResult:
        title = bm["title"]
        url = bm["url"]
        source = bm.get("source", "Browser")

        # Domain snippet for display
        domain = url.split("://")[-1].split("/")[0]

        return LauncherResult(
            id=f"bookmark:{url}",
            provider_id=self.id,
            title=title,
            subtitle=f"{domain} • {source}",
            icon="bookmark",
            badge="BOOKMARK",
            score=score,
            preview_type="markdown",
            preview_data={
                "markdown": f"### {title}\n\n- **URL:** [{url}]({url})\n- **Browser:** {source}\n\nPress **Enter** to open in default browser."
            },
            actions=[
                LauncherAction(
                    id="open_bookmark",
                    title="Open in Browser",
                    shortcut="↵",
                    is_primary=True,
                    handler_payload={"url": url},
                ),
                LauncherAction(
                    id="copy_url",
                    title="Copy URL",
                    shortcut="⌘C",
                    handler_payload={"url": url},
                ),
            ],
        )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        url = payload.get("url")
        if not url:
            return {"ok": False, "error": "Missing URL"}

        if action_id == "copy_url":
            set_clipboard(url)
            return {"ok": True, "copied": url}

        try:
            webbrowser.open(url)
            return {"ok": True, "opened": url}
        except Exception as e:
            log.exception(f"Failed to open bookmark {url}")
            return {"ok": False, "error": str(e)}
