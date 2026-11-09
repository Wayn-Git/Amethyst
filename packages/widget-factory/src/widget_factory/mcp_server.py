from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import STATUSES, connect, read_prompts, sync_prompt_tasks
from .generation import artifacts, generate, generate_batch, register_image
from .queue import (
    agent_status,
    claim,
    complete,
    fail,
    heartbeat,
    integration_queue,
    progress,
    retry,
    task_history,
    task_rows,
)


def mcp_server() -> Any:
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError as exc:
        raise RuntimeError("Install the repository MCP dependency to run this server") from exc
    server = MCPServer(
        name="Amethyst Widget Factory",
        version="1.0.0",
        instructions="Local widget factory. Mutations require explicit session_id ownership.",
    )

    @server.tool()
    def list_widget_tasks(status: str = "") -> list[dict[str, Any]]:
        if status and status not in STATUSES:
            raise ValueError("Invalid status")
        sync_prompt_tasks(read_prompts())
        db = connect()
        try:
            return task_rows(db, status or None)
        finally:
            db.close()

    @server.tool()
    def generate_widget(
        widget_id: str, prompt: str, reference_image_path: str = ""
    ) -> dict[str, Any]:
        image = Path(reference_image_path).expanduser().resolve() if reference_image_path else None
        return generate(widget_id, prompt, reference_image=image)

    @server.tool(name="generate_batch")
    def mcp_generate_batch() -> dict[str, Any]:
        return generate_batch()

    @server.tool()
    def get_widget_artifacts(widget_id: str, session_id: str = "") -> dict[str, Any]:
        return artifacts(widget_id, session_id or None)

    @server.tool()
    def register_widget_image(
        widget_id: str, image_path: str, session_id: str = ""
    ) -> dict[str, Any]:
        return register_image(
            widget_id, Path(image_path).expanduser().resolve(), session_id or None
        )

    @server.tool()
    def claim_widget_task(session_id: str, widget_id: str = "") -> dict[str, Any]:
        return claim(widget_id or None, session_id)

    @server.tool()
    def heartbeat_widget_task(widget_id: str, session_id: str) -> dict[str, Any]:
        return heartbeat(widget_id, session_id)

    @server.tool()
    def report_widget_progress(
        widget_id: str, session_id: str, status: str, detail: str
    ) -> dict[str, Any]:
        return progress(widget_id, session_id, status, detail)

    @server.tool()
    def complete_widget_task(
        widget_id: str, session_id: str, commit_sha: str, report: str
    ) -> dict[str, Any]:
        return complete(widget_id, session_id, commit_sha, report)

    @server.tool()
    def fail_widget_task(widget_id: str, session_id: str, error: str) -> dict[str, Any]:
        return fail(widget_id, session_id, error)

    @server.tool()
    def get_agent_status(session_id: str) -> list[dict[str, Any]]:
        return agent_status(session_id)

    @server.tool()
    def get_widget_task_history(widget_id: str, session_id: str = "") -> list[dict[str, Any]]:
        return task_history(widget_id, session_id or None)

    @server.tool()
    def get_integration_queue() -> list[dict[str, Any]]:
        return integration_queue()

    @server.tool()
    def retry_widget_task(widget_id: str, session_id: str = "") -> dict[str, Any]:
        return retry(widget_id, session_id or None)

    return server
