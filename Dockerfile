# PSOK as one image: one process, one port, one origin.
#
# The API already serves the built single-page app when frontend/dist exists
# (backend/api/main.py, _mount_frontend), so there is no second service to run
# and no cross-origin request to configure. That is the whole reason this is a
# single image rather than a compose file with a web tier.
#
# Build:  docker build -t psok:local .
# Run:    docker compose up          (see docker-compose.yml)


# --------------------------------------------------------------------- web
#
# Node 24 because vite 8 requires Node >= 20.19, and -bookworm-slim so this
# stage shares a glibc with the runtime stage below -- that is what makes
# copying the node binary across stages work at all.

FROM node:24-bookworm-slim AS web

WORKDIR /build

# Dependencies first, so editing a component does not reinstall the tree.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# VITE_API_BASE is deliberately unset. Empty means same-origin, which is
# correct here: one process serves both halves. Setting it would hard-code an
# address into the bundle at build time.
RUN npm run build


# ----------------------------------------------------------------- runtime
#
# Python 3.12 to match render.yaml's PYTHON_VERSION, so a bug reproduced in
# this container is a bug on Render rather than a version difference.

FROM python:3.12-slim-bookworm AS runtime

# uv and uvx as static binaries rather than `pip install uv`. Pinned, because
# uvx is the program backend/mcp/catalogue.py shells out to when it starts a
# connector, and `latest` would make that a moving target.
COPY --from=ghcr.io/astral-sh/uv:0.12.8 /uv /uvx /usr/local/bin/

# node and npx, copied from the same Debian base as the web stage. Half the
# MCP catalogue is an npx package (playwright, chrome-devtools, memory,
# microsoft-todo, spotify), so a container without npx has half a catalogue.
# Copying beats adding the NodeSource apt repository: no third-party signing
# key, and the version is pinned by the tag above.
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# ffmpeg carries ffprobe too, and backend/media/audio.py checks for both.
# poppler-utils is pdftotext, the extraction fallback in backend/documents.
# bubblewrap is the shell sandbox; see the note on USER below for when it works.
#
# Not installed, on purpose:
#
#   libnotify-bin -- it would put notify-send on PATH, backend/notify.py would
#     then select it, and every reminder would fail against a D-Bus session
#     that does not exist in a container. Absent, _notifier() returns None and
#     warns exactly once. Absence is the correct configuration here, not a gap.
#
#   libreoffice -- ~800MB for one tool. backend/tools/builtin/convert.py
#     already degrades with a named message when soffice is missing. Add it in
#     a running container if you need it:
#       docker compose exec psok apt-get install -y libreoffice-writer
RUN apt-get update && apt-get install --no-install-recommends -y \
      ca-certificates \
      ffmpeg \
      poppler-utils \
      bubblewrap \
      curl \
      git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer, kept separate from the source so editing backend code does
# not re-resolve the tree. Hatchling needs the package directory to exist for
# an editable install to resolve, hence the stub.
COPY pyproject.toml README.md ./
RUN mkdir -p backend && touch backend/__init__.py

# Every extra except dev, and each one earns its place:
#
#   vector      sqlite-vec. Without it backend/retrieval/store.py catches the
#               error, logs a warning nobody reads, and search silently falls
#               back to keyword-only. Silent degradation is the failure mode
#               you cannot debug remotely. ~1MB.
#   documents   pdftotext covers reading; nothing covers writing. There is no
#               honest way to author a .docx without python-docx.
#   providers   openai and anthropic, or the two headline providers are
#               unreachable and `psok doctor` reports none configured.
#   reels       yt-dlp, the fallback route for an Instagram permalink. It goes
#               stale in weeks; refresh it in place rather than at boot:
#                 docker compose exec psok uv pip install --system -U yt-dlp
#               Auto-updating at start would make every restart depend on PyPI.
#
# The -e is load-bearing and not a development habit. backend/api/main.py
# resolves the SPA as parents[2]/frontend/dist relative to its own file; a
# non-editable install puts that file in site-packages, the path resolves to
# somewhere with no frontend, and _mount_frontend returns silently. The symptom
# is a working API behind a blank page, with nothing in the logs.
RUN uv pip install --system --no-cache -e '.[providers,vector,documents,reels]'

COPY backend/ ./backend/
COPY --from=web /build/dist ./frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/psok-entrypoint

# The assertion that turns the blank page above into a failed build.
RUN python -c "from backend.api.main import _DIST; assert (_DIST / 'index.html').is_file(), _DIST"

# Runs as a normal user. bubblewrap needs unprivileged user namespaces, which
# most hosts allow but some (Ubuntu 24.04's apparmor_restrict_unprivileged_userns)
# do not. backend/security/sandbox.py handles that already: platform_backend()
# returns None, commands run directly, and `psok doctor` says so.
#
# Do NOT add privileged: true or cap_add: SYS_ADMIN to make bwrap work. That
# grants the container the capabilities needed to escape it, in order to
# constrain a tool inside it -- strictly worse than no sandbox. In a container
# the container is the boundary, and it is a tighter one than bwrap gives on a
# laptop: this process sees /data/psok, /home/psok and nothing else of yours.
RUN useradd --uid 1000 --create-home --home-dir /home/psok psok \
 && mkdir -p /data/psok /opt/uv-cache /opt/npm-cache /opt/cache \
 && chown -R psok:psok /data/psok /home/psok /opt/uv-cache /opt/npm-cache /opt/cache \
 && chmod +x /usr/local/bin/psok-entrypoint

# PSOK_SECRETS_FILE is mandatory in a container, not optional: there is no OS
# keychain here, and without it every attempt to store a key answers 503
# (backend/secrets.py). Keeping it inside PSOK_HOME means one volume covers
# both, which is what render.yaml does too.
#
# The caches must sit OUTSIDE $HOME. $HOME is a volume, and a volume mount
# shadows whatever the image put at that path -- so a uv cache under ~/.cache
# would be invisible at runtime and every first connect would re-download.
#
# XDG_CONFIG_HOME is deliberately NOT set: microsoft-todo-mcp writes
# ~/.config/microsoft-todo-mcp/token-cache.json and the catalogue entry reads
# that exact path, so redirecting it would break sign-in detection.
#
# PSOK_CORS_ORIGINS is deliberately unset: one origin, so the dev default is
# correct and an allowlist would only be a way to get it wrong.
ENV PSOK_HOME=/data/psok \
    PSOK_SECRETS_FILE=/data/psok/secrets.json \
    HOME=/home/psok \
    UV_CACHE_DIR=/opt/uv-cache \
    UV_LINK_MODE=copy \
    npm_config_cache=/opt/npm-cache \
    XDG_CACHE_HOME=/opt/cache \
    PYTHONUNBUFFERED=1 \
    PSOK_BIND=0.0.0.0 \
    PSOK_PORT=8000

USER psok

EXPOSE 8000

# /api/ping and not /api/health: health surveys every configured provider over
# the network, which would make container liveness depend on OpenAI being up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PSOK_PORT}/api/ping" || exit 1

ENTRYPOINT ["/usr/local/bin/psok-entrypoint"]
