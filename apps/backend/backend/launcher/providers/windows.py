from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)

log = logging.getLogger(__name__)


@dataclass
class WindowEntry:
    win_id: str
    workspace: int
    class_name: str
    client_machine: str
    title: str


def parse_wmctrl_output(output: str) -> list[WindowEntry]:
    """Parse output of `wmctrl -l -x` into WindowEntry items."""
    windows: list[WindowEntry] = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        win_id, ws_str, class_name, machine, title = parts
        try:
            workspace = int(ws_str)
        except ValueError:
            continue

        # Skip desktop roots, docks, or hidden sticky layers
        if workspace == -1:
            continue
        clean_title = title.strip()
        if not clean_title or clean_title.lower() == "desktop":
            continue

        windows.append(
            WindowEntry(
                win_id=win_id,
                workspace=workspace,
                class_name=class_name,
                client_machine=machine,
                title=clean_title,
            )
        )
    return windows


class WindowProvider(BaseLauncherProvider):
    id = "window"
    name = "Open Windows"
    priority = 85

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        q = query.strip().lower()
        if not q:
            return

        if not shutil.which("wmctrl"):
            return

        try:
            res = subprocess.run(
                ["wmctrl", "-l", "-x"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if res.returncode != 0:
                return
            windows = parse_wmctrl_output(res.stdout)
        except Exception as e:
            log.debug("wmctrl window query failed: %s", e)
            return

        for win in windows:
            title_lower = win.title.lower()
            class_lower = win.class_name.lower()
            score = 0.0

            if q == title_lower or q == class_lower:
                score = 100.0
            elif title_lower.startswith(q) or class_lower.startswith(q):
                score = 90.0
            elif any(w.startswith(q) for w in title_lower.split()):
                score = 80.0
            elif q in title_lower or q in class_lower:
                score = 65.0

            if score > 0:
                actions = [
                    LauncherAction(
                        id="focus",
                        title=f"Switch to {win.title}",
                        shortcut="↵",
                        is_primary=True,
                        handler_payload={"win_id": win.win_id},
                    )
                ]
                yield LauncherResult(
                    id=f"window:{win.win_id}",
                    provider_id=self.id,
                    title=win.title,
                    subtitle=f"{win.class_name} • Workspace {win.workspace + 1}",
                    icon="app",
                    badge="Window",
                    score=score,
                    preview_type="markdown",
                    preview_data={
                        "markdown": (
                            f"### {win.title}\n\n"
                            f"- **Application:** `{win.class_name}`\n"
                            f"- **Window ID:** `{win.win_id}`\n"
                            f"- **Workspace:** Workspace {win.workspace + 1}\n\n"
                            f"Press **Enter** to focus and bring window to front."
                        )
                    },
                    actions=actions,
                )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        win_id = payload.get("win_id")
        if not win_id:
            return {"ok": False, "error": "Missing window ID"}

        if not shutil.which("wmctrl"):
            return {"ok": False, "error": "wmctrl utility not found"}

        try:
            res = subprocess.run(
                ["wmctrl", "-i", "-a", win_id],
                capture_output=True,
                text=True,
                timeout=2,
            )
            return {"ok": res.returncode == 0, "win_id": win_id}
        except Exception as e:
            log.exception(f"Failed to focus window {win_id}")
            return {"ok": False, "error": str(e)}
