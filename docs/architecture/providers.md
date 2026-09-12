# Providers: the catalogue, the taxonomy and the chain

Built 2026-08-28. This is the "what happens when the provider cannot answer"
half of the AI runtime; [ai-runtime.md](ai-runtime.md) is the "how AMETHYST talks to
any provider" half, and it did not change. The adapter contract, the registry
and the OpenAI-compatible fall-through are the same as they were — this work
was a catalogue, a classification and a loop, not a rewrite.

## The problem, in the shape it was found

Four conversations in the real database had collected nine consecutive
`All connection attempts failed`. Nothing was wrong with the provider
abstraction. Three separate things were wrong around it:

1. **AMETHYST knew a provider's base URL, model id and key page, and told the user
   to go and edit YAML by hand.** `Settings.jsx` said "configured in
   `~/.amethyst/config/providers.yaml`" and stopped there. `providers.yaml` was
   read-only from the application's side: there was no `save_providers`, no
   `add_provider`, and `amethyst secrets`, referenced by the docs and by the
   starter file's own comments, had never been implemented.
2. **"Has a key" was being used to mean "can answer."** A local endpoint
   declares no key, so `has_key` called it configured by definition — and
   offered Ollama in the picker whether or not anything was listening on its
   port.
3. **Every failure was one `ProviderHTTPError` carrying a formatted string.**
   Nothing could tell "retry this" from "wrong model name" from "the account is
   out of credit". The only existing consumer had resorted to
   `if "unreachable" in str(exc)`.

## The catalogue

`backend/provider_catalogue.py` holds thirteen presets — slug, label, base URL,
default model, context window where it is known, key page, docs page. Each is
the set of facts needed to write one `providers.yaml` entry.

The starter file is **generated from the catalogue** (`render_default_providers`)
and lists twelve of them, so the file itself is the menu -- base URL, model and
keychain ref already written, making "add a provider" one `amethyst secrets set`
rather than research. Listing costs nothing: `configured_providers` filters out
any entry whose key is missing, so a listed provider is not an offered one.
`amethyst doctor` summarises the keyless ones on one line rather than warning per
provider, which would train the reader to skip the section that also reports
real faults.

The file is generated rather than hand-written. The hand-written one had drifted: Groq sat commented
out while the docs claimed it was configured, and Cerebras existed in neither.
`amethyst doctor` had grown a check to report the drift, which is a good sign the
two should not have been separate lists.

Two deliberate omissions, both to avoid a reserved slot for code that does not
exist:

- **No `auth_style` field.** openhuman's `AuthStyle` enum is why Anthropic is
  not a bespoke adapter there, and that is the right shape when every provider
  goes through one generic client. AMETHYST already has native adapters for the two
  that do not speak Bearer-and-chat-completions, so the field would be read by
  nothing. `adapter` names the mechanism that already exists.
- **`context_window` only where it is known.** A declared window overrides the
  adapter's guess, so a wrong one is worse than none — it fails loudly
  mid-generation instead of merely wasting room. Presets whose window varies per
  model (OpenRouter, Together, Fireworks, NVIDIA) leave it unset.

Writing is `config.save_providers` / `add_provider` / `remove_provider`,
modelled on `backend/mcp/config.py`, which has done the same for `mcp.yaml` since
connectors shipped. `yaml.safe_dump` cannot preserve comments, so the header is
re-emitted on every write and hand-written per-entry comments are lost on the
first programmatic edit — the honest trade for being able to edit the file at
all. Other top-level keys, `memory:` in particular, are left alone.

## Cloudflare Workers AI, and a content shim it needed

