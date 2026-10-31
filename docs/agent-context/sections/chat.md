# Chat

The agent workbench at `/chat`. This is the primary surface: a conversation
transcript, streaming turn output, tool traces, approvals, artifacts and a
terminal drawer.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Chat.jsx` (eagerly imported) |
| Route | `/chat`; `/` redirects to `/today`, not here |
| Client | `frontend/src/api.js` → `api.turn(...)`, `api.conversations()` |
| Endpoint | `POST /api/conversations/{id}/turn` (SSE), `POST .../turn/stop` |
| Loop | `backend/agent/director.py` |
| State | `backend/agent/state.py` |

Chat is the only eagerly loaded view. Every other view is a lazy chunk
(`frontend/src/views/registry.js`).

## Source map

```text
frontend/src/views/Chat.jsx              page, composer, transcript, turn wiring
frontend/src/components/TurnTrace.jsx    tool-call trace
frontend/src/components/TurnRail.jsx     turn navigation rail
frontend/src/components/ResponseActionBar.jsx
frontend/src/components/ResponseEditor.jsx
frontend/src/components/ResponseArtifactBox.jsx
frontend/src/components/ArtifactPanel.jsx
frontend/src/components/SourcesSidePanel.jsx
frontend/src/components/ComposioConnectCard.jsx
frontend/src/components/ConnectorWaitCard.jsx
frontend/src/components/widgets/         inline widget envelopes
frontend/src/components/TerminalDrawer.jsx
frontend/src/components/ConfirmModal.jsx
frontend/src/components/ModelMenu.jsx
frontend/src/components/EffortMenu.jsx
frontend/src/components/GuardMenu.jsx
backend/agent/director.py                the loop
backend/agent/prompt.py                  prompt assembly
backend/agent/state.py                   phases and guards
backend/agent/projection.py              tool-result shaping for context
backend/agent/tool_search.py             tool selection and schema visibility
backend/conversations/                   conversation repository helpers
```

## UI structure

- Conversation sidebar with create, rename, branch, archive, delete, pin.
- Transcript with Markdown, code blocks, streaming blur, message actions and
  artifact boxes.
- Composer with model, effort, guard and workspace controls.
- Live turn trace: each `tool_call` and `tool_result` renders as it arrives.
- Approval card for `confirmation_required`.
- Question card for `question_required`.
- Connector card for `connection_required` / `connector_failed`.
- Inline widgets for `widget` events.
- Terminal drawer backed by `backend/terminal.py` and the terminal router.
- Sources panel extracted from assistant messages.

## Turn contract

Request fields: `message`, `mode`, `guard`, `effort`, `provider`, `model`,
`variant`, `workspace`, `depth`, `attachments`.

Rules enforced by the endpoint:

- One active turn per conversation. A second POST returns 409.
- Unknown mode returns 400.
- A remote device cannot weaken the guard.
- The stream opens before slow connector work, so the browser never holds a
  silent request.

Client handling (`api.turn`):

1. POST and read the SSE body with a reader.
2. Dispatch each frame by event name.
3. Accumulate `assistant_delta`; replace on `assistant_text` if sent.
4. Render `tool_call` before the result; update on `tool_result`.
5. Treat `done`, `error` and `guard` as terminal.
6. On abort, call the stop endpoint and keep partial output.

Do not add a second fetch loop or parse the stream in a component. Keep the
parser in `api.js`.

## Modes and guards

- Mode controls whether the turn may act or only plan. `TURN_MODES` in
  `backend/api/main.py` is authoritative.
- Guard controls the permission ceiling. A remote device is restricted to
  `guard` or `read-only`.
- Effort controls reasoning budget where the provider supports it.
- Depth limits subagent nesting.

## Persistence

Messages are written as the turn progresses. A cancelled turn keeps partial
messages. The run row records provider, model, tokens and terminal status.
Tool calls are audited in `execution_logs`.

Memory extraction runs after `done` and is a separate model call. It can fail
without failing the turn.

## Modification guide

| Change | Touch |
|---|---|
| Add a streamed event | `backend/agent/director.py`, `frontend/src/api.js`, the consuming component, and the event list in [AGENT-SYSTEM.md](../AGENT-SYSTEM.md) |
| Change composer controls | `Chat.jsx`, the menu component, `TurnRequest` |
| Change approval UI | `ConfirmModal.jsx`, `backend/security/confirmation.py` |
| Change artifact handling | `ResponseArtifactBox.jsx`, `ArtifactPanel.jsx`, artifact routes |
| Change tool trace | `TurnTrace.jsx`, `backend/agent/projection.py` |
| Change conversation list | `Chat.jsx`, `api.conversations`, `ConversationRepository` |

Rules:

- Do not render raw tool output. Projection and sanitization happen server-side
  (`backend/agent/projection.py`, `backend/mcp/composio_sanitizer.py`).
- Do not let a component call `fetch` directly for turns.
- Preserve the terminal-frame contract. A turn that ends without one leaves the
  UI spinning.
- Keep the stop path reachable during connector startup.

## Known issues

- A turn is single-flight per conversation. There is no queue; the second
  request is refused rather than deferred.
- Disconnect cancels the turn. Refreshing mid-turn loses the live stream;
  partial messages remain.
- `Chat.jsx` is large and owns many concerns. Prefer extracting a component
  rather than adding another block of state.
- Inline widgets render only what the server envelope allows; see
  [components/widget-system.md](../components/widget-system.md).

## Related

- [AGENT-SYSTEM.md](../AGENT-SYSTEM.md)
- [DATA-FLOW.md](../DATA-FLOW.md) — chat turn sequence
- [systems/tool-execution.md](../systems/tool-execution.md)
- [systems/state.md](../systems/state.md)
- [components/shared.md](../components/shared.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
