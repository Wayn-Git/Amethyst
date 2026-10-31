# Amethyst — Agent Instructions

## Core Principle

Before exploring or modifying the codebase, understand the relevant architecture through the documentation in `docs/agent-context/`.

The objective is to minimize unnecessary repository exploration, reduce repeated analysis, prevent architectural misunderstandings, and make development more efficient.

Documentation is a navigation and understanding layer, not a substitute for inspecting actual source code.

## 1. Before Starting Any Task

1. Read `docs/agent-context/INDEX.md`.
2. Identify the application section, subsystem, or components relevant to the task.
3. Read only the relevant documentation files.
4. Check any linked dependencies or related systems that could be affected.
5. Verify documented file paths and implementation details against the actual source code before making assumptions.

Do not blindly explore the entire repository when the documentation already identifies the relevant files.

## 2. Repository Exploration

- Prefer documented entry points over searching the entire repository.
- Use targeted searches rather than recursively reading unrelated files.
- Trace dependencies only as far as necessary to understand the requested change.
- Inspect actual implementations before editing.
- Expand exploration when documentation is missing, outdated, contradictory, or insufficient.
- Never assume a documented implementation is still accurate without verification.

## 3. Documentation Structure

The central documentation directory is:

`docs/agent-context/`

It contains:

- `INDEX.md` — central navigation and documentation directory.
- `ARCHITECTURE.md` — overall application architecture.
- `FRONTEND.md` — frontend architecture and conventions.
- `BACKEND.md` — backend architecture and services.
- `DATABASE.md` — database schemas and relationships.
- `AGENT-SYSTEM.md` — agent execution and orchestration.
- `MCP-INTEGRATIONS.md` — tools and integrations.
- `DATA-FLOW.md` — important application data flows.
- `DEVELOPMENT-GUIDE.md` — setup, verification, change recipes, documentation maintenance.
- `sections/` — individual application sections.
- `systems/` — cross-cutting systems and infrastructure.
- `components/` — significant shared components.

The actual documentation inventory is defined by `INDEX.md`. Do not assume every listed file exists until verified.

## 4. Documentation Maintenance

Documentation must evolve alongside the implementation.

Whenever a task changes architecture, component responsibilities, dependencies, APIs, data flow, database structures, or application behavior:

1. Identify affected documentation.
2. Update only the relevant documents.
3. Verify all referenced paths.
4. Remove obsolete implementation details.
5. Update the documentation index if necessary.
6. Record unresolved uncertainties instead of inventing explanations.

Do not regenerate the entire documentation library for minor changes.

Purely cosmetic changes do not require documentation updates unless they change documented design conventions or component structure.

## 5. Accuracy and Reliability

- Actual source code is the source of truth.
- Documentation must describe implemented functionality, not intended functionality.
- Clearly distinguish implemented, experimental, deprecated, and planned features.
- Never invent file paths, APIs, dependencies, database fields, or integrations.
- Avoid duplicating information across multiple documents.
- Link related documents instead of copying their entire contents.
- Record verification dates and Git commit references where practical.

If documentation conflicts with implementation, trust the implementation and correct the documentation when appropriate.

## 6. Development Principles

- Preserve existing architectural conventions unless explicitly asked to change them.
- Avoid unnecessary dependencies and abstractions.
- Avoid broad refactoring when a targeted change is sufficient.
- Preserve existing functionality.
- Do not introduce mock functionality or pretend integrations are implemented.
- Keep changes focused on the user's request.

### Repository-specific guardrails

- Home dashboard work starts with `docs/dashboard-spec.md` and records progress in `docs/dashboard-changelog.md`. The current implementation map is in `docs/agent-context/sections/today.md` and `docs/agent-context/components/widget-system.md`.
- Drafts only. Writes go through the permission gate in `backend/security/confirmation.py`.
- Use theme tokens, not hardcoded visual values. Never invent features or data.
- Run only the tests for the code you touched; verify the served desktop build when changing the frontend.

## 7. Completion

Before completing a task:

- Verify the modified implementation.
- Check relevant dependencies and affected sections.
- Update documentation when necessary.
- Report important files changed.
- Mention any architectural implications or remaining uncertainties.

**Remember:** Understand the relevant part of Amethyst, inspect what matters, make the smallest appropriate change, and keep the knowledge base accurate.
