# Memory

Long-term facts at `/memory`. Facts are extracted after a turn, recalled in
later conversations, and superseded rather than deleted.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Memory.jsx`, `memory.css` |
| Client | `frontend/src/api.js` → `api.memory`, `api.addMemory`, `api.toggleMemory`, `api.forgetMemory`, `api.restoreMemory`, `api.forgetAllMemories` |
| Routes | `backend/api/main.py` `/api/memory*` |
| Service | `backend/memory/service.py` |
| Store | `backend/memory/store.py` |
| Table | `memories` |
| Extraction | called by `backend/agent/director.py` after a turn |

## UI structure

- List of live facts with timestamps and originating conversation links.
- History: superseded facts and the fact that replaced them.
- Manual add.
- Edit (adds a new fact and supersedes the old one).
- Forget and restore.
- Memory on/off toggle, globally or per conversation.
- Search/filter across facts.

## Data model

`memories` is append-only in effect:

- A fact is never deleted on supersede. It gets `superseded_at`.
- `supersedes_id` points at the previous fact.
- `restore` clears the supersede marker for selected rows.
- `forget` is a soft delete unless the user explicitly clears everything.
- Vector index: `memory_vectors` with a recorded embedding model.
- `memory_settings` stores the global and per-conversation toggle.

This is deliberate: “what did AMETHYST believe last week” stays answerable.

## Extraction flow

1. A turn reaches `done`.
2. The Director calls `MemoryService.extract` with the recent transcript.
3. The model returns a diff: facts to add, facts to supersede.
4. `parse_diff` validates and sanitizes.
5. `apply` writes the new facts, marks superseded rows, and indexes vectors.
6. A `memory` event may be emitted for the UI.

Extraction is a second model call and is not part of the turn's terminal frame.
A failure does not fail the turn.

## Recall flow

1. Prompt assembly asks `MemoryService.recall(query, conversation_id)`.
2. Live facts are filtered by the memory toggle.
3. Semantic search runs if an embedder is configured; otherwise recent/live
   facts are used.
4. `render` formats the facts for the system prompt.

Recall is bounded. Memory is context, not a database the model can query
arbitrarily.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/memory` | List facts; query `conversation_id`, `include_retired` |
| POST | `/api/memory` | Add a fact manually |
| POST | `/api/memory/toggle` | Enable/disable memory |
| DELETE | `/api/memory` | Forget all |
| DELETE | `/api/memory/{id}` | Forget one |
| POST | `/api/memory/{id}/restore` | Restore a superseded fact |

## Modification guide

| Change | Touch |
|---|---|
| Change extraction prompt | `backend/memory/service.py` |
| Change fact parsing | `parse_diff`, `_sanitize_fact` |
| Change recall ranking | `recall`, `_semantic_ids`, `MemoryStore.search` |
| Change the UI | `frontend/src/views/Memory.jsx` |
| Change the schema | `backend/db/schema.sql`, `MemoryStore` |
| Change memory sync | `backend/sync/registry.py` (memories are append-only and already merge) |

Rules:

- Never hard-delete a fact on supersede.
- Keep extraction idempotent: the same transcript should not create duplicates.
- Do not put credentials or secrets into a fact. Sanitization is a backstop, not
  permission to store them.
- Keep the per-conversation toggle authoritative; a disabled conversation must
  not recall or extract.

## Known issues

- `Memory.jsx` falls back to `SAMPLE_FACTS` when the API returns no facts or
  fails. This is demo data, not persisted memory. It can make an empty install
  look populated. Treat it as a UI bug when changing the empty state.
- Extraction quality depends on the memory model. A weak model can produce
  vague or duplicate facts.
- Semantic recall requires an embedder. Without one, recall degrades to recent
  live facts.
- Memory is single-user. There is no per-fact access control.

## Related

- [AGENT-SYSTEM.md](../AGENT-SYSTEM.md)
- [DATABASE.md](../DATABASE.md)
- [DATA-FLOW.md](../DATA-FLOW.md)
- [systems/model-providers.md](../systems/model-providers.md)
- [sections/chat.md](chat.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