Cloudflare rides the OpenAI-compatible adapter like every other non-native
provider — its `/ai/v1/chat/completions` endpoint speaks standard
chat-completions, so the whole integration is one catalogue preset. The one
quirk: the account id lives in the base URL
(`.../accounts/<id>/ai/v1`), so the preset ships an `ACCOUNT_ID` placeholder
that must be filled in, and a wrong one 404s visibly rather than failing as a
mystery. Verified live 2026-08-28: `complete`, streaming and tool calls all work
through the runtime on `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (the preset
default — fast, tool-capable, no reasoning overhead; `@cf/openai/gpt-oss-120b`
also works but spends a few hundred tokens thinking before it answers, which
starves a small `max_tokens`).

It also surfaced a real robustness bug in the shared adapter. Cloudflare
serialises a purely **numeric** content token — the "3" in a reply that counts —
as a JSON number, so `delta.content` arrived as an int and `"".join(text_parts)`
raised `expected str instance, int found`, killing the whole stream over one
token. The spec says content is a string; `_as_text` is the shim for the
providers that treat that as advisory, applied on both the streaming and
non-streaming paths. Locked down by two mutation-checked tests.

## Declared context windows

`ProviderConfig` gained `context_window`. The adapters take it and fall back to
what they did before: `_context_window`'s substring match for
OpenAI-compatible, and the hardcoded figure for Anthropic (200k), Ollama (32k)
and Google (1M).

This matters because the guess falls through to **128,000 for anything
unrecognised**, and `nvidia/nemotron-3-ultra-550b-a55b` matches nothing — so
`budget_history` was trimming history against a number nobody had checked. A
value that is not a positive integer is discarded rather than obeyed: zero would
make the budget negative and cut the history to two messages every turn, which
reads as the model forgetting the conversation rather than as a typo.

**Tool schemas now come out of the same budget.** They measured 29,620 tokens
across 132 tools from seven connectors — more than the system prompt — and
`budget_history` had never counted one of them, so the budget was wrong by
exactly their size in the direction that overflows the window. `tool_schema_tokens`
serialises them the way the adapter sends them, and the director now builds the
schemas *before* budgeting rather than after.

## The failure taxonomy

`backend/runtime/failures.py`. `ProviderError` (and its subclasses
`ProviderHTTPError` and `ProviderStreamError`, now both defined in
`runtime/http.py`) carries `kind`, `status` and `body` alongside the message.

| Kind | Means | Retry? | Fall back? |
|---|---|---|---|
| `RETRYABLE` | 408, 409, 425 | yes | yes |
| `RATE_LIMITED` | 429 that clears on its own | yes | yes |
| `NON_RETRYABLE_RATE_LIMIT` | 429/402 from exhausted quota or credit | **no** | yes |
| `UPSTREAM_UNHEALTHY` | 5xx | yes | yes |
| `UNREACHABLE` | nothing answered | yes | yes |
| `NON_RETRYABLE` | bad key, unknown model, malformed request | no | **no** |

Two decisions come off a failure and they are not the same decision. Retry asks
the *same* provider again; fall back asks a *different* one. That is why the
table has two columns and why the two exhausted-quota and bad-request rows sit
on opposite diagonals:

- **An exhausted quota is not retried but is worth another provider.** Both
  arrive as 429 and only one clears by waiting, so the body is consulted
  (`QUOTA_MARKERS`). Retrying a billing failure spends four attempts to re-read
  the same sentence; a different provider answers it immediately.
- **A bad request stops the chain.** A model name that does not exist at
  provider A does not exist at provider B either, so falling back turns one fast
  failure into several slow ones.

Error frames delivered *inside* an already-200 stream carry no status, so
`classify_stream_error` maps their own names (`overloaded_error`,
`context_length_exceeded`, …). Anything unrecognised is treated as a bad
request, which is the conservative reading: it stops rather than retries.

## Availability

`backend/runtime/availability.py`, fed from two sources kept deliberately apart:

- **A probe**, for endpoints whose credential tells us nothing — one `GET
  {base}/models` with a 3-second timeout. *Any* HTTP answer counts as reachable:
  a 401 means something is there and disagrees with us, which is a different
  problem from nothing being there.
- **Observed failures**, for everything else. Probing a dozen cloud providers on
  a health poll that runs every twenty seconds would spend real latency to learn
  what the next turn finds out for free, so a cloud provider is presumed
  available until a turn proves otherwise and the director reports what it saw.

Only `UNREACHABLE` and `UPSTREAM_UNHEALTHY` are recorded. A 404 for a model name
says nothing about the provider's health and must not take it out of the picker
— the fix for that is a different model, not a different provider.

Both kinds of entry expire (60s for a probe, 300s for an observed failure) and
`forget()` clears them, because a cache of "this is broken" with no way out is
how "start Ollama and it still says unavailable" happens.

`GET /api/health` reports `providers_unavailable` as a `{name: reason}` map
beside `providers`. Unavailable providers stay **listed**: the user configured
them on purpose, so they get a reason rather than vanishing. Both pickers read
it -- the composer's `ModelMenu` dims the row and says "not answering", and
Settings shows the reason in full.

## The chain

`backend/runtime/chain.py`. The chosen provider first, then up to two others.

- **Order** is `providers.yaml`'s own order — the closest thing to a stated
  preference that exists without inventing a setting. A top-level `fallback:`
  list overrides it.
- **A provider with no `default_model` is not a candidate**, because
  substituting it in would mean guessing a model name, and a guessed model name
  is the failure [turns.md](turns.md) already documents fixing once.
- **A provider known to be down is skipped**, for the same reason the picker
  stops offering it.
- **Capped at two fallbacks.** The failure this exists for — one provider down —
  is fixed by the first alternative; a chain that walks every configured
  provider spends minutes proving the network is broken.

### One attempt budget, not one per link

`AttemptBudget` starts at `MAX_RETRIES + 1` for the whole chain. Each link's
`allowance` is what it may spend while leaving one attempt for every link behind
it. Four attempts per link across three links is twelve attempts at a
120-second timeout, which is worse than failing.

### What the loop does

`Director._run` walks the chain inside each iteration. `active` only ever moves
forward, so a provider that failed once is **not** rediscovered on every later
iteration of a fifteen-step turn. On a hand-over the history is **re-budgeted
against the fallback model's own context window** — carrying a 200,000-token
history into a 32,000-token fallback would trade one provider's outage for the
next one's refusal.

One thing stops a hand-over: **a non-fallback kind** (see the table).

Text already on screen used to stop one too — a second provider would restart
the answer underneath the half the user was reading, which is worse than
failing. That reasoning held until resumes shipped. `state.carried` is rebuilt
into the wire as an assistant message plus `RESUME_AFTER_CUT` ("continue from
exactly where it stops"), and neither is provider-specific, so a *different*
provider continues a cut answer exactly the way the same one does.

What the old rule cost: NVIDIA's NIM emits `Error in input stream` inside an
already-200 body, intermittently, **after** tokens have moved — precisely the
case the guard excluded. A mid-answer failure could then only be retried on the
provider that had just failed, and once `max_resumes` ran out the turn died
holding half a sentence with healthy providers still in the chain. Now the
provider that was talking gets its two resumes first, and only then does the
chain move on, carrying the partial.

### When the chain is exhausted

What decides the ending is **what is in hand, not how the connection ended**.

- **An answer, whole or partial** — a `guard` frame, which the interface draws
  as a neutral note, on the `stopped` phase. The text is persisted as the
  answer, with no `[model error]` note stapled under it, and `stopped` keeps
  `AgentState.resumable` true (`carried and phase != "completed"`) so the
  pickup offer survives a reload (ADR-0021).
- **Nothing** — an `error` frame on the `failed` phase, as before. A neutral
  note over an empty turn would hide a real failure.

This used to be one path ending in `error` either way. A turn that streamed a
*complete* answer and then had its stream fall over on the way out — a provider
sending an error frame instead of closing cleanly, which NVIDIA's NIM does —
rendered the whole answer and then a red card saying it had failed. Which is
the half the reader believes: the work is done, and the interface says it is
broken.

The user is told in one `warning` frame:

> `nvidia was unreachable — answering with groq/llama-3.3-70b instead`

or, when there is already half an answer on screen:

> `nvidia returned a server error — continuing with groq/llama-3.3-70b instead`

"answering with" would be wrong and alarming there: the reader can see text
above the line, and being told somebody else is *answering* reads as that text
being about to be thrown away.

Decided with the user: visible, one line, no stack trace. `warning` is not a
terminal event, so no plumbing in the API, the frontend or the CLI needed
changing. The provider's own error body is in the audit log; what belongs in the
transcript is which provider answered, because that changes how the answer
should be read.

Post-turn memory extraction uses the model that **answered**, not the one named
on the conversation — after a fallback those differ, and the conversation's is
the one just proven unable to answer.

## The interface

Settings → Models writes the file instead of describing it: the configured list
with a per-row state (`ready` / `needs a key` / `not answering`), the unlisted
catalogue with an Add button each, and a "something else" row for any
OpenAI-compatible endpoint. The form is inline rather than a modal — a dialog
over a dialog puts the thing you were reading behind the thing you are filling
in.

**No route ever returns a key.** `POST /api/providers` takes one, stores it in
the OS keychain, and answers with `ready` / `needs_key` / `needs_model` — the
same rule `mcp_set_env` already held to. A key with surrounding whitespace is
refused with the reason, because it would be sent verbatim and fail as a bad
key rather than as a bad paste.

`DELETE /api/providers/{name}` drops the entry and **keeps the key**. Removing a
provider from a list and destroying the credential behind it are different
decisions, and only one of them is reversible from that screen;
`amethyst secrets delete` is the other one.

## CLI

`amethyst secrets set|list|delete` and `amethyst providers list|catalogue|add|remove`.
`secrets set` prompts rather than taking the key as an argument, because an
argument lands in shell history and in `ps` — which is how the NVIDIA key and
the Google secret both ended up in a transcript that then had to be rotated.
`secrets list` prints which declared references have a key and never a value.

`amethyst doctor` now points at `amethyst providers add <name>` instead of printing the
YAML for the user to copy.

## Verified

- 45 tests in `tests/test_providers_and_fallback.py`; 503 in the suite; `ruff`
  clean; `npm run lint` and `build` clean.
- End to end against real HTTP, no mocked transport — a live `http.server` on
  one port and a dead port for the other entry:
  - primary unreachable → answered by the fallback in 2.1s with exactly one
    warning line naming both providers;
  - primary returns 404 → failed in 0.00s with **no** fallback attempt;
  - `survey` afterwards reported `broken` unavailable with its reason and
    `working` available.
- Live `amethyst serve`: `/api/health` reported Ollama listed and
  `providers_unavailable: {ollama: "nothing answered at
  http://localhost:11434/v1 (ConnectError)"}` with Ollama not running;
  `POST /api/providers` added DeepSeek and wrote the entry; a name with `../` in
  it and a custom entry with no base URL were both 400s.

## Routing (ADR-0023)

The chain decides who answers when the chosen provider cannot. The router
decides who is chosen. It produces an **order**, which `build_chain` already
took as an argument — so this is a better candidate list, not a second
mechanism. `backend/runtime/router.py`.

**Where it applies.** Most specific first, which is the same precedence the
chain already used:

| The conversation says | Head | Order |
|---|---|---|
| a provider, and its own `fallback` list | the provider | the list |
| a provider, no list | the provider | routed |
| `auto` | routed | routed |

Background work with no conversation (`default_chain`) always routes, except
that a configured `tiers:` entry still wins the head — a tier is somebody's
stated choice about that job, and the router is a guess about it.

**What it scores.** Every input is already measured or already in
providers.yaml; nothing is inferred by a model. Request size and tool count come
from the same estimator the tokens-per-minute precheck uses, vision from the
attachments, health from `availability`, local-ness from whether a credential is
declared, headroom from the ledger below.

Terms are additive and named in one `WEIGHTS` table. Two of them are
**penalties** rather than bonuses, which is not cosmetic: scored as bonuses,
declaring a `tokens_per_minute` ceiling or a `context_window` was worth points,
so the provider that published its limits started ahead of the one that
published nothing — and an almost-exhausted provider still beat an idle peer.
As penalties, "nothing declared" and "declared and comfortable" both score zero.
The window penalty has a deadband for the same reason: a 400-token question does
not care that the window is 131,072.

**Core is a tier.** Providers marked `core` in the catalogue sort ahead of
everything else, and scoring decides within each pool. Preferred, never
exclusive — a provider that cannot answer is not in the ranking at all, so Auto
reaches the user's own providers whenever no core one can, with no special case.
`auto_route: false` marks an endpoint under evaluation: offered in the picker,
honoured in a hand-written fallback chain, never chosen unattended.

**The rate-limit ledger.** `availability.record_usage` counts what each request
cost against a rolling minute — the provider's own token counts where it reports
them, the precheck's estimate where it does not. `headroom(config)` answers what
fraction of the *declared* ceiling is left. An undeclared ceiling answers 1.0:
unknown is not unlimited, but an unknown ceiling cannot be steered by, and
guessing one would route around a provider that was fine. In memory, not
persisted — one uvicorn worker, and a lost window costs at most one 429 that
`record_exhausted` already absorbs with the provider's own `Retry-After`.

**Total network failure.** When every configured cloud provider is *known* to be
down (observed, not merely silent), the decision is marked `offline` and a local
endpoint is hoisted to the head with that as its stated reason. When nothing at
all can answer, the head is `None` and the caller must say so — the Director
turns that into one sentence naming each provider's own rejection reason, rather
than a general "no provider available" that sends someone to look at entries
that are all correct.

**Explainability.** `RouteDecision.explain()` is persisted on the run row
(`agent_runs.state.route`) and served by `GET /api/routing`. Every provider
considered stays in `candidates`, including the excluded ones, each carrying
either the reasons that moved its score or the reason it was ruled out — a
provider filtered out of the output cannot answer "why not that one", which is
the question the surface exists for.

**Switches.** `enabled: false` in providers.yaml is the state between configured
and deleted: the entry and its key stay, the picker stops offering it. Checked
in `chain._usable` as well as in the router, because a conversation's own
fallback list bypasses the router entirely.

**The floor.** A machine that declares no `strengths`, has spent nothing and
marks nothing core routes in providers.yaml's own order — the ranking's last
sort key. Routing reorders on evidence; it does not invent a preference where
there is none.

## Not built, on purpose

- **A control in the interface for the per-conversation chain.** The column and
  the PATCH field are there and tested; nothing in the UI sets them yet, so it
  is an API-level setting today.
- **Probing cloud providers on a schedule.** Costs latency on every health poll
  to learn what the next turn learns for free.
- **A generic client with per-provider auth flags.** See the catalogue section.
- **A local classifier in front of routing.** Checked first, as instructed, and
  not needed: every routing input is a figure the loop has already measured. A
  classifier would spend a model call re-deriving them and make the one part of
  routing that must be explainable the one part that could not be.
- **Persisted usage history.** Spend over time is a different feature from
  routing and can be added without touching the router.
- **Per-model routing.** The router picks a provider; the model is that
  provider's `default_model`, exactly as the chain already does. Choosing among
  one provider's models needs per-model metadata that does not exist.
