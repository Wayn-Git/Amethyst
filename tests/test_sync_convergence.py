"""The property the sync layer lives or dies by: devices that saw the same
changes agree, whatever order they saw them in.

Every other guarantee here is a means to this one. The HLC exists to make the
order total, the per-field stamps exist so unrelated edits do not fight, and
`sync_seen` exists so a redelivery is not a second edit. A test that only checked
"an op applies" would pass against a merge that silently diverges, which is the
failure mode that matters -- it is invisible until two devices have quietly
disagreed for a week.
"""

from __future__ import annotations

import itertools
import json
import random
import sqlite3
from pathlib import Path

import pytest

from backend.sync import crypto, hlc, ops

SCHEMA = Path(__file__).resolve().parents[1] / "backend" / "db" / "schema.sql"


def replica() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    return conn


def apply_all(conn, op_list):
    for op in op_list:
        ops.apply_op(conn, op)
    conn.commit()


def snapshot(conn, table, columns):
    order = columns[0]
    rows = conn.execute(
        f"SELECT {', '.join(columns)}, updated_hlc FROM {table} ORDER BY {order}"
    ).fetchall()
    return [tuple(r) for r in rows]


# -- the clock -----------------------------------------------------------

def test_stamps_rise_within_a_device():
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    stamps = [clock.tick() for _ in range(50)]
    assert stamps == sorted(stamps), "a frozen wall clock must still give a rising order"
    assert len(set(stamps)) == 50


def test_a_backwards_wall_clock_does_not_rewind_the_order():
    """NTP stepping the clock back mid-session is the case that breaks naive
    timestamps: the edit after the step would sort before the edit before it."""
    ticks = iter([5_000, 4_000, 3_000, 4_500, 6_000])
    clock = hlc.Clock("dev-a", now_ms=lambda: next(ticks))
    stamps = [clock.tick() for _ in range(5)]
    assert stamps == sorted(stamps)


def test_observing_a_future_stamp_carries_the_clock_forward():
    clock = hlc.Clock("dev-b", now_ms=lambda: 1_000)
    ahead = hlc.format_stamp(9_000_000, 0, "dev-a")
    assert clock.observe(ahead) > ahead, "an answer must sort after what it answers"


def test_the_order_is_total_and_device_id_is_what_makes_it_so():
    """Two devices stamping in the same millisecond with the same counter differ
    only by device id. Without that field they would compare equal and each
    device would keep whichever it happened to apply last -- diverging forever."""
    a = hlc.format_stamp(1_000, 0, "dev-a")
    b = hlc.format_stamp(1_000, 0, "dev-b")
    assert a != b and (a < b) != (b < a)
    assert hlc.wins(b, a) and not hlc.wins(a, b)
    assert not hlc.wins(a, a), "a tie must not rewrite, so replay is free"


def test_a_device_id_with_the_separator_is_refused():
    with pytest.raises(ValueError):
        hlc.Clock("dev:a")


# -- convergence ---------------------------------------------------------

def build_ops(seed: int, count: int = 40):
    """A plausible mess: several devices editing overlapping fields of
    overlapping rows, with clocks that do not agree."""
    rng = random.Random(seed)
    clocks = {
        name: hlc.Clock(name, now_ms=lambda o=offset: 1_000 + o)
        for name, offset in (("dev-a", 0), ("dev-b", 7), ("dev-c", -5))
    }
    keys = ["ui.theme", "ui.defaultEffort", "ui.sendWith"]
    out = []
    for i in range(count):
        clock = clocks[rng.choice(list(clocks))]
        out.append(ops.Op(
            op_id=f"op-{seed}-{i}",
            device_id=clock.device_id,
            hlc=clock.tick(),
            entity="settings",
            key=rng.choice(keys),
            fields={"value": f"{clock.device_id}-{i}"},
        ))
    return out


@pytest.mark.parametrize("seed", range(25))
def test_replicas_converge_whatever_order_ops_arrive_in(seed):
    made = build_ops(seed)
    first, second = replica(), replica()
    apply_all(first, made)

    shuffled = made[:]
    random.Random(seed + 9_000).shuffle(shuffled)
    apply_all(second, shuffled)

    assert snapshot(first, "app_settings", ["key", "value"]) == \
           snapshot(second, "app_settings", ["key", "value"])


def test_convergence_holds_for_every_permutation_of_a_small_set():
    """The parametrised test samples orderings; this one exhausts them, which is
    what catches a merge that is order-dependent only in a rare interleaving."""
    made = build_ops(seed=99, count=5)
    expected = None
    for ordering in itertools.permutations(made):
        conn = replica()
        apply_all(conn, list(ordering))
        got = snapshot(conn, "app_settings", ["key", "value"])
        expected = got if expected is None else expected
        assert got == expected


def test_applying_the_same_ops_twice_changes_nothing():
    made = build_ops(seed=3)
    conn = replica()
    apply_all(conn, made)
    once = snapshot(conn, "app_settings", ["key", "value"])
    apply_all(conn, made)
    assert snapshot(conn, "app_settings", ["key", "value"]) == once


def test_a_redelivered_op_is_refused_by_the_ledger():
    conn = replica()
    op = build_ops(seed=1, count=1)[0]
    assert ops.apply_op(conn, op) is True
    assert ops.apply_op(conn, op) is False


