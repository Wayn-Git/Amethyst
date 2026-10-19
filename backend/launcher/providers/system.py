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
class SystemCommandDef:
    id: str
    title: str
    subtitle: str
    icon: str
    keywords: list[str]
    command_args: list[str]
    required_binary: str


SYSTEM_COMMANDS: list[SystemCommandDef] = [
    SystemCommandDef(
        id="system:lock",
        title="Lock Screen",
        subtitle="Lock current desktop session",
        icon="lock",
        keywords=["lock", "screen", "session"],
        command_args=["loginctl", "lock-session"],
        required_binary="loginctl",
    ),
    SystemCommandDef(
        id="system:sleep",
        title="Sleep / Suspend",
        subtitle="Suspend system to RAM",
        icon="moon",
        keywords=["sleep", "suspend", "standby"],
        command_args=["systemctl", "suspend"],
        required_binary="systemctl",
    ),
    SystemCommandDef(
        id="system:reboot",
        title="Restart System",
        subtitle="Reboot the computer",
        icon="refresh-cw",
        keywords=["restart", "reboot", "system"],
        command_args=["systemctl", "reboot"],
        required_binary="systemctl",
    ),
    SystemCommandDef(
        id="system:shutdown",
        title="Shut Down",
        subtitle="Power off the computer",
        icon="power",
        keywords=["shutdown", "power off", "turn off", "halt"],
        command_args=["systemctl", "poweroff"],
        required_binary="systemctl",
    ),
    SystemCommandDef(
        id="system:volume_up",
        title="Volume Up",
        subtitle="Increase master volume by 5%",
        icon="volume-2",
        keywords=["volume up", "louder", "audio", "sound", "vol"],
        command_args=["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+5%"],
        required_binary="pactl",
    ),
    SystemCommandDef(
        id="system:volume_down",
        title="Volume Down",
        subtitle="Decrease master volume by 5%",
        icon="volume-1",
        keywords=["volume down", "quieter", "audio", "sound", "vol"],
        command_args=["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-5%"],
        required_binary="pactl",
    ),
    SystemCommandDef(
        id="system:volume_mute",
        title="Toggle Mute",
        subtitle="Mute or unmute master audio sink",
        icon="volume-x",
        keywords=["mute", "silence", "volume", "sound", "vol"],
        command_args=["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"],
        required_binary="pactl",
    ),
    SystemCommandDef(
        id="system:empty_trash",
        title="Empty Trash",
        subtitle="Permanently remove files in trash",
        icon="trash",
        keywords=["empty trash", "trash", "recycle bin", "clean"],
        command_args=["gio", "trash", "--empty"],
        required_binary="gio",
    ),
]


class SystemProvider(BaseLauncherProvider):
    id = "system"
    name = "System Commands"
    priority = 90

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        q = query.strip().lower()
        if not q:
            return

        for cmd in SYSTEM_COMMANDS:
            score = 0.0
            if q == cmd.title.lower():
                score = 100.0
            elif cmd.title.lower().startswith(q):
                score = 90.0
            elif any(k.startswith(q) for k in cmd.keywords):
                score = 80.0
            elif any(q in k for k in cmd.keywords) or q in cmd.title.lower():
                score = 65.0

            if score > 0:
                actions = [
                    LauncherAction(
                        id="exec",
                        title=f"Execute {cmd.title}",
                        shortcut="↵",
                        is_primary=True,
                        handler_payload={"command_id": cmd.id, "command": cmd.id.replace("system:", "")},
                    )
                ]
                yield LauncherResult(
                    id=cmd.id,
                    provider_id=self.id,
                    title=cmd.title,
                    subtitle=cmd.subtitle,
                    icon=cmd.icon,
                    badge="System",
                    score=score,
                    preview_type="markdown",
                    preview_data={
                        "markdown": f"### {cmd.title}\n\n**Action:** `{ ' '.join(cmd.command_args) }`\n\n{cmd.subtitle}"
                    },
                    actions=actions,
                )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        cmd_id = payload.get("command_id") or payload.get("command")
        if not cmd_id:
            return {"ok": False, "error": "Missing command identifier"}

        if not cmd_id.startswith("system:"):
            cmd_id = f"system:{cmd_id}"

        target = next((c for c in SYSTEM_COMMANDS if c.id == cmd_id), None)
        if not target:
            return {"ok": False, "error": f"Unknown system command: {cmd_id}"}

        # Verify command binary exists
        if not shutil.which(target.required_binary):
            return {
                "ok": False,
                "error": f"Required system tool '{target.required_binary}' not available",
            }

        try:
            res = subprocess.run(
                target.command_args,
                capture_output=True,
                text=True,
                timeout=5,
            )
            return {
                "ok": res.returncode == 0,
                "command": target.id,
                "stdout": res.stdout,
                "stderr": res.stderr,
            }
        except Exception as e:
            log.exception(f"Failed to execute system command {target.id}")
            return {"ok": False, "error": str(e)}
