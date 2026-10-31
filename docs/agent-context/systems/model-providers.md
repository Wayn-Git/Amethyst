# Model Providers and Routing

How AMETHYST turns a provider name into a streaming client, chooses a provider
for a turn, falls back when one fails, and configures tiers, embeddings and
auxiliary models.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [BACKEND.md](../BACKEND.md), [AGENT-SYSTEM.md](../AGENT-SYSTEM.md),
[sections/settings.md](../sections/settings.md), [DATA-FLOW.md](../DATA-FLOW.md).

## Provider model

`providers.yaml` is the inventory. Every entry is a `ProviderConfig`
(`backend/config.py`):

```yaml
providers:
  groq:
    provider: openai-compatible
    base_url: https://api.groq.com/openai/v1
    api_key_ref: amethyst/groq
    default_model: llama-3.3-70b-versatile
    context_window: 131072
    max_tools: 128
    tokens_per_minute: 8000
    strengths: [fast]
  ollama:
    provider: ollama
    base_url: http://localhost:11434
    default_model: qwen2.5:7b
```

Key rules:

- `api_key_ref` is a keychain reference, never a key.
- `api_key_env` is the fallback environment variable.
- An entry with no credential is treated as local/unauthenticated.
- `enabled: false` keeps the entry and key but removes it from routing.
- Any name not in the builtin registry resolves to the OpenAI-compatible
  adapter unless it declares `provider: anthropic|google|gemini|ollama`.
- `configured_providers()` returns only entries whose key is present. Settings
  and the model picker use this; `resolve()` still honours an explicitly named
  provider.

## Adapters

`backend/runtime/registry.py`:

| Adapter key | Module | Shape |
|---|---|---|
| `openai`, `openai-compatible` | `providers/openai_compat.py` | OpenAI chat completions; the default for Groq, vLLM, LM Studio, NVIDIA NIM, OpenRouter, etc. |
| `anthropic` | `providers/anthropic.py` | Messages API, thinking budget, tool blocks |
| `google`, `gemini` | `providers/google.py` | Generative Language API; `x-goog-api-key` for model listing |
| `ollama` | `providers/ollama.py` | Local Ollama chat API |

All adapters return the normalized shapes in `backend/runtime/types.py`:
`ModelResponse`, `ToolCall`, `ToolSchema`, `Capabilities`, `ModelParameters`,
`StreamEvent`, `ResolvedModel`.

`Capabilities` carries facts the router and loop need:

- `tools`, `streaming`, `vision`, `reasoning`
- `context_window`
- `max_tools` (where the endpoint caps schemas)
- `tokens_per_minute` (account ceiling, not context)
- `parallel_tool_calls`

`ModelParameters.answer_tokens` is separate from `max_tokens` because Anthropic
bounds thinking and answer together. Adapters translate or drop unsupported
fields.

`backend/runtime/vision.py` and `transcribe.py` handle image description and
audio transcription. `history_sanitizer.py` strips provider-incompatible
history. `partial_json.py` parses streaming tool arguments.

## Resolution

`registry.resolve(provider, model, max_retries=...)`:

1. Refuse `auto`; it is a routing choice, not an adapter.
2. Look up `providers.yaml`.
3. A builtin adapter with no entry is usable through environment variables.
4. Choose the adapter from `config.provider or config.name`, defaulting to
   OpenAI-compatible.
5. Build the client and resolve capabilities.

`ProviderNotConfigured` is the failure for an unknown or unusable provider. It
is raised before a stream opens where possible.

`is_known_provider()` lets a form reject a bad name early; `auto` counts as
known so the picker's Auto entry is saveable.

## Auto routing

`AUTO = "auto"` is stored in `conversations.provider` like any other name. The
Director replaces it with a real provider before building the chain.

`backend/runtime/router.py` scores every configured provider against the request:

`RouteRequest` inputs:

- `tier`: `fast | default | heavy`
- `context_tokens`
- `tool_count`, `needs_tools`
- `needs_vision`
- `interactive`
- `prefer_local` (`None` = decide)

Weights:

| Term | Weight | Meaning |
|---|---|---|
| `strength` | +3.0 | Endpoint is tagged for this shape of work |
| `headroom` | -2.0 | Scaled by how much of its declared minute is gone |
| `window` | -1.5 | Scaled by how much of its context the request fills |
| `local_offline` | +5.0 | Nothing else can answer |
| `local_online` | -1.0 | Local is slower than a working cloud provider |
| `tool_cap` | -0.5 | Its tool cap will force a trim |

Hard rejections (`_rejection`):

- switched off,
- no default model,
- still under evaluation (`auto_route=False`),
- known unavailable,
- request exceeds a **declared** context window.

Tool caps are not rejections; `fit_tools_to_budget` trims schemas instead.

Ordering: core providers first as a tier, then score, then `providers.yaml`
order. The result is a `RouteDecision` with `head`, `order`, `offline` and a
per-candidate explanation. That explanation is persisted and served; there is
no second, truer reason kept elsewhere.

`route_for_tier(tier)` is the no-measurement variant for background work.

## Tiers

`providers.yaml` may name three tiers:

```yaml
tiers:
  fast:    {provider: groq, model: llama-3.1-8b-instant}
  default: {provider: anthropic, model: claude-sonnet-4-5}
  heavy:   {provider: google, model: gemini-2.5-pro}
```

`TIERS = ("fast", "default", "heavy")`. A configured tier wins over the router
for that job. An entry naming an unconfigured provider is dropped with a log
line; one bad tier must not stop the others.

`registry.resolve_tier()` returns `None` when nothing is configured. Callers
treat that as "use the conversation's model", not as an error.

