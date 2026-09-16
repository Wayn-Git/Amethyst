"""Emitting a local change, and merging one that arrived.

The whole merge model is here, and it is deliberately small. Every synced row
carries a JSON map of per-field HLC stamps; an incoming op carries a stamp and
the fields it claims; a field is overwritten only if the op's stamp beats the
stamp already recorded for *that field*. Nothing else. There is no CRDT library
underneath because there is nothing here a CRDT library would do better:

  - Fields are independent, so concurrent edits to different fields both
    survive without any merge logic at all.
  - Concurrent edits to the *same* field are a genuine conflict, and no
    algorithm can divine which the user meant. What matters is that every
    device picks the same one, which the HLC's total order guarantees.
  - The rows that would justify a real CRDT -- a shared text buffer, an
    ordered list two people reorder at once -- do not exist in this product.
    A transcript is append-only and single-writer.

Deletion is not an operation. It is a field: `memories.superseded_at`,
`conversations.archived`, `devices.revoked_at`. The schema already worked this
way before sync existed ("facts are superseded rather than deleted, so 'what did
AMETHYST believe last week' stays answerable"), and a tombstone that is an
ordinary LWW field needs no special case in the merge, no separate tombstone
table, and no garbage collection deadline.

Applying an op is idempotent three times over: `sync_seen` refuses the second
delivery, the stamp comparison refuses a rewrite on a tie, and the write itself
is the same bytes. Any one of the three would do; the belt-and-braces is the
house style, and it is why an op can be retried without anybody reasoning about
whether it is safe to.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass, field as _field

from backend.sync import hlc, registry

log = logging.getLogger(__name__)

#: How long an applied op id is remembered. Long enough that no in-flight op can
#: outlive it -- the relay prunes at eight days -- and short enough that the
#: table stays small forever.
SEEN_RETENTION_DAYS = 30


@dataclass(frozen=True)
class Op:
    """One change to one row, as it travels."""

    op_id: str
    device_id: str
    hlc: str
    entity: str
    key: str
    fields: dict = _field(default_factory=dict)

    def to_payload(self) -> dict:
        """What gets sealed. `op_id` and `device_id` are left out: they travel in
        the clear on the envelope so the relay can dedup and route, and the AEAD
        binds the ciphertext to them, so repeating them inside would be two
        copies of one fact with no way to say which is authoritative."""
        return {"hlc": self.hlc, "entity": self.entity, "key": self.key, "fields": self.fields}

    @classmethod
    def from_payload(cls, op_id: str, device_id: str, payload: dict) -> "Op":
        missing = {"hlc", "entity", "key"} - payload.keys()
        if missing:
            raise ValueError(f"an op payload is missing {sorted(missing)}")
        fields = payload.get("fields") or {}
        if not isinstance(fields, dict):
            raise ValueError("an op's fields must be an object")
        hlc.parse(payload["hlc"])  # raises if it is not a stamp
        return cls(
            op_id=op_id,
            device_id=device_id,
            hlc=str(payload["hlc"]),
            entity=str(payload["entity"]),
            key=str(payload["key"]),
            fields=fields,
        )


def _placeholder_columns(conn: sqlite3.Connection, table: str) -> dict[str, object]:
    """Values for the NOT NULL columns an incoming op does not carry.

    An op can arrive before the op that created the row it edits -- different
    devices, different poll windows -- and the row has to be materialisable
    anyway, or that edit is lost and the two devices never converge. So the row
    is created with empty placeholders and the fields fill in as their ops
    arrive, in whatever order they arrive, because each carries its own stamp.

    A placeholder is always overwritten by the real value: it is written with no
    stamp at all, and `wins` gives an unstamped field to the first op that claims
    it. The row is briefly half-built, never permanently wrong.
    """
    blanks: dict[str, object] = {}
    for _, name, column_type, not_null, default, is_pk in conn.execute(
        f"PRAGMA table_info({table})"
    ):
        if not not_null or default is not None or is_pk:
            continue
        blanks[name] = 0 if column_type.upper() in ("INTEGER", "REAL") else ""
    return blanks


def _stamps(raw) -> dict[str, str]:
    if not raw:
        return {}
    try:
        loaded = json.loads(raw)
    except ValueError:
        # A corrupt map loses to everything, which re-syncs the row rather than
        # wedging it. Losing a stamp costs one redundant write; refusing to
        # parse would cost the row.
        log.warning("unreadable stamp map; treating the row as unwritten")
        return {}
    return loaded if isinstance(loaded, dict) else {}


# -- emitting ------------------------------------------------------------

def emit(conn: sqlite3.Connection, clock: hlc.Clock, entity_name: str, key: str,
         fields: dict) -> Op | None:
    """Record a local change for sending, and stamp the row it changed.

    Called after the ordinary write, not instead of it -- the repositories stay
    the only code that knows how to write their own tables. Returns None when
    the entity is not synced or the change touches nothing synced, so callers
    can emit unconditionally rather than each deciding what crosses.
    """
    entity = registry.get(entity_name)
    if entity is None:
        return None
    if not registry.syncable(entity, key):
        return None
    crossing = {k: v for k, v in fields.items() if k in entity.fields}
    if not crossing:
        return None

    stamp = clock.tick()
    row = conn.execute(
        f"SELECT {entity.stamp_column} FROM {entity.table} WHERE {entity.key_column} = ?",
        (key,),
    ).fetchone()
    stamps = _stamps(row[0]) if row else {}
    stamps.update({name: stamp for name in crossing})
    if row is not None:
        conn.execute(
            f"UPDATE {entity.table} SET {entity.stamp_column} = ? WHERE {entity.key_column} = ?",
            (json.dumps(stamps, sort_keys=True), key),
        )

    op = Op(op_id=str(uuid.uuid4()), device_id=clock.device_id, hlc=stamp,
            entity=entity.name, key=key, fields=crossing)
    conn.execute(
        "INSERT INTO sync_ops (op_id, entity, entity_key, hlc, payload) VALUES (?,?,?,?,?)",
        (op.op_id, op.entity, op.key, op.hlc, json.dumps(op.to_payload(), sort_keys=True)),
    )
    return op


def stable_key(conn: sqlite3.Connection, entity_name: str, row_id) -> str | None:
    """The identity an op addresses, minting it if this row has never had one.

    Only `tasks` and `memories` need this: their primary key is an
    autoincrementing integer, which names a row on *this* machine and nothing
    anywhere else. Backfilled here, on first sync, so a database nobody syncs
    never pays for a column it does not use.
    """
    entity = registry.get(entity_name)
    if entity is None:
        return None
    if entity.key_column != "uuid":
        return str(row_id)
    row = conn.execute(
        f"SELECT uuid FROM {entity.table} WHERE id = ?", (row_id,)
    ).fetchone()
    if row is None:
        return None
    if row[0]:
        return row[0]
    minted = str(uuid.uuid4())
    conn.execute(f"UPDATE {entity.table} SET uuid = ? WHERE id = ?", (minted, row_id))
    return minted


# -- receiving -----------------------------------------------------------

def apply_op(conn: sqlite3.Connection, op: Op, clock: hlc.Clock | None = None) -> bool:
    """Merge one op. Returns whether it changed anything.

    The caller wraps this in a transaction together with the `sync_seen` write,
    so an op is never applied without being recorded as applied.
    """
    seen = conn.execute(
        "INSERT OR IGNORE INTO sync_seen (op_id) VALUES (?)", (op.op_id,)
    ).rowcount
    if not seen:
        return False  # a duplicate delivery, which costs nothing

    if clock is not None:
        clock.observe(op.hlc)

    entity = registry.get(op.entity)
    if entity is None:
        # A device running a newer version syncing a table this one has never
        # heard of. Recorded as seen and dropped, so an upgrade does not replay
        # months of ops -- and deliberately not an error: refusing to start
        # because a phone knows a word we do not is worse than ignoring it.
        log.debug("ignoring an op for the unknown entity %r", op.entity)
        return False

    # The allowlist applies on the way in as well as the way out. A device that
    # has been tampered with cannot write a column this one does not sync.
    if not registry.syncable(entity, op.key):
        log.debug("refusing an op for %s row %r, which is not on the allowlist",
                  entity.name, op.key)
        return False
    claimed = {k: v for k, v in op.fields.items() if k in entity.fields}
    if not claimed:
        return False

    row = conn.execute(
        f"SELECT {entity.stamp_column} FROM {entity.table} WHERE {entity.key_column} = ?",
        (op.key,),
    ).fetchone()

    if row is None:
        if not entity.insertable:
            # Single-writer entities. The host that owns the run emits its create
            # before its updates and the outbox preserves that order, so a
            # missing row here means the run belongs to a conversation this
            # device has not been told about -- not an ordering accident.
            log.debug("no %s row for %r and the entity is not insertable", entity.table, op.key)
            return False
        blanks = _placeholder_columns(conn, entity.table)
        blanks.pop(entity.key_column, None)
        blanks.update({name: value for name, value in claimed.items() if name in blanks})
        columns = [entity.key_column, *blanks]
        try:
            conn.execute(
                f"INSERT INTO {entity.table} ({', '.join(columns)})"
                f" VALUES ({', '.join('?' * len(columns))})",
                (op.key, *blanks.values()),
            )
        except sqlite3.IntegrityError as exc:
            # A constraint the placeholder cannot satisfy -- a foreign key to a
            # row this device has not received yet, most likely. Dropping the op
            # is the honest outcome: there is nothing to attach it to.
            log.warning("could not materialise %s %r: %s", entity.table, op.key, exc)
            return False
        stamps: dict[str, str] = {}
    else:
        stamps = _stamps(row[0])

    winning = {name: value for name, value in claimed.items()
               if hlc.wins(op.hlc, stamps.get(name))}
    if not winning:
        return False  # every field here was overwritten by something later

    stamps.update({name: op.hlc for name in winning})
    assignments = ", ".join(f"{name} = ?" for name in winning)
    conn.execute(
        f"UPDATE {entity.table} SET {assignments}, {entity.stamp_column} = ?"
        f" WHERE {entity.key_column} = ?",
        (*winning.values(), json.dumps(stamps, sort_keys=True), op.key),
    )
    return True


# -- the outbox ----------------------------------------------------------

def pending(conn: sqlite3.Connection, limit: int = 100) -> list[Op]:
    # By rowid, which is insertion order, rather than by `created_at` -- that is
    # second-precision, a turn fills the outbox with several ops inside one
    # second, and the tiebreak was a random op id. The entities that are
    # created-then-updated by one device (`agent_runs`, `subagent_sessions`)
    # depend on this order being the order they were written in; with the old
    # one their update could be sent before their create and be dropped.
    rows = conn.execute(
        "SELECT op_id, payload FROM sync_ops ORDER BY rowid LIMIT ?", (limit,)
    ).fetchall()
    out = []
    for op_id, payload in rows:
        try:
            out.append(Op.from_payload(op_id, "", json.loads(payload)))
        except ValueError as exc:
            log.error("dropping an unreadable outbox op %s: %s", op_id, exc)
            conn.execute("DELETE FROM sync_ops WHERE op_id = ?", (op_id,))
    return out


def forget(conn: sqlite3.Connection, op_ids) -> int:
    """Drop ops the relay has taken. Called late, on the poll *after* the one
    that handed them over, for the reason `RelayPoller` already gives: an op
    dropped before the handover is confirmed is one a failed sync loses."""
    ids = list(op_ids)
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    return conn.execute(f"DELETE FROM sync_ops WHERE op_id IN ({marks})", ids).rowcount


def prune(conn: sqlite3.Connection, days: int = SEEN_RETENTION_DAYS) -> int:
    return conn.execute(
        "DELETE FROM sync_seen WHERE applied_at < datetime('now', ?)", (f"-{days} days",)
    ).rowcount
