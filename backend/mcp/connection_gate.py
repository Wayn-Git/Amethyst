"""Suspend a failed Composio tool call on the app connection it is missing.

A call can arrive fully formed and still go nowhere: the toolkit it names is
not connected, or its credentials expired. Today the failure is returned to the
model as guidance and the model relays it -- a round trip that ends with the
user pasting an OAuth link into a browser by hand. The permission gate proved
the shape that fixes this: announce the suspension, park the turn on it, and
let the interface resume the call the moment the app is actually connected.

This module is the same shape, minus permissions. `wait_for_connection()`
mints the wait, publishes `connection_required` onto the tool context's event
queue -- the loop drains that queue and the interface renders the card -- and
blocks on a future until the interface resolves it, the turn is stopped, or
the wait times out. `begin` joins an identical wait rather than minting a
second one, so a batch that touches the same dead toolkit three times is one
card, not three.

Everything here is bounded and opt-in per turn. A context without a
conversation, which is every subagent and every batch-mock path, gets its
error back as before; the gate never makes an unattended run wait on a person
who is not there.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

#: How long a turn stays parked on a connection card. Generous on purpose: an
#: OAuth round trip plus a "which account was that, again" is minutes of real
#: life, not seconds. Overridable so tests can make it instant.
CONNECTION_WAIT_SECONDS = float(os.getenv("AMETHYST_CONNECTION_WAIT_SECONDS", "600"))


@dataclass
class ConnectorWait:
    """One card the interface owes an answer to."""

    id: str
    toolkit: str
    service: str
    detail: str
    conversation_id: str

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "toolkit": self.toolkit,
            "service": self.service,
            "detail": self.detail,
            "conversation_id": self.conversation_id,
        }


@dataclass
class _Entry:
    wait: ConnectorWait
    future: asyncio.Future[str]


class ConnectionGate:
    """The in-process map of waits a turn is currently suspended on.

    Mirrors the permission gate's `_pending` structure but owns it locally:
    the loop that resolved confirmations lives in the api layer, while the
    calls that need a connection live in the mcp layer.
    """

    def __init__(self) -> None:
        self._waits: dict[str, _Entry] = {}
        self._joins: dict[tuple[str, str], str] = {}

    def begin(
        self,
        *,
        toolkit: str,
        service: str,
        conversation_id: str,
        detail: str = "",
    ) -> tuple[str, asyncio.Future[str]]:
        """Mint the wait -- or hand back the one already open for this pair.

        Keyed by conversation and toolkit together: the same toolkit dead in
        two conversations is two separate cards, and one conversation touching
        it repeatedly is one card for all of them.
        """
        key = (conversation_id, toolkit)
        existing = self._joins.get(key)
        if existing is not None:
            entry = self._waits.get(existing)
            if entry is not None and not entry.future.done():
                return existing, entry.future

        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        wait_id = str(uuid.uuid4())
        self._waits[wait_id] = _Entry(
            ConnectorWait(
                id=wait_id,
                toolkit=toolkit,
                service=service,
                detail=detail,
                conversation_id=conversation_id,
            ),
            future,
        )
        self._joins[key] = wait_id
        return wait_id, future

    def resolve(self, wait_id: str, action: str) -> bool:
        """Wake the turn. False when the wait is gone or already settled."""
        entry = self._waits.get(wait_id)
        if entry is None or entry.future.done():
            return False
        entry.future.set_result(action)
        return True

    def finish(self, wait_id: str) -> None:
        """Forget a wait whose coroutine is no longer parked on it."""
        entry = self._waits.pop(wait_id, None)
        if entry is None:
            return
        key = (entry.wait.conversation_id, entry.wait.toolkit)
        if self._joins.get(key) == wait_id:
            self._joins.pop(key, None)

    def snapshot(self) -> list[dict[str, Any]]:
        """Still-unresolved waits, for the interface recovering after a reload."""
        return [
            entry.wait.payload()
            for entry in list(self._waits.values())
            if not entry.future.done()
        ]


#: Process-wide: the api endpoints answer against the same waits the call
#: handlers created.
gate = ConnectionGate()


def is_connection_required_text(text: str) -> bool:
    """True when a tool result says this failed for want of a connected app.

    Two shapes today: an auth instruction (credentials expired mid-call) and
    the sign-in instruction Composio's tool schemas get refused with. Both are
    messages the model relays today; a card replaces the relaying when the
    turn is interactive.
    """
    from backend.mcp.client import is_auth_failure_text

    if is_auth_failure_text(text or ""):
        return True
    lowered = (text or "").lower()
    return "composio:" in lowered and "no account is connected" in lowered


async def wait_for_connection(
    *,
    toolkit: str,
    service: str,
    detail: str = "",
    conversation_id: str | None,
    events: asyncio.Queue | None = None,
) -> str:
    """Announce the missing connection, then park the call until it is wired.

    Announcing before blocking is the whole trick, borrowed straight from the
    permission gate: without the event the only sign of the suspension is the
    stream going quiet, which reads as a slow tool. Resumes with `"resume"'
    when the interface saw the card connect, `"dismiss"` when the user opted
    out -- the caller answers with its original error either way, so the
    failure the model would have read is never lost, only delayed.

    Returns `"unavailable"` and touches nothing when there is no conversation
    or no event queue -- an unattended run or a subagent, where waiting on a
    person is not an offer we can make.
    """
    if not conversation_id or events is None:
        return "unavailable"

    wait_id, future = gate.begin(
        toolkit=toolkit,
        service=service,
        conversation_id=conversation_id,
        detail=detail,
    )
    events.put_nowait(
        (
            "connection_required",
            {
                "wait_id": wait_id,
                "toolkit": toolkit,
                "service": service,
                "detail": detail,
                "conversation_id": conversation_id,
            },
        )
    )
    # Shielded: the future is shared with any joined waiter for the same
    # toolkit, and `wait_for` resolving a timeout by cancelling it would wake
    # the others as a cancellation rather than as their own timeout.
    try:
        return await asyncio.wait_for(asyncio.shield(future), timeout=CONNECTION_WAIT_SECONDS)
    except TimeoutError:
        return "timeout"
    finally:
        gate.finish(wait_id)
