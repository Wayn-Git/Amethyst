"""Skill tools: the agent's procedural memory.

The catalog is already in the system prompt as a list of names and descriptions.
These tools are the other half: read one in full, and write one back when the
procedure turns out to be incomplete or wrong. Without them the agent can follow
a skill and can never improve one, so the same correction is made in chat on
every session and never reaches the library.

The write path is deliberately narrower than a filesystem tool. A skill is a
directory under the user's skills root, support files live in four known
subdirectories, deleting archives, and editing an existing file requires reading
it in the same turn. Those constraints are what keep an agent-managed library
from turning into a pile of near-duplicates and blind overwrites.
"""

from __future__ import annotations

from typing import Any

from backend.skills import manage, usage
from backend.skills.loader import scan
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

ACTION_READS = {"patch", "replace", "write_file", "remove_file"}


def _read_names(context: ToolContext) -> set[str]:
    names = context.extra.get("skills_read")
    if not isinstance(names, set):
        names = set()
        context.extra["skills_read"] = names
    return names


async def skills_list(_: dict[str, Any], __: ToolContext) -> ToolResult:
    skills, errors = scan()
    if not skills:
        note = "No skills are installed."
        if errors:
            note += f" {len(errors)} entr{'y' if len(errors) == 1 else 'ies'} could not be read."
        return ToolResult.ok(note)

    lines = []
    for skill in skills:
        state = usage.get(skill.name)
        flags = []
        if state.get("pinned"):
            flags.append("pinned")
        if state.get("locked"):
            flags.append("locked")
        if state.get("state") and state["state"] != usage.ACTIVE:
            flags.append(str(state["state"]))
        suffix = f" [{', '.join(flags)}]" if flags else ""
        lines.append(f"{skill.name}{suffix}: {skill.description}")
    return ToolResult.ok("\n".join(lines))


async def skill_view(args: dict[str, Any], context: ToolContext) -> ToolResult:
    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult.error("skill_view needs a skill name.")
    file_path = (args.get("file_path") or "").strip() or None
    try:
        text = manage.read(name, file_path)
    except manage.SkillManageError as exc:
        return ToolResult.error(str(exc))

    if not file_path:
        _read_names(context).add(name)
        usage.bump(name, "view_count")
    return ToolResult.ok(text)


async def skill_manage(args: dict[str, Any], context: ToolContext) -> ToolResult:
    action = (args.get("action") or "").strip().lower()
    name = (args.get("name") or "").strip()
    file_path = (args.get("file_path") or "").strip() or None

    if action not in {
        "create", "patch", "replace", "write_file", "remove_file",
        "delete", "restore", "pin", "lock",
    }:
        return ToolResult.error(
            "action must be one of: create, patch, replace, write_file,"
            " remove_file, delete, restore, pin, lock"
        )
    if action != "restore" and not name:
        return ToolResult.error(f"skill_manage({action}) needs a skill name.")

    if action in ACTION_READS:
        if name not in _read_names(context):
            return ToolResult.error(
                f"Read '{name}' with skill_view in this turn before editing it."
                " A patch written from memory of an earlier turn applies to a"
                " version that may no longer exist."
            )
        if usage.get(name).get("locked"):
            return ToolResult.error(
                f"'{name}' is locked. Ask the user to unlock it in Capabilities"
                " before editing; locked skills stay readable on purpose."
            )

    try:
        if action == "create":
            content = args.get("content") or ""
            if not content.strip():
                return ToolResult.error("create needs content (a full SKILL.md).")
            skill = manage.create(name, content)
            usage.mark(name, created_by="agent")
            notes = manage.linter(name, content)
            message = f"Created skill '{skill.name}' at {skill.path}."
            if notes:
                message += "\nWarnings:\n- " + "\n- ".join(notes)
            return ToolResult.ok(message)

        if action == "patch":
            old = args.get("old_string") or ""
            new = args.get("new_string") or ""
            if not old or new is None:
                return ToolResult.error("patch needs old_string and new_string.")
            message = manage.patch(name, old, new, file_path=file_path)
            usage.bump(name, "patch_count")
            return ToolResult.ok(message)

        if action == "replace":
            content = args.get("content") or ""
            if not content.strip():
                return ToolResult.error("replace needs content.")
            message = manage.replace(name, content, file_path=file_path)
            usage.bump(name, "patch_count")
            notes = manage.linter(name, content) if not file_path else []
            if notes:
                message += "\nWarnings:\n- " + "\n- ".join(notes)
            return ToolResult.ok(message)

        if action == "write_file":
            content = args.get("file_content") or ""
            if not file_path:
                return ToolResult.error("write_file needs file_path.")
            return ToolResult.ok(manage.write_file(name, file_path, content))

        if action == "remove_file":
            if not file_path:
                return ToolResult.error("remove_file needs file_path.")
            return ToolResult.ok(manage.remove_file(name, file_path))

        if action == "delete":
            destination = manage.archive(name, reason="deleted by the agent")
            usage.mark(name, state=usage.ARCHIVED)
            return ToolResult.ok(
                f"Archived '{name}' at {destination}. It can be restored; nothing was deleted."
            )

        if action == "restore":
            target = manage.restore(name)
            usage.mark(name, state=usage.ACTIVE)
            return ToolResult.ok(f"Restored '{name}' to {target}.")

        if action in ("pin", "lock"):
            flag = action
            value = args.get(flag)
            if value is None:
                value = True
            item = usage.set_flag(name, flag, bool(value))
            return ToolResult.ok(f"{name}: {flag}={'on' if item[flag] else 'off'}")

    except manage.SkillManageError as exc:
        return ToolResult.error(str(exc))
    except Exception as exc:  # pragma: no cover - surfaced rather than raised
        return ToolResult.error(f"skill_manage({action}) failed: {exc}")

    return ToolResult.error(f"unhandled action {action}")


