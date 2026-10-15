from __future__ import annotations

import logging
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
        q = query.strip().lower()
        if not q:
            # Show navigation commands first when query is empty
            for cmd in self._commands[:6]:
                yield self._to_result(cmd, score=40.0)
            return

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
        raise ValueError(f"Unknown command action {action_id}")
