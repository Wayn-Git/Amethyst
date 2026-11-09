"""Task tool: spawn a subagent for autonomous, parallel work.

The primary mechanism for delegating complex tasks to specialized agents.
The Director calls this tool; it creates a child session and runs a
SubagentRunner with derived permissions.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import uuid
from typing import Any

from backend.agent.agents import get_agent, list_visible_subagents
from backend.agent.permissions import derive_subagent_permissions
from backend.db.repositories import SubagentSessionRepository
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

log = logging.getLogger(__name__)

# HMAC secret for capability tokens (generated per process, not persisted)
_HMAC_SECRET = secrets.token_bytes(32)


def _generate_capability_token(
    session_id: str,
    parent_id: str,
    permissions: dict[str, Any],
    depth: int,
) -> str:
    """Generate an HMAC-SHA256 capability token encoding child permissions.

    The token binds the child's identity, permissions, and depth limit to
    prevent tampering with permission derivation.
    """
    payload = json.dumps({
        "session_id": session_id,
        "parent_id": parent_id,
        "permissions": sorted(permissions.items()),
        "depth": depth,
    }, sort_keys=True, default=str)
    return hmac.new(_HMAC_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def _verify_capability_token(
    token: str,
    session_id: str,
    parent_id: str,
    permissions: dict[str, Any],
    depth: int,
) -> bool:
    """Verify a capability token matches expected values."""
    expected = _generate_capability_token(session_id, parent_id, permissions, depth)
    return hmac.compare_digest(token, expected)

# Subagent depth limit (configurable via config)
DEFAULT_MAX_DEPTH = 2  # subagent → subagent → subagent (3 levels total)

BACKGROUND_DESCRIPTION = (
    "Background mode: background=true launches the subagent asynchronously and "
    "returns immediately. Foreground is the default; use it when you need the "
    "result before continuing. Use background only for independent work that can "
    "run while you continue elsewhere. You will be notified automatically when "
    "it finishes."
)

BACKGROUND_STARTED = (
    "The task is working in the background. You will be notified automatically "
    "when it finishes.\n"
    "DO NOT sleep, poll for progress, ask the task for status, or duplicate this "
    "task's work — avoid working with the same files or topics it is using.\n"
    "Work on non-overlapping tasks, or briefly tell the user what you launched "
    "and end your response."
)


def _subagent_list_sentence() -> str:
    """Available subagents for the tool description."""
    agents = list_visible_subagents()
    if not agents:
        return "No subagents available."
    lines = []
    for a in agents:
        lines.append(f"- {a.name}: {a.description[:120]}")
    return "\n".join(lines)


def _format_result(
    session_id: str,
    state: str,
    text: str,
    summary: str | None = None,
) -> str:
    """Format subagent output for the parent agent."""
    parts = [f'<subagent id="{session_id}" state="{state}">']
    if summary:
        parts.append(f"<summary>{summary}</summary>")
    tag = "subagent_error" if state == "error" else "subagent_result"
    parts.append(f"<{tag}>")
    parts.append(text)
    parts.append(f"</{tag}>")
    parts.append("</subagent>")
    return "\n".join(parts)


async def _check_depth(conversation_id: str, repo: SubagentSessionRepository) -> int:
    """Check current subagent depth. Returns 0 for top-level conversations."""
    # Walk up the parent chain
    depth = 0
    current = conversation_id
    while depth < 10:  # hard cap to prevent infinite loops
        row = repo.conn.execute(
            "SELECT parent_conversation_id FROM subagent_sessions WHERE id = ?",
            (current,),
        ).fetchone()
        if not row or not row["parent_conversation_id"]:
            break
        parent_id = row["parent_conversation_id"]
        # Check if parent is itself a subagent session
        parent_row = repo.conn.execute(
            "SELECT id FROM subagent_sessions WHERE id = ?", (parent_id,)
        ).fetchone()
        if not parent_row:
            break
        depth += 1
        current = parent_id
    return depth


async def _run_subagent(
    args: dict[str, Any],
    ctx: ToolContext,
) -> ToolResult:
    """Execute the subagent task."""
    from backend.agent.runner import SubagentRunner

    description = args.get("description", "subagent task")
    prompt = args.get("prompt", "")
    subagent_type_name = args.get("subagent_type", "general")
    task_id = args.get("task_id")
    run_in_background = args.get("background", False)

    # Look up the agent type
    agent_type = get_agent(subagent_type_name)
    if agent_type is None:
        available = [a.name for a in list_visible_subagents()]
        hint = f" Available agents: {', '.join(available)}" if available else ""
        return ToolResult.error(f"Unknown agent type: {subagent_type_name}.{hint}")

    # Check depth limit
    repo = SubagentSessionRepository()
    depth = await _check_depth(ctx.conversation_id, repo)
    max_depth = DEFAULT_MAX_DEPTH  # TODO: read from config
    if depth >= max_depth:
        return ToolResult.error(
            f"Subagent depth limit reached ({max_depth}). "
            "Increase 'subagent_depth' config to allow nested subagents."
        )

    # Derive permissions for the child session
    # Parent permissions come from the conversation's agent config
    parent_permissions: dict[str, Any] = ctx.extra.get("agent_permissions", {})
    child_permissions = derive_subagent_permissions(parent_permissions, agent_type)

    # Create or resume subagent session
    session_id = task_id or f"sub_{uuid.uuid4().hex[:12]}"

    if task_id:
        # Resume existing session
        existing = repo.get(task_id)
        if not existing:
            return ToolResult.error(f"Task session not found: {task_id}")
        session_id = task_id
    else:
        # Generate capability token for this child
        capability_token = _generate_capability_token(
            session_id, ctx.conversation_id, child_permissions, depth + 1
        )

        # Create new session
        repo.create(
            session_id=session_id,
            parent_conversation_id=ctx.conversation_id,
            parent_message_id=str(ctx.extra.get("message_id", "")),
            agent_type=subagent_type_name,
            title=description,
            depth=depth + 1,
            model=agent_type.model_override,
            metadata={
                "background": run_in_background,
                "capability_token": capability_token,
                "max_depth": max_depth,
            },
        )

    # Notify the interface
    if ctx.events:
        await ctx.events.put(("subagent.started", {
            "session_id": session_id,
            "agent_type": subagent_type_name,
            "description": description,
            "background": run_in_background,
        }))

    # Build the runner
    runner = SubagentRunner()

    if run_in_background:
        # Launch background task via the job system
        from backend.workers.batch import BatchSpec, Node, enqueue

        async def _background_run() -> str:
            """Run the subagent in background and return the result."""
            result_parts: list[str] = []
            async for event in runner.run(
                session_id=session_id,
                agent_type=agent_type,
                prompt=prompt,
                permissions=child_permissions,
                conversation_id=ctx.conversation_id,
            ):
                if event["type"] == "delta":
                    result_parts.append(event.get("text", ""))
                elif event["type"] == "error":
                    return json.dumps({"error": event.get("message", "Unknown error")})
                elif event["type"] == "done":
                    pass
            return "".join(result_parts)

        # Build a single-node batch with the subagent collector
        node = Node(
            id=f"subagent_{session_id}",
            task="subagent",
            params={
                "session_id": session_id,
                "agent_type": subagent_type_name,
                "prompt": prompt,
                "permissions": child_permissions,
                "conversation_id": ctx.conversation_id,
            },
        )
        batch_id = f"subagent_{session_id}"
        spec = BatchSpec(nodes=(node,), conversation_id=ctx.conversation_id)
        enqueue(spec, batch_id=batch_id)

        # Update status
        repo.update_status(session_id, "running")

        return ToolResult.ok(
            _format_result(
                session_id,
                "running",
                BACKGROUND_STARTED,
                summary=f"Background task started: {description}",
            )
        )

    # Foreground: run synchronously, stream results
    repo.update_status(session_id, "running")
    result_parts: list[str] = []
    error_msg: str | None = None

    try:
        async for event in runner.run(
            session_id=session_id,
            agent_type=agent_type,
            prompt=prompt,
            permissions=child_permissions,
            conversation_id=ctx.conversation_id,
        ):
            if event["type"] == "delta":
                result_parts.append(event.get("text", ""))
            elif event["type"] == "tool_call":
                # Forward tool call events to the parent stream
                if ctx.events:
                    await ctx.events.put(("subagent.tool_call", {
                        "session_id": session_id,
                        "tool": event.get("tool"),
                        "input": event.get("input"),
                    }))
            elif event["type"] == "error":
                error_msg = event.get("message", "Unknown error")
            elif event["type"] == "usage":
                # Track token usage
                repo.update_status(
                    session_id,
                    "running",
                    tokens_input=event.get("input_tokens", 0),
                    tokens_output=event.get("output_tokens", 0),
                )
    except Exception as exc:
        error_msg = str(exc)
        log.exception("Subagent execution failed")

    final_text = "".join(result_parts)
    if error_msg:
        repo.update_status(session_id, "error", error=error_msg)
        return ToolResult.error(
            _format_result(session_id, "error", final_text or error_msg)
        )

    repo.update_status(session_id, "completed", result=final_text)

    # Notify completion
    if ctx.events:
        await ctx.events.put(("subagent.completed", {
            "session_id": session_id,
            "description": description,
        }))

    return ToolResult.ok(
        _format_result(session_id, "completed", final_text, summary=description)
    )


def tools() -> list[Tool]:
    """Register the task tool."""
    subagent_list = _subagent_list_sentence()
    return [
        Tool(
            name="task",
            description=(
                "Launch a new agent to handle complex, multistep tasks autonomously.\n\n"
                "WHEN TO USE: delegate research, exploration, analysis, or parallel work "
                "that doesn't need your direct file access. Use for tasks that can run "
                "independently while you continue responding.\n\n"
                "WHEN NOT TO USE: simple lookups you can do yourself, reading a specific "
                "file (use view_file), searching code in a single file (use grep_files).\n\n"
                "You must specify subagent_type (general, explore, or scout) and a prompt. "
                "Launch multiple agents concurrently when possible.\n\n"
                f"Available subagents: {subagent_list}\n\n"
                f"{BACKGROUND_DESCRIPTION}"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "A short (3-5 words) description of the task",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The task for the agent to perform",
                    },
                    "subagent_type": {
                        "type": "string",
                        "description": "The type of specialized agent to use",
                        "enum": [a.name for a in list_visible_subagents()],
                    },
                    "task_id": {
                        "type": "string",
                        "description": (
                            "Resume a previous task session. Pass the task_id from "
                            "a prior invocation to continue the same subagent session."
                        ),
                    },
                    "background": {
                        "type": "boolean",
                        "description": (
                            "Run the agent in the background. You will be notified "
                            "when it completes. DO NOT sleep or poll for progress."
                        ),
                    },
                },
                "required": ["description", "prompt", "subagent_type"],
            },
            handler=_run_subagent,
            risk=RiskLevel.MEDIUM,
            subtype=lambda args: args.get("subagent_type", "unknown"),
        )
    ]
