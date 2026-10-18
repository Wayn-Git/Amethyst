"""Compression that can actually fire (amethyst-v2 Phase 01, Tasks 3 and 4).

Nothing in the repo imported `context_compressor` before this file: the
`should_compress` argument, the summary call's shape, and the
degrade-don't-raise contract were all unverified, which is how a summary path
that failed on every attempt survived inside a try/except that logged a
warning and moved on. Each test names the mutation that makes it fail.
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.agent.context_compressor import ContextCompressor
from backend.runtime.types import ModelParameters


def test_should_compress_fires_on_a_growing_history():
    """The argument decides; the compressor must read it.

    Mutation check: `tokens = self.last_prompt_tokens` (ignoring the argument)
    -- the class default is 0, so every call would answer False and the
    director would never reach `compress()`.
    """
    c = ContextCompressor(context_length=1_000)  # threshold lands at 500 tokens
    assert c.should_compress(400) is False, "below the threshold, nothing to do"
    assert c.should_compress(500) is True, "at the threshold, compaction fires"

    # The shape the director passes: system + schemas + history that grows
    # with the conversation. A near-constant argument never crosses.
    base = 100
    assert c.should_compress(base + 1 * 300) is False
    assert c.should_compress(base + 3 * 300) is True, "growth is what crosses it"


async def test_the_director_feeds_history_into_the_compressor(db, monkeypatch):
    """Task 3's wiring, at the call site.

    Mutation check: drop `+ sum(message_tokens(m) for m in history)` from
    director.py -- the recorded argument collapses to system+schemas, far
    below the sentinel every history message contributes.
    """
    from backend.agent import director as director_mod
    from backend.agent.director import Director
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel
    from backend.security.confirmation import ConfirmationService, auto_approve
    from backend.tools.base import RiskLevel, Tool, ToolResult
    from backend.tools.registry import ToolRegistry

    class Client:
        async def complete(self, messages, tools=None, params=None):
            return ModelResponse(text="done")

    resolved = ResolvedModel(
        provider="fake",
        model="fake-1",
        client=Client(),
        capabilities=Capabilities(streaming=False, context_window=32_000),
    )
    monkeypatch.setattr(director_mod, "resolve", lambda *a, **k: resolved)
    monkeypatch.setattr(director_mod, "message_tokens", lambda m: 10_000_000)

    seen: list[int | None] = []

    class SpyEngine:
        def __init__(self, *, context_length, threshold_percent=0.5, compression_model=None):
            self.context_length = context_length

        @property
        def name(self):
            return "spy"

        def should_compress(self, prompt_tokens=None):
            seen.append(prompt_tokens)
            return False

        def compress(self, messages):
            return messages

        def update_from_response(self, usage):
            pass

    monkeypatch.setattr(director_mod, "ContextCompressor", SpyEngine)

    reg = ToolRegistry(ConfirmationService(auto_approve))

    async def echo(args, ctx):
        return ToolResult.ok("ok")

    reg.register(
        Tool(
            name="echo",
            description="echo",
            parameters={"type": "object", "properties": {}},
            handler=echo,
            risk=RiskLevel.LOW,
        )
    )

    cid = ConversationRepository().create("fake", "fake-1")
    events = [e async for e in Director(reg, memory=False, retrieval=False).run(cid, "hello there")]

    assert events, "the turn ran"
    assert seen, "should_compress was consulted"
    assert all(v is not None and v >= 10_000_000 for v in seen), (
        "the argument must include history tokens; without them it is "
        "system+schemas only and can never grow"
    )


def test_the_summary_call_sends_model_parameters(monkeypatch):
    """Task 4.1: `complete()` takes `(messages, system, ModelParameters)`.

    Mutation check: `client.complete(messages, params={"max_tokens": ...})`
    -- the dict raises AttributeError, swallowed as a warning, and the
    deterministic fallback hides the failure forever.
    """
    captured: dict = {}

    class Client:
        async def complete(self, messages, system, params):
            captured.update(messages=messages, system=system, params=params)
            return SimpleNamespace(text="the summary")

    monkeypatch.setattr(
        "backend.runtime.router.route_for_tier",
        lambda tier: SimpleNamespace(head=SimpleNamespace(provider="fast", model="fast-1")),
    )
    monkeypatch.setattr(
        "backend.runtime.registry.resolve",
        lambda provider, model: SimpleNamespace(provider=provider, model=model, client=Client()),
    )

    c = ContextCompressor(context_length=128_000, max_tokens=1234)
    assert c._call_summary_llm("sum this up") == "the summary"
    assert isinstance(captured["params"], ModelParameters), "not a raw dict"
    assert captured["params"].max_tokens == 1234
    assert captured["system"] is None
    assert captured["messages"] == [{"role": "user", "content": "sum this up"}]


def test_a_summary_client_that_raises_returns_none(monkeypatch):
    """A dead summarizer degrades, it does not raise into the turn.

    Mutation check: remove the `except Exception` from `_call_summary_llm`.
    """

    class Client:
        async def complete(self, *a, **k):
            raise ConnectionError("refused")

    monkeypatch.setattr(
        "backend.runtime.router.route_for_tier",
        lambda tier: SimpleNamespace(head=SimpleNamespace(provider="fast", model="fast-1")),
    )
    monkeypatch.setattr(
        "backend.runtime.registry.resolve",
        lambda provider, model: SimpleNamespace(provider=provider, model=model, client=Client()),
    )

    assert ContextCompressor()._call_summary_llm("anything") is None


def test_no_fast_tier_means_no_summary_call(monkeypatch):
    """The unresolvable-default contract: a fresh machine with nothing
    configured answers None, never an exception.

    Mutation check: let `_summary_target` raise when the fast tier is empty.
    """
    monkeypatch.setattr(
        "backend.runtime.router.route_for_tier",
        lambda tier: SimpleNamespace(head=None),
    )
    c = ContextCompressor()
    assert c._summary_target() is None
    assert c._call_summary_llm("anything") is None


def test_a_summary_that_cannot_be_made_degrades_without_raising(monkeypatch):
    """The whole path end to end: no model -> static fallback, same list shape.

    Mutation check: make `_generate_summary` propagate instead of returning
    None.
    """
    monkeypatch.setattr(
        "backend.runtime.router.route_for_tier",
        lambda tier: SimpleNamespace(head=None),
    )
    # Sized past `_find_tail_start`'s tail budget (>= 10k tokens): with small
    # messages the whole history fits in the protected tail and the middle is
    # empty -- nothing to compress, nothing to prove.
    messages = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " + "word " * 2000}
        for i in range(20)
    ]
    out = ContextCompressor(context_length=128_000).compress(messages)

    assert isinstance(out, list)
    assert len(out) < len(messages), "the middle was compacted"
    assert any(
        "compacted" in (m.get("content") or "") for m in out
    ), "the reader is told what happened to the middle"


def test_tail_start_never_starts_on_tool_and_snaps_to_user_turn():
    """Regression test for Mistral/OpenCode 400: tail_start must never land on role='tool'."""
    c = ContextCompressor(context_length=128_000)
    messages = [
        {"role": "system", "content": "system prompt"},
        {"role": "user", "content": "first message"},
        {"role": "assistant", "content": "first response"},
    ]
    # Build conversation with tool calls
    for i in range(10):
        messages.extend([
            {"role": "user", "content": f"query {i} " + "data " * 500},
            {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{i}", "function": {"name": "search", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": f"call_{i}", "content": f"tool result {i} " + "output " * 500},
            {"role": "assistant", "content": f"answer {i} " + "words " * 500},
        ])

    head_end = c._find_head_end(messages)
    tail_start = c._find_tail_start(messages, head_end)

    # 1. Tail must never start with a tool message
    assert messages[tail_start].get("role") != "tool"
    # 2. Tail should snap to a user message
    assert messages[tail_start].get("role") == "user"

    # 3. Whole compression preserves role ordering without 'tool' after 'user'
    compressed = c.compress(messages)
    for idx in range(len(compressed) - 1):
        curr_role = compressed[idx].get("role")
        next_role = compressed[idx + 1].get("role")
        assert not (curr_role == "user" and next_role == "tool"), (
            f"Found invalid sequence: role '{curr_role}' followed by '{next_role}' at index {idx}"
        )


def test_to_openai_messages_sanitizes_orphaned_tools_and_consecutive_users():
    """Test that _to_openai_messages transforms orphaned tool messages into user content."""
    from backend.runtime.providers.openai_compat import _to_openai_messages

    # Sliced conversation where a tool message has no preceding assistant tool_calls
    orphaned_slice = [
        {"role": "user", "content": "What was the result?"},
        {"role": "tool", "tool_call_id": "call_old", "name": "GMAIL_SEARCH", "content": "2 emails found"},
        {"role": "assistant", "content": "You had 2 emails."},
    ]

    wire = _to_openai_messages(orphaned_slice)

    # Should not contain any 'tool' role because it was orphaned
    roles = [m["role"] for m in wire]
    assert "tool" not in roles
    # The orphaned tool result should be merged into the preceding user message
    assert len(wire) == 2
    assert wire[0]["role"] == "user"
    assert "2 emails found" in wire[0]["content"]
    assert wire[1]["role"] == "assistant"

