# Storage and Filesystem

Where AMETHYST keeps data: the `~/.amethyst` layout, SQLite configuration,
schema and migrations, the library vault, attachments, converter uploads,
secrets, logs and configuration files.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [DATABASE.md](../DATABASE.md), [BACKEND.md](../BACKEND.md),
[systems/auth.md](auth.md), [sections/library.md](../sections/library.md).

## Home directory

`amethyst_home()` (`backend/config.py`) is:

```text
$AMETHYST_HOME  or  ~/.amethyst
```

`Paths.ensure()` creates the directories at startup.

| Path | Contents |
|---|---|
| `amethyst.db` | Main SQLite database |
| `amethyst.db-wal`, `amethyst.db-shm` | WAL sidecars while open |
| `amethyst.lock` | Single-instance lock |
| `config/providers.yaml` | Provider entries, tiers, fallback, embeddings, memory model |
| `config/mcp.yaml` | MCP servers and connector settings |
| `config/sandbox.yaml` | Shell sandbox policy |
| `config/workers.yaml` | Remote worker accounts |
| `skills/` | Installed skills |
| `library/` | Captured text as Markdown files |
| `library/media/` | Thumbnails, slides and downloaded media |
| `attachments/<12-hex>/<name>` | Composer uploads |
| `converter/uploads/<file_id>/` | Converter originals and outputs |
| `logs/amethyst.log` | Rotating application log |
| `logs/crash.log` | Crash log |
| `user_profile.json` | Name, avatar and profile preferences |
| `mobile-updates/` | Mobile update artifacts |
| `secrets.json` | Only when `AMETHYST_SECRETS_FILE` is explicitly set |

`AMETHYST_HOME` is read on every `paths()` call, not cached at import. Tests and
portable installs rely on that.

## SQLite

`backend/db/connection.py`:

```python
sqlite3.connect(path, check_same_thread=False)
PRAGMA journal_mode=WAL
PRAGMA foreign_keys=ON
PRAGMA busy_timeout=5000
```

WAL lets readers continue while a background runner writes. `busy_timeout`
covers two writers meeting. One uvicorn worker is required; the connection
layer is not a multi-process coordination mechanism.

Connections are process-wide through `get_connection()`. `transaction(conn)` is
the context manager used by services that need an atomic group.

### Schema

`backend/db/schema.sql` creates the core schema: 43 tables at verification time.
`backend/dashboard/schema.sql` creates the dashboard tables. Both run in
`migrate()`.

`migrate()` also:

- adds missing columns (`_add_missing_columns`),
- adopts legacy automation runs,
- drops empty legacy tables (`integrations`, `integration_state`),
- drops retired columns (`tasks.my_day_on`) when SQLite supports it,
- normalises task timestamps,
- repairs placeholder model names.

Migrations are idempotent and run at every startup. There is no separate
migration runner and no version table; the schema files are the target state.

### Virtual tables

Created by `backend/retrieval/store.py`, not by `schema.sql`:

- `chunks_fts` — FTS5 over chunk content and heading path.
- `chunk_vectors` — `sqlite-vec` `vec0` table, created when embeddings exist.

If `sqlite_vec` is unavailable, keyword search still works and vector search is
skipped. The embedding dimensions are fixed at table creation; changing the
embedding model requires rebuilding the index.

The embedding model used for the index is recorded in `app_settings`. It is
deliberately not synced: two devices with different local models must not share
one index identity.

## Repositories

`backend/db/repositories.py` is the only layer above SQL for core tables.
Services call repositories; routes call services. A route that writes SQL
directly is a bug.

Exceptions that live beside their table:

- `backend/jobs/store.py` for `jobs` and `job_steps`.
- `backend/dashboard/store.py` for widget cache and settings.
- `backend/instagram/store.py` for delivery state.
- `backend/workers/reports.py` for worker reports.

## Library vault

`backend/library/store.py`:

```text
library/<id:06d>-<slug>.md          captured text
library/media/<id:06d>-thumb.jpg    thumbnail
library/media/<id:06d>-thumb-opt.jpg
library/media/<id:06d>-slide-<n>.jpg
library/media/<id:06d><ext>         video or audio
```

The id leads the filename, so two items with the same title cannot collide. The
Markdown file is the source of truth for the text; the `library_items` row
records metadata and points at the path. The same indexer that reads the vault
indexes these files, so `search_documents` can find a saved article without
knowing the library exists.

`library_items.text_path`, `media_path` and `thumbnail_path` are deliberately
absent from the sync allowlist. Paths name files on one machine.

