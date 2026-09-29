"""Shell execution. One component owns this, and it never raises at the agent.

Two execution modes, as alternatives rather than layers: sandbox mode is
OS-contained and lower friction; direct mode has full access and always
confirms. Every failure -- bad cwd, timeout, spawn error -- comes back as a
structured result the loop can reason about.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from pathlib import Path
from typing import Any

from backend.security.sandbox import (
    SandboxPolicy,
    platform_backend,
    unavailable_reason,
    wrap_command,
)
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

DEFAULT_TIMEOUT_S = 30
MAX_TIMEOUT_S = 300
MAX_OUTPUT_CHARS = 60_000


def _clip(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + f"\n[... {len(text) - MAX_OUTPUT_CHARS} more characters ...]"


def _kill_tree(proc: asyncio.subprocess.Process) -> None:
    """Kill the command and everything it spawned, not just its leader.

    `proc.kill()` signals one pid. A command that started a daemon of its own
    survives it and keeps working after the tool has reported a timeout -- and
    after the turn that asked for it is over. The process group is private
    (`start_new_session=True`), so signalling it can only ever reach this
    command's tree.
    """
    if proc.returncode is not None:
        return
    with contextlib.suppress(OSError, ProcessLookupError, PermissionError):
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    with contextlib.suppress(Exception):
        proc.kill()


async def run_shell_command(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    command = (args.get("command") or "").strip()
    if not command:
        return ToolResult.error("no command provided")

    workspace = str(Path(ctx.workspace_root or Path.cwd()).expanduser().resolve())
    cwd = str(Path(args.get("cwd") or workspace).expanduser())
    if not Path(cwd).is_dir():
        return ToolResult.error(f"working directory does not exist: {cwd}")

    # The advertised timeout is the enforced timeout -- no silent clamping of a
    # contract the model reasons about.
    timeout = min(int(args.get("timeout_seconds") or DEFAULT_TIMEOUT_S), MAX_TIMEOUT_S)

    mode = args.get("execution_mode") or "sandbox"
    policy = SandboxPolicy.load()
    if mode == "direct":
        argv, backend = ["/bin/bash", "-c", command], None
    else:
        argv, backend = wrap_command(command, policy, workspace)

    env = {**os.environ, "AMETHYST": "1"}
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # Own session, own process group. Without it the command runs in
            # the server's group, and anything in it that signals its group --
            # `pkill`, a build script cleaning up after itself, a Ctrl+C it
            # synthesises -- takes the API down with it. `killpg` is also how
            # the timeout below kills the tree, and a group it shares with the
            # server is one that must never be used for that.
            start_new_session=True,
        )
    except (OSError, FileNotFoundError) as exc:
        return ToolResult.error(f"failed to start command: {exc}")

    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        _kill_tree(proc)
        await proc.wait()
        return ToolResult.error(f"command timed out after {timeout}s and was killed:\n{command}")
    except asyncio.CancelledError:
        # The user pressed Stop. Without this the process kept running with its
        # pipes unread -- orphaned, invisible, and still doing whatever the
        # model asked for after the turn that asked was over.
        _kill_tree(proc)
        with contextlib.suppress(Exception):
            await proc.wait()
        raise

    stdout = _clip(stdout_b.decode(errors="replace"))
    stderr = _clip(stderr_b.decode(errors="replace"))

    parts = []
    if stdout:
        parts.append(stdout)
    if stderr:
        parts.append(f"[stderr]\n{stderr}")
    if proc.returncode != 0:
        parts.append(f"[exit code {proc.returncode}]")
        # Tell the model how to recover rather than just failing.
        if mode != "direct" and backend and _looks_like_sandbox_denial(stderr):
            parts.append(
                "[note] this looks like a sandbox restriction. Retry with"
                " execution_mode='direct' if the command genuinely needs full access."
            )
    if mode != "direct" and backend is None:
        reason = unavailable_reason()
        if reason:
            parts.append(f"[note] {reason}")

    output = "\n".join(parts) or "(no output)"
    return ToolResult(content=output, is_error=proc.returncode != 0)


def _preference_subtype(arguments: dict[str, Any]) -> str:
    """What a "don't ask again" for this command should actually cover.

    Sandbox mode runs unwrapped where the OS offers no sandbox -- Windows, or a
    Linux box without bubblewrap. Keying that as ':sandbox' let a preference the
    user granted to contained commands silence the gate for uncontained ones,
    which is the one thing the sandbox/direct split exists to prevent.
    """
    mode = arguments.get("execution_mode") or "sandbox"
    if mode != "direct" and platform_backend() is None:
        return "direct"
    # Otherwise the documented precedence: the model's own description of the
    # operation, falling back to the mode it asked for.
    return arguments.get("operation_type") or mode


def _looks_like_sandbox_denial(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(s in lowered for s in ("operation not permitted", "permission denied", "eperm"))


def tools() -> list[Tool]:
    sandbox_note = unavailable_reason()
    description = (
        "Run a shell command.\n"
        "WHEN TO USE: to verify your own work -- run the tests, the linter, the"
        " type checker, `git status`, `git diff` -- after changing code, and to"
        " do anything the filesystem tools cannot.\n"
        "OUTPUT: stdout and stderr, with the exit code. A non-zero exit is"
        " information to act on, not a dead end: read the error and adapt.\n"
        "TIPS: set execution_mode='sandbox' (the default, OS-contained) unless"
        " the command genuinely needs unrestricted access, in which case use"
        " 'direct', which always asks the user. Set operation_type honestly --"
        " it can only raise the confirmation requirement, never lower it. Use"
        " cwd rather than prefixing `cd`.\n"
        "LIMITS: never commit or push unless the user explicitly asked. Do not"
        " use this to talk to the user -- text outside tool calls does that."
    )
    if sandbox_note:
        description += f" Note: {sandbox_note}."

    return [
        Tool(
            name="run_shell_command",
            description=description,
            parameters={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to run"},
                    "cwd": {"type": "string", "description": "Working directory"},
                    "timeout_seconds": {
                        "type": "integer",
                        "description": f"Timeout, max {MAX_TIMEOUT_S}s",
                    },
                    "execution_mode": {
                        "type": "string",
                        "enum": ["sandbox", "direct"],
                        "description": "sandbox is OS-contained; direct always asks the user",
                    },
                    "operation_type": {
                        "type": "string",
                        "enum": ["read-only", "write-only", "read-write"],
                        "description": "Your assessment of what this command does. This can only"
                        " raise the confirmation requirement, never lower it.",
                    },
                },
                "required": ["command"],
            },
            handler=run_shell_command,
            risk=RiskLevel.HIGH,
            touches_paths=True,
            subtype=_preference_subtype,
        )
    ]
