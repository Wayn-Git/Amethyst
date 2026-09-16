# ADR-0024: Cross-Device Synchronisation

## Status

Proposed. Supersedes [ADR-0011](0011-authentication.md), which declined to build
authentication and named the condition for revisiting it: *"if and when AMETHYST
gains a networked or multi-device remote-access mode."*

## Context

AMETHYST is one machine. [overview.md](../overview.md) opens by saying so, and
almost every decision since follows from it: SQLite as the single relational
engine (ADR-0002), the filesystem as the source of truth for text (ADR-0004),
secrets in the OS keychain (ADR-0012), no login because the boundary is the
operating system's own user account (ADR-0011).

What is wanted now is the shape Claude Code's remote access has: the session runs
on the machine that has the files, and a phone attaches to it, watches it, and
steers it. That is not a second machine running AMETHYST. It is a second *view*
of the one that already is.

Much of the necessary machinery exists, built for Instagram capture:

- `POST /sync` is already a batched delta protocol with late acknowledgement.
- `relay/` is already a Worker whose D1 tables are queues rather than stores.
- `jobs` already carries an idempotency key, a lease and a step ledger.
- The share token is already mirrored into D1 on every poll, so rotating it on
  the machine revokes it at the relay within one poll.

The question this ADR answers is what to add, and -- more importantly -- what not
to.

## Decision

### Devices have roles, and only one role owns data

A **host** runs turns and owns a database. A **control** device attaches to one,
holds a cache and an outbox, and mints no rows of its own. The vault, the
keychain and SQLite stay exactly where they are.

This is the decision everything else falls out of, including the next one.

### Last-write-wins per field, and no CRDT library

Sync targets were examined one at a time to find which genuinely need a
conflict-free replicated data type. The honest answer is none of them:

| Target | What it needs | Why |
|---|---|---|
| Queued jobs | nothing new | `idempotency_key` + `lease_owner` + `job_steps` already give exactly-once; the state machine is already monotonic |
| Memory metadata | stable ids | `memories` supersedes rather than deletes -- already a 2P-Set |
| Messages | nothing new | immutable, append-only, single-writer |
| Agent / subagent runs | LWW | single-writer by construction: the host executing them |
| Conversations, tasks, settings | per-field LWW | genuinely concurrent, but field-independent |

So the model is a **last-write-wins register per field**, ordered by a hybrid
logical clock, and nothing else. Yjs, Automerge and every sequence CRDT exist to
solve collaborative editing of ordered text, and there is none in this product: a
transcript is append-only and written by one agent.

The clock is `(wall_ms, counter, device_id)`, compared as a fixed-width string.
`device_id` is what makes the order *total*: without it two edits in the same
millisecond compare equal, each device keeps whichever it applied last, and the
two disagree permanently. Arbitrary-but-identical is the correct outcome, because
nobody can say which of two simultaneous edits *should* win, and agreeing matters
more than being right.

Stamps are per field rather than per row so a phone editing a task's due date and
a laptop editing its title both survive.

### No primary-key migration

`tasks`, `memories`, `library_items` and others use `INTEGER PRIMARY KEY
AUTOINCREMENT`, which two devices minting rows offline would collide on. Under
the host/control split only the host mints rows -- a control device's outbox
carries *intents* -- so the integer keys are safe. `tasks` and `memories` get a
nullable `uuid` column, backfilled on first sync, because their rows are edited
from both sides and need a name that does not depend on insertion order.

Migrating every key to a UUID is a large change touching every foreign key and
most of `repositories.py`. **The trigger for doing it is a second host**, not a
second device.

### The relay carries what it cannot read

Every other payload in `relay/` is plaintext because the Worker must act on it:
it answers Meta's webhook, it runs a `url_ingest`, it decides whether the laptop
is away. An op needs none of that -- it travels between two of one person's own
devices -- so it is sealed with AES-256-GCM under a group key established at
pairing and never sent to Cloudflare.

`op_id` and `from_device` stay in the clear because routing needs them; both are
opaque identifiers, and the AEAD binds the ciphertext to both, so a relay that
moved a ciphertext onto another row would produce a decryption failure rather
than a plausible op from the wrong device.

This strengthens the property `relay/README.md` already claims. "A compromised
relay can lose a reel, it cannot invent one" becomes: it cannot read one either.

