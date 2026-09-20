-- The relay's whole database. Two tables, and both are deliberately small.
--
-- `deliveries` is a queue, not a store. A row exists for as long as the laptop
-- takes to come back, and is deleted the moment it has been taken. That
-- transience is why this fits in a free tier and why the blast radius of the
-- relay being compromised is one delivery rather than a library.

CREATE TABLE IF NOT EXISTS deliveries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 'instagram' carries Meta's exact bytes; 'share' carries a URL from a phone.
    kind         TEXT    NOT NULL,
    -- sha256 of the raw body. This is what Meta's *retry of an unacknowledged
    -- delivery* collides with, and it needs no payload parsing -- so the route
    -- classification in backend/instagram/webhook.py is not duplicated here in
    -- TypeScript, where the two copies would drift apart in a month.
    body_hash    TEXT    NOT NULL,
    -- base64 of the bytes exactly as they arrived. Not re-serialised JSON: key
    -- order, unicode escaping and float formatting all differ, and a signature
    -- verified over anything but the original bytes is not a check.
    body         TEXT    NOT NULL,
    -- the X-Hub-Signature-256 header, verbatim, so the laptop can verify it again
    signature    TEXT,
    sender_id    TEXT,
    received_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_hash ON deliveries(body_hash);
CREATE INDEX IF NOT EXISTS idx_delivery_order ON deliveries(id);

