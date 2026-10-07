# Amethyst documentation

Everything written about how the system works, and where to find it. Start with
the architecture overview if you are new, then whichever subsystem you are
touching.

## Start here

| Doc | Read it when |
|---|---|
| [../README.md](../README.md) | You want the one-page picture: what it is, features, quick start |
| [../QUICKSTART.md](../QUICKSTART.md) | You are installing it for the first time |
| [architecture/overview.md](architecture/overview.md) | You need the layer model, the request lifecycle, or the design principles everything else derives from |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | You are about to change code |

## Guides

| Doc | What it covers |
|---|---|
| [CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md) | Every integration: model providers, OAuth apps, the Cloudflare relay, Library capture |
| [deployment.md](deployment.md) | One process on one port, or the Vercel + Render split — and when to pick which |
| [interface.md](interface.md) | The web UI: each view, the keyboard bindings, and the rationale for the design |
| [IMPROVEMENTS.md](IMPROVEMENTS.md) | Parallel execution, smart file reading, LLM intelligence rules |
| [../relay/README.md](../relay/README.md) | The Cloudflare Worker: deploy, routes, the share token |

## Architecture

| Doc | Subsystem |
|---|---|
| [architecture/overview.md](architecture/overview.md) | Layer diagram, request lifecycle, ADR index |
| [architecture/components.md](architecture/components.md) | The four nouns: tool, skill, MCP tool, agent |
| [architecture/ai-runtime.md](architecture/ai-runtime.md) | Provider adapters, streaming, fallback |
| [architecture/providers.md](architecture/providers.md) | The provider catalogue, its taxonomy, and the fallback chain |
| [architecture/turns.md](architecture/turns.md) | A turn that always resolves, whatever the model does |
| [architecture/modes.md](architecture/modes.md) | Chat vs. agent mode, and a loop that narrates itself |
| [architecture/data-model.md](architecture/data-model.md) | Schema, the multi-store split, what lives where |
| [architecture/security.md](architecture/security.md) | Permissions, sandboxing, credentials, the audit trail |
| [architecture/jobs.md](architecture/jobs.md) | Durable jobs — work that must survive a restart, and work that must not |
| [architecture/scheduling.md](architecture/scheduling.md) | Date resolution, conflicts, free-slot search |
| [architecture/tasks.md](architecture/tasks.md) | Lists, buckets, the board, Microsoft To Do sync |
| [architecture/library.md](architecture/library.md) | Capture, storage, enrichment, search — the eight doors |
| [architecture/instagram.md](architecture/instagram.md) | Webhook intake, reel capture, and why the relay exists |
| [architecture/connectors.md](architecture/connectors.md) | What a connector is, what is offered, local vs. Composio ownership |
| [architecture/mcp.md](architecture/mcp.md) | MCP strategy: one flat tool registry |
| [architecture/mcp-oauth.md](architecture/mcp-oauth.md) | What connecting an app actually does |
| [architecture/skills.md](architecture/skills.md) | Skills as markdown, loading, the catalogue |
| [architecture/automation.md](architecture/automation.md) | A prompt on an interval, and its beta contract |
| [architecture/journal.md](architecture/journal.md) | The journal and what reads from it |
| [architecture/desktop.md](architecture/desktop.md) | Launching, startup order, single instance, tray, global shortcut |

## Decision records

Numbered ADRs in [architecture/decisions/](architecture/decisions/). They record
what was chosen and, more usefully, what was rejected and why.

| | |
|---|---|
| [0001](architecture/decisions/0001-ai-provider-abstraction.md) | AI provider abstraction |
| [0002](architecture/decisions/0002-primary-database-engine.md) | Primary database engine |
| [0003](architecture/decisions/0003-vector-storage.md) | Vector storage |
| [0004](architecture/decisions/0004-storage-architecture-multi-store-split.md) | Storage architecture — the multi-store split |
| [0005](architecture/decisions/0005-tool-architecture.md) | Tool architecture |
| [0006](architecture/decisions/0006-skills-architecture.md) | Skills architecture |
| [0007](architecture/decisions/0007-mcp-strategy.md) | MCP strategy |
| [0009](architecture/decisions/0009-local-computer-shell-execution-permissions.md) | Local computer / shell execution and permissions |
| [0010](architecture/decisions/0010-scheduling-architecture.md) | Scheduling architecture |
| [0011](architecture/decisions/0011-authentication.md) | Authentication |
| [0012](architecture/decisions/0012-credential-storage.md) | Credential storage |
| [0013](architecture/decisions/0013-local-first-ai-default-posture.md) | Local-first AI default posture |
| [0015](architecture/decisions/0015-desktop-gui-automation-scope.md) | Desktop / GUI automation scope |
| [0016](architecture/decisions/0016-agent-loop-ownership-and-concurrency.md) | Agent loop ownership and concurrency |
| [0017](architecture/decisions/0017-conversation-message-persistence-model.md) | Conversation / message persistence model |
| [0018](architecture/decisions/0018-container-image.md) | One container image, one process, no extra capabilities |
| [0019](architecture/decisions/0019-default-app-registrations.md) | Default app registrations — shared registration, never a shared account |
| [0020](architecture/decisions/0020-artifact-panel.md) | The artifact panel — a view onto a file, declared by tool choice |
| [0021](architecture/decisions/0021-agent-run-state.md) | Agent run state — one row per turn |
| [0022](architecture/decisions/0022-durable-jobs.md) | Durable jobs for unattended work, and not for turns |
| [0023](architecture/decisions/0023-dynamic-routing.md) | Deterministic routing over the existing fallback chain |
| [0024](architecture/decisions/0024-multi-device-sync.md) | Cross-device synchronisation |

ADR-0008 and ADR-0014 do not exist; the numbering was never compacted, and
renumbering would break every reference to the records that do.

## Screenshots

[images/](images/) holds the captures used in the README and the interface doc.

## Conventions in here

- A doc that describes a mechanism names the file and the function that
  implements it, so it can be checked rather than trusted.
- When a design decision changes, the ADR gains a line saying it superseded
  something — the old record is not edited into agreeing.
- Nothing in this directory is a substitute for the code. If the doc and the
  code disagree, the code is right and the doc is the bug.
