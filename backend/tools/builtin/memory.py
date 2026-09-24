"""Tools for managing long-term memory.

These tools allow the model to explicitly store durable facts, recall
existing memories, and retire outdated facts across conversations.
"""

from __future__ import annotations

from typing import Any

from backend.memory.service import MemoryDiff, MemoryService, _sanitize_fact, render
from backend.memory.store import MemoryStore
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult


async def remember(args: dict[str, Any], context: ToolContext) -> ToolResult:
    fact = (args.get("fact") or "").strip()
    if not fact:
        return ToolResult.error("The 'fact' argument cannot be empty.")

    clean = _sanitize_fact(fact)
    if not clean:
        return ToolResult.error("Fact contains only invalid characters.")

    service = MemoryService()
    conversation_id = context.conversation_id if hasattr(context, "conversation_id") else None

    diff = await service.apply(MemoryDiff(create=[clean]), conversation_id=conversation_id)
    if not diff.create:
        return ToolResult.ok(f"Already remembered: {clean}")

    return ToolResult.ok(f"Remembered: {clean}")


async def recall_memories(args: dict[str, Any], context: ToolContext) -> ToolResult:
    query = (args.get("query") or "").strip()
    conversation_id = context.conversation_id if hasattr(context, "conversation_id") else None
    service = MemoryService()

    if query:
        recalled = await service.recall(query, conversation_id=conversation_id)
        if recalled:
            return ToolResult.ok("\n".join(recalled))

    # Fallback to listing most recent live memories
    live = service.store.live(limit=30)
    if not live:
        return ToolResult.ok("No standing memories recorded yet.")

    return ToolResult.ok("\n".join(render(live)))


async def forget_memory(args: dict[str, Any], _: ToolContext) -> ToolResult:
    raw_id = args.get("memory_id")
    try:
        memory_id = int(raw_id)
    except (TypeError, ValueError):
        return ToolResult.error(f"Invalid memory_id: {raw_id!r}")

    store = MemoryStore()
    if store.supersede([memory_id]):
        return ToolResult.ok(f"Memory [{memory_id}] has been retired/forgotten.")
    return ToolResult.error(f"No active memory with id {memory_id} was found.")


def tools() -> list[Tool]:
    return [
        Tool(
            name="remember",
            description=(
                "Store a durable fact in long-term memory across sessions. "
                "Use this whenever the user asks you to remember something, or states a durable "
                "preference, identity trait, ongoing project, or constraint."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "fact": {
                        "type": "string",
                        "description": "The durable statement or preference to remember.",
                    },
                },
                "required": ["fact"],
            },
            handler=remember,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="recall_memories",
            description=(
                "Search or inspect standing facts from long-term memory. "
                "If query is provided, searches memories semantically and by recency; "
                "otherwise lists the most recent facts."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Optional search term or question to match memories against.",
                    },
                },
            },
            handler=recall_memories,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="forget_memory",
            description=(
                "Retire an outdated or contradicted fact by its memory_id. "
                "The fact will no longer be recalled in future conversations."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "memory_id": {
                        "type": "integer",
                        "description": "The numeric ID of the memory to forget.",
                    },
                },
                "required": ["memory_id"],
            },
            handler=forget_memory,
            risk=RiskLevel.LOW,
        ),
    ]
