from __future__ import annotations

import logging
import math
import os
import subprocess
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)

log = logging.getLogger(__name__)

BUILTIN_COMMANDS = [
    # Navigation
    {
        "id": "nav:chat",
        "title": "Open Chat",
        "subtitle": "Interactive AI assistant with tool execution",
        "icon": "chat",
        "action_type": "navigate",
        "target": "chat",
        "keywords": ["chat", "agent", "conversation", "ai"],
    },
    {
        "id": "nav:library",
        "title": "Open Library",
        "subtitle": "Articles, videos, documents, and bookmarks",
        "icon": "library",
        "action_type": "navigate",
        "target": "library",
        "keywords": ["library", "saved", "bookmarks", "reading"],
    },
    {
        "id": "nav:tasks",
        "title": "Open Tasks",
        "subtitle": "Actionable task bucket and scheduled items",
        "icon": "task",
        "action_type": "navigate",
        "target": "tasks",
        "keywords": ["tasks", "todo", "agenda", "reminders"],
    },
    {
        "id": "nav:notes",
        "title": "Open Notes & Memory",
        "subtitle": "Recalled facts and personal notes vault",
        "icon": "note",
        "action_type": "navigate",
        "target": "memory",
        "keywords": ["notes", "memory", "facts", "vault"],
    },
    {
        "id": "nav:today",
        "title": "Open Today Dashboard",
        "subtitle": "Overview bento grid and personal widgets",
        "icon": "dashboard",
        "action_type": "navigate",
        "target": "today",
        "keywords": ["today", "dashboard", "bento", "home"],
    },
    # Themes
    {
        "id": "theme:graphite",
        "title": "Switch to Graphite Theme",
        "subtitle": "Neutral obsidian slate (dark)",
        "icon": "sun",
        "action_type": "theme",
        "target": "graphite",
        "keywords": ["theme", "dark", "graphite", "color"],
    },
    {
        "id": "theme:ink",
        "title": "Switch to Ink Theme",
        "subtitle": "Deep blue-black indigo (dark)",
        "icon": "sun",
        "action_type": "theme",
        "target": "ink",
        "keywords": ["theme", "dark", "ink", "blue"],
    },
    {
        "id": "theme:nocturne",
        "title": "Switch to Nocturne Theme",
        "subtitle": "Pitch black cobalt cyan (dark)",
        "icon": "sun",
        "action_type": "theme",
        "target": "nocturne",
        "keywords": ["theme", "dark", "nocturne", "cyan"],
    },
    {
        "id": "theme:paper",
        "title": "Switch to Paper Theme",
        "subtitle": "Pristine gallery white (light)",
        "icon": "sun",
        "action_type": "theme",
        "target": "paper",
        "keywords": ["theme", "light", "paper", "white"],
    },
    {
        "id": "theme:sand",
        "title": "Switch to Sand Theme",
        "subtitle": "Warm parchment linen (light)",
        "icon": "sun",
        "action_type": "theme",
        "target": "sand",
        "keywords": ["theme", "light", "sand", "warm"],
    },
    # Media Forwarding & Playback Controls
    {
        "id": "media:play_pause",
        "title": "Play / Pause Media",
        "subtitle": "Toggle playback on Spotify or active media player",
        "icon": "play",
        "action_type": "media",
        "target": "play-pause",
        "keywords": ["media", "music", "spotify", "play", "pause", "track", "song"],
    },
    {
        "id": "media:next",
        "title": "Next Track",
        "subtitle": "Skip to the next song",
        "icon": "play",
        "action_type": "media",
        "target": "next",
        "keywords": ["media", "next", "skip", "track", "music", "spotify"],
    },
    {
        "id": "media:prev",
        "title": "Previous Track",
        "subtitle": "Return to the previous song",
        "icon": "play",
        "action_type": "media",
        "target": "previous",
        "keywords": ["media", "previous", "prev", "track", "music", "spotify"],
    },
    {
        "id": "media:mute",
        "title": "Mute / Unmute Volume",
        "subtitle": "Toggle master audio mute",
        "icon": "bell",
        "action_type": "media",
        "target": "mute",
        "keywords": ["volume", "mute", "sound", "audio", "quiet", "silence"],
    },
    {
        "id": "media:vol_up",
        "title": "Increase Volume (+5%)",
        "subtitle": "Raise system output volume",
        "icon": "bell",
        "action_type": "media",
        "target": "vol_up",
        "keywords": ["volume", "louder", "up", "sound", "audio"],
    },
    {
        "id": "media:vol_down",
        "title": "Decrease Volume (-5%)",
        "subtitle": "Lower system output volume",
        "icon": "bell",
        "action_type": "media",
        "target": "vol_down",
        "keywords": ["volume", "quieter", "down", "sound", "audio"],
    },
    # Developer Commands
    {
        "id": "dev:clean_cache",
        "title": "Clean Caches & Temporary Data",
        "subtitle": "Purge local caches, temporary build artifacts, and logs",
        "icon": "terminal",
        "action_type": "dev",
        "target": "clean_cache",
        "keywords": ["dev", "clean", "cache", "purge", "derived", "temp"],
    },
    {
        "id": "dev:diagnostics",
        "title": "System Diagnostics & Performance",
        "subtitle": "Inspect system load, uptime, and Amethyst status",
        "icon": "terminal",
        "action_type": "navigate",
        "target": "dash",
        "keywords": ["dev", "diagnostics", "stats", "status", "system", "performance"],
    },
]


