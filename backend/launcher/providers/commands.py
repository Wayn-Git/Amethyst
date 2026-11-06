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
                try:
                    res = subprocess.run(
                        ["ps", "-eo", "pid,comm,%mem,%cpu", "--sort=-%cpu"],
                        capture_output=True,
                        text=True,
                        timeout=0.6,
                    )
                    count = 0
                    for line in res.stdout.strip().splitlines()[1:]:
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
                except Exception as e:
                    log.debug("Process listing error: %s", e)

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

        # 5. Built-in Commands matching
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
