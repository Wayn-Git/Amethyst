"""What a control device may ask for, and what happens when it does.

This is the trust boundary, and it is here rather than at the relay on purpose.
The relay carries sealed bytes it cannot read, so it cannot be the thing that
decides what is allowed; the machine that holds the vault and the keychain is.

The shape is `relay/src/jobs/registry.ts`'s, deliberately: a table of handlers
keyed by kind, and a kind with no handler is refused at the door rather than
falling through to something generic. A phone can ask for a turn in a
conversation. It cannot ask for a tool call, a shell command, a file read or a
model key, because there is no handler for those and adding one is a decision
somebody makes in this file rather than a message somebody sends.

Every intent is refused or accepted exactly once. The row's id is the id of the
op that carried it, so the merge's own duplicate guard is the idempotency
guarantee -- a phone tapping send once produces one turn however many times the
relay redelivers the op.
"""

from __future__ import annotations

import json
import logging

log = logging.getLogger(__name__)

#: The job kind a remote turn becomes. Registered in `backend/api/main.py`
#: alongside the automation handler, because both run a turn with nobody
#: watching and both need the same lease and the same crash discipline.
TURN_JOB_KIND = "remote_turn"

#: The longest message a control device may send. A composer is not a file
#: upload, and the op carrying it has to fit in the relay's 64KB envelope.
MAX_PROMPT_CHARS = 8_000


def _refuse(conn, clock, intent_id: str, note: str) -> None:
    settle(conn, clock, intent_id, "refused", note=note)
    log.info("refused intent %s: %s", intent_id, note)


def settle(conn, clock, intent_id: str, state: str, *, note=None, job_id=None) -> None:
    """Record the outcome, and emit it so the phone learns what happened.

    Without the op the phone would send into silence: the intent would sit at
    `pending` in its replica forever, whether it ran, was refused, or named a
    conversation that no longer exists.
    """
    from backend.sync import ops

    conn.execute(
        "UPDATE sync_intents SET state = ?, note = ?, job_id = ?,"
        " updated_at = datetime('now') WHERE id = ?",
        (state, note, job_id, intent_id),
    )
    ops.emit(conn, clock, "intents", intent_id, {"state": state, "note": note})


def pending(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT id, device_id, kind, payload FROM sync_intents"
        " WHERE state = 'pending' ORDER BY created_at LIMIT 25"
    ).fetchall()
    return [
        {"id": r[0], "device_id": r[1], "kind": r[2], "payload": r[3]} for r in rows
    ]


def _is_live(conn, device_id: str | None) -> bool:
    """Whether the device that asked is still one this machine recognises.

    Checked at dispatch as well as at revocation, because an intent can arrive
    *after* the device was revoked: it was sealed before, sat at the relay, and
    the relay only learns about the revocation on the next config mirror. The
    machine is the authority, so the machine checks.
    """
    if not device_id:
        return True   # predates device stamping; the registry decides nothing here
    row = conn.execute(
        "SELECT revoked_at FROM devices WHERE id = ?", (device_id,)
    ).fetchone()
    return row is None or row[0] is None


def dispatch(conn, clock) -> int:
    """Act on everything a control device has asked for. Returns how many ran.

    Never raises. A malformed intent is refused with a reason the phone can
    show; an unexpected failure is refused too, because a row left at `pending`
    would be retried on every poll forever.
    """
    acted = 0
    for intent in pending(conn):
        try:
            if not _is_live(conn, intent["device_id"]):
                _refuse(conn, clock, intent["id"], "that device was revoked")
                continue
            handler = HANDLERS.get(intent["kind"])
            if handler is None:
                _refuse(conn, clock, intent["id"],
                        f"this machine does not know how to {intent['kind']!r}")
                continue
            try:
                payload = json.loads(intent["payload"] or "{}")
            except ValueError:
                _refuse(conn, clock, intent["id"], "that request was not readable")
                continue
            if not isinstance(payload, dict):
                _refuse(conn, clock, intent["id"], "that request was not an object")
                continue
            handler(conn, clock, intent, payload)
            acted += 1
        except Exception:
            log.exception("intent %s could not be handled", intent["id"])
            try:
                _refuse(conn, clock, intent["id"], "this machine could not carry that out")
            except Exception:
                log.exception("intent %s could not even be refused", intent["id"])
    return acted


# -- the handlers --------------------------------------------------------


