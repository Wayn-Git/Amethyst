"""Which provider is the best one to ask, for the request actually in hand.

`backend/runtime/chain.py` answers "this provider is down, who else" and
answers it well. What it does not do is *choose*: its candidate order is the
order of providers.yaml, which is a stated preference about providers in
general and says nothing about the turn in front of it. A 200,000-token
question went to whichever entry was first in the file, and a one-line question
went to the same place -- so a machine with Groq and Gemini configured used the
fast one for the work that needed the big window and the big one for the work
that needed the round trip.

This is the choosing half. It produces an *order*, which `build_chain` already
takes as an argument -- so routing is a better candidate list, not a second
mechanism running beside the first. Everything downstream is unchanged: the
same chain, the same shared `AttemptBudget`, the same failure taxonomy, the
same announcements.

**It scores, it does not classify.** Every input is a number the loop has
already measured or a fact already in providers.yaml:

* how big the request is -- the loop budgets history against a context window
  on every iteration and already computes this
* whether tools and vision are needed -- it is holding the schemas and the
  attachments
* how much of a provider's declared minute is left -- `availability.headroom`
* whether a provider is up -- `availability.cached`
* whether it is local -- whether it declares a credential

A classifier in front of this would spend a model call at the head of every
turn to re-derive figures the turn already has, and would make the one part of
routing that must be explainable the one part that cannot be. If routing is
ever observed picking wrong with all of the above correct, that is the evidence
that something smarter is needed; it is not the starting assumption.

**It does not invent quotas.** The only ceiling it reads is
`tokens_per_minute`, declared per account in providers.yaml, because that is
the number that changes without warning and must not be compiled in. The
catalogue's `strengths` tags are facts about an endpoint's character, of the
same kind and the same shelf life as the context window sitting next to them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from backend.config import ProviderConfig, configured_providers
from backend.provider_catalogue import preset
from backend.runtime import availability
from backend.runtime.chain import Link

log = logging.getLogger(__name__)

#: The provider name that means "you pick". Stored in `conversations.provider`
#: like any other name, so nothing downstream needs a second column or a
#: nullable one -- but it is not a provider and `resolve` refuses it. The
#: Director swaps it for a real one before the chain is built.
AUTO = "auto"

#: Above this many tokens a request is "large" and a big declared window stops
#: being a nicety. Set at the point where the smallest windows in the catalogue
#: (128k) start to matter, not at a model's limit -- the question here is which
#: provider to prefer, and the provider that cannot take it at all is excluded
#: by `_rejection` further down rather than scored low.
LARGE_CONTEXT_TOKENS = 60_000

#: The same conservative correction the director applies before a
#: tokens-per-minute precheck (`TPM_SAFETY_MARGIN`). Four-chars-per-token
#: under-counts dense tool-schema JSON badly enough that Groq's own tokenizer
#: reported 18,091 for a request this side measured at 12,000. Duplicated as a
#: constant rather than imported because `backend.agent` must not be imported
#: from the runtime (ADR-0001's component boundary); the two are checked
#: against each other by a test.
TPM_SAFETY_MARGIN = 1.5

#: What each term can contribute. Written out as one table rather than as magic
#: numbers scattered through `_score`, because the only way to tune routing is
#: to read these against each other and the only way to do that is to have them
#: in one place. Higher wins.
#:
#: `headroom` and `window` are *penalties*, and that is not an accident. Scored
#: as bonuses they made declaring metadata worth points: a provider that
#: published a tokens-per-minute ceiling started two points ahead of one that
#: published nothing, so a Groq entry with 10% of its minute left still beat an
#: idle Cerebras that had simply never declared a limit -- the exact steer this
#: file exists to make, backwards. As penalties, "nothing declared" and
#: "declared and comfortable" both score zero, which is the honest reading:
#: an unknown ceiling cannot be steered by, so it must not move the score.
WEIGHTS = {
    "strength": 3.0,       # the endpoint is known to be good at this shape of work
    "headroom": -2.0,      # scaled by how much of its declared minute is *gone*
    "window": -1.5,        # scaled by how much of its context window this fills
    "local_offline": 5.0,  # nothing else can answer, and this one needs no network
    "local_online": -1.0,  # a local model is slower than a cloud one that works
    "tool_cap": -0.5,      # its tool cap will force a trim (a cost, not a bar)
}


@dataclass(frozen=True)
class RouteRequest:
    """What the caller knows about the work, in the terms the router scores.

    Every field has a default that describes an ordinary interactive turn, so a
    caller that knows nothing still gets a sane order rather than having to
    describe a request it has not measured.
    """

    #: fast | default | heavy -- the caller's own statement about how hard this
    #: is, and the only input here that is a judgement rather than a measurement.
    tier: str = "default"
    context_tokens: int = 0
    tool_count: int = 0
    needs_tools: bool = True
    needs_vision: bool = False
    #: Whether somebody is waiting. A briefing at seven in the morning can spend
    #: thirty seconds on a slow provider; a turn in the composer cannot.
    interactive: bool = True
    #: None means "decide from what is reachable", which is the useful answer
    #: almost always. True pins local, False refuses it.
    prefer_local: bool | None = None


@dataclass(frozen=True)
class Candidate:
    """One provider considered, and why it placed where it did."""

    provider: str
    model: str
    score: float
    #: Every term that moved the score, in the user's terms. This is the whole
    #: explanation; there is no second, truer one kept somewhere else.
    reasons: list[str] = field(default_factory=list)
    #: Set means excluded, and says why. An excluded provider stays in the list
    #: rather than being filtered out of it: "why did it not use Groq" is the
    #: question this exists to answer, and a provider that has vanished from
    #: the output cannot answer it.
    rejected: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "score": round(self.score, 3),
            "reasons": list(self.reasons),
            "rejected": self.rejected,
        }


@dataclass(frozen=True)
class RouteDecision:
    #: Ranked provider names, ready to hand to `build_chain(order=...)`.
    order: list[str]
    #: The best candidate, or None when nothing can answer -- which is a real
    #: state on a laptop with no network and no local model running, and the
    #: caller must say so out loud rather than substituting a guess.
    head: Link | None
    candidates: list[Candidate]
    #: Every configured cloud provider is known to be unreachable. Recorded
    #: rather than inferred by the reader, because it changes what the reasons
    #: below mean: a local model at the top is the right answer when this is
    #: true and a surprising one when it is false.
    offline: bool = False

    def explain(self) -> dict[str, Any]:
        """The decision, in the shape that is persisted and served."""
        return {
            "head": str(self.head) if self.head else None,
            "order": list(self.order),
            "offline": self.offline,
            "candidates": [c.as_json() for c in self.candidates],
        }


def strengths_for(config: ProviderConfig) -> frozenset[str]:
    """What this endpoint is good at: the user's file first, the catalogue next.

    An entry that declares its own `strengths:` has overridden the catalogue
    and must win -- including when it declares something the catalogue would
    not have. Empty means "nothing said", which falls through to the catalogue
    by slug, which is empty in turn for the presets whose character depends on
    which model you name.
    """
    if config.strengths:
        return config.strengths
    known = preset(config.name)
    return known.strengths if known else frozenset()


def is_core(config: ProviderConfig) -> bool:
    """Whether this is one of the providers Auto leans on before anything else.

    A catalogue fact, not a user setting: "core" describes which endpoints this
    install is built to always have, and a user who wants their own entry
    preferred has a better tool for it -- pick it, or name it in the
    conversation's own fallback list, both of which beat routing outright.
    """
    known = preset(config.name)
    return bool(known and known.core)


def auto_routable(config: ProviderConfig) -> bool:
    """Whether Auto may hand this provider a turn unattended.

    False for an endpoint under evaluation: good enough to configure and try by
    hand, not good enough to be chosen on the user's behalf. It stays in the
    picker and is honoured in a fallback chain someone wrote themselves -- both
    of which are explicit choices -- and the router leaves it alone.
    """
    known = preset(config.name)
    return known is None or known.auto_route


def is_local(config: ProviderConfig) -> bool:
    """Whether this endpoint needs no network beyond this machine.

    The same test `availability.needs_probe` uses, and for the same reason: an
    entry that declares no credential is either a local server or an
    unauthenticated one, and both are reached without leaving the building.
    """
    return not config.api_key_ref and not config.api_key_env


def _rejection(config: ProviderConfig, req: RouteRequest) -> str | None:
    """Why this provider cannot take this request, or None if it can.

    Only hard bars belong here -- things that would fail rather than merely go
    badly. A tool cap is not one of them: `fit_tools_to_budget` already trims
    the schemas to fit, so a low cap costs tools rather than the turn, and it
    is scored as a penalty below instead.
    """
    if not config.enabled:
        return "switched off in settings"
    if not config.default_model:
        return "no default model, so there is nothing to substitute in"
    if not auto_routable(config):
        return "still being evaluated, so Auto does not pick it -- choose it by hand to try it"

    known = availability.cached(config.name)
    if known is not None and not known.available:
        clears = availability.clears_in(config.name)
        waiting = f", clears in {clears:.0f}s" if clears else ""
        return f"{known.reason or 'unavailable'}{waiting}"

    # A *declared* window only. The adapters guess from substrings in the model
    # name and silently return 128,000 for anything they do not recognise, so
    # rejecting on a guess would take working providers out of the running on
    # the strength of a number nobody checked.
    if config.context_window and req.context_tokens > config.context_window:
        return (
            f"the request is about {req.context_tokens:,} tokens,"
            f" over its {config.context_window:,}-token window"
        )

    if config.tokens_per_minute:
        needed = round(req.context_tokens * TPM_SAFETY_MARGIN)
        if needed > config.tokens_per_minute:
            return (
                f"a request this size needs about {needed:,} tokens,"
                f" over its {config.tokens_per_minute:,} per minute"
            )

    if req.prefer_local is True and not is_local(config):
        return "not a local provider, and local was asked for"
    if req.prefer_local is False and is_local(config):
        return "a local provider, and cloud was asked for"
    return None


def _wanted(req: RouteRequest) -> set[str]:
    """The strength tags this request is actually looking for.

    Derived, not declared: the caller says how big the work is and whether
    anybody is waiting, and which tags that implies is this function's opinion
    and the only place it is written down.
    """
    wanted: set[str] = set()
    if req.context_tokens >= LARGE_CONTEXT_TOKENS:
        wanted.add("large_context")
    if req.tier == "heavy":
        wanted.add("reasoning")
    if req.tier == "fast" or (req.interactive and req.context_tokens < LARGE_CONTEXT_TOKENS):
        wanted.add("fast")
    if not req.interactive:
        # Nobody is watching, so "cheap" and "slow but fine" are the same thing.
        wanted.update({"background", "cheap"})
    if req.needs_vision:
        wanted.add("vision")
    return wanted


def _score(config: ProviderConfig, req: RouteRequest, *, offline: bool) -> tuple[float, list[str]]:
    score = 0.0
    reasons: list[str] = []

    wanted = _wanted(req)
    matched = sorted(wanted & strengths_for(config))
    if matched:
        score += WEIGHTS["strength"] * len(matched)
        reasons.append(f"good at {', '.join(matched)}")

    left = availability.headroom(config)
    if config.tokens_per_minute:
        score += WEIGHTS["headroom"] * (1.0 - left)
        used, requests = availability.spent(config.name)
        if left < availability.HEADROOM_FLOOR:
            reasons.append(
                f"{left:.0%} of its minute left"
                f" ({used:,} of {config.tokens_per_minute:,} tokens in {requests} requests)"
            )

    if config.context_window and req.context_tokens:
        # Nothing at all until the request fills half the window, then rising to
        # the full penalty at the brim.
        #
        # The deadband is the point. Scored as a plain fraction, a 400-token
        # question in a 131,072-token window scored -0.005 -- almost nothing,
        # but enough to lose a tie to a provider that had simply never declared
        # its window, so publishing the number cost you the route. "Comfortable"
        # and "undeclared" have to score the same, or the file's best-described
        # entries are quietly the least likely to be picked.
        fills = min(1.0, req.context_tokens / config.context_window)
        score += WEIGHTS["window"] * max(0.0, fills - 0.5) * 2
        if fills > 0.75:
            reasons.append(f"only just fits its {config.context_window:,}-token window")

    if is_local(config):
        if offline:
            score += WEIGHTS["local_offline"]
            reasons.append("runs on this machine, and nothing else is reachable")
        elif req.interactive:
            score += WEIGHTS["local_online"]
            reasons.append("runs on this machine, so slower than a cloud provider")

    if req.needs_tools and config.max_tools and req.tool_count > config.max_tools:
        score += WEIGHTS["tool_cap"]
        reasons.append(f"takes {config.max_tools} tools, so {req.tool_count} would be trimmed")

    return score, reasons


def route(
    req: RouteRequest | None = None, *, configs: dict[str, ProviderConfig] | None = None
) -> RouteDecision:
    """Rank every configured provider against this request."""
    req = req or RouteRequest()
    configured = configs if configs is not None else configured_providers()

    # Decided before scoring, because it changes how a local provider scores.
    # "Every cloud provider we know to be down" -- a provider nothing has been
    # heard from is presumed up, the same assumption the rest of availability
    # makes, so this fires on observed failures rather than on silence.
    cloud = [c for c in configured.values() if not is_local(c) and c.enabled]
    offline = bool(cloud) and all(
        (known := availability.cached(c.name)) is not None and not known.available for c in cloud
    )

    rejected: list[Candidate] = []
    ranked: list[tuple[float, int, Candidate]] = []

    for position, (name, config) in enumerate(configured.items()):
        why = _rejection(config, req)
        if why is not None:
            rejected.append(
                Candidate(provider=name, model=config.default_model or "", score=0.0, rejected=why)
            )
            continue
        score, reasons = _score(config, req, offline=offline)
        if is_core(config):
            reasons.insert(0, "one of the core providers")
        ranked.append(
            (
                score,
                position,
                Candidate(
                    provider=name,
                    model=config.default_model or "",
                    score=score,
                    reasons=reasons,
                ),
            )
        )

    # Core providers first as a *tier*, not as a bonus, then by score, then by
    # file position.
    #
    # A tier rather than a large added weight. A constant bonus would in fact
    # behave the same today -- it cancels between two core providers, so
    # scoring inside the pool keeps working -- but only for as long as no score
    # can reach it. It would be a magic number carrying an unwritten invariant
    # ("bigger than any sum `_score` can produce"), enforced nowhere, and
    # quietly wrong the first time someone adds a term or raises a weight past
    # it. The sort key states the rule instead of encoding it in arithmetic,
    # and cannot be overtaken.
    #
    # A provider that cannot answer is not in `ranked` at all, so "no core
    # provider is available" is the same thing as "the core pool is empty", and
    # the user's own providers are reached without a special case.
    #
    # The last key is how providers.yaml's order survives routing: two
    # providers nothing distinguishes come out in the order the user wrote
    # them, which is the only stated preference a machine that configures
    # nothing ever gives. It was briefly also a `(total - position) * 0.01`
    # term added to the score, which was the same rule applied twice --
    # redundant with this sort, and able to outweigh a real signal once enough
    # providers were configured.
    ranked.sort(key=lambda row: (not is_core(configured[row[2].provider]), -row[0], row[1]))
    candidates = [row[2] for row in ranked]
    head = Link(provider=candidates[0].provider, model=candidates[0].model) if candidates else None

    if head is None:
        log.warning(
            "nothing can answer: %d providers considered, all rejected", len(rejected)
        )

    return RouteDecision(
        order=[c.provider for c in candidates],
        head=head,
        # Rejections last: the list is read top-down as "what it picked and
        # why", and the providers that were never in the running belong under
        # the ones that were.
        candidates=candidates + rejected,
        offline=offline,
    )


def route_for_tier(tier: str, **kwargs: Any) -> RouteDecision:
    """Route background work that has a tier but no measured request."""
    return route(RouteRequest(tier=tier, interactive=False, **kwargs))