-- Everything the laptop mirrors up so the Worker can act while it is away:
-- access_token, token_expires_on, allow_senders, reply_on_save, share_token,
-- and last_pull_at -- which is how the Worker knows whether the laptop is there.
CREATE TABLE IF NOT EXISTS state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- What the relay owes somebody, and the proof it owes it once.
--
-- The ack was `ctx.waitUntil(sendAck(...))`: one fetch, inside the request that
-- received the delivery, with a catch that logged and moved on. A Graph 500 or a
-- rate limit lost it silently, inside a window that closes after 24 hours and
-- cannot be reopened. This is the record that a send was owed, so the Workflow
-- in src/ack.ts can keep trying and the laptop can see what happened while it
-- was away.
--
-- Keyed by the delivery's body hash, the same key `deliveries` uses. Meta
-- re-delivering therefore does not buy a second ack, for the same reason it does
-- not buy a second reel.
CREATE TABLE IF NOT EXISTS outbound (
    body_hash  TEXT PRIMARY KEY,
    sender_id  TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'ack',
    -- pending | sent | skipped | failed
    state      TEXT NOT NULL,
    note       TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_state ON outbound(state, updated_at);

-- ---------------------------------------------------------------- the jobs
--
-- The generic half. `deliveries` above is a *transport* -- Meta's exact bytes,
-- held until the laptop verifies them -- and it stays that way because a parsed
-- delivery cannot be checked against a signature. This table is the other
-- thing: work the relay was asked to *do* while the laptop was away, of a kind
-- named by `kind` rather than built into the Worker.
--
-- The shape is deliberately `backend/jobs/`'s: an idempotency key that decides
-- what "the same job" is, a bounded attempt count, a step ledger, and a result
-- small enough to live in a row. Two halves of one idea rather than two ideas.
--
-- What is NOT here: content. A job's result carries references -- a URL, a
-- title, an R2 key when there genuinely are bytes -- and the bytes are deleted
-- the moment the laptop confirms it has them. Cloud retention is a queue's
-- worth, not a library's.
CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    -- Which registered job type runs this. Unknown kinds are refused at the
    -- door, so this column never names something nothing can run.
    kind            TEXT NOT NULL,
    -- The "same job" test. Chosen from the fact the job is about -- a URL and
    -- the day, a delivery's body hash -- never randomly, which is what makes a
    -- phone retrying a share create nothing the second time.
    idempotency_key TEXT NOT NULL UNIQUE,
    -- queued | running | waiting | completed | failed | cancelled | synced
    state           TEXT NOT NULL,
    -- What the type needs to start, as JSON. Never a credential: the Worker's
    -- secrets are the Worker's, and a job that needed one would be handing it
    -- to whoever can read this table.
    params          TEXT NOT NULL DEFAULT '{}',
    -- {step, done, total, note} -- what a phone polling this job is shown.
    progress        TEXT,
    -- Small JSON the laptop reads. Bytes go to R2 and are named in `artifacts`.
    result          TEXT,
    -- JSON array of R2 keys staged for this job, so cleanup needs no listing.
    artifacts       TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    last_error      TEXT,
    -- Which credential asked for this: 'desktop', 'client' or 'webhook'. A
    -- remote client may read back only the jobs it created.
    origin          TEXT NOT NULL DEFAULT 'client',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    started_at      INTEGER,
    finished_at     INTEGER,
    -- When the laptop confirmed it had this. Until then nothing is deleted.
    synced_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_kind ON jobs(kind, created_at);

-- The ledger that makes a retry safe.
--
-- A step's answer is written down after it returns, so a crash mid-step leaves
-- no row and the step runs again -- at-least-once for the step in flight,
-- exactly-once for every step before it. Workflows already replays its own
-- instance this way; this table is what survives the *instance* being lost, so
-- a job re-dispatched by the cron does not re-send what the first one sent.
CREATE TABLE IF NOT EXISTS job_steps (
    job_id     TEXT NOT NULL,
    step_key   TEXT NOT NULL,
    result     TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (job_id, step_key)
);

-- ---------------------------------------------------------- the worker mailbox
--
-- What a worker running on somebody else's compute said about a job the laptop
-- started. A mailbox, exactly like `deliveries` above and for exactly the same
-- reason: a GitHub Actions runner cannot reach a laptop -- there is no address,
-- and half the time there is no laptop -- so it reports here and the laptop
-- collects on the /sync poll it was already making.
--
-- Deliberately NOT the `jobs` table. A job there is work *this relay runs*: the
-- sweep re-dispatches it, `promoteDue` promotes it out of backoff, a Workflow
-- instance executes its steps. A worker report is none of those things -- there
-- is nothing here to run -- and parking rows in `jobs` to use it as storage
-- would mean the sweep periodically trying to execute a mailbox.
--
-- `job_id` is chosen by the laptop before dispatch, because `workflow_dispatch`
-- returns no run id: the only name both sides share is the one we picked.
--
-- Transient, like everything else here. A row lives until the laptop confirms
-- it, and the daily cron clears whatever nobody came back for.
CREATE TABLE IF NOT EXISTS worker_reports (
    job_id     TEXT PRIMARY KEY,
    -- queued | running | completed | failed
    state      TEXT NOT NULL,
    -- {done, total, note} -- progress, so a batch can say more than "waiting".
    progress   TEXT,
    -- Small JSON. A worker with more than this to say sends references.
    result     TEXT,
    error      TEXT,
    -- 'automation' or 'subagent'. Which account ran it, and nothing else about it.
    lane       TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    -- When the laptop confirmed it had this. Set on the sync *after* the one
    -- that handed it over, the same late acknowledgement `deliveries` uses.
    synced_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_worker_unsynced ON worker_reports(synced_at, updated_at);

-- ------------------------------------------------------------- the sync ops
--
-- A mailbox, like `deliveries` and `worker_reports` above, and transient for the
-- same reason -- but this one the relay cannot read at all.
--
-- Everything else in this file is plaintext because the relay has to *act* on
-- it: it answers Meta's webhook, it runs a `url_ingest`, it decides whether the
-- laptop is away. An op needs none of that. It is carried from one of the user's
-- devices to another and never inspected, so there is no reason for this table
-- to hold anything but sealed bytes -- and every reason not to, since these are
-- the user's settings and task titles rather than a public reel.
--
-- `op_id` and `from_device` are in the clear because routing needs them: one is
-- the duplicate guard, the other says who must NOT be sent it back. Both are
-- opaque identifiers. The AEAD binds the ciphertext to both, so moving a
-- ciphertext onto another row yields a decryption failure on the far side
-- rather than a plausible op attributed to the wrong device.
CREATE TABLE IF NOT EXISTS ops (
    -- The whole of duplicate detection at this layer. A device retrying an
    -- upload it already made writes nothing the second time, for the same
    -- reason `idx_delivery_hash` makes Meta's redelivery free.
    op_id       TEXT PRIMARY KEY,
    from_device TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_order ON ops(created_at, op_id);

-- Who has taken what.
--
-- An op is deleted once every registered device except its sender has acked it,
-- which is what keeps this table a queue rather than a log of everything the
-- user has ever changed. Without the fan-out cursor the relay would either
-- delete on first collection -- losing the op for the second device -- or keep
-- it forever.
CREATE TABLE IF NOT EXISTS op_acks (
    op_id     TEXT NOT NULL,
    device_id TEXT NOT NULL,
    PRIMARY KEY (op_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_op_acks_device ON op_acks(device_id);
