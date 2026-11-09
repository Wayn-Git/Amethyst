"""Built-in agent definitions.

Every agent the system ships with. Users can add more via the config file
or markdown files in ~/.amethyst/agents/ or .amethyst/agents/.
"""

from __future__ import annotations

from backend.agent.types import AgentType

BUILD = AgentType(
    name="build",
    mode="primary",
    description="The default agent. Executes tools based on configured permissions.",
    permissions={},  # full access by default
    max_iterations=24,
    max_tool_calls=60,
    max_seconds=600.0,
)

PLAN = AgentType(
    name="plan",
    mode="primary",
    description="Plan mode. Read-only agent for analysis and code exploration.",
    permissions={
        "edit": "deny",
        "write_file": "deny",
        "create_artifact": "deny",
        "run_shell_command": "ask",
    },
    max_iterations=24,
    max_tool_calls=40,
    max_seconds=600.0,
    color="#6366f1",
)

GENERAL = AgentType(
    name="general",
    mode="subagent",
    description=(
        "General-purpose agent for researching complex questions and executing "
        "multi-step tasks. Use this agent to execute multiple units of work in parallel."
    ),
    permissions={
        "todowrite": "deny",
    },
    max_iterations=12,
    max_tool_calls=30,
    max_seconds=300.0,
)

EXPLORE = AgentType(
    name="explore",
    mode="subagent",
    description=(
        "Fast agent specialized for exploring codebases. Use this when you need "
        "to quickly find files by patterns (eg. 'src/components/**/*.tsx'), search "
        "code for keywords (eg. 'API endpoints'), or answer questions about the "
        "codebase (eg. 'how do API endpoints work?'). When calling this agent, "
        "specify the desired thoroughness level: 'quick' for basic searches, "
        "'medium' for moderate exploration, or 'very thorough' for comprehensive "
        "analysis across multiple locations and naming conventions."
    ),
    permissions={
        "*": "deny",
        "grep_files": "allow",
        "list_files": "allow",
        "view_file": "allow",
        "run_shell_command": "allow",
        "web_search": "allow",
        "fetch_url": "allow",
    },
    max_iterations=8,
    max_tool_calls=20,
    max_seconds=120.0,
    color="#22c55e",
)

SCOUT = AgentType(
    name="scout",
    mode="subagent",
    description=(
        "Read-only agent for external docs and dependency research. Use this "
        "when you need to clone a dependency repository into Amethyst's managed "
        "cache, inspect library source, or cross-reference local code against "
        "upstream implementations without modifying your workspace."
    ),
    permissions={
        "*": "deny",
        "grep_files": "allow",
        "list_files": "allow",
        "view_file": "allow",
        "web_search": "allow",
        "fetch_url": "allow",
        "run_shell_command": "allow",
    },
    max_iterations=8,
    max_tool_calls=15,
    max_seconds=120.0,
    color="#f59e0b",
)

# All built-in agents, indexed by name
BUILTIN_AGENTS: dict[str, AgentType] = {
    "build": BUILD,
    "plan": PLAN,
    "general": GENERAL,
    "explore": EXPLORE,
    "scout": SCOUT,
}

# Only primary agents are selectable by users via Tab
PRIMARY_AGENTS = [a for a in BUILTIN_AGENTS.values() if a.mode == "primary"]

# Only subagents appear in @ autocomplete
SUBAGENTS = [a for a in BUILTIN_AGENTS.values() if a.mode == "subagent"]


def get_agent(name: str) -> AgentType | None:
    """Look up an agent by name."""
    return BUILTIN_AGENTS.get(name)


def list_agents(mode: str | None = None) -> list[AgentType]:
    """List agents, optionally filtered by mode."""
    agents = list(BUILTIN_AGENTS.values())
    if mode:
        agents = [a for a in agents if a.mode == mode or a.mode == "all"]
    return agents


def list_visible_subagents() -> list[AgentType]:
    """Subagents visible in @ autocomplete (not hidden)."""
    return [a for a in SUBAGENTS if not a.hidden]