## Fallback chain

`backend/runtime/chain.py`:

Order, most specific first:

1. The conversation's `fallback` column (JSON list). An empty list means **do
   not fall back**.
2. A top-level `fallback:` list in `providers.yaml`.
3. The router's ranking.
4. `providers.yaml` order.

`MAX_FALLBACK_LINKS = 2`, so at most three providers are tried. Every fallback
link uses **its own** `default_model`, never the failed model string. That is why
a dead model id at provider A is allowed to fall back.

`AttemptBudget` is shared across the whole turn:

- default total `MAX_RETRIES + 7` (10),
- every remaining link is reserved one attempt,
- `allowance(links_after)` gives the current link the rest,
- bounded by the turn's `max_seconds` and the per-iteration resume cap.

Once deltas have reached the interface, a fallback does not restart the answer.
The Director carries the partial in `state.carried` and asks the next provider
to continue from there.

## Failure taxonomy

`backend/runtime/failures.py`:

| Kind | Retry same? | Fall back? |
|---|---|---|
| `RETRYABLE` | yes | yes |
| `RATE_LIMITED` | yes, honours `Retry-After` | yes |
| `UPSTREAM_UNHEALTHY` | yes | yes |
| `UNREACHABLE` | yes | yes |
| `NON_RETRYABLE_RATE_LIMIT` (quota/credit) | no | yes |
| `NON_RETRYABLE` (bad key, unknown model, malformed) | no | yes |

Nearly everything falls back. The bound on cost is `AttemptBudget` and
`MAX_FALLBACK_LINKS`, not a "this looks permanent" guess.

`reason_for(kind)` produces the short user-facing line, e.g. "was unreachable".
The provider's full error body goes to the audit log, not the transcript.

## HTTP behavior

`backend/runtime/http.py`:

- `MAX_RETRIES = agent_config.max_network_retries`.
- `CONNECT_TIMEOUT = 15.0`.
- Streaming and non-streaming paths retry transient failures.
- A 4xx can trigger one sanitized minimal-payload retry, because some providers
  reject fields they claim to support.
- `ProviderHTTPError` carries a `FailureKind`, status and body.

Availability is cached in `backend/runtime/availability.py` so routing and
health checks do not probe on every turn. `clears_in()` gives the router a
human-readable wait.

## Auxiliary models

| Role | Configuration | Default |
|---|---|---|
| Embeddings | `embeddings:` in `providers.yaml` | Ollama `nomic-embed-text` |
| Memory extraction | `memory:` | Conversation's model |
| Vision | Provider capabilities | Adapter-specific |
| Transcription | `transcribe.py` | Configured provider |

Embedding candidates (`EMBEDDING_CANDIDATES`):

```text
ollama      nomic-embed-text
cloudflare  @cf/baai/bge-base-en-v1.5, @cf/baai/bge-m3
openai      text-embedding-3-small
openrouter  text-embedding-3-small
google      text-embedding-004
```

`backend/retrieval/embeddings.py`:

- No arguments means "whatever the user configured", not Ollama.
- `BATCH_SIZE = 32`.
- A refused endpoint is remembered for the process, so a machine without Ollama
  does not pay the connect timeout twice per turn.
- `amethyst embeddings detect` probes candidates and can persist the first
  working one.
- The embedding model used to build the index is recorded in `app_settings`;
  changing it invalidates the vector index.

## Model catalogue

`backend/provider_catalogue.py` supplies presets: display name, core flag,
auto-routable flag, strengths, context window, tool cap and known models.
`backend/runtime/models_dev_catalog.py` can fetch models.dev metadata.
`backend/runtime/reasoning_catalog.py` maps reasoning effort support.

A catalogue fact is not a user setting. The user's `providers.yaml` wins for
strengths and limits; the catalogue fills what the file does not say.

## Modification guide

| Change | Touch |
|---|---|
| Add a builtin adapter | `backend/runtime/providers/`, `PROVIDER_REGISTRY`, `PROVIDER_REGISTRY_MODULES` |
| Support a new OpenAI-compatible service | Add a `providers.yaml` entry; no code |
| Change routing weights | `WEIGHTS` and `_score` in `router.py` |
| Change rejection rules | `_rejection` in `router.py` |
| Change fallback order | `chain.py`, conversation `fallback`, `providers.yaml` |
| Add a tier | `TIERS`, `load_tiers`, settings UI |
| Change retry policy | `runtime/http.py`, `runtime/failures.py` |
| Change embeddings | `retrieval/embeddings.py`, `EMBEDDING_CANDIDATES` |
| Change the model picker | `frontend/src/components/ModelMenu.jsx`, `/api/providers*` |

Rules:

- Never store a key in `providers.yaml`; store a reference.
- Never let a fallback link reuse the failed model id.
- Never multiply the retry budget per link.
- Never restart an answer that has already streamed; continue it.
- A tier is a choice; the router is a guess. The tier wins.
- Do not invent a quota; only use a declared `tokens_per_minute`.

## Known issues

- Routing is a scoring function, not a classifier. It can be wrong when all
  inputs are right; the explanation is the debugging surface.
- `context_window` guessed from a model name defaults to 128,000 for anything
  unrecognized. A declared value is the only trustworthy one.
- Tool caps are endpoint-specific and often undocumented; `max_tools: None`
  means "not observed", not "unlimited".
- A local provider with no credential is assumed reachable until a probe fails.
- The embedding index is tied to one model. Switching models requires a
  re-index.
- Provider health is cached; a recovered provider can stay marked unavailable
  until the cache clears.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
