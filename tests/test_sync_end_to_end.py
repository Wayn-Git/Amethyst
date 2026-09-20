"""Two devices, one relay, and the claim that going offline costs nothing.

The unit tests prove the merge converges when handed a set of ops. This proves
the thing a user would actually notice: that two machines editing the same
settings while disconnected end up agreeing once they can talk again, and that
neither of them stops working while they cannot.

The relay here is a dozen lines rather than the real Worker, and deliberately
so -- `relay/test/ops.test.ts` drives the real one against the real schema. What
is being exercised on this side is the whole Python chain: emit into the outbox,
seal, hand over, fan out, open, merge. The mailbox in between only has to keep
the contract the Worker keeps, which is why it is written from the same three
rules rather than from what would make these tests pass.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend.sync import crypto, devices, ops, service

SCHEMA = Path(__file__).resolve().parents[1] / "backend" / "db" / "schema.sql"


class Mailbox:
    """The relay, reduced to the three rules `src/ops.ts` actually implements:
    a duplicate op id writes nothing, a device is never handed its own op, and a
    row lives until every other device has taken it."""

    def __init__(self, *device_ids: str):
        self.devices = list(device_ids)
        self.rows: dict[str, dict] = {}
        self.acks: set[tuple[str, str]] = set()

    def post(self, uploaded, from_device):
        stored = 0
        for op in uploaded:
            if op["op_id"] in self.rows:
                continue  # INSERT OR IGNORE
            self.rows[op["op_id"]] = {**op, "from_device": from_device}
            stored += 1
        return stored

    def take(self, device_id):
        return [
            row for op_id, row in self.rows.items()
            if row["from_device"] != device_id and (op_id, device_id) not in self.acks
        ]

    def ack(self, device_id, op_ids):
        for op_id in op_ids:
            self.acks.add((op_id, device_id))
        for op_id in list(self.rows):
            owed = [d for d in self.devices if d != self.rows[op_id]["from_device"]]
            if all((op_id, d) in self.acks for d in owed):
                del self.rows[op_id]


class Device:
    """One machine: its own database, its own device id, its own clock."""

    def __init__(self, name: str):
        self.name = name
        self.conn = sqlite3.connect(":memory:")
        self.conn.executescript(SCHEMA.read_text())
        self.id = devices.local_id(self.conn, name=name)
        self.conn.commit()
        self.sent: list[dict] = []
        self.pending_ack: list[str] = []

    def set(self, key: str, value: str) -> None:
        """A local write, exactly as a repository would make it: the ordinary
        write first, then the op that records it."""
        self.conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        ops.emit(self.conn, service.clock(self.conn), "settings", key, {"value": value})
        self.conn.commit()

    def get(self, key: str):
        row = self.conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
        return row[0] if row else None

    def sync(self, mailbox: Mailbox) -> int:
        """One round trip, with the poller's late-acknowledgement discipline:
        what was taken last time is acknowledged now, not when it was taken."""
        outgoing = service.outgoing(self.conn)
        ack, self.pending_ack = self.pending_ack, []

        stored = mailbox.post(outgoing, self.id)
        mailbox.ack(self.id, ack)

        if outgoing and stored is not None:
            ops.forget(self.conn, [op["op_id"] for op in outgoing])

        applied, acks = service.incoming({"ops": mailbox.take(self.id)}, self.conn)
        self.pending_ack.extend(acks)
        self.conn.commit()
        return applied


@pytest.fixture(autouse=True)
def _shared_group_key(monkeypatch):
    """Both devices are paired, so both hold the group key. The keychain is
    stubbed: a test must not write to the user's real one."""
    store = {}
    monkeypatch.setattr(crypto, "get_secret", lambda ref: store.get(ref))
    monkeypatch.setattr(crypto, "set_secret", lambda ref, v: store.__setitem__(ref, v))
    crypto.create_group_key()
    service.reset_clock()
    yield
    service.reset_clock()


@pytest.fixture
def pair():
    """Two machines that have actually paired with each other.

    Each registers the other, which the harness did not used to bother with
    because nothing read it. `service.outgoing` does now: a machine with no
    peers has nobody to publish to and does not, which is what stops one with
    every device revoked uploading ~7,700 ops a day into a relay where nothing
    will ever collect them. Registering here is not scaffolding for that check
    -- it is what being paired means, and the fixture is named for it.
    """
    laptop, phone = Device("laptop"), Device("phone")
    devices.register(laptop.conn, name="phone", role="control")
    devices.register(phone.conn, name="laptop", role="host")
    laptop.conn.commit()
    phone.conn.commit()
    yield laptop, phone, Mailbox(laptop.id, phone.id)


# -- the everyday case ---------------------------------------------------

def test_a_change_on_one_device_reaches_the_other(pair):
    laptop, phone, mailbox = pair
    laptop.set("ui.theme", "nocturne")
    laptop.sync(mailbox)

    assert phone.sync(mailbox) == 1
    assert phone.get("ui.theme") == "nocturne"


def test_a_device_does_not_receive_its_own_change(pair):
    laptop, _, mailbox = pair
    laptop.set("ui.theme", "ink")
    laptop.sync(mailbox)
    assert laptop.sync(mailbox) == 0