def _turn(conn, clock, intent, payload) -> None:
    """Run a turn in an existing conversation.

    Deliberately only an *existing* one. Creating a conversation needs a
    provider, a model and a workspace, which are this machine's to choose; a
    phone picks one that is already there and says what to send to it.
    """
    from backend.jobs import JobStore, enqueue

    conversation_id = str(payload.get("conversation_id") or "").strip()
    text = str(payload.get("text") or "").strip()

    if not conversation_id or not text:
        _refuse(conn, clock, intent["id"], "a turn needs a conversation and something to say")
        return
    if len(text) > MAX_PROMPT_CHARS:
        _refuse(conn, clock, intent["id"], f"that message is longer than {MAX_PROMPT_CHARS} characters")
        return
    exists = conn.execute(
        "SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)
    ).fetchone()
    if not exists:
        _refuse(conn, clock, intent["id"], "that conversation is not on this machine")
        return

    # The intent id is the idempotency key, so the job layer refuses a second
    # job for the same request exactly as the merge refuses a second row.
    job = enqueue(
        TURN_JOB_KIND,
        f"{TURN_JOB_KIND}:{intent['id']}",
        payload={"conversation_id": conversation_id, "text": text, "intent_id": intent["id"]},
        store=JobStore(),
    )
    settle(conn, clock, intent["id"], "accepted", job_id=getattr(job, "id", None))
    log.info("accepted a remote turn for %s from %s", conversation_id, intent["device_id"])


def _new_conversation(conn, clock, intent, payload) -> None:
    """Start a conversation, so a phone is not limited to replying.

    The provider and model are *this machine's* defaults, never the phone's
    choice: routing is a decision made from what is configured and paid for
    here, and a control device that could name a provider could name one whose
    key it wanted spent. The title is the phone's, because a title is just text.

    The conversation id is the intent id. That is what makes this idempotent --
    a redelivered intent addresses the conversation it already made rather than
    making a second one -- and it means the phone knows the id before the
    machine answers, so it can send a turn to it on the same poll.
    """
    from backend.config import configured_providers

    title = str(payload.get("title") or "New conversation").strip()[:200]
    conversation_id = intent["id"]

    if conn.execute("SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)).fetchone():
        settle(conn, clock, intent["id"], "done", note="that conversation already exists")
        return

    # `configured_providers` is the same set the interface offers, so a phone
    # gets what a person sitting at the machine would get. First enabled one
    # with a model: routing proper happens per turn in backend/runtime/router.py
    # and does not need deciding here.
    provider, model = "", ""
    try:
        for name, candidate in configured_providers().items():
            if getattr(candidate, "enabled", True) and candidate.default_model:
                provider, model = name, candidate.default_model
                break
    except Exception:
        log.exception("could not read the provider configuration")

    if not provider or not model:
        _refuse(conn, clock, intent["id"],
                "this machine has no default model configured yet")
        return

    conn.execute(
        "INSERT INTO conversations (id, title, provider, model) VALUES (?,?,?,?)",
        (conversation_id, title, provider, model),
    )
    # Published explicitly rather than left to the sweep, so the phone sees the
    # conversation on the same poll that carries the acceptance instead of
    # showing an accepted request with nothing to point at.
    from backend.sync import ops

    ops.emit(conn, clock, "conversations", conversation_id, {
        "title": title, "provider": provider, "model": model,
        "pinned": 0, "archived": 0,
    })
    settle(conn, clock, intent["id"], "done")
    log.info("a control device started conversation %s", conversation_id)


def _stop(conn, clock, intent, payload) -> None:
    """Stop a turn that is running.

    A phone that can start a turn and not stop one is a phone that can spend
    money it cannot get back. This cancels through the same registry the Stop
    button uses, so there is one way to stop a turn rather than two.
    """
    conversation_id = str(payload.get("conversation_id") or "").strip()
    if not conversation_id:
        _refuse(conn, clock, intent["id"], "a stop needs a conversation")
        return
    try:
        from backend.api.main import _active_turns

        cancel = _active_turns.get(conversation_id)
    except Exception:
        cancel = None
    if cancel is None:
        settle(conn, clock, intent["id"], "done", note="nothing was running")
        return
    cancel.set()
    settle(conn, clock, intent["id"], "done", note="stopped")
    log.info("a control device stopped the turn in %s", conversation_id)


#: Every kind a control device may ask for. A kind absent from this table is
#: refused, which is what makes the surface a decision rather than an accident.
#:
#: Deliberately short, and each entry is a deliberate widening. There is no
#: handler that runs a tool, reads a file, changes a provider or reaches a
#: credential -- not because those are filtered out, but because nothing here
#: can express them.
HANDLERS = {
    "turn": _turn,
    "new_conversation": _new_conversation,
    "stop": _stop,
}
