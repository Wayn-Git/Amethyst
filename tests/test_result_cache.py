"""Repeated reads are answered once -- without ever serving a stale one.

Speed here is worth nothing if it makes the agent wrong, so these hold the
safety properties rather than the hit rate: a write invalidates reads, a
question is always really asked, and one chat never sees another's read.
"""

from __future__ import annotations

import pytest

from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def _registry(counter):
    reg = ToolRegistry(ConfirmationService(auto_approve))

    async def read(args, ctx):
        counter["read"] += 1
        return ToolResult.ok(f"contents {counter['read']}")

    async def write(args, ctx):
        counter["write"] += 1
        return ToolResult.ok("written")

    async def ask(args, ctx):
        counter["ask"] += 1
        return ToolResult.ok(f"answer {counter['ask']}")

    reg.register(Tool(name="view_file", description="d", parameters={}, handler=read,
                      risk=RiskLevel.LOW))
    reg.register(Tool(name="write_file", description="d", parameters={}, handler=write,
                      risk=RiskLevel.MEDIUM))
    reg.register(Tool(name="ask_user", description="d", parameters={}, handler=ask,
                      risk=RiskLevel.LOW))
    return reg


@pytest.mark.asyncio
async def test_an_identical_read_is_served_once():
    counter = {"read": 0, "write": 0, "ask": 0}
    reg = _registry(counter)
    ctx = ToolContext(conversation_id="c1")
    a = await reg.dispatch("view_file", {"path": "x.md"}, ctx)
    b = await reg.dispatch("view_file", {"path": "x.md"}, ctx)
    assert a.content == b.content
    assert counter["read"] == 1, "the second identical read ran again"
    # A different argument is a different question.
    await reg.dispatch("view_file", {"path": "y.md"}, ctx)
    assert counter["read"] == 2


@pytest.mark.asyncio
async def test_a_write_invalidates_every_cached_read():
    """The bug this exists to prevent: editing from a read taken before the
    write, which corrupts work rather than merely wasting time.

    Mutation check: drop the `self._result_cache.clear()` on non-LOW risk.
    """
    counter = {"read": 0, "write": 0, "ask": 0}
    reg = _registry(counter)
    ctx = ToolContext(conversation_id="c1")
    await reg.dispatch("view_file", {"path": "x.md"}, ctx)
    await reg.dispatch("write_file", {"path": "x.md", "content": "new"}, ctx)
    after = await reg.dispatch("view_file", {"path": "x.md"}, ctx)
    assert counter["read"] == 2, "a read after a write came from the cache"
    assert after.content == "contents 2"


@pytest.mark.asyncio
async def test_asking_the_user_is_never_cached():
    """`ask_user` is LOW risk, so a blanket 'cache LOW tools' rule would answer
    the second question from the first -- skipping the person entirely."""
    counter = {"read": 0, "write": 0, "ask": 0}
    reg = _registry(counter)
    ctx = ToolContext(conversation_id="c1")
    await reg.dispatch("ask_user", {"question": "which?"}, ctx)
    await reg.dispatch("ask_user", {"question": "which?"}, ctx)
    assert counter["ask"] == 2, "the user was not actually asked the second time"


@pytest.mark.asyncio
async def test_one_conversation_never_sees_anothers_read():
    counter = {"read": 0, "write": 0, "ask": 0}
    reg = _registry(counter)
    await reg.dispatch("view_file", {"path": "x.md"}, ToolContext(conversation_id="c1"))
    await reg.dispatch("view_file", {"path": "x.md"}, ToolContext(conversation_id="c2"))
    assert counter["read"] == 2


@pytest.mark.asyncio
async def test_an_error_is_not_cached():
    reg = ToolRegistry(ConfirmationService(auto_approve))
    calls = {"n": 0}

    async def flaky(args, ctx):
        calls["n"] += 1
        return ToolResult.error("nope") if calls["n"] == 1 else ToolResult.ok("fine")

    reg.register(Tool(name="grep_files", description="d", parameters={}, handler=flaky,
                      risk=RiskLevel.LOW))
    ctx = ToolContext(conversation_id="c1")
    first = await reg.dispatch("grep_files", {"pattern": "x"}, ctx)
    second = await reg.dispatch("grep_files", {"pattern": "x"}, ctx)
    assert first.is_error and not second.is_error, "a failure was cached as the answer"