def tools() -> list[Tool]:
    return [
        Tool(
            name="skills_list",
            description=(
                "List the installed skills with their descriptions and state. Use this"
                " before assuming a skill exists, and to find one worth reading."
            ),
            parameters={"type": "object", "properties": {}},
            handler=skills_list,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="skill_view",
            description=(
                "Read a skill's full SKILL.md, or one of its support files"
                " (references/, templates/, scripts/, assets/). The system prompt"
                " only carries names and descriptions; call this before following a"
                " skill. Reading here is also what permits editing it later in the"
                " same turn."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill name."},
                    "file_path": {
                        "type": "string",
                        "description": "Optional path inside the skill, e.g. references/notes.md",
                    },
                },
                "required": ["name"],
            },
            handler=skill_view,
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="skill_manage",
            description=(
                "Create or edit a skill — the procedural memory used for a class of"
                " task. Prefer 'patch' (one unique span) over 'replace'. Read the skill"
                " with skill_view in this turn before editing. Save a procedure only"
                " when it is reusable: not a session narrative, not an environment"
                " failure, not a one-off. 'delete' archives rather than destroys."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "create", "patch", "replace", "write_file",
                            "remove_file", "delete", "restore", "pin", "lock",
                        ],
                        "description": "What to do.",
                    },
                    "name": {"type": "string", "description": "Skill name (slug)."},
                    "content": {
                        "type": "string",
                        "description": "Full SKILL.md text, for create or replace.",
                    },
                    "old_string": {
                        "type": "string",
                        "description": "Exact span to replace, for patch. Must occur once.",
                    },
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text, for patch.",
                    },
                    "file_path": {
                        "type": "string",
                        "description": "Support file path, for write_file/remove_file/patch/replace.",
                    },
                    "file_content": {
                        "type": "string",
                        "description": "Support file content, for write_file.",
                    },
                    "pinned": {
                        "type": "boolean",
                        "description": "For pin: keep this skill out of automatic archival.",
                    },
                    "locked": {
                        "type": "boolean",
                        "description": "For lock: refuse further agent edits, keep it readable.",
                    },
                },
                "required": ["action"],
            },
            handler=skill_manage,
            risk=RiskLevel.MEDIUM,
            # A skill edit is a durable change to what future turns will do;
            # the confirmation layer treats each action as its own operation.
            subtype=lambda args: str(args.get("action") or ""),
        ),
    ]
