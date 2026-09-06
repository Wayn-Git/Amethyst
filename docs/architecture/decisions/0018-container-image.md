# ADR-0018: One container image, one process, no extra capabilities

## Status

Accepted

## Context

Contributors were expected to install uv, ffmpeg, poppler, Node, sqlite-vec
and a browser's worth of MCP runtimes just to run PSOK, so nobody but the
owner ever did. Meanwhile the API already serves the built SPA from one
origin (`backend/api/main.py`, `_mount_frontend`) when `frontend/dist`
exists — there is no web tier to separate, and a compose file with two
services would add a network and a cross-origin request where neither is
needed.

Two traps shaped the image and are worth recording with it:

- **`_DIST` is resolved relative to `main.py`'s own file** — `parents[2] /
  frontend/dist`. A non-editable `pip install .` puts `main.py` in
  site-packages, the path resolves to nothing, `_mount_frontend` returns
  silently, and the result is a working API behind a blank page with no
  error anywhere. The install is therefore `-e`, and the Dockerfile carries a
  build-time assertion that `_DIST/index.html` exists so the silent blank
  page becomes a failed build.
- **The shell sandbox needs unprivileged user namespaces**, which some hosts
  (Ubuntu 24.04's `apparmor_restrict_unprivileged_userns=1`) refuse.

## Decision

One image: a Node stage builds the SPA, a Python stage carries the backend
plus `uv`/`uvx`, Node/`npx`, ffmpeg, poppler, bubblewrap, curl and git. One
process: the entrypoint runs `psok init` then `exec psok serve`, and compose
sets `init: true` so orphaned `uvx`/`npx` children are reaped.

- **One worker, forever.** The lifespan starts five in-process runners
  (automations, reminders, journal, Instagram capture, bookmark watcher) and
  the MCP manager holds live stdio subprocesses; a second worker duplicates
  all six against one SQLite file. `cmd_serve` runs `uvicorn.run()` with no
  `workers` argument, and neither the Dockerfile nor compose will grow a way
  to change that.
- **Non-root (`uid 1000 psok`), no `privileged`, no `cap_add: SYS_ADMIN`.**
  Adding SYS_ADMIN to make bubblewrap work would grant the container the
  capability set needed to escape it, in order to constrain the LLM-driven
  shell tool inside it — strictly worse than no sandbox. In a container, the
  container *is* the boundary, and a tighter one than bwrap gives on a
  laptop; `backend/security/sandbox.py` already degrades to direct mode and
  `psok doctor` states so.
- **Caches outside `$HOME`.** `$HOME` is a volume, and a volume mount shadows
  whatever the image baked there; the uv/npm/xdg caches live under `/opt`.
- **`libnotify-bin` deliberately absent.** `notify-send` on PATH would be
  selected by `backend/notify.py` and then fail against a D-Bus session that
  does not exist; absence is the correct configuration, not a gap.
- **`libreoffice` deliberately absent** (~800MB for one tool that already
  degrades with a named message); the docs give the
  `docker compose exec` line instead.

Loopback OAuth callbacks (PSOK's own `:33418`, workspace-mcp's `:8765`,
Spotify's `:8888`) are why the default compose file uses `network_mode:
host` on Linux with `PSOK_BIND=127.0.0.1`: a bridge network forwards the
host's loopback to the container's interface, and a listener bound inside
the container to `127.0.0.1` never sees it. PSOK's own listener's *bind*
is overridable via `PSOK_OAUTH_CALLBACK_BIND` for bridge networking; the
redirect URI itself never changes because it is registered with the provider.
Google and Spotify run their own listeners and are host-networking-only,
documented as such rather than half-solved with published ports that fail at
redirect with a message that reads like a Google console misconfiguration.

## Alternatives Considered

- **A compose file with a web tier and an API tier.** Rejected: the one
  origin is a property of the app, and a second service buys a network and a
  CORS config for nothing.
- **`privileged: true` for a working sandbox.** Rejected: it hands the
  LLM-driven shell tool the capabilities the sandbox exists to constrain.
- **Auto-updating yt-dlp at start.** Rejected: every restart would depend on
  PyPI being up; the image documents
  `docker compose exec psok uv pip install --system -U yt-dlp` instead.

## Consequences

`docker compose up` is the whole contributor install. Personal state stays
out of image layers by construction (`.dockerignore` safety block, asserted
by `tests/test_docker_context.py`), and a degraded feature in a container —
notifications, bookmark watching, office conversion — is a documented row
in `docs/deployment.md` rather than a mystery. The exposure warning is the
same as the CLI's: no authentication; compose publishes on `127.0.0.1` only.