## Attachments

`POST /api/attachments` writes to:

```text
~/.amethyst/attachments/<12-hex>/<original name>
```

- Maximum 32MB (`MAX_ATTACHMENT_BYTES`).
- The original filename is sanitised with `Path(...).name`.
- Text and document extensions are indexed best-effort with
  `require_embeddings=False`, so an unreachable embedder leaves the file
  keyword-searchable instead of failing the upload.
- The message carries the absolute path; the ordinary file tools read it.

## Converter

`backend/converter/service.py`:

```text
~/.amethyst/converter/uploads/<file_id>/...
```

Each upload gets a folder for the original, extracted files and generated
outputs. Thumbnails and downloads are served through
`/api/converter/thumbnail/{file_id}` and `/api/converter/download/{job_id}`.
Temporary archive extraction uses the system temp directory, not the vault.

## Secrets

`backend/secrets.py` (ADR-0012):

- Default: OS keychain via `keyring`, service `amethyst`.
- Explicit fallback: `AMETHYST_SECRETS_FILE` JSON store, mode 0600.
- No silent downgrade.
- `resolve_api_key(ref, env)` checks the keychain reference, then an environment
  variable.
- `redact()` removes credential-shaped values before logs and audit rows.

References look like `amethyst/openai`. `providers.yaml`, `mcp.yaml` and the
`devices` table store references or hashes, never plaintext secrets.

The sync group key lives at `amethyst/sync-group-key`. A device token is stored
only as SHA-256 in `devices.token_hash`.

## Logs

`backend/logging_setup.py`:

- `logs/amethyst.log` — `RotatingFileHandler`.
- `logs/crash.log` — crash records.
- Console stream at the configured level.

The Electron shell writes backend stdout/stderr to its own
`userData/logs/backend.log` and keeps the last 30 lines in memory for the
splash error screen. That is separate from `~/.amethyst/logs/`.

Audit rows are in `execution_logs`, not in the log file. The reminders runner
prunes old audit rows on a schedule.

## Configuration files

YAML is read on demand, not cached indefinitely. Writes use `write_atomic()`
(temp file + `os.replace`) so a crash cannot leave a truncated file.

| File | Read by | Notes |
|---|---|---|
| `providers.yaml` | `backend/config.py` | Providers, tiers, fallback, embeddings, memory |
| `mcp.yaml` | `backend/config.py`, MCP manager | Servers, enabled flags, tool allowlists |
| `sandbox.yaml` | `backend/security/sandbox.py` | Created with defaults on first use |
| `workers.yaml` | `backend/workers/accounts.py` | Remote worker accounts |

## Backup and portability

There is no built-in backup command in the application. A consistent manual
backup is:

1. Stop the API (or use SQLite's online backup API).
2. Copy `amethyst.db` and the `library/`, `attachments/`, `config/` and
   `skills/` directories.
3. Do not copy `amethyst.db-wal` without `amethyst.db`; the pair is only
   consistent together.

`AMETHYST_HOME` makes a portable install possible: point it at another
directory before starting.

## Modification guide

| Change | Touch |
|---|---|
| Add a table | `backend/db/schema.sql` or `backend/dashboard/schema.sql`, repository, docs |
| Add a column | Schema file plus `_add_missing_columns` if an existing DB must gain it |
| Add an index | Schema file; verify the query it serves |
| Change SQLite pragmas | `backend/db/connection.py`; test WAL and busy behavior |
| Change the vault layout | `backend/library/store.py`, `library/service.py`, migration if needed |
| Change attachment limits | `MAX_ATTACHMENT_BYTES`, upload route |
| Change secret storage | `backend/secrets.py`, docs, tests |
| Add a config file | `Paths`, loader, atomic writer, docs |

Rules:

- Keep SQL in repositories or the module that owns the table.
- Keep the schema files idempotent; they run at every startup.
- Never put a secret in SQLite or YAML.
- Never sync a filesystem path.
- Keep the library text as real files; the database is an index, not the blob
  store.
- Test migrations against a copy of a real database, not only a fresh one.

## Known issues

- No built-in backup or restore command.
- `migrate()` has no version table; correctness depends on every step being
  idempotent.
- `chunk_vectors` dimensions are fixed at creation. A model change needs a
  rebuild.
- `sqlite_vec` is optional; vector search silently degrades to keyword search.
- Old databases may contain unused `clipboard.db`, `library.db` or `psok`
  backup files from earlier versions. Current code does not read them.
- The Electron shell's logs and the Python logs are in different directories.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