### D1 is not in the local read path

No host query consults the relay to serve anything. `ops` is a queue like every
other D1 table: a row is deleted once every registered device but the sender has
acked it, and the daily cron clears what nobody came back for. With the relay
down, a host is completely unaffected and a control device falls back to its
cache and outbox.

This is the "not a single point of failure" requirement discharged structurally,
by never depending on it, rather than by replicating it.

### Duplicate detection in three layers

1. `ops.op_id` is a primary key at the relay; a retried upload writes nothing.
2. `sync_seen` on the host, written in the same transaction as the op's effect.
3. The merge itself: applying an LWW op twice is the same write.

Any one would do. All three are present because that is this codebase's existing
habit, and because it means an op can be retried without anybody having to reason
about whether it is safe to.

### A token per device, stored as a hash

`share.py`'s discipline, with two changes. A token per device, so revoking a
phone does not revoke the laptop. And only sha256 is stored, because these are
only ever checked -- so a stolen database authenticates as nobody.

Pairing carries a 160-bit secret in a QR code. That length is what lets the
handshake be a single sealed round trip with no PAKE: protocols like SPAKE2 exist
because a typed code is short enough to guess offline, and a QR code has no
reason to be short. Both halves are sealed under a key derived from that secret,
so the relay carries the handshake without being able to complete or read it.

### Remote control: what a phone may ask for

A control device does not run turns and does not mint rows. It shows what the
machine published and appends *intents* -- requests the machine decides about.

Publishing the transcript is a **sweep, not an emit**. Messages are written from
the agent loop, the tool dispatcher, the automation runner and the subagent
runner, and threading an emit through all four would put the sync layer inside
the parts of the system that change most. Instead one indexed query per poll
walks a watermark (`backend/sync/project.py`), so `backend/agent/` stays unaware
any of this exists and no new caller can forget to publish.

An intent is an ordinary op on an append-only table, which means it inherits the
dedup, the ordering and the sealing without any new machinery. Its row id **is**
the id of the op that carried it, so a relay redelivering an intent it never got
acknowledged for is an INSERT the merge already refuses: one tap is one turn,
however many times the message arrives.

**The trust boundary is the machine, not the relay.** The relay carries sealed
bytes it cannot read, so it cannot be what decides. `backend/sync/intents.py`
holds a table of handlers keyed by kind, in the same shape as
`relay/src/jobs/registry.ts`, and a kind with no handler is refused at the door.
A phone can ask for a turn in a conversation that already exists. It cannot ask
for a tool call, a shell command, a file read or a model key -- not because
those are filtered, but because there is no handler for them and adding one is a
decision someone makes in that file.

Message content is capped at 8KB with a truncation marker. The relay refuses an
op over 64KB, and a tool result can be a megabyte of JSON, so without the cap a
large message would produce an op silently dropped at the door -- a transcript
with a hole in it and nothing anywhere reporting one.

### The group key is never bytes on the phone

It was base64 in `localStorage` first, which meant any script running on that
origin could read it and send it somewhere. For a key that decrypts the user's
transcript, that is the difference between "an XSS can act while the tab is
open" and "an XSS walks away with everything, permanently".

It is now a `CryptoKey` imported with `extractable: false`, held in IndexedDB.
It can be handed to `crypto.subtle` and cannot be read back out -- by this code
or any other. This does not make an XSS harmless: a script on the origin can
still *use* the key and read what is already merged. It removes the part that
outlives the tab, which is the part that matters.

Where IndexedDB is unavailable -- a private window, a webview with storage off
-- the key is held in memory for the page's lifetime and pairing is needed again
after a reload. That is worse, and it is the right trade: the alternative is
writing an extractable copy somewhere a script can read.

### Order is carried, not inferred

`created_at` is second-precision, and a turn writes the question and the answer
inside the same second routinely. Sorting a transcript by it leaves a tie, and
the tie was broken by a random uuid -- so a real phone rendered the answer above
the question about half the time. Messages carry `seq`, the machine's own write
order, explicitly.

The same mistake was one layer down: the outbox and the relay both ordered ops
by `(created_at, op_id)`. Convergence does not depend on delivery order -- that
is what the merge guarantees -- but the entities created and then updated by a
single device do, and their update could be handed over before their create and
dropped. Both now order by rowid, which is insertion order.

