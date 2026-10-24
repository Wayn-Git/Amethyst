-- Tasks reuse the existing tasks table; drafts never mutate source rows.
CREATE TABLE IF NOT EXISTS widget_action_drafts (
    id TEXT PRIMARY KEY, widget_id TEXT NOT NULL, action TEXT NOT NULL,
    body_json TEXT NOT NULL, created_at TEXT NOT NULL,
    decision TEXT, decided_at TEXT
);
