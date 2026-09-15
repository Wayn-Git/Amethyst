"""Agent type system for primary agents and subagents.

An AgentType defines what an agent can do, what tools it has access to,
and how it behaves. Primary agents handle user conversations directly;
subagents are spawned by the Task tool for autonomous work.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class AgentType:
    """Definition of an agent's capabilities and constraints."""

    name: str
    mode: str  # "primary" | "subagent" | "all"
    description: str
    system_prompt: str | None = None  # override prompt; None uses default
    model_override: str | None = None  # e.g. "anthropic/claude-haiku-4-20250514"
    permissions: dict[str, Any] = field(default_factory=dict)
    # Tool permission overrides: {"tool_name": "allow"|"deny"|"ask"}
    # or nested: {"bash": {"git *": "allow", "*": "ask"}}
    hidden: bool = False  # hide from @ autocomplete
    max_iterations: int = 12
    max_tool_calls: int = 30
    max_seconds: float = 300.0
    temperature: float | None = None
    color: str | None = None  # hex color for UI badge
