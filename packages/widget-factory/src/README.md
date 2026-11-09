# Local Widget Factory

The CLI delegates to `widget_factory/common.py` (SQLite and prompt parsing), `generation.py` (Gan-Tu and image artifacts), `queue.py` (leases, worktrees and integration), and `mcp_server.py` (stdio tools). The factory generates exact Gan-Tu artifacts, records durable tasks in a local SQLite database, and assigns isolated Git worktrees to up to four Antigravity sessions. It does not add a second dashboard or alter Today registration. Only calls to the configured Gan-Tu endpoint use the network; SQLite, artifacts, image files and worktrees stay local.

## Requirements and start

Use the repository Python environment (Python 3.11+, repository dependencies including `mcp`), and Git. No OpenAI key is used or stored.

```sh
./.venv/bin/python widget-factory/factory.py validate-prompts
./.venv/bin/python widget-factory/factory.py generate-batch
./.venv/bin/python widget-factory/factory.py status
./.venv/bin/python widget-factory/factory.py history air-quality
```

Set `WIDGET_FACTORY_MAX_AGENTS` to choose 1–4 implementation slots (default 4). Set `WIDGET_FACTORY_ENDPOINT` to override `https://widgets.gan.dev/api/author-widget`; set `WIDGET_FACTORY_DB` to move the local SQLite database. Generation accepts an optional local PNG/JPEG reference image (up to 10 MiB), sent as `{ "dataUrl": "data:image/...;base64,..." }` in `referenceImages` and preserved with the generated artifacts:

```sh
./.venv/bin/python widget-factory/factory.py generate task.agenda --reference-image /absolute/path/to/design.png
```

The MCP `generate_widget` tool accepts the same option as `reference_image_path`. An image registered with `register-image` is also reused by the next generation or retry. HTTP 429/5xx/timeouts get at most three retries with exponential delays; malformed responses and other HTTP errors are saved as failed task metadata and reported. Each batch item runs independently.

Generated artifacts are written to `generated/<widget-id>/`: `template.jsx`, `data.json`, `metadata.json`, and an optional original `reference.png` or `reference.jpg`. Metadata preserves prompt, theme, design specification, stages, status and SHA-256 hashes. Generation never pretends an image is available when none was returned.

## Prompt file

Edit [`prompts/widgets.md`](prompts/widgets.md). Each widget uses one unique lowercase level-two ID and one nonempty fenced `prompt` block:

````md
## air-quality
```prompt
Create one air quality widget with the requested size variants...
```
````

The parser rejects duplicate or malformed IDs, absent/empty prompts and incorrectly closed or repeated prompt blocks. Run `validate-prompts` before generation.

## Image registration

The playground's documented `Save PNG` export is a manual browser action. The API response exposes template/data/theme/designSpec/stages but no generated image, so the factory does not scrape the playground. `register-image` stores a local reference image for generation and implementation comparison:

```sh
./.venv/bin/python widget-factory/factory.py register-image air-quality /absolute/path/to/export.png
```

PNG/JPEG extensions and file signatures must agree. Task context copies the original image into its isolated worktree. Missing images are explicitly flagged and tasks must report that visual comparison could not be performed.

## Four isolated sessions

Generate widgets, then launch four independent Antigravity sessions. Configure the MCP server below in each session, use a distinct stable session ID, and call `claim_widget_task(session_id)`. The atomic queue allocates one of four slots and creates `.agent-worktrees/agent-N/<widget-id>/` on a per-task branch. A task claim returns the complete private context, copied template/data/image paths, lease and worktree instructions. A second session cannot claim that widget. Use heartbeats during work; leases expire after 30 minutes by default. Recovery preserves the branch and files so the next claim for that task resumes the same worktree. Do not manually edit the SQLite DB or worktree list.

Agent tasks are scoped by [`AGENTS.md`](AGENTS.md). Workers must leave shared Today registration/routing/global files untouched and submit a registration proposal. Worktree isolation protects the main checkout from concurrent edits. The Git integration allowlist rejects unexpected paths; it does not impose an OS sandbox inside an agent's own worktree, so configure Antigravity's workspace permissions to that worktree as well.

## MCP setup

The server uses the installed MCP Python SDK v2 stdio API and explicit `session_id` ownership. Start it from the repository root:

```sh
./.venv/bin/python widget-factory/factory.py mcp
```

OpenCode example (`opencode.json`):

```json
{
  "mcp": {
    "amethyst-widget-factory": {
      "type": "local",
      "command": ["/absolute/path/to/amethyst/.venv/bin/python", "/absolute/path/to/amethyst/widget-factory/factory.py", "mcp"],
      "enabled": true
    }
  }
}
```

Antigravity's documented MCP configuration shape (`~/.gemini/antigravity/mcp_config.json`):

```json
{
  "mcpServers": {
    "amethyst-widget-factory": {
      "command": "/absolute/path/to/amethyst/.venv/bin/python",
      "args": ["/absolute/path/to/amethyst/widget-factory/factory.py", "mcp"]
    }
  }
}
```

Restart the client and confirm the tools appear. MCP host versions/config locations can vary; the factory itself provides stdio MCP and does not claim a live Antigravity client handshake. MCP exposes the factory task/artifact tools; Antigravity uses its own editor/filesystem tools to implement code. After claiming, open the returned worktree as that session’s workspace and grant workspace file access there. MCP does not grant filesystem permissions. Keep the main checkout out of agent workspaces.

Tools: `list_widget_tasks`, `get_widget_task_history`, `generate_widget`, `generate_batch`, `get_widget_artifacts`, `register_widget_image`, `claim_widget_task`, `heartbeat_widget_task`, `report_widget_progress`, `complete_widget_task`, `fail_widget_task`, `get_agent_status`, `get_integration_queue`, `retry_widget_task`. List/status tools return summaries only. A claim returns its own task context; task mutations require the owning session ID.

## Integration and recovery

Agents commit before requesting review. The single integration manager inspects the task report and registration proposal, checks the branch SHA and changed paths, and merges serially:

```sh
./.venv/bin/python widget-factory/factory.py integration-queue
./.venv/bin/python widget-factory/factory.py integrate air-quality antigravity-session-1
# Review/apply registration-proposal.md in the main checkout, then verify:
./.venv/bin/python widget-factory/factory.py finalize air-quality antigravity-session-1 "Reviewed proposal; registered backend/frontend; checks passed" --cleanup
```

The merge rejects shared registration/routing/layout/style edits and unrelated widget paths, then leaves the task `integrating` while the proposal is applied. Conflicts stop integration; resolve them deliberately and retry. The manager reviews and applies the registration proposal in the main checkout, then runs finalization. Finalization verifies the widget appears in both registries, runs `scripts/check-widget-map.py`, reruns the widget-specific tests/lint and existing renderer tests, and only then marks the task completed. `--cleanup` removes a successfully verified clean worktree only; it never deletes branches. Do not force-push, force-reset or manually overwrite another branch.

Inspect the terminal status table with `status`, JSON summaries with `list`, and persistent events with `history <id> --session-id <owner>`. Failures remain in task history and generation failures retain their prompt/error in metadata. `retry <id>` retries generation from the saved prompt when artifacts are absent, or returns a failed implementation task with existing artifacts to generated. Expired leases recover automatically and retain their worktree and uncommitted changes.

The database uses SQLite WAL, foreign keys, status/slot constraints, busy timeout and `BEGIN IMMEDIATE` for claim and mutation. The local DB and worktree directory are ignored by Git. Generated source artifacts remain inspectable under `generated/`.
