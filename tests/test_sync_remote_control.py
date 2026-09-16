"""The phone asks, the machine acts, the answer comes back.

`test_sync_end_to_end.py` proves two devices converge on state. This proves the
other direction of the remote-control loop: a control device appends an intent,
this machine decides whether to honour it, and what it writes afterwards is
published back without anything on the agent side knowing a phone exists.

The Director is not run here. What is asserted is everything around it -- the
refusals, the idempotency, the publishing and the watermarks -- because that is
the part a phone's behaviour actually depends on and the part that would fail
silently. A turn is one `enqueue` away and is covered by the job tests.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path

import pytest

from backend.sync import intents, ops, project
from backend.sync.hlc import Clock
from backend.sync.registry import MAX_SYNCED_CONTENT

SCHEMA = Path(__file__).resolve().parents[1] / "backend" / "db" / "schema.sql"


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA.read_text())
    c.execute(
        "INSERT INTO conversations (id, title, provider, model)"
        " VALUES ('conv-1', 'Groceries', 'anthropic', 'claude-opus-5')"
    )
    yield c
    c.close()


@pytest.fixture
def clock():
    return Clock("laptop", now_ms=lambda: 1_000)


def arrive(conn, clock, kind, payload, *, intent_id=None, device="phone"):
    """An intent as it lands: an ordinary op, merged like any other."""
    intent_id = intent_id or str(uuid.uuid4())
    ops.apply_op(conn, ops.Op(
        op_id=f"op-{intent_id}", device_id=device, hlc=clock.tick(),
        entity="intents", key=intent_id,
        fields={"device_id": device, "kind": kind,
                "payload": json.dumps(payload), "state": "pending"},
    ))
    return intent_id


def state_of(conn, intent_id):
    row = conn.execute(
        "SELECT state, note FROM sync_intents WHERE id = ?", (intent_id,)
    ).fetchone()
    return (row[0], row[1]) if row else (None, None)


# -- what a control device may ask for -----------------------------------

def test_a_turn_is_accepted_and_becomes_a_job(conn, clock, monkeypatch):
    enqueued = {}

    class FakeJob:
        id = "job-1"

    def fake_enqueue(kind, key, *, payload, store):
        enqueued.update(kind=kind, key=key, payload=payload)
        return FakeJob()

    monkeypatch.setattr("backend.jobs.enqueue", fake_enqueue)
    monkeypatch.setattr("backend.jobs.JobStore", lambda: None)

    intent_id = arrive(conn, clock, "turn", {"conversation_id": "conv-1", "text": "what is left?"})
    assert intents.dispatch(conn, clock) == 1

    assert state_of(conn, intent_id)[0] == "accepted"
    assert enqueued["kind"] == intents.TURN_JOB_KIND
    assert enqueued["payload"]["text"] == "what is left?"
    # The intent id is the idempotency key, which is what makes one tap one turn.
    assert intent_id in enqueued["key"]


def test_a_kind_with_no_handler_is_refused(conn, clock):
    """The surface a phone can reach is a table in this file, not a message it
    chose to send. This is the check that makes that true."""
    intent_id = arrive(conn, clock, "run_shell_command", {"cmd": "rm -rf /"})
    intents.dispatch(conn, clock)
    state, note = state_of(conn, intent_id)
    assert state == "refused"
    assert "does not know how to" in note


def test_a_turn_for_a_conversation_that_is_not_here_is_refused(conn, clock):
    intent_id = arrive(conn, clock, "turn", {"conversation_id": "nope", "text": "hello"})
    intents.dispatch(conn, clock)
    assert state_of(conn, intent_id)[0] == "refused"


@pytest.mark.parametrize("payload", [
    {"conversation_id": "conv-1", "text": "   "},
    {"conversation_id": "", "text": "hello"},
    {"text": "hello"},
])
def test_an_incomplete_turn_is_refused(conn, clock, payload):
    intent_id = arrive(conn, clock, "turn", payload)
    intents.dispatch(conn, clock)
    assert state_of(conn, intent_id)[0] == "refused"


def test_an_oversized_prompt_is_refused(conn, clock):
    intent_id = arrive(conn, clock, "turn", {
        "conversation_id": "conv-1", "text": "x" * (intents.MAX_PROMPT_CHARS + 1),
    })
    intents.dispatch(conn, clock)
    assert state_of(conn, intent_id)[0] == "refused"


def test_unreadable_payload_is_refused_rather_than_fatal(conn, clock):
    intent_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO sync_intents (id, device_id, kind, payload) VALUES (?,?,?,?)",
        (intent_id, "phone", "turn", "{not json"),
    )
    intents.dispatch(conn, clock)
    assert state_of(conn, intent_id)[0] == "refused"


def test_a_settled_intent_is_not_acted_on_twice(conn, clock, monkeypatch):
    """The whole idempotency claim: a relay redelivering the op that carried an
    intent must not buy a second turn."""
    calls = []
    monkeypatch.setattr("backend.jobs.enqueue",
                        lambda *a, **k: calls.append(1) or type("J", (), {"id": "j"})())
    monkeypatch.setattr("backend.jobs.JobStore", lambda: None)

    intent_id = arrive(conn, clock, "turn", {"conversation_id": "conv-1", "text": "hello"})
    intents.dispatch(conn, clock)
    assert len(calls) == 1

    # The same op again -- which is what a sync that failed to acknowledge does.
    ops.apply_op(conn, ops.Op(
        op_id=f"op-{intent_id}", device_id="phone", hlc=clock.tick(),
        entity="intents", key=intent_id,
        fields={"kind": "turn", "state": "pending"},
    ))
    intents.dispatch(conn, clock)
    assert len(calls) == 1, "a redelivered intent must not run a second turn"


def test_settling_tells_the_phone_what_happened(conn, clock):
    """Without an op back, the phone's copy stays at `pending` forever whatever
    actually happened."""
    intent_id = arrive(conn, clock, "turn", {"conversation_id": "nope", "text": "hi"})
    intents.dispatch(conn, clock)
    outgoing = [o for o in ops.pending(conn) if o.entity == "intents" and o.key == intent_id]
    assert outgoing, "the refusal was never published"
    assert outgoing[-1].fields["state"] == "refused"


# -- what the machine publishes ------------------------------------------

def test_the_transcript_is_published_for_a_control_device(conn, clock):
    conn.execute(
        "INSERT INTO messages (conversation_id, role, content)"
        " VALUES ('conv-1', 'user', 'what is left?'), ('conv-1', 'assistant', 'eggs')"
    )
    assert project.publish(conn, clock) >= 2
    published = [o for o in ops.pending(conn) if o.entity == "messages"]
    # Ordered by the explicit write order, not by `created_at`: both of these
    # were written in the same second, which is the ordinary case for a turn.
    in_order = sorted(published, key=lambda o: o.fields["seq"])
    assert [o.fields["content"] for o in in_order] == ["what is left?", "eggs"]
    assert [o.fields["content"] for o in published] == ["what is left?", "eggs"], \
        "the outbox must hand ops over in the order they were written"
    # Every message got a name that does not depend on insertion order.
    assert conn.execute("SELECT count(*) FROM messages WHERE uuid IS NULL").fetchone()[0] == 0


def test_a_turn_written_inside_one_second_keeps_its_order(conn, clock):
    """The bug this guards against was visible in the product and nowhere else:
    a question and its answer are written in the same second, `created_at` has
    second precision, and the tiebreak was a random uuid -- so the phone rendered
    the answer above the question about half the time. `seq` is the real order,
    carried explicitly rather than inferred."""
    for role, content in [("user", "q1"), ("assistant", "a1"), ("user", "q2"), ("assistant", "a2")]:
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at)"
            " VALUES ('conv-1', ?, ?, '2026-09-16 12:00:00')",
            (role, content),
        )
    project.publish(conn, clock)
    published = [o for o in ops.pending(conn) if o.entity == "messages"]

    assert [o.fields["content"] for o in published] == ["q1", "a1", "q2", "a2"]
    seqs = [o.fields["seq"] for o in published]
    assert seqs == sorted(seqs) and len(set(seqs)) == 4, "seq must be a strict order"
    assert len({o.fields["created_at"] for o in published}) == 1, \
        "the timestamps really are identical, which is the whole point"


def test_a_message_is_published_once(conn, clock):
    conn.execute("INSERT INTO messages (conversation_id, role, content) VALUES ('conv-1','user','hi')")
    project.publish(conn, clock)
    first = len([o for o in ops.pending(conn) if o.entity == "messages"])
    project.publish(conn, clock)
    assert len([o for o in ops.pending(conn) if o.entity == "messages"]) == first


def test_a_huge_tool_result_is_capped_rather_than_dropped(conn, clock):
    """The relay refuses an op over 64KB. Capping here means a phone sees the
    first part of a big result; not capping meant it saw nothing and no error."""
    conn.execute(
        "INSERT INTO messages (conversation_id, role, content) VALUES ('conv-1','tool',?)",
        ("x" * (MAX_SYNCED_CONTENT * 3),),
    )
    project.publish(conn, clock)
    published = [o for o in ops.pending(conn) if o.entity == "messages"][-1]
    assert len(published.fields["content"]) < MAX_SYNCED_CONTENT + 200
    assert "truncated" in published.fields["content"]


def test_conversations_are_published_so_the_phone_has_a_list(conn, clock):
    project.publish(conn, clock)
    published = [o for o in ops.pending(conn) if o.entity == "conversations"]
    assert published and published[0].fields["title"] == "Groceries"


def test_the_watermarks_are_not_synced(conn, clock):
    """They describe how far *this* device has published. Two devices agreeing
    on one would make each skip what the other had already sent."""
    from backend.sync import registry

    settings = registry.ENTITIES["settings"]
    for key in (project.MESSAGE_WATERMARK, project.CONVERSATION_WATERMARK, project.RUN_WATERMARK):
        assert not registry.syncable(settings, key)


def test_publishing_survives_a_conversation_with_no_messages(conn, clock):
    assert project.publish(conn, clock) >= 1


# -- the turn itself, end to end -----------------------------------------
#
# The director is stubbed, not the loop around it. What is asserted is
# everything a phone's behaviour actually depends on: that the turn runs, that
# what it wrote reaches the transcript, that the intent is settled so the phone
# stops showing it as queued, and that a failure is a failure rather than a
# silently finished job.


class FakeEvent:
    def __init__(self, type_, data=None):
        self.type = type_
        self.data = data or {}


class FakeDirector:
    """Writes to the transcript like the real one, and answers instantly."""

    def __init__(self, conn, reply="Added oat milk.", fail=None):
        self.conn = conn
        self.reply = reply
        self.fail = fail
        self.asked = []

    async def run(self, conversation_id, text):
        self.asked.append((conversation_id, text))
        if self.fail:
            yield FakeEvent("error", {"message": self.fail})
            return
        self.conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)",
            (conversation_id, "user", text),
        )
        self.conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)",
            (conversation_id, "assistant", self.reply),
        )
        self.conn.commit()
        yield FakeEvent("assistant_text", {"text": self.reply})


class FakeJob:
    def __init__(self, payload):
        self.payload = payload
        self.id = "job-1"


@pytest.fixture
def wired(conn, clock, monkeypatch):
    """The handler, pointed at this test's database and a stub director."""
    import backend.api.main as main
    from backend.db import connection

    monkeypatch.setattr(connection, "get_connection", lambda: conn)
    monkeypatch.setattr("backend.db.connection.get_connection", lambda: conn)
    monkeypatch.setattr("backend.sync.service.get_connection", lambda: conn)
    monkeypatch.setattr("backend.sync.service.clock", lambda c=None: clock)
    return main


