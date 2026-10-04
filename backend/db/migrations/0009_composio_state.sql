-- Composio session state: tracks the active hosted MCP session and enabled toolkits.
-- Exactly one row (id = 1) per local Amethyst instance.
CREATE TABLE IF NOT EXISTS composio_state (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    session_id       TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    enabled_toolkits TEXT NOT NULL DEFAULT '[]',
    mcp_url          TEXT NOT NULL,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
