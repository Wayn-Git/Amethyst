-- Tasks reuse the existing tasks table; drafts never mutate source rows.
CREATE TABLE IF NOT EXISTS widget_action_drafts (
    id TEXT PRIMARY KEY, widget_id TEXT NOT NULL, action TEXT NOT NULL,
    body_json TEXT NOT NULL, created_at TEXT NOT NULL,
    decision TEXT, decided_at TEXT
);

CREATE TABLE IF NOT EXISTS deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snoozes (
    item_id TEXT NOT NULL,
    widget_id TEXT NOT NULL,
    until TEXT NOT NULL,
    PRIMARY KEY (item_id, widget_id)
);