### Revocation takes effect on what was already asked

Revoking a device refuses, in the same transaction, everything it had asked for
that has not yet run. Pressing the button on a phone you no longer have, and
having its queued request run a minute later, would make the button a lie.

An intent can also arrive *after* the revocation -- sealed before, held at the
relay, delivered after -- because the relay only learns of a revocation on the
next config mirror. So the check runs at dispatch as well: the machine is the
authority, so the machine decides.

### The existing poll, and the ceiling on it

`POST /sync` gains `ops` in both directions. No new Cloudflare product, and the
free-tier promise in `relay/README.md` holds.

Convergence latency is therefore one poll, about 15 seconds. That is right for
settings and task edits and wrong for watching a transcript stream, so a control
device on the same network talks straight to the host, which already streams over
SSE. Remote attach polls faster only while a run is live.

**The ceiling:** sustained 1-second polling would be ~86k requests a day per
device and would break the free-tier promise. When remote attach becomes an
everyday thing, the upgrade is a Durable Object with hibernatable WebSockets
pushing the same op frames -- the envelope is designed so that swap needs no
protocol change.

## Alternatives Considered

- **Automerge or Yjs for everything.** Rejected: they solve collaborative text
  editing, which does not occur here. The cost is a large dependency on both
  sides of the wire, an opaque binary format in the database, and document
  histories that grow without a compaction story -- to resolve conflicts that
  per-field LWW resolves in about forty lines.
- **A sequence CRDT for the transcript.** Rejected: messages are immutable and
  single-writer. There is no reordering to reconcile.
- **Making D1 the source of truth and having devices read through it.** Rejected
  outright: it makes an outage of somebody else's computer an outage of the
  user's own machine, and contradicts ADR-0004 and the local-first posture of
  ADR-0013.
- **Plaintext ops in D1, as the other tables are.** Rejected: the other tables
  hold data the Worker must act on. These hold the user's settings and task
  titles, and there is no reason for a queue on somebody else's computer to be
  able to read them.
- **Full peer replication between equals, phone included.** Rejected for the
  write path: a phone appends intents rather than minting rows, which is what
  removes the UUID migration. The *read* path does need a second merge
  implementation in JavaScript (`frontend/src/lib/sync/replica.js`), because a
  phone with no backend has nothing else to merge into. Two implementations of
  one rule is a real cost, paid down by `tests/test_sync_interop.py`, which
  seals in each language and opens in the other -- the first version of the
  JavaScript half produced ops whose `fields` was an empty object, and nothing
  else would have noticed.
- **Streaming the turn to the phone as it runs.** Rejected: it needs a second
  transport and a Durable Object to hold the socket. The turn's output reaches
  the phone as transcript messages on the next poll, which is the same content
  one poll later, for no new infrastructure.
- **Durable Objects with WebSockets from the start.** Rejected: a new stateful
  primitive and a second transport to keep correct, for latency that only the
  attach path needs and that the LAN path already provides.

## Trade-offs

Concurrent edits to the *same* field lose one of the two, silently. This is
inherent in LWW and is accepted because the alternative -- surfacing a conflict
to a single user editing their own settings on their own two devices -- is worse
than picking one.

Convergence is one poll rather than instant, accepted for everything except the
attach path.

The host/control split means a control device cannot create a row while offline,
only an intent. Accepted: it is what removes the primary-key migration, and it
matches how the product is actually used.

An op that cannot be applied is acknowledged and dropped rather than retried
forever. The same call `_take` already makes about an unverifiable delivery, for
the same reason: one poisonous item must not block the queue behind it.

## Consequences

`ADR-0011` no longer holds: there is now a credential, and there is now something
to authenticate to. The scope boundary it drew -- "AMETHYST v1 is explicitly not
designed to be exposed on a network" -- is unchanged for the HTTP API, which
stays loopback-only. What is exposed is the relay, which was already public and
is now additionally unable to read what it carries.

Adding a synced table is one entry in `backend/sync/registry.py`. Adding a device
type is a role. Neither changes the wire protocol, which is the same property
`relay/src/jobs/registry.ts` gives job types.

The first thing that must change if a second *host* is ever added is the primary
keys. That is written down here so the trigger is not rediscovered the hard way.