@pytest.mark.asyncio
async def test_a_remote_turn_writes_the_transcript_and_settles_the_intent(wired, conn, clock, monkeypatch):
    conn.execute(
        "INSERT INTO sync_intents (id, device_id, kind, payload, state)"
        " VALUES ('i1','phone','turn','{}','accepted')"
    )
    director = FakeDirector(conn)
    monkeypatch.setattr(wired, "_remote_director_for", lambda: director)

    result = await wired._run_remote_turn(
        FakeJob({"conversation_id": "conv-1", "text": "add oat milk", "intent_id": "i1"}), None
    )

    assert director.asked == [("conv-1", "add oat milk")]
    assert result["characters"] > 0

    rows = conn.execute(
        "SELECT role, content FROM messages WHERE conversation_id='conv-1' ORDER BY id"
    ).fetchall()
    assert [tuple(r) for r in rows] == [("user", "add oat milk"), ("assistant", "Added oat milk.")]

    # The phone stops showing it as queued only because of this.
    assert conn.execute("SELECT state FROM sync_intents WHERE id='i1'").fetchone()[0] == "done"


@pytest.mark.asyncio
async def test_what_the_turn_wrote_is_published_back_to_the_phone(wired, conn, clock, monkeypatch):
    """The whole round trip: the reply reaches the phone as transcript ops,
    without the agent loop knowing a phone exists."""
    conn.execute(
        "INSERT INTO sync_intents (id, device_id, kind, payload, state)"
        " VALUES ('i1','phone','turn','{}','accepted')"
    )
    monkeypatch.setattr(wired, "_remote_director_for", lambda: FakeDirector(conn))

    await wired._run_remote_turn(
        FakeJob({"conversation_id": "conv-1", "text": "add oat milk", "intent_id": "i1"}), None
    )
    project.publish(conn, clock)

    published = [o.fields["content"] for o in ops.pending(conn) if o.entity == "messages"]
    assert "Added oat milk." in published


