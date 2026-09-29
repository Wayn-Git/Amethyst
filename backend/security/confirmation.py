"""The permission gate (ADR-0009).

Static per-tool risk floor, which the model's self-reported risk can escalate but
never lower -- the correction to Pipali's design, where model self-report was the
primary gate. Transport-agnostic: callers supply a callback, so a CLI, a web UI
and an unattended scheduled run all work through the same service.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.db.repositories import ConfirmationPreferenceRepository, McpTrustRepository
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolSource

# Forces confirmation regardless of sandbox, preference or self-report.
SENSITIVE_PATH_PATTERNS = [
    re.compile(p)
    for p in (
        r"/\.ssh(/|$)",
        r"/\.aws(/|$)",
        r"/\.gnupg(/|$)",
        r"/\.config/gh(/|$)",
        r"/\.npmrc$",
        r"/\.netrc$",
        r"/\.env(\.|$)",
        r"/\.amethyst/config(/|$)",
        r"_history$",
        r"/\.mozilla(/|$)",
        r"/\.config/google-chrome(/|$)",
    )
]

_SELF_REPORT_RISK = {
    "read-only": RiskLevel.LOW,
    "safe": RiskLevel.LOW,
    "write-only": RiskLevel.MEDIUM,
    "read-write": RiskLevel.HIGH,
    "unsafe": RiskLevel.HIGH,
    "destructive": RiskLevel.HIGH,
}


@dataclass
class ConfirmationRequest:
    tool_name: str
    operation_key: str
    risk: RiskLevel
    reason: str
    arguments: dict[str, Any]
    # Minted here rather than by whichever transport answers the prompt, so the
    # same id can be announced to the interface and used to answer. A UI that
    # learns of a prompt only by polling cannot tell two pending calls to the
    # same tool apart.
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    # Which conversation is suspended on this. Pending prompts are process-wide,
    # so without it an interface recovering one after a reload cannot tell
    # whether it belongs to the conversation on screen or another one.
    conversation_id: str | None = None


@dataclass
class ConfirmationOutcome:
    allowed: bool
    decision: str  # auto | approved | denied | skipped_by_pref | denied_by_pref | ...
    risk: RiskLevel
    #: Why, when the decision alone does not say -- which mode blocked a call,
    #: for instance. Carried on the outcome rather than folded into `decision`
    #: because the log page groups on the decision prefix and a message would
    #: split it into one group per conversation.
    detail: str = ""


# Return True to allow. Raise or return False to deny.
ConfirmationCallback = Callable[[ConfirmationRequest], Awaitable[bool]]


async def auto_approve(_: ConfirmationRequest) -> bool:
    """Non-interactive default. Only safe where the caller has vetted the tool set."""
    return True


def is_sensitive_path(value: str) -> bool:
    try:
        resolved = str(Path(value).expanduser())
    except (OSError, ValueError):
        resolved = value
    return any(p.search(resolved) for p in SENSITIVE_PATH_PATTERNS)


def _path_arguments(arguments: dict[str, Any]) -> list[str]:
    out = []
    for key, value in arguments.items():
        if isinstance(value, str) and ("path" in key or "file" in key or "dir" in key):
            out.append(value)
    return out


class ConfirmationService:
    def __init__(
        self,
        callback: ConfirmationCallback | None = None,
        *,
        preferences: ConfirmationPreferenceRepository | None = None,
        mcp_trust: McpTrustRepository | None = None,
    ):
        self.callback = callback or auto_approve
        self._prefs = preferences
        self._trust = mcp_trust

    @property
    def preferences(self) -> ConfirmationPreferenceRepository:
        if self._prefs is None:
            self._prefs = ConfirmationPreferenceRepository()
        return self._prefs

    @property
    def mcp_trust(self) -> McpTrustRepository:
        if self._trust is None:
            self._trust = McpTrustRepository()
        return self._trust

    def evaluate_risk(self, tool: Tool, arguments: dict[str, Any]) -> tuple[RiskLevel, str]:
        """Static floor, escalated only upward by self-report and sensitive paths."""
        risk = tool.risk
        reason = f"{tool.name} is rated {tool.risk.value} risk"

        self_reported = arguments.get("operation_type")
        if isinstance(self_reported, str):
            escalated = _SELF_REPORT_RISK.get(self_reported.lower())
            if escalated and escalated != risk:
                new_risk = risk.at_least(escalated)
                if new_risk != risk:
                    risk = new_risk
                    reason = f"model reported '{self_reported}', escalating to {risk.value}"

        if tool.touches_paths:
            for candidate in _path_arguments(arguments):
                if is_sensitive_path(candidate):
                    return RiskLevel.HIGH, f"touches sensitive path: {candidate}"

        return risk, reason

    async def _ask(
        self, request: ConfirmationRequest, context: ToolContext | None
    ) -> bool:
        """Announce the prompt, then block on it.

        Announcing first is what lets an interface react the moment the turn
        suspends. Without it the only signal is the stream going quiet, which
        looks exactly like a slow tool.
        """
        if context is not None and context.events is not None:
            context.events.put_nowait(
                (
                    "confirmation_required",
                    {
                        "request_id": request.id,
                        "tool_name": request.tool_name,
                        "operation_key": request.operation_key,
                        "risk": request.risk.value,
                        "reason": request.reason,
                        "arguments": request.arguments,
                        "conversation_id": request.conversation_id,
                    },
                )
            )
        return await self.callback(request)

    async def check(
        self,
        tool: Tool,
        arguments: dict[str, Any],
        context: ToolContext | None = None,
    ) -> ConfirmationOutcome:
        risk, reason = self.evaluate_risk(tool, arguments)

        # First call to a not-yet-trusted MCP server always confirms. This is a
        # one-time trust event, orthogonal to the per-call risk gate.
        if tool.source is ToolSource.MCP and tool.server_name:
            if not self.mcp_trust.is_trusted(tool.server_name):
                request = ConfirmationRequest(
                    tool_name=tool.name,
                    operation_key=f"mcp:{tool.server_name}",
                    risk=RiskLevel.HIGH,
                    reason=f"first use of MCP server '{tool.server_name}'",
                    arguments=arguments,
                    conversation_id=context.conversation_id if context else None,
                )
                if await self._ask(request, context):
                    self.mcp_trust.trust(tool.server_name)
                else:
                    return ConfirmationOutcome(False, "denied", RiskLevel.HIGH)

        sensitive = reason.startswith("touches sensitive path")
        if risk is RiskLevel.LOW and not sensitive:
            return ConfirmationOutcome(True, "auto", risk)

        operation_key = tool.operation_key(arguments)
        if not sensitive:
            # A standing preference cannot silence the sensitive-path check.
            remembered = self.preferences.get(operation_key)
            if remembered == "allow":
                return ConfirmationOutcome(True, "skipped_by_pref", risk)
            if remembered == "deny":
                return ConfirmationOutcome(False, "denied_by_pref", risk)

        request = ConfirmationRequest(
            tool_name=tool.name,
            operation_key=operation_key,
            risk=risk,
            reason=reason,
            arguments=arguments,
            conversation_id=context.conversation_id if context else None,
        )
        allowed = await self._ask(request, context)
        return ConfirmationOutcome(allowed, "approved" if allowed else "denied", risk)


#: File-writing tools that `guard-auto-edit` runs without asking. Named rather
#: than derived from risk, because the mode is a statement about *edits*, not
#: about a rating: a medium-risk write that prompts in every other mode is
#: exactly the thing this mode exists to make silent.
AUTO_EDIT_TOOLS = frozenset(
    {
        "replace_file_content",
        "multi_replace_file_content",
        "write_to_file",
        "create_document",
        "edit_file",
    }
)


class GuardedConfirmationService(ConfirmationService):
    """A confirmation service whose answer is decided by the guard mode.

    This is a subclass overriding `check` rather than a rule passed to the base
    class, and the reason is that each mode has to override a *different* part
    of the base decision:

    - `read-only` must block a write even when the user has a standing
      "always allow" for it, which is a preference the base class would honour;
    - `full-access` must skip the prompt even for a HIGH risk tool, and skip
      the one-time MCP trust prompt with it;
    - `guard-auto-edit` must answer "yes" for edits the base class would ask
      about, and fall through to the ordinary question for everything else.

    Replacing the callback instead would have done none of that: the callback
    is only reached once the base class has already decided to ask.

    Where a mode allows something, it is delegated back to `super().check` so
    the one-time MCP trust prompt still happens -- a mode that makes edits
    silent is not a mode that makes an unvetted connector silent.

    Lives here rather than in `backend/api/main.py` because that is where
    `RiskLevel`, `ConfirmationOutcome` and `Tool` already are. Defining it
    anywhere else means resolving those names across a module boundary at call
    time, which is the kind of bug that only appears in the two modes that use
    it.
    """

    def __init__(self, guard: str, /, **kwargs: Any):
        super().__init__(**kwargs)
        self.guard = guard

    async def check(
        self,
        tool: Tool,
        arguments: dict[str, Any],
        context: ToolContext | None = None,
    ) -> ConfirmationOutcome:
        risk, _reason = self.evaluate_risk(tool, arguments)

        if self.guard == "full-access":
            return ConfirmationOutcome(True, "full_access", risk)

        if self.guard == "read-only":
            if risk is RiskLevel.LOW:
                # Delegated, not answered here: LOW still has to pass the MCP
                # trust check above it in the base class.
                return await super().check(tool, arguments, context)
            return ConfirmationOutcome(
                False, "blocked_by_mode", risk, detail=f"guard mode '{self.guard}'"
            )

        if self.guard == "guard-auto-edit":
            if risk is RiskLevel.LOW:
                return await super().check(tool, arguments, context)
            if tool.name in AUTO_EDIT_TOOLS:
                return ConfirmationOutcome(True, "auto_edit", risk)

        return await super().check(tool, arguments, context)


#: The permission modes the interface can select. Named here rather than
#: derived, because the text below is written per mode and an unknown mode has
#: to fall back to something true rather than to an empty prompt.
GUARD_MODES = frozenset({"guard", "read-only", "full-access", "guard-auto-edit"})

#: What the mode means, as the model should hear it.
#:
#: The gate enforces the mode whether or not it is written down, so this is not
#: the enforcement -- it is the model's ability to answer for it. Before it
#: existed the model only learned a mode from a refusal, which meant it learned
#: the strictest mode it could imagine: it would tell the user it could not
#: touch files while the conversation sat in `full-access`, because a refusal
#: from anywhere looks like no permission at all. Naming the mode up front is
#: also what makes a refusal readable -- "read-only refused this" is a setting,
#: and the user can change a setting.
_GUARD_TEXT: dict[str, str] = {
    "read-only": (
        "This conversation is in the READ-ONLY (`read-only`) permission mode. "
        "Nothing you do "
        "may change the workspace or the machine: writing, editing, creating or "
        "deleting files, running a command that alters something, and any "
        "browser action that submits are all unavailable. Low-risk calls still "
        "run, and a path the gate treats as sensitive may still ask first. A "
        "call above that is refused before it runs and comes back as a tool "
        "error -- nobody is prompted, because nobody needs to be. Do not retry "
        "it. Say plainly that the conversation is in read-only mode, describe "
        "what you would have done, and keep working from what you can read. Do "
        "not ask the user to change the mode; they choose it, and the question "
        "is theirs."
    ),
    "guard": (
        "This conversation is in the GUARD (`guard`) permission mode: reading is "
        "free, and "
        "anything that changes the workspace or runs on the machine asks the "
        "user first. A pause on a write tool means the mode is working, not that "
        "something failed -- expect it, and let it happen. Prefer the fewest "
        "calls that do the job, since each one that changes something can be its "
        "own prompt."
    ),
    "guard-auto-edit": (
        "This conversation is in the GUARD-AUTO-EDIT (`guard-auto-edit`) "
        "permission mode: edits to "
        "files run without being asked, and everything else that changes the "
        "workspace or runs on the machine still prompts. Ordinary file edits are "
        "therefore free -- write, replace, create and edit as the task needs. "
        "Commands, deletes and anything outside those edits are where you should "
        "expect to stop and wait."
    ),
    "full-access": (
        "This conversation is in the FULL-ACCESS (`full-access`) permission mode. "
        "Tool calls "
        "that change the workspace or run on the machine are not paused for "
        "approval, and no prompt will interrupt them. Nothing will stop a bad "
        "command on the way out, so decide what should run before you select "
        "it."
    ),
}


def guard_instruction(guard: str | None) -> str:
    """The permission mode, appended to the system prompt for this turn.

    Deliberately not passed into `build_system_prompt`: that result is cached
    across turns by a hash of its inputs, and the mode is the input that changes
    from turn to turn in one conversation -- exactly the shape of the problem
    `depth_instruction` already solves this way. Appended after the cache, so a
    stale prompt cannot describe the mode the conversation used to be in.
    """
    return _GUARD_TEXT.get(guard or "", _GUARD_TEXT["guard"])
