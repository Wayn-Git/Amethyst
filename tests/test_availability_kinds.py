"""Failure kinds that reach the availability cache (Phase 01, Task 2).

`record_failure` gates on `kind in (UNREACHABLE, UPSTREAM_UNHEALTHY,
NON_RETRYABLE_RATE_LIMIT)`; a plain string never matches, so the worker's
`record_failure(provider, "unreachable", ...)` was a silent no-op -- while the
comment at the call site promised the opposite ("A worker that fails silently
teaches the router nothing"). Each test names the mutation that makes it fail.
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.runtime import availability
from backend.runtime.failures import FailureKind


def test_an_unreachable_kind_is_written_to_the_cache():
    """Mutation check: pass a str where the enum belongs (the Task 2 call
    shape) -- the gate rejects it and nothing is remembered."""
    name = "kinds-test-unreachable"
    availability.forget(name)

    availability.record_failure(name, FailureKind.UNREACHABLE, "nothing answered")

    entry = availability.cached(name)
    assert entry is not None, "the router must be able to see this"
    assert entry.available is False
    assert "nothing answered" in entry.reason
    availability.forget(name)


async def test_the_worker_records_an_enum_kind(monkeypatch):
    """The call site itself: `workers/llm.ask` must hand `record_failure` a
    FailureKind, not the literal "unreachable".

    Mutation check: restore `availability.record_failure(provider,
    "unreachable", str(exc))` in workers/llm.py -- `seen["kind"]` arrives as a
    str and the assert fails even though nothing raises.
    """
    from backend.workers.llm import ask

    seen: dict = {}

    def record(name, kind, message=""):
        seen.update(name=name, kind=kind, message=message)

    class Client:
        async def complete(self, messages, system, params):
            raise ConnectionError("connection refused")

    monkeypatch.setattr(
        "backend.workers.llm._providers", lambda paid_ok=True: (["kinds-worker"], None)
    )
    monkeypatch.setattr("backend.workers.llm._model_for", lambda provider: "some-model")
    monkeypatch.setattr(
        "backend.workers.llm.resolve",
        lambda p, m: SimpleNamespace(client=Client()),
    )
    monkeypatch.setattr("backend.workers.llm.availability.record_failure", record)

    result = await ask("hello", paid_ok=False)

    assert seen, "the failure must be recorded"
    assert isinstance(seen["kind"], FailureKind), (
        f"got {type(seen['kind']).__name__} -- a str kind is silently dropped by the gate"
    )
    assert seen["kind"] is FailureKind.UNREACHABLE
    assert result["calls"] >= 1, "the call was attempted before it failed"


async def test_an_http_status_failure_is_classified_not_guessed(monkeypatch):
    """A provider answering 503 is upstream-unhealthy; the worker derives the
    kind from the status instead of hard-coding UNREACHABLE.

    Mutation check: drop the `classify_status` call in workers/llm.py.
    """
    from backend.workers.llm import ask

    seen: dict = {}

    def record(name, kind, message=""):
        seen.update(kind=kind)

    class ServiceUnavailable(ConnectionError):
        status = 503

    class Client:
        async def complete(self, messages, system, params):
            raise ServiceUnavailable("bad gateway-ish")

    monkeypatch.setattr(
        "backend.workers.llm._providers", lambda paid_ok=True: (["kinds-worker-2"], None)
    )
    monkeypatch.setattr("backend.workers.llm._model_for", lambda provider: "some-model")
    monkeypatch.setattr(
        "backend.workers.llm.resolve",
        lambda p, m: SimpleNamespace(client=Client()),
    )
    monkeypatch.setattr("backend.workers.llm.availability.record_failure", record)

    await ask("hello", paid_ok=False)

    assert isinstance(seen.get("kind"), FailureKind)
    assert seen["kind"] is FailureKind.UPSTREAM_UNHEALTHY, "503 means upstream trouble"