@pytest.mark.asyncio
async def test_a_failed_turn_raises_so_the_job_layer_can_retry(wired, conn, monkeypatch):
    """An error event that returned normally would mark the job completed and
    leave the phone's intent stuck at accepted forever."""
    monkeypatch.setattr(wired, "_remote_director_for",
                        lambda: FakeDirector(conn, fail="no provider is configured"))
    with pytest.raises(RuntimeError, match="no provider"):
        await wired._run_remote_turn(
            FakeJob({"conversation_id": "conv-1", "text": "hi", "intent_id": "i1"}), None
        )


# -- revocation ----------------------------------------------------------


def test_revoking_a_device_refuses_what_it_had_already_asked_for(conn, clock):
    """Revoking a phone you no longer have, and letting its queued request run a
    minute later, would make the button a lie."""
    from backend.sync import devices

    device, _ = devices.register(conn, "phone")
    conn.execute(
        "INSERT INTO sync_intents (id, device_id, kind, payload)"
        " VALUES ('i1', ?, 'turn', '{}')", (device.id,),
    )
    devices.revoke(conn, device.id)
    state, note = state_of(conn, "i1")
    assert state == "refused" and "revoked" in note


def test_an_intent_that_arrives_after_revocation_is_refused(conn, clock):
    """It was sealed before the revocation, sat at the relay, and arrives after.
    The relay only learns about a revocation on the next config mirror, so the
    machine has to be the one that checks."""
    from backend.sync import devices

    device, _ = devices.register(conn, "phone")
    devices.revoke(conn, device.id)
    intent_id = arrive(conn, clock, "turn",
                       {"conversation_id": "conv-1", "text": "hi"}, device=device.id)
    intents.dispatch(conn, clock)
    assert state_of(conn, intent_id)[0] == "refused"


def test_a_live_device_is_still_served(conn, clock, monkeypatch):
    from backend.sync import devices

    monkeypatch.setattr("backend.jobs.enqueue", lambda *a, **k: type("J", (), {"id": "j"})())
    monkeypatch.setattr("backend.jobs.JobStore", lambda: None)
    device, _ = devices.register(conn, "phone")
    intent_id = arrive(conn, clock, "turn",
                       {"conversation_id": "conv-1", "text": "hi"}, device=device.id)
    intents.dispatch(conn, clock)
    assert state_of(conn, intent_id)[0] == "accepted"
