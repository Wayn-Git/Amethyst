"""Lightweight agent loop for subagents.

A simplified version of the Director that runs autonomous tasks without the
full conversation management, memory extraction, widget classification, or
brand profiling. It focuses on: build prompt -> call LLM -> dispatch tools ->
return result.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from backend.agent.prompt import (
    compress_tool_schemas,
)
from backend.agent.types import AgentType
from backend.db.repositories import ConversationRepository
from backend.runtime.registry import resolve
from backend.runtime.types import ModelParameters, ModelResponse, ToolCall
from backend.tools.base import ToolContext, ToolResult
from backend.tools.registry import ToolRegistry

log = logging.getLogger(__name__)

SUBAGENT_SYSTEM_PROMPT = """\
You are a specialized AI assistant working autonomously on a task assigned to you.

{agent_description}

Your task:
{task_prompt}

Rules:
1. Complete the task using the tools available to you.
2. Do NOT duplicate work the parent agent will do.
3. Return a clear, concise result when done.
4. If you encounter errors, report them clearly.
5. Focus on your specific task — do not deviate.
"""

SUBAGENT_DONE_INSTRUCTION = (
    "The task is complete. Provide your final answer now. "
    "Do not call any more tools."
)


@dataclass
class SubagentEvent:
    """Event yielded by the SubagentRunner."""

    type: str  # "status" | "tool_call" | "tool_result" | "delta" | "done" | "error" | "usage"
    data: dict[str, Any]


class SubagentRunner:
    """A lightweight agent loop for subagent execution."""

    HEARTBEAT_INTERVAL = 30  # seconds between heartbeat pings

    def __init__(
        self,
        registry: ToolRegistry | None = None,
        *,
        stream: bool = True,
    ):
        self.registry = registry or self._build_registry()
        self.stream = stream
        self._steer_queue: asyncio.Queue[str] = asyncio.Queue()

    def _build_registry(self) -> ToolRegistry:
        """Build a minimal tool registry for subagent use."""
        from backend.tools.registry import build_default_registry

        return build_default_registry()

    async def _heartbeat_loop(self, session_id: str, stop: asyncio.Event) -> None:
        """Periodically update the heartbeat timestamp for this subagent."""
        from backend.db.repositories import SubagentSessionRepository

        repo = SubagentSessionRepository()
        while not stop.is_set():
            try:
                repo.update_heartbeat(session_id)
            except Exception:
                log.debug("Heartbeat update failed for %s", session_id)
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                pass

    def steer(self, goal: str) -> None:
        """Inject a steering message into the running subagent's conversation.

        The message is queued and injected as a system message at the start
        of the next iteration.
        """
        self._steer_queue.put_nowait(goal)

    async def run(
        self,
        *,
        session_id: str,
        agent_type: AgentType,
        prompt: str,
        permissions: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run a subagent, yielding events.

        Args:
            session_id: The subagent session ID.
            agent_type: The agent type configuration.
            prompt: The task prompt.
            permissions: Derived permissions for this subagent.
            conversation_id: Parent conversation ID for context.
        """
        started = time.monotonic()
        max_iterations = agent_type.max_iterations
        max_tool_calls = agent_type.max_tool_calls
        max_seconds = agent_type.max_seconds

        # Start heartbeat loop
        heartbeat_stop = asyncio.Event()
        heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(session_id, heartbeat_stop)
        )

        try:
            # Build the system prompt
            system_prompt = self._build_system_prompt(agent_type, prompt)

            # Resolve the model
            model = self._resolve_model(agent_type, conversation_id)
            if model is None:
                yield {"type": "error", "message": "No model available for subagent"}
                return

            # Build tool schemas (filtered by permissions)
            tool_schemas = self._build_tools(model, permissions)

            # Build history from the prompt
            history: list[dict[str, Any]] = [
                {"role": "user", "content": prompt}
            ]

            tool_calls_made = 0
            said: list[str] = []

            for iteration in range(max_iterations):
                # Check limits
                if time.monotonic() - started > max_seconds:
                    yield {"type": "error", "message": "Time limit reached"}
                    return

                # Check for steering messages (from in-memory queue or database)
                while not self._steer_queue.empty():
                    try:
                        steer_goal = self._steer_queue.get_nowait()
                        history.append({
                            "role": "system",
                            "content": f"NEW GOAL from parent: {steer_goal}",
                        })
                        yield {"type": "steer", "goal": steer_goal}
                    except asyncio.QueueEmpty:
                        break

                # Also check database for steer goals (from API)
                try:
                    from backend.db.repositories import SubagentSessionRepository
                    repo = SubagentSessionRepository()
                    row = repo.get(session_id)
                    if row and row["metadata"]:
                        import json
                        meta = json.loads(row["metadata"])
                        db_queue = meta.get("steer_queue", [])
                        if db_queue:
                            # Clear the queue in database
                            meta["steer_queue"] = []
                            repo.update_status(session_id, "running", metadata=json.dumps(meta))
                            for goal in db_queue:
                                history.append({
                                    "role": "system",
                                    "content": f"NEW GOAL from parent: {goal}",
                                })
                                yield {"type": "steer", "goal": goal}
                except Exception:
                    pass  # Best-effort; don't fail the run on DB errors

                if iteration == max_iterations - 1:
                    # Last iteration: no tools, force answer
                    tool_schemas_this = None
                else:
                    tool_schemas_this = tool_schemas

                # Build the wire messages
                wire = [{"role": "system", "content": system_prompt}, *history]

                # Call the model with retries for transient stream interruptions
                response = None
                max_subagent_attempts = 3
                for subagent_attempt in range(max_subagent_attempts):
                    try:
                        if self.stream and hasattr(model.client, "stream"):
                            streamed_text: list[str] = []
                            async for chunk in model.client.stream(
                                wire, tools=tool_schemas_this, params=ModelParameters()
                            ):
                                if chunk.type == "text" and chunk.text:
                                    streamed_text.append(chunk.text)
                                    said.append(chunk.text)
                                    yield {"type": "delta", "text": chunk.text}
                                elif chunk.type == "done":
                                    response = chunk.response
                            if response is None and streamed_text:
                                response = ModelResponse(
                                    text="".join(streamed_text),
                                    stop_reason="stop",
                                )
                        else:
                            response = await model.client.complete(
                                wire, tools=tool_schemas_this, params=ModelParameters()
                            )
                        break
                    except Exception as exc:
                        if subagent_attempt < max_subagent_attempts - 1:
                            log.warning(
                                "Subagent model call failed (%s); retrying (%d/%d)",
                                exc,
                                subagent_attempt + 1,
                                max_subagent_attempts,
                            )
                            await asyncio.sleep(min(1.5 ** subagent_attempt, 3.0))
                            continue
                        log.warning("Subagent model call failed after retries: %s", exc)
                        clean_msg = "Model stream interrupted" if "input stream" in str(exc).lower() else str(exc)
                        yield {"type": "error", "message": f"Model call failed: {clean_msg}"}
                        return

                if response is None:
                    yield {"type": "error", "message": "No response from model"}
                    return

                # No tool calls: we're done
                if not response.tool_calls:
                    text = response.text or ""
                    if text:
                        said.append(text)
                        yield {"type": "delta", "text": text}
                    # Report usage
                    if hasattr(response, "usage") and response.usage:
                        yield {
                            "type": "usage",
                            "input_tokens": getattr(response.usage, "input_tokens", 0),
                            "output_tokens": getattr(response.usage, "output_tokens", 0),
                        }
                    yield {"type": "done", "text": "".join(said)}
                    return

                # Dispatch tool calls
                tool_calls_made += len(response.tool_calls)
                if tool_calls_made > max_tool_calls:
                    yield {
                        "type": "error",
                        "message": f"Tool call limit reached ({max_tool_calls})",
                    }
                    return

                # Add assistant message to history
                history.append({
                    "role": "assistant",
                    "content": response.text,
                    "tool_calls": [
                        {
                            "id": c.id,
                            "function": {"name": c.name, "arguments": c.arguments},
                        }
                        for c in response.tool_calls
                    ],
                })

                # Execute each tool call
                for call in response.tool_calls:
                    yield {"type": "tool_call", "tool": call.name, "input": call.arguments}

                    # Permission check
                    action = self._check_permission(call, permissions)
                    if action == "deny":
                        result = ToolResult.error(
                            f"Permission denied for tool '{call.name}'"
                        )
                    elif action == "ask":
                        # Subagents can't ask for permission — deny
                        result = ToolResult.error(
                            f"Permission required for tool '{call.name}' but subagents cannot ask"
                        )
                    else:
                        result = await self._execute_tool(call)

                    yield {
                        "type": "tool_result",
                        "tool": call.name,
                        "output": result.content[:2000],  # truncate for history
                        "is_error": result.is_error,
                    }

                    # Add tool result to history
                    history.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": result.content[:5000],  # truncate for context
                    })

                # After max iterations, nudge the model to answer
                if iteration >= max_iterations - 2:
                    history.append({
                        "role": "system",
                        "content": SUBAGENT_DONE_INSTRUCTION,
                    })
        finally:
            # Stop heartbeat loop
            heartbeat_stop.set()
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task

    def _build_system_prompt(
        self,
        agent_type: AgentType,
        prompt: str,
    ) -> str:
        """Build the system prompt for the subagent."""
        base = SUBAGENT_SYSTEM_PROMPT.format(
            agent_description=agent_type.description,
            task_prompt=prompt,
        )
        if agent_type.system_prompt:
            base = f"{agent_type.system_prompt}\n\n{base}"
        return base

    def _resolve_model(
        self,
        agent_type: AgentType,
        conversation_id: str | None,
    ):
        """Resolve the model for this subagent."""

        if agent_type.model_override:
            # Parse "provider/model" format
            parts = agent_type.model_override.split("/", 1)
            if len(parts) == 2:
                provider, model_name = parts
            else:
                provider, model_name = "openai", parts[0]
            try:
                return resolve(provider, model_name)
            except Exception as exc:
                log.warning(
                    "Failed to resolve subagent model %s: %s",
                    agent_type.model_override, exc,
                )

        # Fall back to the conversation's model
        if conversation_id:
            try:
                conv = ConversationRepository().get(conversation_id)
                if conv:
                    return resolve(conv["provider"], conv["model"])
            except Exception:
                pass

        # Last resort: use the first available provider
        try:
            from backend.config import configured_providers
            providers = configured_providers()
            if providers:
                first = providers[0]
                return resolve(first.name, first.default_model)
        except Exception:
            pass

        return None

    def _build_tools(
        self,
        model: Any,
        permissions: dict[str, Any] | None,
    ) -> list[dict[str, Any]] | None:
        """Build tool schemas, filtered by permissions."""
        if not model.capabilities.tools:
            return None

        schemas = self.registry.schemas()

        # Filter by permissions if provided
        if permissions:
            allowed_tools = []
            for schema in schemas:
                action = permissions.get(schema.name, "allow")
                if isinstance(action, str) and action != "deny":
                    allowed_tools.append(schema)
                elif isinstance(action, dict):
                    # Nested permission — allow by default
                    allowed_tools.append(schema)
            schemas = allowed_tools

        # Compress to reduce token usage
        return compress_tool_schemas(schemas)

    def _check_permission(
        self,
        call: ToolCall,
        permissions: dict[str, Any] | None,
    ) -> str:
        """Check if a tool call is permitted."""
        if not permissions:
            return "allow"

        rule = permissions.get(call.name)
        if rule is None:
            # Check wildcard
            rule = permissions.get("*", "allow")

        if isinstance(rule, str):
            return rule
        if isinstance(rule, dict):
            # Nested rules — default to allow
            return "allow"
        return "allow"

    async def _execute_tool(self, call: ToolCall) -> ToolResult:
        """Execute a single tool call."""
        tool = self.registry.get(call.name)
        if tool is None:
            return ToolResult.error(f"Unknown tool: {call.name}")

        ctx = ToolContext(
            read_only=False,
            extra={"subagent": True},
        )

        try:
            return await tool.handler(call.arguments, ctx)
        except Exception as exc:
            return ToolResult.error(f"Tool execution failed: {exc}")
