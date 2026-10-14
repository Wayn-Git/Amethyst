import asyncio
import pytest
from typing import AsyncIterator, Any

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)
from backend.launcher.engine import LauncherEngine


class DummyFastProvider(BaseLauncherProvider):
    id = "dummy_fast"
    name = "Dummy Fast"
    priority = 100

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        if "test" in query.lower():
            yield LauncherResult(
                id="fast_1",
                provider_id=self.id,
                title="Fast Test Result",
                subtitle="Description",
                score=90.0,
                actions=[
                    LauncherAction(id="open", title="Open", is_primary=True)
                ],
            )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return {"status": "ok", "action": action_id}


class DummySlowProvider(BaseLauncherProvider):
    id = "dummy_slow"
    name = "Dummy Slow"
    priority = 50

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        await asyncio.sleep(0.1)
        yield LauncherResult(
            id="slow_1",
            provider_id=self.id,
            title="Slow Result",
            score=50.0,
        )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return {"status": "ok"}


@pytest.mark.asyncio
async def test_engine_query_and_aggregation():
    engine = LauncherEngine()
    engine.register_provider(DummyFastProvider())
    engine.register_provider(DummySlowProvider())

    batches = []
    async for batch in engine.query("test", session_id="s1"):
        batches.append(batch)

    assert len(batches) >= 1
    # Check that fast result was delivered
    all_results = [r for b in batches for r in b]
    ids = [r.id for r in all_results]
    assert "fast_1" in ids


@pytest.mark.asyncio
async def test_engine_query_cancellation():
    engine = LauncherEngine()
    slow = DummySlowProvider()
    engine.register_provider(slow)

    # Launch query 1 then immediately query 2 with new session
    task1 = asyncio.create_task(
        _collect(engine.query("slow", session_id="session_first"))
    )
    await asyncio.sleep(0.01)

    # New query overrides old session
    task2 = asyncio.create_task(
        _collect(engine.query("slow", session_id="session_second"))
    )

    res2 = await task2
    res1 = await task1

    # First session was cancelled, second finished
    assert len(res2) >= 1
    assert "slow_1" in [r.id for b in res2 for r in b]


@pytest.mark.asyncio
async def test_engine_execute_action():
    engine = LauncherEngine()
    fast = DummyFastProvider()
    engine.register_provider(fast)

    res = await engine.execute_action("dummy_fast", "open", {"key": "val"})
    assert res == {"status": "ok", "action": "open"}


async def _collect(gen):
    items = []
    try:
        async for x in gen:
            items.append(x)
    except asyncio.CancelledError:
        pass
    return items
