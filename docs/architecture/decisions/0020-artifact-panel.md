# ADR-0020: The artifact panel — a view onto a file, declared by tool choice

## Status

Proposed

## Context

Output that is a *thing* — a markdown document, an email draft, a module, a
config — reads badly in a chat transcript. It arrives as a wall of fenced text
between two paragraphs of commentary, it cannot be scrolled independently of
the conversation, and the moment the next turn starts it is buried. The
transcript is a record of a conversation; a deliverable is not a conversational
turn.

The interface already has the slot for this. `App.jsx` owns a single
`<aside id="wb-panel">` and `components/SidePanel.jsx` portals into it with a
header, an eyebrow, a count, a close button and a footer. Chat's `RunPanel`
(steps) and Mail's thread panel are its two existing consumers. Nothing new is
needed to *hold* an artifact. What is missing is knowing when one exists, and
getting its content there while it is still being written.

Two facts about this codebase decide the design.

**Tool-call arguments already stream, and are already thrown away.**
`backend/runtime/providers/openai_compat.py` says it plainly: tool calls
"arrive fragmented across chunks -- the name in one, the JSON arguments a few
characters at a time in later ones -- so they are accumulated by index and only
parsed once the stream ends". The bytes needed to stream a document into a
panel are already arriving on every turn. `StreamEvent` (`backend/runtime/types.py`)
exposes `text | reasoning | done` and drops the fragments. One
OpenAI-compatible adapter covers six of the seven providers configured on this
machine.

**Prose is the wrong place to detect.** A fenced-block convention streams for
free through `assistant_delta`, but it either duplicates the content — once as
prose, once as a tool call to become a file — or has the backend writing files
the model never asked for. Fence discipline is also the first thing a small
open-weights model loses under load. The tool layer is the part of this system
that already works reliably across every provider, because every turn depends
on it.

## Decision

### An artifact is a view onto a file

Identity is the **resolved absolute path**. The file is the source of truth, as
it is for the library (ADR-0004). The panel holds no authoritative copy: on
reopen it reads the file. Nothing is duplicated into the database except
metadata, so a 400KB document costs 400KB once.

Consequence, stated plainly: **content the agent only says is not an artifact.**
An email draft becomes one when the model writes it somewhere. No scratch
directory is introduced — inventing `~/.amethyst/drafts/` adds a convention the
model must learn, and puts artifacts outside the workspace, which
`filesystem._resolve` flags as an escape. The model picks the path.

### Declaration is a tool name, not a flag

A new tool, `create_artifact(path, content, title?, language?)`, whose handler
delegates to the existing `write_file` implementation. It writes a file exactly
as `write_file` does — same sandbox, same `RiskLevel.MEDIUM`, same confirmation
gate and the same standing approval covering it. The only difference is what
its name tells the interface.

The name is why. A boolean argument has an ordering problem that cannot be
fixed by asking nicely: JSON key order belongs to the model, so `content` may
begin arriving before `artifact: true` does, and the assembler would have to
either buffer the whole document — losing the streaming this design exists for
— or open a panel speculatively and retract it. **A tool's name arrives in the
first fragment, before any argument, in every provider's protocol.** Detection
is therefore instant, order-independent, and streaming can begin at the first
byte of `content`.

It is also better steering. Choosing between two described tools is a task
open-weights models do well; setting an optional boolean on a tool they were
going to call anyway is one they routinely skip.

`write_file`, `create_document`, `edit_file` and `edit_document` are unchanged.

### Revision is by path

`edit_file` or a second `create_artifact` on a path that is already an open
artifact is **the next version of that artifact**, not a new one. The store
keys on `(conversation_id, resolved_path)`. Version is the write count.

Nothing reads the version until the follow-up work lands. It is in the event
payload from the first commit anyway, so the store never needs reshaping.

### Three events, over the existing frame

Emitted by the director through the same `data: {json}` SSE frame as every
other event, and handled in the same `onEvent` switch in `views/Chat.jsx`.

| Event | Payload | When |
|---|---|---|
| `artifact_open` | `id, path, title, media_type, language, version` | The tool name resolves to `create_artifact`, before any content |
| `artifact_delta` | `id, text` | A coalesced run of newly decoded `content` characters. **Append-only** |
| `artifact_done` | `id, bytes, version, is_error, message?` | The tool call has been dispatched and the file written, or it failed |

`id` is a stable hash of `conversation_id` + resolved path, so the same
document across three turns is one addressable artifact with three versions.

`artifact_delta` never carries the whole document. Re-sending accumulated
content on every tick is quadratic in the document's length, which is exactly
the shape of bug that only appears on the long documents the panel exists for.

