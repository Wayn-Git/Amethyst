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

CREATE TABLE IF NOT EXISTS support_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    submitted_on TEXT NOT NULL,
    sender_domain TEXT,
    reply_at TEXT,
    follow_up TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','done')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);


CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Only health metadata; no tokens, request arguments, or source responses.
CREATE TABLE IF NOT EXISTS dashboard_connector_health (
    toolkit TEXT PRIMARY KEY,
    last_success TEXT,
    failures INTEGER NOT NULL DEFAULT 0,
    retry_at REAL NOT NULL DEFAULT 0,
    needs_reconnect INTEGER NOT NULL DEFAULT 0,
    reconnect_started TEXT,
    account_id TEXT
);
