"""Provider registry and resolution (ADR-0001).

Four builtin adapters. Any provider name not in the registry is looked up in the
user's providers.yaml and resolves to the OpenAI-compatible adapter unless the
entry declares a different native provider -- which is how Ollama, vLLM,
LM Studio, NVIDIA NIM, Groq and OpenRouter are supported with no code.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from backend.config import ProviderConfig, configured_providers, load_providers, load_tiers
from backend.runtime.http import MAX_RETRIES
from backend.runtime.providers import anthropic, google, ollama, openai_compat
from backend.runtime.types import ResolvedModel

log = logging.getLogger(__name__)

#: `(config, model, *, max_retries) -> ResolvedModel`. The retry allowance is
#: a keyword with a default, so an adapter written against the two-argument form
#: still satisfies it -- the fallback chain is the only caller that sets it.
Initializer = Callable[..., ResolvedModel]

PROVIDER_REGISTRY: dict[str, Initializer] = {
    "openai": openai_compat.initialize,
    "openai-compatible": openai_compat.initialize,
    "anthropic": anthropic.initialize,
    "google": google.initialize,
    "gemini": google.initialize,
    "ollama": ollama.initialize,
}


def _bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"} if key else {}


def model_lister(config: ProviderConfig):
    """How to ask this provider for its model list, and how to read the answer.

    Returns `(headers_for_key, parse_payload)`. The OpenAI shape -- a Bearer
    header and `{"data": [{"id": ...}]}` -- is the default and covers every
    adapter but one; Google wants `x-goog-api-key` and answers
    `{"models": [{"name": "models/..."}]}`, and answers a Bearer header with a
    401 that reads in the picker as a bad key.

    Keyed the way `resolve` keys adapters, so an entry naming a native adapter
    gets that adapter's answer and everything else gets the common one.
    """
    adapter_key = config.provider or config.name
    module = PROVIDER_REGISTRY_MODULES.get(adapter_key, openai_compat)
    headers = getattr(module, "auth_headers", None) or _bearer
    parse = getattr(module, "list_models", None) or openai_compat.list_models
    return headers, parse


#: The module behind each adapter name, for the optional hooks that are a
#: property of the *endpoint* rather than of a chat call -- listing models, so
#: far. `PROVIDER_REGISTRY` above maps to `initialize` and cannot answer this.
PROVIDER_REGISTRY_MODULES = {
    "openai": openai_compat,
    "openai-compatible": openai_compat,
    "anthropic": anthropic,
    "google": google,
    "gemini": google,
    "ollama": ollama,
}


class ProviderNotConfigured(RuntimeError):
    pass


def is_known_provider(provider: str) -> bool:
    """Whether resolve() would find an adapter, without initializing one.

    Lets an interface reject a bad provider name up front rather than letting it
    surface mid-turn, where the failure lands inside an already-open stream.

    "auto" counts, and is the one name here that is not a provider: it is what a
    conversation stores to say the router should choose. `resolve` still refuses
    it -- there is no adapter to build -- but a form that rejected it would make
    the picker's own Auto entry unsaveable.
    """
    from backend.runtime.router import AUTO

    return provider == AUTO or provider in load_providers() or provider in PROVIDER_REGISTRY


def resolve_tier(
    tier: str, *, max_retries: int = MAX_RETRIES
) -> ResolvedModel | None:
    """The model configured for a job, or None when nothing is configured for it.

    None is the ordinary answer on a machine with one provider, and every caller
    treats it as "use the conversation's own model" rather than as a failure.
    """
    entry = load_tiers().get(tier)
    if entry is None:
        return None
    try:
        return resolve(entry.provider, entry.model, max_retries=max_retries)
    except ProviderNotConfigured:
        # The provider was configured when the file was read and is not now, or
        # its key has gone. A tier that cannot be built is the same as one that
        # was never named.
        log.warning("tier '%s' names %s, which cannot be resolved", tier, entry.provider)
        return None


def default_chain(*, tier: str = "fast", limit: int | None = None) -> list:
    """Who to ask for background work that has no conversation behind it.

    A turn gets its provider from the conversation and its fallbacks from
    `build_chain`. A briefing has no conversation, so this picks the head the
    same way the rest of the system would -- the named tier if there is one,
    otherwise whichever provider the router ranks first -- and then hands it to
    `build_chain` for the alternatives.

    Walking a chain matters more here than it does in a turn. Nobody is watching
    at seven in the morning, and providers.yaml commonly lists a local endpoint
    first: without the chain, "Ollama is not running" was the entire briefing on
    a machine with two working cloud providers configured behind it.

    An empty list means nothing on this machine can answer, which the caller
    must say out loud. An entry with no prose and a stated reason is honest; an
    entry with invented prose is not.

    The head used to be "the first configured provider that declares a model",
    which on a laptop that lists Ollama first meant every briefing waited on a
    local model to wake up. It is the router's pick now -- unless a tier names
    one, which still wins, because a tier is a choice and the router is a guess.
    """
    from backend.runtime.chain import MAX_FALLBACK_LINKS, Link, build_chain
    from backend.runtime.router import route_for_tier

    configured = configured_providers()
    head: Link | None = None

    entry = load_tiers().get(tier)
    routed = route_for_tier(tier)
    if entry is not None and entry.provider in configured:
        # A configured tier still wins. A tier is somebody's stated choice about
        # this job and the router's ranking is a guess about it, and a guess
        # that overrides a statement is a setting that does not work.
        head = Link(provider=entry.provider, model=entry.model)
    elif routed.head is not None:
        head = routed.head

    if head is None:
        return []
    return build_chain(
        head.provider,
        head.model,
        configs=configured,
        # The router's ranking behind the head, so a briefing that falls off a
        # rate-limited provider lands on the next-best one rather than on
        # whichever entry happens to be next in the file.
        order=routed.order or None,
        limit=MAX_FALLBACK_LINKS if limit is None else limit,
    )


def resolve(
    provider: str, model: str | None = None, *, max_retries: int = MAX_RETRIES
) -> ResolvedModel:
    from backend.runtime.router import AUTO

    if provider == AUTO:
        # Reached only by a caller that skipped routing. Raised with the reason
        # rather than falling through to the openai-compatible adapter, which
        # would happily build a client for a provider named "auto" and fail on
        # the first round trip against a base URL nobody meant.
        raise ProviderNotConfigured(
            "'auto' is a routing choice, not a provider:"
            " the router picks one before the chain is built"
        )

    configs = load_providers()
    config = configs.get(provider)

    if config is None:
        if provider in PROVIDER_REGISTRY:
            # A builtin adapter with no providers.yaml entry: usable via env vars.
            config = ProviderConfig(name=provider)
        else:
            raise ProviderNotConfigured(
                f"provider '{provider}' is not in providers.yaml and is not a builtin adapter"
            )

    # An entry may name the adapter explicitly; otherwise use its own name;
    # otherwise fall through to the OpenAI-compatible adapter.
    adapter_key = config.provider or config.name
    initializer = PROVIDER_REGISTRY.get(adapter_key, openai_compat.initialize)
    return initializer(config, model, max_retries=max_retries)
