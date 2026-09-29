"""The permission mode, as the gate applies it and as the model is told it.

Two halves of one property. The gate half is what actually refuses a call; the
prompt half is what lets the model answer for the refusal instead of inventing
one -- which it did, describing `full-access` conversations as ones where it
had no permission to touch files.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.security.confirmation import (
    AUTO_EDIT_TOOLS,
    ConfirmationService,
    GuardedConfirmationService,
    guard_instruction,
)
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry, _refusal_reason


async def _noop(args, ctx):
    return ToolResult.ok("done")


async def _yes(_request):
    return True


async def _no(_request):
    return False


def make_tool(name="edit_file", risk=RiskLevel.MEDIUM) -> Tool:
    return Tool(
        name=name,
        description="",
        parameters={"type": "object", "properties": {}},
        handler=_noop,
        risk=risk,
    )


# --------------------------------------------------------------- the gate


async def test_read_only_refuses_a_write_and_says_the_mode_did_it(db):
    """Nobody is asked, so nobody may be credited with refusing.

    Mutation check: return the plain `denied` outcome instead of
    `blocked_by_mode`, then read `_refusal_reason` -- it says "the user
    declined", and the model goes looking for a prompt that never appeared.
    """
    asked = False

    async def callback(_request):
        nonlocal asked
        asked = True
        return True

    service = GuardedConfirmationService("read-only", callback=callback)
    outcome = await service.check(make_tool(risk=RiskLevel.MEDIUM), {})
    assert not outcome.allowed
    assert outcome.decision == "blocked_by_mode"
    assert "read-only" in outcome.detail
    assert not asked, "a mode does not ask; it decides"

    reason = _refusal_reason(outcome)
    assert "permission mode" in reason
    assert "Nobody was asked" in reason
    assert "read-only" in reason


async def test_read_only_still_reads(db):
    """A mode that refuses every call is a mode that cannot do anything.
    LOW is delegated to the base class so the MCP trust prompt still happens
    underneath it, which is the point of delegating rather than answering here.
    """
    asked = False

    async def callback(_request):
        nonlocal asked
        asked = True
        return True

    service = GuardedConfirmationService("read-only", callback=callback)
    outcome = await service.check(make_tool(risk=RiskLevel.LOW), {})
    assert outcome.allowed
    assert not asked


async def test_read_only_blocks_even_a_standing_approval(db):
    """The reason this is a subclass: a saved "always allow" is a preference
    the base class would honour, and read-only has to overrule it."""
    service = GuardedConfirmationService("read-only", callback=_yes)
    service.preferences.remember("edit_file", "allow", "low")
    outcome = await service.check(make_tool(risk=RiskLevel.MEDIUM), {})
    assert not outcome.allowed and outcome.decision == "blocked_by_mode"


async def test_full_access_runs_high_risk_without_asking(db):
    asked = False

    async def callback(_request):
        nonlocal asked
        asked = True
        return False

    service = GuardedConfirmationService("full-access", callback=callback)
    outcome = await service.check(make_tool(name="delete_file", risk=RiskLevel.HIGH), {})
    assert outcome.allowed and outcome.decision == "full_access"
    assert not asked


async def test_guard_auto_edit_runs_edits_silently(db):
    """The whole reason the mode exists: a medium-risk write that prompts in
    every other mode is exactly what it is meant to make silent."""
    assert "edit_file" in AUTO_EDIT_TOOLS
    asked = False

    async def callback(_request):
        nonlocal asked
        asked = True
        return False

    service = GuardedConfirmationService("guard-auto-edit", callback=callback)
    outcome = await service.check(make_tool(name="edit_file", risk=RiskLevel.MEDIUM), {})
    assert outcome.allowed and outcome.decision == "auto_edit"
    assert not asked


async def test_guard_auto_edit_still_asks_for_a_command(db):
    """Edits are free; the machine is not. Falling through to `super().check`
    is what keeps the ordinary question in place for everything else."""
    asked = False

    async def callback(_request):
        nonlocal asked
        asked = True
        return False

    service = GuardedConfirmationService("guard-auto-edit", callback=callback)
    outcome = await service.check(
        make_tool(name="run_shell_command", risk=RiskLevel.MEDIUM), {}
    )
    assert not outcome.allowed and outcome.decision == "denied"
    assert asked


async def test_guard_asks_because_that_is_what_it_means(db):
    """The mode with no override: LOW runs, anything else asks, a standing
    preference decides as the user left it."""
    service = GuardedConfirmationService("guard", callback=_yes)
    assert (await service.check(make_tool(risk=RiskLevel.LOW), {})).allowed
    assert (await service.check(make_tool(risk=RiskLevel.MEDIUM), {})).allowed

    refusing = GuardedConfirmationService("guard", callback=_no)
    outcome = await refusing.check(make_tool(risk=RiskLevel.MEDIUM), {})
    assert not outcome.allowed and outcome.decision == "denied"


async def test_a_mode_refusal_is_a_tool_result_not_a_crash(db):
    """What the loop sees. A refusal that raised would end the turn; a refusal
    that returns an error result is something the model reads and works around.
    """
    registry = ToolRegistry(GuardedConfirmationService("read-only", callback=_yes))
    registry.register(make_tool(name="delete_file", risk=RiskLevel.HIGH))
    result = await registry.dispatch("delete_file", {}, ToolContext())
    assert result.is_error
    assert "permission mode" in result.content
    assert "read-only" in result.content


async def test_a_tool_that_never_finishes_is_stopped(db):
    """Per-call timeout. The turn's own guards are checked *between*
    iterations, so nothing inside the loop can reach a call that never
    returns -- which is how a single hung tool held a turn open forever.

    Mutation check: drop `asyncio.wait_for` from the dispatch path and this
    sleeps for the full test timeout.
    """
    async def hang(args, ctx):
        await asyncio.sleep(30)

    registry = ToolRegistry(ConfirmationService(_yes))
    registry.register(
        Tool(
            name="hang",
            description="",
            parameters={"type": "object", "properties": {}},
            handler=hang,
            risk=RiskLevel.LOW,
            timeout=0.05,
        )
    )
    result = await registry.dispatch("hang", {}, ToolContext())
    assert result.is_error
    assert "did not finish" in result.content
    assert "0.05" in result.content or "0s" in result.content


# --------------------------------------------------------------- the prompt


@pytest.mark.parametrize(
    "guard",
    ["read-only", "guard", "guard-auto-edit", "full-access"],
)
def test_the_prompt_names_the_mode_it_is_in(guard):
    text = guard_instruction(guard)
    # Spelled the way the mode is spelled, including the hyphen: the model has
    # to be able to quote the setting back to the person who chose it.
    assert guard in text


def test_an_unknown_mode_describes_the_mode_that_is_actually_applied(db):
    """The registry falls through to the base rules for an unknown mode, so the
    prompt must not claim one of the overrides it is not getting."""
    text = guard_instruction("banana")
    assert "`guard`" in text
    assert "`read-only`" not in text
    assert "`full-access`" not in text


def test_read_only_prompt_says_nobody_is_prompted():
    """The difference between a setting and a person saying no, which is the
    whole reason the model used to invent a refusal."""
    text = guard_instruction("read-only")
    assert "nobody is prompted" in text.lower()
    assert "Do not retry" in text


def test_full_access_prompt_carries_the_warning_with_it():
    text = guard_instruction("full-access")
    assert "not paused for approval" in text
    assert "decide what should run before you select it" in text
