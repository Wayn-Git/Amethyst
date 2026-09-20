"""Which tables cross devices, and what "merge" means for each.

A registry rather than a switch statement, for the same reason
`relay/src/jobs/registry.ts` is one: adding a capability should be a declaration,
not an edit to the machinery that runs it. A new synced table is one entry here
and nothing else -- the op format, the wire protocol and the poller never learn
its name.

One merge rule, and the fact that there is only one is the point. Every entry
below is per-*field* last-write-wins ordered by an HLC stamp -- per field, not
per row, so a phone changing a task's due date and a laptop changing its title
both survive, where a whole-row write would silently drop one.

Two things are deliberately absent. Append-only data needs no entry here at all:
`memories` supersedes rather than deletes and `messages` are immutable, so two
devices holding such a row hold the same bytes and the schema is already doing
the merging. And device-specific state -- panel width, which conversation is
open -- is not a conflict to resolve, it is a setting that should differ.

`fields` is an allowlist, never `SELECT *`. A column added later does not start
crossing the network because somebody forgot this file existed, and a credential
column cannot leak into an op by default.
"""

from __future__ import annotations

from dataclasses import dataclass

@dataclass(frozen=True)
class Entity:
    """One synced table."""

    #: The name that travels in an op. Stable forever once shipped -- renaming
    #: it strands every op already in flight at the relay.
    name: str
    table: str
    #: The column holding the row identity an op addresses. Must be stable
    #: across devices: a TEXT id the host minted, or a natural key.
    key_column: str
    #: Exactly the columns that may cross. Everything else stays home.
    fields: tuple[str, ...]
    #: For key-value tables, exactly which rows may cross. `app_settings` holds
    #: the embedding model this database was indexed with and this device's own
    #: sync identity alongside the user's preferences; syncing the first would
    #: invalidate a vector index and syncing the second would give two devices
    #: one name. None means every row of the table is eligible.
    keys: tuple[str, ...] | None = None
    #: Where the winning stamp is recorded -- one column per row, holding the
    #: stamp of the most recent write to any field of it.
    stamp_column: str = "updated_hlc"
    #: A row this device may write when an op arrives for a key it has never
    #: seen. False for tables where a row has to be minted by the host with
    #: side effects the sync layer cannot reproduce.
    insertable: bool = True


#: Preferences the user means to be the same everywhere. Deliberately an
#: allowlist: `panelWidth`, `sidebar`, `textSize`, `activeId` and `workspace` are
#: per-device and are absent on purpose -- syncing a phone's text size onto a
#: desktop is a bug, not a feature.
#: Namespaced `ui.` so they cannot collide with a backend setting, and so the
#: allowlist below is a prefix a reader can scan rather than a list of bare words
#: that could be anything.
SYNCED_PREFERENCES = (
    "theme",
    "accentColor",
    "defaultGuard",
    "defaultEffort",
    "sendWith",
    "archiveChats",
    "confirmDestructive",
    "shellConfirm",
    "fileConfirm",
    "netConfirm",
    "showUsage",
    "notifyOnDone",
    "draftProvider",
    "draftModel",
)

ENTITIES: dict[str, Entity] = {}


def register(entity: Entity) -> Entity:
    if entity.name in ENTITIES:
        raise ValueError(f"{entity.name} is registered twice")
    if not entity.stamp_column:
        raise ValueError(f"{entity.name} names no stamp column")
    if entity.stamp_column in entity.fields:
        raise ValueError(f"{entity.name} syncs its own stamp column as a field")
    ENTITIES[entity.name] = entity
    return entity


def syncable(entity: Entity, key: str) -> bool:
    """Whether this row of this entity is allowed to cross. Checked on the way
    out *and* on the way in, so a device that has been tampered with cannot
    write a row this one never agreed to sync."""
    return entity.keys is None or key in entity.keys


def get(name: str) -> Entity | None:
    """The entity an op names, or None -- which is how a device running an
    older version ignores an op for a table it has never heard of instead of
    crashing on it. Forward compatibility is the reason ops are refused quietly."""
    return ENTITIES.get(name)


# -- the entities -------------------------------------------------------

#: Settings. A key-value table, so one op per setting and the key *is* the row.
#: This is the one genuinely concurrent case in the product: the same setting
#: really can be changed on a phone and a laptop inside the same poll window.
register(Entity(
    name="settings",
    table="app_settings",
    key_column="key",
    fields=("value",),
    keys=tuple(f"ui.{name}" for name in SYNCED_PREFERENCES),
))

