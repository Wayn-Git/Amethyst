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