`artifact_done` is authoritative. A stream that dies mid-document leaves an
artifact whose content is a prefix; `artifact_done` carries the real byte count
so the panel can tell a truncated artifact from a finished one instead of
rendering half a file as though it were whole.

### The assembler

A small state machine in the director, one instance per streamed tool-call
index, fed by a new `StreamEvent(type="tool_arguments", index, fragment)`.

1. Idle until the fragment's tool name is known and equals `create_artifact`.
2. Scan for the `"content"` key, its colon, and its opening quote. Emit
   `artifact_open` at that point — `path` is usually already decoded, and if it
   is not, `artifact_open` carries a provisional title and `artifact_done`
   corrects it.
3. Decode forward from a cursor, never rescanning from the start. Emit
   decoded characters. Stop at the first unescaped closing quote.
4. `artifact_done` when the completed `ToolCall` is dispatched.

The scanner handles JSON string escapes — `\n`, `\"`, `\\`, `\uXXXX` — and
**must hold back a partial escape sequence** at a fragment boundary rather than
emitting a lone backslash. A fragment can split `é` across five chunks.
This is the one genuinely fiddly piece of the design and it gets direct unit
tests with adversarial inputs: escapes split at every offset, a literal
`"content"` appearing inside an earlier string value, and a `content` key that
is never closed because the stream died.

If a provider does not stream fragments, nothing breaks: no
`tool_arguments` events arrive, and the completed-call path below emits
`artifact_open` / one `artifact_delta` / `artifact_done` back to back.

### Efficiency rules, which are load-bearing

- **Coalesce fragments.** Flush on 256 characters or 50ms, whichever comes
  first. One SSE frame per token would put a frame-per-token load on a panel
  that repaints, for no visible gain over 20fps.
- **Deltas append.** Never resend.
- **The frontend buffers in a ref and flushes on `requestAnimationFrame`.**
  Artifact content does not live in React state per delta; the transcript must
  not re-render because a document is being written beside it.
- **Raw while streaming, parsed when settled.** Re-parsing markdown on every
  delta is the classic way this feature becomes unusable at 2,000 words. The
  panel renders a plain `<pre>` during the stream and does the full
  markdown/highlight pass on `artifact_done` — which also makes the `</>` raw
  view free, because raw is what streaming already shows.
- **Metadata in the database, content on disk.** Reopening an artifact from a
  previous session reads the file.

### Staging

The three steps ship against **the same event contract**, so the panel is
written once.

1. **Detection.** `create_artifact`, the store, and the three events emitted
   from the completed tool call at `director.py:1100` — where `arguments` are
   already whole. No provider changes at all. `artifact_delta` fires once,
   carrying everything.
2. **Panel.** A second consumer of `SidePanel`, against those three events. It
   cannot tell how many deltas it received.
3. **Streaming.** `StreamEvent.type` gains `tool_arguments`; `openai_compat`
   yields the fragments it already accumulates; the assembler and scanner land.
   Anthropic (`input_json_delta`) and Google get their own adapter work.
   **The panel does not change** — it starts receiving forty deltas instead of
   one.

Deferred to follow-up work, deliberately: in-panel editing, feeding edits back
into the next turn, and version stepping. The version integer is in the payload
from step 1 so that work is additive.

## Consequences

**The panel is a peer of Steps, not a replacement.** Both consume the one
`#wb-panel` slot. Chat needs a small surface selector, which is also what the
pending side-panel redesign wants.

**A missed declaration is a normal `write_file`.** The file is still written
and still correct; it simply renders inline. That is the right failure: an
artifact that did not open costs a nicer view, not the work.

**No Tailwind.** The frontend has no Tailwind, no PostCSS config and no
`tailwind.config.*`. It is React 19 + Vite over one `index.css` of design
tokens (`--canvas`, `--raised`, `--r-md`, the `--space-*` scale) with
`data-theme` light/dark. The panel is built in that system. Adding Tailwind for
one component would put two styling systems in one interface and a second
theme mechanism next to the working one.

**`create_artifact` writes files, so it prompts.** It carries
`RiskLevel.MEDIUM` like `write_file`, deliberately: a tool that writes to the
filesystem without the gate because its output is pretty would be a hole. The
existing standing-approval mechanism covers the repeat case.

**Six providers, then two.** Streaming lands for every OpenAI-compatible
provider at once. Anthropic and Google stay on the step-1 path — whole
artifacts, no progressive render — until their adapters follow. They are not
broken in the meantime.