#: Standing facts. Append-only already -- `superseded_at` is a tombstone, not a
#: delete -- which makes this a 2P-Set the schema happened to implement before
#: anyone called it that. Merge is union, and the only LWW field is the tombstone.
register(Entity(
    name="memories",
    table="memories",
    key_column="uuid",
    fields=("fact", "conversation_id", "superseded_at"),
))

#: What a conversation is called and where it sits. The transcript itself is not
#: here: messages are immutable and large, and a phone gets them by asking the
#: host for the ones it is actually looking at.
register(Entity(
    name="conversations",
    table="conversations",
    key_column="id",
    #: provider and model are here so the row can be materialised at all -- both
    #: are NOT NULL -- and because a control device listing conversations wants
    #: to show which model answered. Neither is a credential.
    fields=("title", "provider", "model", "pinned", "archived"),
))

#: The to-do list. Concurrently editable and field-independent, which is exactly
#: what per-field LWW is for. `external_*` columns are absent: Microsoft To Do is
#: the authority for those and `backend/sync/microsoft_todo.py` owns that half.
register(Entity(
    name="tasks",
    table="tasks",
    key_column="uuid",
    fields=(
        "title", "notes", "due_at", "scheduled_at", "status", "priority",
        "important", "list_id", "completed_at", "reminder_at",
    ),
))

#: Agent runs, so a phone can see what a machine is doing. Single-writer -- the
#: host executing the run -- so there is no concurrency here to resolve and LWW
#: is bookkeeping rather than a merge. `state` (the full serialized AgentState)
#: is deliberately absent: it is large, it changes every iteration, and nothing
#: on a control device reads it.
register(Entity(
    name="agent_runs",
    table="agent_runs",
    key_column="id",
    fields=("conversation_id", "phase", "link", "error"),
    #: Never materialised from an op: the row foreign-keys to a conversation, and
    #: a run invented without one would be a phantom on the control device. The
    #: host that executes the run is its only writer, and its outbox emits the
    #: create before any update, so ordering is not left to chance.
    insertable=False,
))

#: The subagent tree, for the same reason and with the same single writer.
register(Entity(
    name="subagent_sessions",
    table="subagent_sessions",
    key_column="id",
    fields=(
        "parent_conversation_id", "agent_type", "title", "depth",
        "status", "error", "model", "provider",
    ),
    insertable=False,   # same single writer, same foreign key, same reason
))


#: How much of a message crosses. A transcript is what a control device is for,
#: but a tool result can be a megabyte of JSON and the relay refuses an op over
#: 64KB -- so the content is capped here, with a marker, rather than producing an
#: op that is silently dropped at the door. The full text stays on the machine
#: and is there when the phone can reach it directly.
MAX_SYNCED_CONTENT = 8_000

TRUNCATION_MARKER = "\n\n[...truncated; open this conversation on the machine for the rest]"

#: The transcript, so a control device has something to show.
#:
#: Append-only in practice: a message is written once and never edited, so the
#: per-field merge never has two writers to reconcile. `tool_calls` and
#: `token_count` are absent deliberately -- a phone renders text and a role, and
#: the rest is machinery it has no use for.
register(Entity(
    name="messages",
    table="messages",
    key_column="uuid",
    fields=("conversation_id", "role", "content", "created_at", "seq"),
    #: Published, never accepted. A control device displays the transcript and
    #: has no business writing one, and the row foreign-keys to a conversation
    #: this machine owns. What a phone sends instead is an intent, below.
    insertable=False,
))

#: What a control device asks for. The one entity that travels phone -> machine.
#:
#: `kind` is matched against a table of handlers on the receiving side, so the
#: set of things that can be asked for is a property of this machine's code
#: rather than of what a device chose to send. A row here is a request, and
#: `backend/sync/intents.py` decides.
register(Entity(
    name="intents",
    table="sync_intents",
    key_column="id",
    fields=("device_id", "kind", "payload", "state", "note"),
))


#: The library: what you have read, watched and saved.
#:
#: Metadata only, and the field list is where that is enforced. `text_path`,
#: `media_path` and `thumbnail_path` are absent deliberately -- they name files
#: on one machine's disk, and a path that means something here means nothing on
#: a phone. The bytes stay where they are and a control device asks for them
#: when it can reach the machine directly. That is the same rule the relay
#: already states for a job's result: references cross, content does not.
#:
#: `summary` and `notes` do cross: they are the part a phone is for -- looking
#: up what you thought about something while you are away from the machine.
register(Entity(
    name="library",
    table="library_items",
    key_column="uuid",
    fields=(
        "kind", "title", "url", "author", "site", "published_on",
        "consumed_on", "notes", "rating", "summary", "tags",
        "word_count", "duration_seconds", "source_ref",
    ),
))
