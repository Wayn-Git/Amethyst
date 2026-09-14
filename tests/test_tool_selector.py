"""Tool selection: fewer schemas per turn, without ever hiding the essentials.

The whole point is token cost and model focus -- 178 tools is ~29,600 tokens on
every round trip -- so these hold the two properties that make narrowing safe:
core tools survive every phrasing, and anything unexpected fails open.
"""

from __future__ import annotations

from backend.agent.tool_selector import CORE, select_tools


class _S:
    def __init__(self, name, description="d"):
        self.name = name
        self.description = description
        self.parameters = {"type": "object"}


def _schemas():
    builtins = [
        "view_file", "list_files", "grep_files", "edit_file", "write_file",
        "create_artifact", "run_shell_command", "ask_user", "delete_file",
        "create_calendar_event", "list_calendar", "search_web", "fetch_url",
        "create_task", "update_task", "read_social", "upload_image",
    ]
    mcp = [f"op{i}__mcp__github" for i in range(6)] + [f"op{i}__mcp__gmail" for i in range(6)]
    return [_S(n) for n in builtins + mcp]


def _names(schemas):
    return {s.name for s in schemas}


def test_core_tools_survive_every_phrasing():
    """A core tool withheld to save tokens is how a capable agent looks broken.

    Mutation check: drop CORE from the `wanted` set in `select_tools`.
    """
    for message in ("hello", "what meetings do I have?", "search the web", "???"):
        kept, _ = select_tools(_schemas(), message)
        missing = {c for c in CORE if c in _names(_schemas())} - _names(kept)
        assert not missing, f"{message!r} withheld core tools: {missing}"


def test_a_calendar_request_gets_calendar_tools_and_not_social():
    kept, withheld = select_tools(_schemas(), "what meetings do I have tomorrow?")
    names = _names(kept)
    assert "list_calendar" in names and "create_calendar_event" in names
    assert "read_social" not in names
    assert withheld > 0, "nothing was narrowed"


def test_naming_a_connector_offers_its_tools():
    kept, _ = select_tools(_schemas(), "open the github pull request")
    names = _names(kept)
    assert any(n.endswith("__mcp__github") for n in names), "github tools not offered"
    assert not any(n.endswith("__mcp__gmail") for n in names), "unrelated connector offered"


def test_the_assistants_own_words_can_reach_a_connector():
    """The escape hatch: a model that says it will check GitHub is offered
    GitHub on the next iteration, even though the user never said it."""
    kept, _ = select_tools(_schemas(), "find that thing\nLet me check github for it")
    assert any(n.endswith("__mcp__github") for n in _names(kept))


def test_it_fails_open_rather_than_hiding_tools():
    """Anything unparseable returns everything. Saving tokens is never worth
    answering without the tool the task needed.

    Mutation check: re-raise instead of returning `schemas` in the except.
    """
    broken = [object(), object()]  # no .name attribute
    kept, withheld = select_tools(broken, "anything")
    assert kept is broken and withheld == 0

    assert select_tools([], "anything") == ([], 0)


# ------------------------------------------------- system prompt is built once


async def test_the_system_prompt_is_built_once_per_turn(db, monkeypatch):
    """It used to be rebuilt inside the provider-retry loop inside the iteration
    loop: a multi-step turn rescanned skills and rebuilt the connector block on
    every round trip, for a string whose inputs never change mid-turn.

    Mutation check: move the `build_system_prompt` call back out of the
    `if system_base is None` guard.
    """
    import backend.agent.director as director_module
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import (
        Capabilities,
        ModelResponse,
        ResolvedModel,
        ToolCall,
    )
    from backend.security.confirmation import ConfirmationService, auto_approve
    from backend.tools.base import RiskLevel, Tool
    from backend.tools.registry import ToolRegistry

    builds = {"n": 0}
    real = director_module.build_system_prompt

    def counted(**kwargs):
        builds["n"] += 1
        return real(**kwargs)

    monkeypatch.setattr(director_module, "build_system_prompt", counted)

    async def noop(args, ctx):
        from backend.tools.base import ToolResult

        return ToolResult.ok("done")

    registry = ToolRegistry(ConfirmationService(auto_approve))
    registry.register(
        Tool(name="view_file", description="read", parameters={"type": "object"},
             handler=noop, risk=RiskLevel.LOW)
    )

    turns = iter([
        ModelResponse(tool_calls=[ToolCall(id="1", name="view_file", arguments={})]),
        ModelResponse(tool_calls=[ToolCall(id="2", name="view_file", arguments={"p": 1})]),
        ModelResponse(text="finished"),
    ])

    class Client:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)
    async for _ in director.run(cid, "read a file please"):
        pass

    assert builds["n"] == 1, f"rebuilt the system prompt {builds['n']} times in one turn"
