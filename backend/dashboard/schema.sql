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

-- User-authored drafts are local records, never Gmail draft objects.
CREATE TABLE IF NOT EXISTS dashboard_mail_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_mail_waiting (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    recipient TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_mail_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    tags_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

-- Renderer declarations only; no connector credentials or conversation tool history.
CREATE TABLE IF NOT EXISTS dashboard_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_calls_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    next_run TEXT,
    interval_s INTEGER CHECK(interval_s IS NULL OR interval_s >= 900)
);
CREATE TABLE IF NOT EXISTS dashboard_job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    conversation_id TEXT,
    trace_id TEXT
);
CREATE TABLE IF NOT EXISTS dashboard_delegated (
    job_id INTEGER PRIMARY KEY REFERENCES dashboard_jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS dashboard_job_traces (
    run_id INTEGER PRIMARY KEY REFERENCES dashboard_job_runs(id),
    trace_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboard_research (
    job_id INTEGER PRIMARY KEY REFERENCES dashboard_jobs(id) ON DELETE CASCADE,
    note_id INTEGER
);
CREATE TABLE IF NOT EXISTS dashboard_watchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('page','mailbox')),
    target TEXT NOT NULL,
    interval_s INTEGER NOT NULL CHECK(interval_s >= 900),
    next_poll TEXT NOT NULL,
    baseline TEXT,
    checked_at TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS dashboard_permission_rules (
    tool_name TEXT PRIMARY KEY,
    decision TEXT NOT NULL DEFAULT 'ask' CHECK(decision IN ('allow','ask','deny'))
);

CREATE TABLE IF NOT EXISTS dashboard_library_collections (
    tag TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_focus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL CHECK(mode IN ('focus','break')),
    started_at TEXT NOT NULL,
    duration_s INTEGER NOT NULL CHECK(duration_s > 0),
    ended_at TEXT,
    completed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_focus_active ON dashboard_focus((1)) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS dashboard_habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    period TEXT NOT NULL CHECK(period IN ('daily','weekly')),
    target INTEGER NOT NULL CHECK(target BETWEEN 1 AND 100)
);
CREATE TABLE IF NOT EXISTS dashboard_habit_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES dashboard_habits(id) ON DELETE CASCADE,
    day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_habit_history ON dashboard_habit_checkins(habit_id,day);

CREATE TABLE IF NOT EXISTS dashboard_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    target_date TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('manual','tasks')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100)
);
CREATE TABLE IF NOT EXISTS dashboard_goal_tasks (
    goal_id INTEGER NOT NULL REFERENCES dashboard_goals(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY(goal_id,task_id)
);

-- Projects reuse local task lists; cards keep placement only, never task copies.
CREATE TABLE IF NOT EXISTS dashboard_kanban_boards (
    list_id INTEGER PRIMARY KEY REFERENCES task_lists(id) ON DELETE CASCADE,
    columns_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboard_kanban_cards (
    task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    column_id TEXT NOT NULL
);
