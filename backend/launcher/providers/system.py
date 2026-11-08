from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)

log = logging.getLogger(__name__)


def normalize_action_name(action: str) -> str:
    name = (
        action.lower()
        .replace("act-sys-", "")
        .replace("system:", "")
        .replace("sys-", "")
        .replace("-", "_")
        .strip()
    )
    if name in ("restart", "reboot"):
        return "reboot"
    if name in ("shutdown", "poweroff", "power_off", "turn_off", "halt"):
        return "shutdown"
    if name in ("lock", "lock_screen", "screen_lock"):
        return "lock"
    if name in ("sleep", "suspend", "standby"):
        return "sleep"
    if name in ("vol_mute", "mute", "volume_mute"):
        return "volume_mute"
    if name in ("vol_up", "volume_up"):
        return "volume_up"
    if name in ("vol_down", "volume_down"):
        return "volume_down"
    if name in ("empty_trash", "trash"):
        return "empty_trash"
    return name


def get_platform_command(action: str) -> list[str] | None:
    norm = normalize_action_name(action)
    plat = sys.platform

    if plat == "win32":
        table = {
            "shutdown": ["shutdown.exe", "/s", "/t", "0"],
            "reboot": ["shutdown.exe", "/r", "/t", "0"],
            "lock": ["rundll32.exe", "user32.dll,LockWorkStation"],
            "sleep": ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
        }
        return table.get(norm)

    if plat == "darwin":
        table = {
            "shutdown": ["osascript", "-e", 'tell app "System Events" to shut down'],
            "reboot": ["osascript", "-e", 'tell app "System Events" to restart'],
            "lock": ["pmset", "displaysleepnow"],
            "sleep": ["pmset", "sleepnow"],
            "volume_mute": ["osascript", "-e", "set volume output muted (not (output muted of (get volume settings)))"],
            "volume_up": ["osascript", "-e", "set volume output volume ((output volume of (get volume settings)) + 5)"],
            "volume_down": ["osascript", "-e", "set volume output volume ((output volume of (get volume settings)) - 5)"],
            "empty_trash": ["osascript", "-e", 'tell app "Finder" to empty trash'],
        }
        return table.get(norm)

    # Linux / Unix
    if norm == "shutdown":
        for bin_name, args in [("systemctl", ["systemctl", "poweroff"]), ("loginctl", ["loginctl", "poweroff"]), ("poweroff", ["poweroff"])]:
            if shutil.which(bin_name):
                return args
        return ["systemctl", "poweroff"]

    if norm == "reboot":
        for bin_name, args in [("systemctl", ["systemctl", "reboot"]), ("loginctl", ["loginctl", "reboot"]), ("reboot", ["reboot"])]:
            if shutil.which(bin_name):
                return args
        return ["systemctl", "reboot"]

    if norm == "lock":
        for bin_name, args in [("loginctl", ["loginctl", "lock-session"]), ("xdg-screensaver", ["xdg-screensaver", "lock"])]:
            if shutil.which(bin_name):
                return args
        return ["loginctl", "lock-session"]

    if norm == "sleep":
        for bin_name, args in [("systemctl", ["systemctl", "suspend"]), ("loginctl", ["loginctl", "suspend"])]:
            if shutil.which(bin_name):
                return args
        return ["systemctl", "suspend"]

    if norm == "volume_mute":
        if shutil.which("pactl"):
            return ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"]
        if shutil.which("amixer"):
            return ["amixer", "-D", "pulse", "sset", "Master", "toggle"]
        return ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"]

    if norm == "volume_up":
        if shutil.which("pactl"):
            return ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+5%"]
        if shutil.which("amixer"):
            return ["amixer", "-D", "pulse", "sset", "Master", "5%+"]
        return ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+5%"]

    if norm == "volume_down":
        if shutil.which("pactl"):
            return ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-5%"]
        if shutil.which("amixer"):
            return ["amixer", "-D", "pulse", "sset", "Master", "5%-"]
        return ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-5%"]

    if norm == "empty_trash":
        if shutil.which("gio"):
            return ["gio", "trash", "--empty"]
        return ["gio", "trash", "--empty"]

    return None


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
        raw_cmd = (
            payload.get("command_id")
            or payload.get("command")
            or payload.get("action_id")
            or action_id
        )
        if not raw_cmd:
            return {"ok": False, "error": "Missing command identifier"}

        args = get_platform_command(raw_cmd)
        if not args:
            return {"ok": False, "error": f"Unsupported system command: {raw_cmd}"}

        # Verify command binary exists
        binary = args[0]
        if not shutil.which(binary):
            return {
                "ok": False,
                "error": f"Required system tool '{binary}' not available on this system",
            }

        try:
            res = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=5,
            )
            return {
                "ok": res.returncode == 0,
                "command": raw_cmd,
                "stdout": res.stdout,
                "stderr": res.stderr,
            }
        except Exception as e:
            log.exception(f"Failed to execute system command {raw_cmd}")
            return {"ok": False, "error": str(e)}
