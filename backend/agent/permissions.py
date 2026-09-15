"""Subagent permission derivation.

When a subagent is spawned, its effective permissions are derived from:

1. The parent session's deny rules (hard ceiling — subagent can't escalate)
2. The subagent type's own permissions (determines capabilities)
3. Default denies for tools the subagent shouldn't have

This mirrors OpenCode's deriveSubagentSessionPermission logic.
"""

from __future__ import annotations

from typing import Any

from backend.agent.types import AgentType

# Tools that subagents should NOT have by default unless explicitly allowed
_SUBAGENT_DEFAULT_DENIES: dict[str, str] = {
    "todowrite": "deny",
    "dispatch_parallel_jobs": "deny",
    "collect_jobs": "deny",
}


def derive_subagent_permissions(
    parent_permissions: dict[str, Any],
    subagent_type: AgentType,
) -> dict[str, Any]:
    """Build effective permissions for a subagent session.

    Args:
        parent_permissions: The parent conversation's tool permissions.
            Format: {"tool_name": "allow"|"deny"|"ask"}
            or nested: {"bash": {"git *": "allow", "*": "ask"}}
        subagent_type: The agent type being spawned.

    Returns:
        Merged permissions dict for the subagent.
    """
    result: dict[str, Any] = {}

    # 1. Start with parent's deny rules as hard ceiling
    for tool, rule in parent_permissions.items():
        if _is_deny(rule):
            result[tool] = rule

    # 2. Layer subagent type's own permissions
    for tool, rule in subagent_type.permissions.items():
        if tool == "*":
            # Wildcard: applies to all tools not explicitly set
            continue
        result[tool] = rule

    # 3. Add default denies unless subagent explicitly allows them
    for tool, default_rule in _SUBAGENT_DEFAULT_DENIES.items():
        if tool not in result:
            # Check if subagent type explicitly allows this tool
            if tool in subagent_type.permissions:
                subagent_rule = subagent_type.permissions[tool]
                if not _is_deny(subagent_rule):
                    result[tool] = subagent_rule
                    continue
            result[tool] = default_rule

    return result


def _is_deny(rule: Any) -> bool:
    """Check if a permission rule is a deny."""
    if isinstance(rule, str):
        return rule == "deny"
    if isinstance(rule, dict):
        # Nested rules: check if the default is deny
        return rule.get("*") == "deny"
    return False


def merge_permissions(
    base: dict[str, Any],
    override: dict[str, Any],
) -> dict[str, Any]:
    """Merge two permission dicts. Override wins on conflict."""
    result = dict(base)
    for tool, rule in override.items():
        if tool in result and isinstance(result[tool], dict) and isinstance(rule, dict):
            # Merge nested dicts
            result[tool] = {**result[tool], **rule}
        else:
            result[tool] = rule
    return result


def check_permission(
    tool_name: str,
    arguments: dict[str, Any],
    permissions: dict[str, Any],
) -> str:
    """Evaluate the effective action for a tool call.

    Returns: "allow" | "deny" | "ask"
    """
    # Check exact tool match first
    if tool_name in permissions:
        rule = permissions[tool_name]
        if isinstance(rule, str):
            return rule
        if isinstance(rule, dict):
            # Check nested patterns
            return _match_nested(tool_name, arguments, rule)

    # Check wildcard
    if "*" in permissions:
        rule = permissions["*"]
        if isinstance(rule, str):
            return rule

    # Default: allow (fail open)
    return "allow"


def _match_nested(
    tool_name: str,
    arguments: dict[str, Any],
    rules: dict[str, str],
) -> str:
    """Match nested permission rules against arguments."""
    # Build a match string from the arguments
    match_parts = []
    if "command" in arguments:
        match_parts.append(arguments["command"])
    if "file_path" in arguments:
        match_parts.append(arguments["file_path"])
    if "operation_type" in arguments:
        match_parts.append(arguments["operation_type"])

    match_str = " ".join(match_parts) if match_parts else ""

    # Check patterns in order (last match wins)
    result = rules.get("*", "allow")
    for pattern, action in rules.items():
        if pattern == "*":
            continue
        import fnmatch
        if fnmatch.fnmatch(match_str, pattern) or fnmatch.fnmatch(tool_name, pattern):
            result = action

    return result
