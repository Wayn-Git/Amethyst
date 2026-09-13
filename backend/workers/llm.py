"""The one place a background worker is allowed to spend a model.

Two rules, and both exist because a worker has nobody watching it.

**It reasons once, not once per item.** Every caller here hands over a *batch*
and gets one answer. A hundred URLs is not a hundred calls; `backend/workers/
urls.py` shortlists first and this makes a single request over the survivors.
The counter in the return value is not decoration -- a test asserts it never
exceeds one, because "it quietly became one call per row" is the failure that
would not otherwise be visible until a bill arrived.

**It never silently reaches a paid endpoint.** An interactive turn spending a
metered key is a person's choice made in front of them. A briefing at seven in
the morning doing it every day, without a prompt and without a reader, is not.
So a worker routes over free endpoints only -- local, or a hosted no-card tier
(`ProviderPreset.free`) -- and when none of them is reachable it returns *no
summary and the reason*, rather than falling through to whatever else is
configured. The fetched pages are still there; only the reasoning is missing,
and that is the right way round.

Lifting it is a deliberate act: `allow_paid_models: true` in workers.yaml, or
`paid_ok=True` from a caller that has a person's decision behind it.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.config import ProviderConfig, configured_providers
from backend.provider_catalogue import preset
from backend.runtime import availability
from backend.runtime.registry import resolve
from backend.runtime.router import route_for_tier
from backend.runtime.types import ModelParameters
from backend.workers.accounts import load_workers

log = logging.getLogger(__name__)

#: How many providers a worker will try before giving up. Not the whole chain:
#: nobody is waiting, but nobody is watching either, and a worker walking twenty
#: dead endpoints is a worker holding a lease for ten minutes to produce nothing.
MAX_ATTEMPTS = 3
#: Workers summarise and classify. Neither wants the biggest model available.
TIER = "fast"
DEFAULT_MAX_TOKENS = 900


def is_free(config: ProviderConfig) -> bool:
    """Whether using this account costs money, as declared -- never as guessed.

    A provider with no catalogue entry is treated as paid. That is the safe
    direction: an unknown endpoint that turns out to be free costs a worker a
    summary, and an unknown endpoint that turns out to be metered costs money
    nobody agreed to.
    """
    entry = preset(config.name)
    if entry is None:
        return False
    return bool(entry.local or entry.free)


def free_providers() -> list[ProviderConfig]:
    """Every configured account a worker may spend without asking."""
    return [config for config in configured_providers().values() if is_free(config)]


#: How gateways mark a model that costs nothing. OpenRouter and Kilocode both
#: suffix the model id, and it is the model rather than the account that is free
#: on those -- so a catalogue flag on the provider cannot express it.
FREE_MODEL_SUFFIX = ":free"


def free_to_use(provider: str, model: str | None) -> bool:
    """Whether asking this provider for this model spends anything.

    Two ways to be free, because there are two kinds of free endpoint. A whole
    account can be free -- a local runner, a no-card tier -- which the catalogue
    declares. Or a *model* can be free on an account that also sells metered
    ones, which is how every gateway works, and there the account flag would be
    wrong in both directions.

    Without the second test a machine whose only configured providers are
    gateways had no free provider at all, so every worker refused to reason and
    said the endpoints "would have cost money" -- about a model id ending in
    `:free`.
    """
    if is_free(ProviderConfig(name=provider)):
        return True
    return bool(model and model.strip().lower().endswith(FREE_MODEL_SUFFIX))


def _providers(*, paid_ok: bool) -> tuple[list[str], str]:
    """Provider names to try, best first, and why the list is as short as it is.

    The provider router does the choosing -- this only filters what it returned,
    so a worker gets the same headroom-aware, availability-aware ordering an
    interactive turn gets, minus the endpoints it is not allowed to use.

    `RouteDecision.order` is a list of provider *names*, not resolved models --
    the same thing `build_chain(order=...)` takes. The model for each is the
    one that provider declares, except for the head, which the router has
    already picked a model for.
    """
    decision = route_for_tier(TIER, needs_tools=False)
    order = list(decision.order)
    if paid_ok:
        return order[:MAX_ATTEMPTS], ""

    free = [name for name in order if free_to_use(name, _model_for(name))]
    if free:
        return free[:MAX_ATTEMPTS], ""
    if order:
        names = ", ".join(sorted(set(order))[:4])
        return [], (
            f"no free provider is reachable; {names} would have cost money, so nothing"
            " was asked. Set allow_paid_models in workers.yaml to change that."
        )
    return [], "no provider is configured"


def _model_for(provider: str) -> str | None:
    """The model to ask this provider for, or None to let `resolve` decide."""
    configs = configured_providers()
    config = configs.get(provider)
    return config.default_model if config else None


async def ask(
    prompt: str,
    *,
    system: str = "",
    max_tokens: int = DEFAULT_MAX_TOKENS,
    paid_ok: bool | None = None,
) -> dict[str, Any]:
    """One model call, over free endpoints. Returns what happened, never raises.

    The return is always the same shape -- `calls`, and then either `text` and
    `provider` or `note` -- so a caller never has to decide whether reasoning
    was possible before reading the answer.
    """
    if paid_ok is None:
        paid_ok = load_workers().allow_paid_models

    providers, refusal = _providers(paid_ok=paid_ok)
    if not providers:
        return {"calls": 0, "note": refusal}

    messages = [{"role": "user", "content": prompt}]
    if system:
        messages.insert(0, {"role": "system", "content": system})

    calls = 0
    tried: list[str] = []
    for provider in providers:
        model = _model_for(provider)
        try:
            resolved = resolve(provider, model)
        except Exception as exc:
            tried.append(f"{provider}: {exc}")
            continue
        calls += 1
        try:
            response = await resolved.client.complete(
                messages, None, ModelParameters(max_tokens=max_tokens)
            )
        except Exception as exc:
            # Recorded so the next worker routes around it, the same way an
            # interactive turn's failure does. A worker that fails silently
            # teaches the router nothing.
            availability.record_failure(provider, "unreachable", str(exc))
            tried.append(f"{provider}: {type(exc).__name__}")
            continue
        availability.record_success(provider)
        if response.input_tokens or response.output_tokens:
            availability.record_usage(
                provider, (response.input_tokens or 0) + (response.output_tokens or 0)
            )
        return {
            "calls": calls,
            "text": (response.text or "").strip(),
            "provider": provider,
            "model": resolved.model,
            "free": free_to_use(provider, resolved.model),
        }

    return {"calls": calls, "note": "every free provider refused: " + "; ".join(tried[:3])}


async def summarize_pages(
    pages: list[dict[str, Any]], *, query: str = "", paid_ok: bool | None = None
) -> dict[str, Any]:
    """One answer over many pages. The call count is the contract.

    Whatever the length of `pages`, this makes at most one request. The pages
    arrive numbered and the model is asked to cite those numbers, so a claim in
    the summary can be traced back to the address it came from -- provenance a
    reader can check rather than a paragraph they have to trust.
    """
    if not pages:
        return {"calls": 0, "note": "nothing to summarise"}

    body = "\n\n".join(
        f"[{index}] {page.get('title') or page.get('url')}"
        f" ({page.get('site') or page.get('url')})\n{page.get('text') or ''}"
        for index, page in enumerate(pages, start=1)
    )
    asked = f"The question: {query}\n\n" if query else ""
    result = await ask(
        f"{asked}{len(pages)} source(s) follow, numbered.\n\n{body}",
        system=(
            "You are summarising sources someone else collected. Answer in plain"
            " prose. Cite the bracketed number of every source you use. Say when"
            " the sources disagree, and say when they do not answer the question"
            " rather than filling the gap."
        ),
        paid_ok=paid_ok,
    )
    result["sources"] = [page.get("url") for page in pages]
    return result


async def classify(
    items: list[str], *, labels: list[str], paid_ok: bool | None = None
) -> dict[str, Any]:
    """Put each item in one of `labels`. One call for the whole list.

    The deterministic half of a collector should already have filtered and
    deduplicated; this is for the last step that genuinely needs judgement --
    which of forty already-collected messages actually needs a reply.
    """
    if not items or not labels:
        return {"calls": 0, "note": "nothing to classify", "labels": {}}

    numbered = "\n".join(f"{index}. {text[:400]}" for index, text in enumerate(items, start=1))
    result = await ask(
        f"Labels: {', '.join(labels)}\n\nItems:\n{numbered}",
        system=(
            "Label each numbered item with exactly one of the given labels."
            ' Answer with JSON only: {"1": "label", "2": "label"}. No prose.'
        ),
        max_tokens=200 + 12 * len(items),
        paid_ok=paid_ok,
    )
    assigned: dict[str, str] = {}
    text = (result.get("text") or "").strip()
    if text:
        # A model asked for JSON usually returns JSON, and sometimes returns it
        # inside a fence. Neither is worth a parser -- and a failure here is a
        # missing label, not a failed job.
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                assigned = {
                    str(key): str(value)
                    for key, value in parsed.items()
                    if str(value) in labels
                }
            except (ValueError, AttributeError) as exc:
                log.debug("a classification did not parse: %s", exc)
    result["labels"] = assigned
    return result
