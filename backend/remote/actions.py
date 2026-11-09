"""Reviewed, expiring, single-use drafts for sensitive PC actions."""

import asyncio
import json
import time
import uuid

from fastapi import HTTPException

from backend.agent.trace import finish_turn_trace, record_tool_dispatch, start_turn_trace
from backend.db.connection import get_connection, transaction
from backend.db.repositories import ExecutionLogRepository
from backend.security.confirmation import ConfirmationService
from backend.security.remote_access import allowed, current_device
from backend.tools.base import RiskLevel, Tool, ToolContext


def prepare(request, action, arguments, permission):
    if action == "command":
        from backend.remote.system import is_command_safe
        safe, reason = is_command_safe(arguments.get("command", ""))
        if not safe:
            raise HTTPException(400, f"Blocked unsafe remote command: {reason}")
    device = request.scope.get("device")
    owner = device.id if device else "local"
    draft_id = str(uuid.uuid4())
    now = time.time()
    with transaction() as conn:
        conn.execute("DELETE FROM remote_action_drafts WHERE expires_at < ?", (now - 86400,))
        conn.execute(
            "INSERT INTO remote_action_drafts(id,device_id,action,arguments,permission,expires_at) VALUES(?,?,?,?,?,?)",
            (draft_id, owner, action, json.dumps(arguments), permission, now + 120),
        )
    return {"draft_id": draft_id, "action": action, "arguments": arguments,
            "state": "awaiting-approval", "expires_at": now + 120}


async def decide(request, draft_id, approved):
    device = request.scope.get("device")
    owner = device.id if device else "local"
    conn = get_connection()
    row = conn.execute("SELECT * FROM remote_action_drafts WHERE id=? AND device_id=?", (draft_id, owner)).fetchone()
    if not row:
        raise HTTPException(404, "Action draft not found")
    if row["decision"] or row["expires_at"] < time.time():
        raise HTTPException(409, "Action draft expired or already decided")
    if device and not allowed(current_device(request.scope), row["permission"]):
        raise HTTPException(403, "Device permission was removed")
    arguments = json.loads(row["arguments"])

    async def answer(_):
        return approved

    async def unused(*_):
        raise RuntimeError("Action executes only after claiming its draft")

    tool = Tool(name="remote_pc_action", description="Apply a reviewed PC action",
                parameters={}, handler=unused, risk=RiskLevel.HIGH)
    trace, watchdog, token = start_turn_trace("remote", row["action"], turn_id=draft_id)
    started = time.monotonic()
    outcome = None
    error = None
    try:
        outcome = await ConfirmationService(callback=answer, require_write_approval=True).check(
            tool, {"action": row["action"], **arguments}, ToolContext(turn_id=draft_id),
        )
        permitted = approved and outcome.allowed
        # Commit the claim BEFORE touching the OS. A crash is never an excuse
        # to automatically repeat a shutdown, shell command or process kill.
        with transaction(conn):
            changed = conn.execute(
                "UPDATE remote_action_drafts SET decision=? WHERE id=? AND decision IS NULL AND expires_at>=?",
                ("approved" if permitted else "denied", draft_id, time.time()),
            ).rowcount
            if not changed:
                raise HTTPException(409, "Action draft expired or already decided")
        if not permitted:
            return {"ok": False, "state": "denied"}
        if device and not allowed(current_device(request.scope), row["permission"]):
            raise HTTPException(403, "Device permission was removed")
        return await asyncio.to_thread(execute, row["action"], arguments)
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        ExecutionLogRepository().record(
            tool_name="remote_pc_action", tool_source="builtin",
            arguments={"device_id": owner, "draft_id": draft_id, "action": row["action"], **arguments},
            risk_level="high", confirmation_decision=outcome.decision if outcome else "failed",
            error=error, duration_ms=int((time.monotonic() - started) * 1000),
        )
        record_tool_dispatch("remote_pc_action", (time.monotonic() - started) * 1000,
                             arguments={"action": row["action"], "device_id": owner})
        finish_turn_trace(trace, watchdog, token)


def execute(action, arguments):
    from backend.remote import power, system

    if action == "command":
        return system.run_terminal_command(**arguments)
    if action == "launch":
        return system.launch_application(**arguments)
    if action == "kill":
        return system.kill_process(**arguments)
    actions = {"lock": power.lock_screen, "sleep": power.suspend_pc,
               "reboot": power.reboot_pc, "shutdown": power.poweroff_pc}
    return actions[action]()
