-- Provider fallback state and Composio key_mode migration.
ALTER TABLE composio_state ADD COLUMN key_mode TEXT NOT NULL DEFAULT 'project';

CREATE TABLE IF NOT EXISTS provider_fallbacks (
    provider        TEXT PRIMARY KEY,
    active_target   TEXT NOT NULL DEFAULT 'composio',
    failure_reason  TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
