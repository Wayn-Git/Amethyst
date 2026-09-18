"""The two halves of a sync, as the poller sees them.

`RelayPoller` already owns the round trip; this is what it hands over and what
it does with what comes back. Kept out of `relay.py` because that file is about
*transport* -- acknowledging, retrying, putting a failed batch back -- and this
one is about meaning, and the two have no reason to change together.

The discipline is the poller's, inherited rather than reinvented: ops taken on
one sync are acknowledged on the *next*. A crash in between re-offers them, and
re-applying an op is free because `sync_seen` refuses the second delivery and
the merge is idempotent anyway. Losing a change is unrecoverable; taking one
twice costs nothing. That trade is stated in `RelayPoller`'s own docstring and
this module makes the same one.

Sealing happens here rather than at rest. The outbox holds plain JSON because it
already sits inside the user's home directory, and a device that had to hold the
group key open to read its own outbox would be strictly worse off.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.db.connection import get_connection, transaction
from backend.sync import crypto, devices, intents, ops, project
from backend.sync.hlc import Clock

log = logging.getLogger(__name__)

#: How many ops one poll carries. Matches SYNC_BATCH at the relay -- a larger
#: number here would only be silently truncated there.
BATCH = 100

#: Keyed by device id rather than a single global, so one process can hold two
#: replicas -- which is how the end-to-end test drives a pair of devices, and the
#: only honest way to assert that two of them converge.
_clocks: dict[str, Clock] = {}


def clock(conn=None) -> Clock:
    """This device's clock, which has to outlive any one request.

    A clock rebuilt per call would restart its counter and re-emit stamps it had
    already used, so two edits in the same millisecond would collide instead of
    ordering -- the exact tie the counter exists to break.
    """
    conn = conn or get_connection()
    device_id = devices.local_id(conn)
    if device_id not in _clocks:
        _clocks[device_id] = Clock(device_id)
    return _clocks[device_id]


def reset_clock() -> None:
    """Drop the cached clocks. For tests, and for a device that has just paired
    and therefore has an identity it did not have a moment ago."""
    _clocks.clear()


# -- outgoing ------------------------------------------------------------

def outgoing(conn=None, *, limit: int = BATCH) -> list[dict[str, Any]]:
    """Seal what is waiting in the outbox. Nothing is deleted here: the ops stay
    until the relay has confirmed them, which is the next poll."""
    conn = conn or get_connection()
    key = crypto.group_key()
    if key is None:
        return []  # nothing has ever paired, so there is nobody to send to

    # And whether anything is paired *now*, which is not the same question.
    #
    # The group key is minted on the first pairing and deliberately outlives it,
    # so `key is None` stops being true the moment a phone is paired once and
    # never becomes true again -- including after every device is revoked. This
    # machine went on sweeping, sealing and uploading for an empty room: ~7,700
    # ops a day, each a row at the relay that nothing would ever collect,
    # because `collect` only deletes what a live device has acknowledged and
    # there were none. That is most of what took D1 over its read limit.
    if not devices.has_peers(conn):
        return []

    # Publish the transcript before sealing, so a message written since the last
    # poll leaves on this one rather than the one after. Swept rather than
    # emitted at the point of writing, which keeps backend/agent/ unaware the
    # sync layer exists -- see backend/sync/project.py.
    try:
        with transaction(conn):
            project.publish(conn, clock(conn))
    except Exception:
        log.exception("could not publish the transcript; the outbox is sent regardless")

    device_id = clock(conn).device_id
    sealed = []
    for op in ops.pending(conn, limit):
        nonce, ciphertext = crypto.seal(
            op.to_payload(), op_id=op.op_id, device_id=device_id, key=key
        )
        sealed.append({
            "op_id": op.op_id,
            "from_device": device_id,
            "nonce": nonce,
            "ciphertext": ciphertext,
        })
    return sealed


# -- incoming ------------------------------------------------------------

def incoming(payload: dict[str, Any], conn=None) -> tuple[int, list[str]]:
    """Apply what the relay handed over.

    Returns how many ops changed something, and the ids to acknowledge next
    time. Every op taken is acknowledged, including ones that changed nothing
    and ones that could not be opened -- an op that cannot be applied is not
    work being held back for later, it is garbage, and leaving it in place would
    block the queue behind it forever. That is the same call `_take` makes about
    an unverifiable delivery, for the same reason.
    """
    rows = payload.get("ops") or []
    if not rows:
        return 0, []

    key = crypto.group_key()
    if key is None:
        # Ops for a device that has not paired, or has been reset. They cannot
        # be opened and never will be, so they are acknowledged rather than left
        # to be re-offered on every poll forever.
        log.warning("dropping %d op(s): this device holds no group key", len(rows))
        return 0, [str(r.get("op_id")) for r in rows if isinstance(r, dict) and r.get("op_id")]

    conn = conn or get_connection()
    tick = clock(conn)
    applied, acks = 0, []

    for row in rows:
        if not isinstance(row, dict):
            continue
        op_id = str(row.get("op_id") or "")
        from_device = str(row.get("from_device") or "")
        if not op_id:
            continue
        acks.append(op_id)
        try:
            opened = crypto.unseal(
                row.get("nonce") or "", row.get("ciphertext") or "",
                op_id=op_id, device_id=from_device, key=key,
            )
            op = ops.Op.from_payload(op_id, from_device, opened)
        except (crypto.SealError, ValueError) as exc:
            # Sealed under a key this device does not hold, or tampered with in
            # transit. Both are "not ours"; neither is recoverable by waiting.
            log.warning("could not open op %s from %s: %s", op_id, from_device, exc)
            continue
        try:
            with transaction(conn):
                if ops.apply_op(conn, op, tick):
                    applied += 1
        except Exception:
            # One bad op must not take the batch. It stays acknowledged: if it
            # failed to apply once it will fail again, and re-offering it
            # forever would wedge every op behind it.
            log.exception("could not apply op %s (%s %s)", op_id, op.entity, op.key)

    # Act on anything a control device asked for, now that its intent rows exist.
    # After the merge rather than inside it: an intent is a row like any other on
    # the way in, and only once it has landed is there something to act on.
    try:
        with transaction(conn):
            intents.dispatch(conn, tick)
    except Exception:
        log.exception("could not dispatch the intents that just arrived")

    return applied, acks


# -- what the relay is told ----------------------------------------------

def config(conn=None) -> dict[str, Any]:
    """The sync layer's additions to the config mirror the poller already pushes.

    `devices` is what lets the relay recognise a control device at all, and
    pushing it on every poll is what makes revoking one take effect within a
    poll rather than on the next deploy.
    """
    conn = conn or get_connection()
    return {
        "device_id": clock(conn).device_id,
        "devices": devices.mirror(conn),
    }


def answer_pairings(payload: dict[str, Any], conn=None) -> list[dict[str, Any]]:
    """Complete any handshake the relay carried across.

    This machine is the only party that can: the relay holds the sealed bytes
    and not the secret that opens them. An offer that does not open is one from
    somebody who did not see the QR code, and `devices.accept` returns None for
    it without saying why.

    An offer that arrives with no code open at all is different, and comes back
    as a plaintext refusal rather than silence -- see `devices.accept`. It is
    carried in the same list because it travels the same way; it just is not a
    pairing, so it does not touch the clock.
    """
    offers = payload.get("pairings") or []
    if not offers:
        return []
    conn = conn or get_connection()
    answers = []
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        try:
            with transaction(conn):
                answer = devices.accept(conn, offer)
        except Exception:
            log.exception("a pairing offer could not be completed")
            continue
        if answer is None:
            continue
        answers.append(answer)
        if not answer.get("refused"):
            reset_clock()  # the group may have just gained its first member
    return answers