def test_the_relay_holds_nothing_once_everybody_has_it(pair):
    """The queue-not-a-store property. Two polls each: one to take, one to
    acknowledge, because acknowledgement is deliberately late."""
    laptop, phone, mailbox = pair
    laptop.set("ui.theme", "paper")
    laptop.sync(mailbox)
    phone.sync(mailbox)
    phone.sync(mailbox)
    assert mailbox.rows == {}


# -- the case the whole design exists for --------------------------------

def test_edits_made_while_disconnected_merge_on_reconnect(pair):
    """Both devices work with the relay unreachable, then agree afterwards."""
    laptop, phone, mailbox = pair

    # The relay is gone. Neither device is told, and neither stops working.
    laptop.set("ui.theme", "nocturne")
    laptop.set("ui.sendWith", "mod+enter")
    phone.set("ui.defaultEffort", "low")

    assert laptop.get("ui.theme") == "nocturne"
    assert phone.get("ui.defaultEffort") == "low"

    # It comes back. Two rounds: one to exchange, one to settle the late acks.
    for _ in range(2):
        laptop.sync(mailbox)
        phone.sync(mailbox)

    for device in (laptop, phone):
        assert device.get("ui.theme") == "nocturne"
        assert device.get("ui.sendWith") == "mod+enter"
        assert device.get("ui.defaultEffort") == "low"


def test_the_same_setting_changed_on_both_settles_the_same_way(pair):
    """A genuine conflict. No algorithm can know which the user meant; what
    matters is that both devices pick the same one and neither keeps a value the
    other has never heard of."""
    laptop, phone, mailbox = pair
    laptop.set("ui.theme", "ink")
    phone.set("ui.theme", "paper")

    for _ in range(2):
        laptop.sync(mailbox)
        phone.sync(mailbox)

    assert laptop.get("ui.theme") == phone.get("ui.theme")
    assert laptop.get("ui.theme") in ("ink", "paper")


def test_a_sync_that_fails_loses_nothing(pair):
    """The relay refuses mid-poll. The op must still be in the outbox, because
    nothing was confirmed -- this is what the late acknowledgement buys."""
    laptop, phone, mailbox = pair
    laptop.set("ui.theme", "nocturne")

    class Broken(Mailbox):
        def post(self, uploaded, from_device):
            raise ConnectionError("the relay is unreachable")

    with pytest.raises(ConnectionError):
        laptop.sync(Broken(laptop.id, phone.id))

    assert len(ops.pending(laptop.conn)) == 1, "the change is still owed"
    laptop.sync(mailbox)
    phone.sync(mailbox)
    assert phone.get("ui.theme") == "nocturne"


def test_a_redelivered_batch_changes_nothing(pair):
    """The relay re-offering what it already handed over is the normal outcome
    of a sync that applied and then failed to acknowledge."""
    laptop, phone, mailbox = pair
    laptop.set("ui.theme", "nocturne")
    laptop.sync(mailbox)

    assert phone.sync(mailbox) == 1
    phone.pending_ack.clear()          # the acknowledgement never arrived
    assert phone.sync(mailbox) == 0, "the second delivery must be free"
    assert phone.get("ui.theme") == "nocturne"


def test_a_device_that_has_been_away_catches_up_in_one_poll(pair):
    laptop, phone, mailbox = pair
    for value in ("ink", "paper", "nocturne"):
        laptop.set("ui.theme", value)
        laptop.sync(mailbox)

    assert phone.sync(mailbox) == 3
    assert phone.get("ui.theme") == "nocturne", "the last write is the one that stands"


# -- what must not cross -------------------------------------------------

def test_an_internal_setting_never_leaves_the_machine(pair):
    laptop, phone, mailbox = pair
    laptop.conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('memory_embedding_model', 'nomic')"
    )
    ops.emit(laptop.conn, service.clock(laptop.conn), "settings",
             "memory_embedding_model", {"value": "nomic"})
    laptop.conn.commit()

    laptop.sync(mailbox)
    phone.sync(mailbox)
    assert phone.get("memory_embedding_model") is None


def test_the_relay_carries_nothing_it_can_read(pair):
    """The privacy claim, asserted rather than described: the user's chosen
    theme must not appear anywhere in what the mailbox holds."""
    laptop, _, mailbox = pair
    laptop.set("ui.theme", "nocturne")
    laptop.sync(mailbox)

    carried = repr(mailbox.rows)
    assert "nocturne" not in carried
    assert "ui.theme" not in carried
    assert "settings" not in carried


def test_a_device_without_the_group_key_can_read_nothing(pair):
    """A relay that leaked its whole table to a third party leaks ciphertext."""
    laptop, _, mailbox = pair
    laptop.set("ui.theme", "nocturne")
    laptop.sync(mailbox)

    outsider = Device("outsider")
    row = next(iter(mailbox.rows.values()))
    with pytest.raises(crypto.SealError):
        crypto.unseal(row["nonce"], row["ciphertext"], op_id=row["op_id"],
                      device_id=row["from_device"], key=crypto.AESGCM.generate_key(bit_length=256))
    assert outsider.get("ui.theme") is None
