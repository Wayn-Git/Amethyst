#!/bin/sh
# One process, and it is uvicorn.
set -e

# Idempotent by construction: paths().ensure() is mkdir(exist_ok=True), the
# schema is CREATE TABLE IF NOT EXISTS, and seed_builtin_skills() skips any
# skill directory that already exists. Running it on every start is what makes
# a fresh volume work without a separate setup step.
amethyst init

# `exec` so uvicorn replaces this shell and receives SIGTERM directly. It has
# real work to do on the way down -- backend/api/main.py's lifespan stops five
# background runners and shuts down the MCP manager, and skipping that leaks
# the stdio subprocesses those connectors spawned.
#
# Single process, deliberately. Do not add --workers or put gunicorn in front:
# the reminder loop, the journal runner, the automation runner, the Instagram
# relay poller and the MCP manager are all in-process state, and a second
# worker starts a second copy of every one of them against one SQLite file.
exec amethyst serve --host "${AMETHYST_BIND:-0.0.0.0}" --port "${AMETHYST_PORT:-8000}"