def test_concurrent_edits_to_different_fields_both_survive():
    """The reason stamps are per field rather than per row. A single row stamp
    would make the later of these two writes erase the other."""
    conn = replica()
    conn.execute("INSERT INTO tasks (id, uuid, title) VALUES (1, 'task-1', 'original')")
    phone = hlc.Clock("phone", now_ms=lambda: 1_000)
    laptop = hlc.Clock("laptop", now_ms=lambda: 1_000)

    ops.apply_op(conn, ops.Op("op-1", "phone", phone.tick(), "tasks", "task-1",
                              {"due_at": "2026-01-01"}))
    ops.apply_op(conn, ops.Op("op-2", "laptop", laptop.tick(), "tasks", "task-1",
                              {"title": "renamed on the laptop"}))
    conn.commit()

    title, due = conn.execute("SELECT title, due_at FROM tasks WHERE uuid='task-1'").fetchone()
    assert title == "renamed on the laptop"
    assert due == "2026-01-01"


def test_a_stale_op_does_not_overwrite_a_newer_field():
    conn = replica()
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    early, late = clock.tick(), clock.tick()
    ops.apply_op(conn, ops.Op("op-late", "dev-a", late, "settings", "ui.theme", {"value": "ink"}))
    ops.apply_op(conn, ops.Op("op-early", "dev-a", early, "settings", "ui.theme", {"value": "paper"}))
    conn.commit()
    assert conn.execute("SELECT value FROM app_settings WHERE key='ui.theme'").fetchone()[0] == "ink"


# -- the allowlist -------------------------------------------------------

def test_a_column_outside_the_registry_is_not_written():
    """The allowlist runs on receive, not only on send, so a tampered device
    cannot reach a column this one never agreed to sync."""
    conn = replica()
    conn.execute("INSERT INTO tasks (id, uuid, title) VALUES (1, 'task-1', 'original')")
    clock = hlc.Clock("evil", now_ms=lambda: 1_000)
    ops.apply_op(conn, ops.Op("op-x", "evil", clock.tick(), "tasks", "task-1",
                              {"external_id": "injected", "title": "fine"}))
    conn.commit()
    title, external = conn.execute(
        "SELECT title, external_id FROM tasks WHERE uuid='task-1'").fetchone()
    assert title == "fine"
    assert external is None


def test_an_internal_setting_cannot_be_written_by_an_op():
    """`app_settings` holds the embedding model this database was indexed with
    next to the user's theme. An op that could reach the former would invalidate
    the vector index from another device."""
    conn = replica()
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    assert ops.apply_op(conn, ops.Op("op-e", "dev-a", clock.tick(), "settings",
                                     "memory_embedding_model", {"value": "junk"})) is False
    conn.commit()
    assert conn.execute(
        "SELECT value FROM app_settings WHERE key='memory_embedding_model'").fetchone() is None


def test_an_internal_setting_is_never_emitted():
    conn = replica()
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('sync.device_id', 'dev-a')")
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    assert ops.emit(conn, clock, "settings", "sync.device_id", {"value": "dev-a"}) is None
    assert ops.pending(conn) == []


def test_an_allowlisted_preference_does_cross():
    conn = replica()
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    assert ops.apply_op(conn, ops.Op("op-t", "dev-a", clock.tick(), "settings",
                                     "ui.theme", {"value": "nocturne"})) is True
    conn.commit()
    assert conn.execute(
        "SELECT value FROM app_settings WHERE key='ui.theme'").fetchone()[0] == "nocturne"


def test_an_unknown_entity_is_ignored_rather_than_fatal():
    """Forward compatibility: a device on a newer version will sync tables this
    one has never heard of, and that must not stop the poll."""
    conn = replica()
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    assert ops.apply_op(conn, ops.Op("op-f", "dev-a", clock.tick(),
                                     "something_from_the_future", "k", {"a": 1})) is False


# -- emitting ------------------------------------------------------------

def test_emit_records_an_op_and_stamps_the_row():
    conn = replica()
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('ui.theme', 'ink')")
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    op = ops.emit(conn, clock, "settings", "ui.theme", {"value": "ink"})
    conn.commit()
    assert op is not None and op.fields == {"value": "ink"}
    stamps = json.loads(conn.execute(
        "SELECT updated_hlc FROM app_settings WHERE key='ui.theme'").fetchone()[0])
    assert stamps["value"] == op.hlc
    assert [o.op_id for o in ops.pending(conn)] == [op.op_id]
    assert ops.forget(conn, [op.op_id]) == 1
    assert ops.pending(conn) == []


def test_emit_ignores_a_change_to_nothing_synced():
    conn = replica()
    conn.execute("INSERT INTO tasks (id, uuid, title) VALUES (1, 't', 'x')")
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    assert ops.emit(conn, clock, "tasks", "t", {"external_etag": "abc"}) is None
    assert ops.emit(conn, clock, "not_an_entity", "t", {"title": "x"}) is None


def test_stable_key_is_minted_once_and_reused():
    conn = replica()
    conn.execute("INSERT INTO tasks (id, title) VALUES (1, 'x')")
    first = ops.stable_key(conn, "tasks", 1)
    assert first and ops.stable_key(conn, "tasks", 1) == first


def test_a_round_trip_through_the_relay_envelope_survives():
    """An op is sealed on the way out and opened on the way in; what comes back
    has to be the same op, or convergence is comparing different things."""
    clock = hlc.Clock("dev-a", now_ms=lambda: 1_000)
    op = ops.Op("op-1", "dev-a", clock.tick(), "settings", "ui.theme", {"value": "ink"})
    key = crypto.AESGCM.generate_key(bit_length=256)
    nonce, ct = crypto.seal(op.to_payload(), op_id=op.op_id, device_id=op.device_id, key=key)
    opened = crypto.unseal(nonce, ct, op_id=op.op_id, device_id=op.device_id, key=key)
    assert ops.Op.from_payload(op.op_id, op.device_id, opened) == op
