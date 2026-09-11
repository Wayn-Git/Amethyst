# AGENTS.md

Orientation for an AI coding agent working in this repo. Kept short on purpose — read the
linked doc, not this whole tree, when you need depth on a specific area.

## What this is

AMETHYST: a single-user, local-first AI agent over the user's files, shell, tasks, calendar,
notes and connected services. Python/FastAPI backend, React/Vite frontend, SQLite storage.
No auth, no multi-user support, deliberately — see README "What was never built".

## Where things live

```
backend/agent/        the loop: reason -> act -> observe, planning, escalation
backend/api/main.py    every HTTP/SSE endpoint
backend/runtime/       provider adapters (one contract, per-provider quirks stay inside)
backend/tools/builtin/ filesystem, shell, desktop, tasks, calendar, convert, documents, web
backend/mcp/           MCP transports, OAuth, catalogue, lifecycle, risk
backend/retrieval/     chunking, embeddings, hybrid (BM25 + vector) index
backend/db/            schema, connection, repositories
frontend/              React app, built by Vite, served by the same process
```

Full architecture map: `docs/architecture/overview.md`. Per-subsystem docs live under
`docs/architecture/` (journal, library, instagram, ai-runtime, providers, mcp, security, etc.)
— open the one that matches your task, not all of them.

## Three design rules that constrain any change here

1. **Everything above the dispatcher is a tool.** A builtin function and an MCP call are
   indistinguishable to the model. Adding capability should not touch the core loop.
2. **Permission is a floor, not negotiable.** A tool's risk level can only be escalated by
   the model, never lowered. Do not write code that lets a tool self-report a lower risk.
3. **The model interprets, a deterministic engine computes.** Date/time resolution,
   calendar conflict checks, etc. are not the model's job — don't reintroduce model-side
   arithmetic for things that have a deterministic path.

## Hard constraints before you touch anything

- **Single worker only.** `amethyst serve` must never run with `--workers N` or gunicorn.
  Five in-process background runners share one SQLite file; multiple workers duplicate writes.
- **No real secrets in the connector catalogue.** Only `AMETHYST_DEFAULT_*` env var *names*,
  never values. Enforced by `tests/test_docker_context.py`.
- **Backend must be installed editable (`-e`).** `main.py` resolves the frontend build path
  relative to its own file location; a non-editable install serves a blank page with no error.

## Before opening a PR

```bash
ruff check backend tests
pytest                     # skips -m live by default
cd frontend && npm run lint && npm run build
```

Full contributor setup, including Windows/WSL2 specifics, is in `CONTRIBUTING.md` and
`TROUBLESHOOTING.md` — read those for command-by-command detail, not this file.