class CommandProvider(BaseLauncherProvider):
    id = "commands"
    name = "Commands"
    priority = 80

    def __init__(self, commands: list[dict[str, Any]] | None = None) -> None:
        self._commands = commands if commands is not None else BUILTIN_COMMANDS

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        q = raw.lower()
        if not q:
            # Show navigation commands first when query is empty
            for cmd in self._commands[:6]:
                yield self._to_result(cmd, score=40.0)
            return

        # 1. Flow Launcher Shell Command Plugin ("> <command>")
        if raw.startswith(">"):
            cmd_text = raw[1:].strip()
            if cmd_text:
                yield LauncherResult(
                    id=f"shell:{cmd_text}",
                    provider_id=self.id,
                    title=f"Run “{cmd_text}” in Terminal",
                    subtitle="Flow Launcher Shell Execution",
                    icon="terminal",
                    badge="SHELL",
                    score=115.0,
                    preview_type="none",
                    actions=[
                        LauncherAction(
                            id="shell_run",
                            title="Execute Shell Command",
                            is_primary=True,
                            handler_payload={"command": cmd_text},
                        )
                    ],
                )

        # 2. Flow Launcher Process Killer Plugin ("kill <process>")
        if q.startswith("kill "):
            proc_target = q[5:].strip()
            if proc_target:
                import asyncio
                import time

                now = time.time()
                # Cache process snapshot for 2 seconds to avoid running ps on every keystroke
                if not hasattr(self, "_proc_cache") or (now - getattr(self, "_proc_cache_time", 0) > 2.0):
                    def _fetch_processes():
                        try:
                            return subprocess.run(
                                ["ps", "-eo", "pid,comm,%mem,%cpu", "--sort=-%cpu"],
                                capture_output=True,
                                text=True,
                                timeout=0.6,
                            ).stdout.strip().splitlines()[1:]
                        except Exception:
                            return []

                    self._proc_cache = await asyncio.to_thread(_fetch_processes)
                    self._proc_cache_time = now

                count = 0
                for line in self._proc_cache:
                    parts = line.strip().split(None, 3)
                    if len(parts) >= 4:
                        pid_str, comm, mem, cpu = parts[0], parts[1], parts[2], parts[3]
                        if proc_target in comm.lower() or proc_target in pid_str:
                            yield LauncherResult(
                                id=f"kill:{pid_str}",
                                provider_id=self.id,
                                title=f"Kill {comm} (PID {pid_str})",
                                subtitle=f"Memory: {mem}% · CPU: {cpu}%",
                                icon="x-circle",
                                badge="PROCESS",
                                score=110.0 - count,
                                preview_type="none",
                                actions=[
                                    LauncherAction(
                                        id="kill_process",
                                        title="Terminate Process",
                                        is_primary=True,
                                        handler_payload={"pid": int(pid_str), "name": comm},
                                    )
                                ],
                            )
                            count += 1
                            if count >= 8:
                                break

        # 3. Flow Launcher Web Search Prefix Plugins (g, ddg, gh, yt, wiki)
        web_engines = {
            "g ": ("Google", "https://www.google.com/search?q=", "google"),
            "ddg ": ("DuckDuckGo", "https://duckduckgo.com/?q=", "search"),
            "gh ": ("GitHub", "https://github.com/search?q=", "github"),
            "yt ": ("YouTube", "https://www.youtube.com/results?search_query=", "youtube"),
            "w ": ("Wikipedia", "https://en.wikipedia.org/wiki/Special:Search?search=", "book"),
            "wiki ": ("Wikipedia", "https://en.wikipedia.org/wiki/Special:Search?search=", "book"),
        }
        for prefix, (engine_name, search_url, icon_name) in web_engines.items():
            if q.startswith(prefix):
                term = raw[len(prefix):].strip()
                if term:
                    yield LauncherResult(
                        id=f"web_search:{engine_name}:{term}",
                        provider_id=self.id,
                        title=f"Search {engine_name} for “{term}”",
                        subtitle=f"Direct Flow Launcher Web Search via {engine_name}",
                        icon=icon_name,
                        badge="WEB",
                        score=110.0,
                        preview_type="none",
                        actions=[
                            LauncherAction(
                                id="open_url",
                                title=f"Open in {engine_name}",
                                is_primary=True,
                                handler_payload={"url": f"{search_url}{term}"},
                            )
                        ],
                    )

        # 4. Flow Launcher Calculator Plugin (math evaluation)
        if any(op in q for op in ("+", "-", "*", "/", "%", "^", "sqrt", "sin", "cos")):
            try:
                allowed = {
                    "__builtins__": None,
                    "math": math,
                    "sqrt": math.sqrt,
                    "abs": abs,
                    "round": round,
                    "sin": math.sin,
                    "cos": math.cos,
                    "pi": math.pi,
                }
                cleaned_expr = raw.replace("^", "**").replace("×", "*").replace("÷", "/")
                # Ensure no forbidden identifiers
                if not any(token in cleaned_expr for token in ("import", "exec", "eval", "__")):
                    val = eval(cleaned_expr, allowed, {})
                    if val is not None and isinstance(val, (int, float)):
                        formatted_val = f"{val:g}" if isinstance(val, float) else str(val)
                        yield LauncherResult(
                            id=f"calc:{raw}",
                            provider_id=self.id,
                            title=formatted_val,
                            subtitle=f"= {raw} (Flow Launcher Calculator — press ↵ to copy)",
                            icon="calculator",
                            badge="MATH",
                            score=120.0,
                            preview_type="none",
                            actions=[
                                LauncherAction(
                                    id="copy_result",
                                    title="Copy Result to Clipboard",
                                    is_primary=True,
                                    handler_payload={"text": formatted_val},
                                )
                            ],
                        )
            except Exception:
                pass

        # 5. Calendar Events query ("cal", "calendar", "meeting", "events", "agenda")
        if any(term == q or q.startswith(term + " ") for term in ("cal", "calendar", "meeting", "events", "agenda", "schedule")):
            try:
                import asyncio
                from datetime import datetime, timedelta
                from backend.db.repositories import CalendarRepository

                now = datetime.now()
                start_iso = now.isoformat(timespec="seconds")
                end_iso = (now + timedelta(days=7)).isoformat(timespec="seconds")

                def _fetch_calendar():
                    return CalendarRepository().in_window(start_iso, end_iso)

                events = await asyncio.to_thread(_fetch_calendar)
                for ev in events[:6]:
                    ev_dict = dict(ev)
                    ev_title = ev_dict.get("title", "Event")
                    ev_start = ev_dict.get("start_at", "")
                    ev_loc = ev_dict.get("location") or ""
                    time_display = ev_start.replace("T", " ")[:16] if ev_start else "Upcoming"

                    yield LauncherResult(
                        id=f"cal:{ev_dict.get('id', ev_title)}",
                        provider_id=self.id,
                        title=ev_title,
                        subtitle=f"{time_display}{' · ' + ev_loc if ev_loc else ''}",
                        icon="calendar",
                        badge="CALENDAR",
                        score=95.0,
                        preview_type="markdown",
                        preview_data={
                            "markdown": f"### {ev_title}\n\n- **Time:** {time_display}\n- **Location:** {ev_loc or 'None'}\n\nPress **Enter** to open in Calendar."
                        },
                        actions=[
                            LauncherAction(
                                id="run",
                                title="Open in Calendar",
                                is_primary=True,
                                handler_payload={"command_id": "nav:today", "action_type": "navigate", "target": "today"},
                            )
                        ],
                    )
            except Exception as e:
                log.debug("Calendar query error: %s", e)

        # 6. Built-in Commands matching
        for cmd in self._commands:
            score = self._score_cmd(cmd, q)
            if score > 0:
                yield self._to_result(cmd, score)

    def _score_cmd(self, cmd: dict[str, Any], q: str) -> float:
        title = cmd["title"].lower()
        subtitle = cmd.get("subtitle", "").lower()
        keywords = cmd.get("keywords", [])

        if title == q:
            return 110.0
        if title.startswith(q):
            return 95.0
        if q in title:
            return 80.0

        for kw in keywords:
            if kw.startswith(q):
                return 75.0
            if q in kw:
                return 60.0

        if q in subtitle:
            return 45.0

        # Multi-word query matching (e.g. "volume up")
        q_words = [w for w in q.split() if w]
        if len(q_words) > 1:
            haystack = f"{title} {subtitle} {' '.join(keywords)}"
            if all(w in haystack for w in q_words):
                return 70.0

        return 0.0

    def _to_result(self, cmd: dict[str, Any], score: float) -> LauncherResult:
        return LauncherResult(
            id=f"cmd:{cmd['id']}",
            provider_id=self.id,
            title=cmd["title"],
            subtitle=cmd.get("subtitle"),
            icon=cmd.get("icon", "sliders"),
            badge="Command",
            score=score,
            preview_type="none",
            actions=[
                LauncherAction(
                    id="run",
                    title="Run Command",
                    is_primary=True,
                    handler_payload={
                        "command_id": cmd["id"],
                        "action_type": cmd.get("action_type"),
                        "target": cmd.get("target"),
                    },
                )
            ],
        )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if action_id == "run":
            cmd_id = payload.get("command_id")
            cmd = next((c for c in self._commands if c["id"] == cmd_id), None)
            action_type = payload.get("action_type") or (cmd.get("action_type") if cmd else None)
            target = payload.get("target") or (cmd.get("target") if cmd else None)

            # Handle media controls
            if action_type == "media":
                import shutil
                if shutil.which("playerctl"):
                    try:
                        if target in ("play-pause", "next", "previous"):
                            subprocess.run(["playerctl", target], timeout=2)
                        elif target == "mute":
                            subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"], timeout=2)
                        elif target == "vol_up":
                            subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+5%"], timeout=2)
                        elif target == "vol_down":
                            subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-5%"], timeout=2)
                        return {"status": "ok", "action": "media", "target": target}
                    except Exception as e:
                        return {"status": "error", "message": str(e)}

            # Handle dev clean cache
            if action_type == "dev" and target == "clean_cache":
                try:
                    import tempfile
                    from pathlib import Path
                    cleaned_count = 0
                    for d in [Path.home() / ".amethyst/cache", Path(tempfile.gettempdir()) / "amethyst"]:
                        if d.exists() and d.is_dir():
                            for f in d.iterdir():
                                if f.is_file():
                                    f.unlink(missing_ok=True)
                                    cleaned_count += 1
                    return {"status": "ok", "message": f"Cleaned {cleaned_count} temporary cache files"}
                except Exception as e:
                    return {"status": "error", "message": str(e)}

            return {
                "status": "ok",
                "action": action_type,
                "target": target,
                "command_id": cmd_id,
            }

        if action_id == "shell_run":
            cmd_str = payload.get("command", "")
            if cmd_str:
                try:
                    subprocess.Popen(cmd_str, shell=True)
                    return {"status": "ok", "message": f"Command executed: {cmd_str}"}
                except Exception as e:
                    return {"status": "error", "message": str(e)}

        if action_id == "kill_process":
            pid = payload.get("pid")
            name = payload.get("name", "process")
            if pid:
                try:
                    import signal
                    os.kill(int(pid), signal.SIGKILL)
                    return {"status": "ok", "message": f"Terminated {name} (PID {pid})"}
                except Exception as e:
                    return {"status": "error", "message": str(e)}

        if action_id == "copy_result":
            from backend.remote.clipboard import set_clipboard
            text = payload.get("text", "")
            if text:
                set_clipboard(text)
                return {"status": "ok", "action": "clipboard", "text": text}

        if action_id == "open_url":
            url = payload.get("url", "")
            return {"status": "ok", "action": "open_url", "url": url}

        raise ValueError(f"Unknown command action {action_id}")
