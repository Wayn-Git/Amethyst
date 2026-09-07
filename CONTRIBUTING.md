# Contributing to PSOK

PSOK is a single-user, local-first agent system. Everything below is either a
setup step or a rule with a trap behind it — the traps are the reason the rules
exist, and each is enforced by a test or a build step rather than by memory.

## Setup

### Automated (Fastest)
```bash
./run.sh --dev
```

### Manual
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # or: uv pip install -e '.[dev]' (the -e matters; see "The -e rule")
psok init

cd frontend && npm install
```

`uv` from [astral.sh](https://docs.astral.sh/uv/), or standard `pip`; the
`requirements-dev.txt` / `.[dev]` extra carries pytest, ruff and the rest.

## Before every push

```bash
ruff check backend tests
pytest
```

`pytest` defaults to `-m 'not live'` — the deselected few spawn real MCP
servers and reach the network. Run them deliberately:

```bash
pytest -m live
```

Frontend:

```bash
cd frontend
npm run lint && npm run build
npm run smoke          # against a running `psok serve` with a configured model
```

## The one-worker rule

`psok serve` runs one uvicorn process. Do not swap it for gunicorn or
`--workers N`: the app's lifespan starts **five in-process runners** —
automations, reminders, the journal, Instagram capture, the bookmark watcher
(`backend/api/main.py`, `_lifespan`) — plus the MCP manager holding live
stdIO subprocesses. A second worker would duplicate all six against the same
SQLite file, and every "fix performance" attempt that does this has produced
a machine that answers twice and writes twice.

## The secrets rule

Nothing personal in the repository, nothing personal in an image layer. The
`PSOK_DEFAULT_*` mechanism in `backend/mcp/catalogue.py` carries **names of
environment variables, never values** — a real client id pasted into the
catalogue would pass every review because it looks exactly like a placeholder.

`tests/test_docker_context.py` enforces this mechanically:

```bash
pytest tests/test_docker_context.py
```

- every `default_client_id_env` must match `^PSOK_DEFAULT_[A-Z0-9_]+$`, with
  `api_key_ref` unset (a metered key is per-user; a shared one spends the
  owner's quota and "search is broken" is what running out looks like);
- every `psok.db*`, `secrets.json`, `providers.yaml`, `mcp.yaml`,
  `token-cache.json`, `credentials/`, `*.pem` in the tree must be git-ignored;
- the required `.dockerignore` patterns are present.

And the release gate for the image:

```bash
docker run --rm --entrypoint sh psok:local -c 'ls -A /data/psok /home/psok'
```

must print **nothing**. Those directories are created by the entrypoint at
runtime; anything listed leaked into a layer, and a layer is forever.

Never pass a secret as `ARG` or `ENV` in the Dockerfile — both are visible in
`docker history` for as long as the image exists. Secrets reach a container
through `env_file` at `docker run`.

## The `-e` rule

The Dockerfile installs the backend with `-e` (editable), and that is
load-bearing, not a development habit. `backend/api/main.py` resolves the
built SPA as `parents[2]/frontend/dist` relative to its own file. A
non-editable install puts `main.py` in site-packages, the path resolves to
somewhere with no frontend, and `_mount_frontend` returns silently: a working
API behind a **blank page, with no error**. The Dockerfile carries a
build-time assertion that fails the build instead; keep the `-e` and keep the
assertion.

## Comments in this codebase

Comments here explain **why**, and usually cite the defect that motivated
them — `Mutation check:` lines in tests name the exact revert that must fail
the test. Match that: a comment that restates the code is noise, and deleting
one that records a trap re-opens it.

## Adding a connector catalogue entry

`backend/mcp/catalogue.py` is the whole catalogue. An entry states its
transport, its auth kind, the environment its server reads, and — where the
provider offers one — an `identity_url` so the interface can name the account
that signed in.

- `auth: AuthKind.NONE` — nothing to configure; the connector works on add.
- `AuthKind.SETUP` — the server runs its own flow once it has credentials;
  say which keys it reads (`client_id_env` etc.) or which file
  (`credentials_file` + `credentials_file_keys`).
- `AuthKind.OAUTH` — PSOK drives OAuth 2.1 + PKCE; needs
  `oauth_scopes`, and `identity_url` is what makes "signed in" verifiable
  rather than assumed.

If you also want a shared default registration for it: add
`default_client_id_env` / `default_client_secret_env` holding **variable
names**, set them in `.env.example` (blank), and read the ADR on default app
registrations first — the mechanism ships with no values, and Google/Spotify
cannot honestly be called zero-config while their apps cap test users and
expire grants weekly.
