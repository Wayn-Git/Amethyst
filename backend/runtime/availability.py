"""Which configured providers can actually answer right now.

`has_key` answers a different question -- whether the credential a provider says
it needs is present -- and for a local endpoint the honest answer is "it needs
none", so Ollama is reported configured whether or not anything is listening on
its port. Four conversations in the real database collected nine consecutive
`All connection attempts failed` because of exactly that: the picker offered a
provider, every turn against it died on the first round trip, and the failure
read as AMETHYST being broken rather than as `ollama serve` not running.

Two sources feed this, deliberately kept apart:

* **A probe**, for endpoints whose credential tells us nothing. One cheap
  request to the endpoint's model list. Any HTTP answer at all counts as
  reachable -- a 401 means something is there and disagrees with us, which is a
  different problem from nothing being there.
* **Observed failures**, for everything else. Probing a dozen cloud providers on
  a health poll that runs every twenty seconds would spend real latency to
  learn what the next turn finds out for free, so a cloud provider is presumed
  available until a turn proves otherwise, and the director reports what it saw.

Both entries expire. A provider that was down is not down forever, and a cache
with no way out is how "start Ollama and it still says unavailable" happens.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass

from backend.config import ProviderConfig
from backend.runtime.failures import FailureKind
from backend.runtime.providers import anthropic, google, ollama, openai_compat

log = logging.getLogger(__name__)

#: Every adapter's fallback endpoint, keyed the way `registry.resolve` keys
#: them: `config.provider or config.name`, with unknown names falling through
#: to the OpenAI-compatible adapter. `None` means "no base URL is ever right"
#: -- which is nobody today, but the honest answer if an adapter ever ships
#: that derives its endpoint some other way.
_DEFAULT_BASE_URLS: dict[str, str] = {
    "openai": openai_compat.DEFAULT_BASE_URL,
    "openai-compatible": openai_compat.DEFAULT_BASE_URL,
    "anthropic": anthropic.DEFAULT_BASE_URL,
    "google": google.DEFAULT_BASE_URL,
    "gemini": google.DEFAULT_BASE_URL,
    "ollama": ollama.DEFAULT_BASE_URL,
}


def resolve_base_url(config: ProviderConfig) -> str:
    """The endpoint a request to this provider would actually hit.

    An entry without a `base_url` is not an entry without an endpoint -- the
    adapter fills one in at initialise time, and pretending otherwise is how
    Ping came to answer `available` without touching the network: `_probe_now`
    saw an empty string and said yes without asking anyone. The probe and the
    picker need the same URL the turn itself would use, from the same table.
    """
    if config.base_url:
        return config.base_url.rstrip("/")
    adapter_key = config.provider or config.name
    return _DEFAULT_BASE_URLS.get(adapter_key, openai_compat.DEFAULT_BASE_URL)

#: How long a probe result is trusted. Short enough that starting a local server
#: is noticed within one health poll or two, long enough that a picker render
#: does not become a burst of network calls.
PROBE_TTL_SECONDS = 60.0

#: How long an observed failure sticks. Longer than a probe because it cost a
#: real turn to learn, shorter than a session because providers recover.
FAILURE_TTL_SECONDS = 300.0

#: A probe is a liveness check, not a request that has to succeed. Anything
#: slower than this is unusable for a turn anyway.
PROBE_TIMEOUT_SECONDS = 3.0


@dataclass(frozen=True)
class Availability:
    name: str
    available: bool
    #: Prose for a person, empty when there is nothing to explain.
    reason: str = ""
    #: "probe" or "observed" -- so an interface can say whether this was checked
    #: or merely remembered.
    source: str = "probe"
    #: Out of quota, as opposed to unreachable or broken. The distinction is
    #: what a person needs to debug this: "wait" and "fix it" are different
    #: instructions, and a status page that says only "unavailable" makes the
    #: reader guess which one they are looking at.
    exhausted: bool = False


_cache: dict[str, tuple[float, Availability]] = {}
_locks: dict[str, asyncio.Lock] = {}

#: How long a minute is, for the purpose of a tokens-per-minute ceiling. The
#: providers that publish one mean a rolling window rather than a wall-clock
#: minute, so this is one too: a fixed minute lets a burst land at :59 and
#: another at :01 and calls both of them within budget.
WINDOW_SECONDS = 60.0

#: The fraction of a declared ceiling above which a provider stops being the
#: obvious choice. Not a limit and not a quota -- a provider over this still
#: answers, it just loses to an idle peer when there is one. Every real number
#: comes from `tokens_per_minute` in providers.yaml; this is only where the
#: router starts steering away from it.
HEADROOM_FLOOR = 0.8

#: What has been spent at each provider inside the window: (monotonic, tokens).
#:
#: Not persisted, for the same reason `_cache` is not. AMETHYST runs one
#: uvicorn worker by design (see CLAUDE.md), so there is no second process to
#: stay coherent with, and the cost of losing the window to a restart is at
#: most one 429 -- which `record_exhausted` already absorbs, with the
#: provider's own `Retry-After` rather than a guess. A table would buy
#: durability for a number that is stale after sixty seconds.
_usage: dict[str, deque[tuple[float, int]]] = {}


def forget(name: str | None = None) -> None:
    """Drop what is remembered, for one provider or all of them.

    The escape hatch every cache of "this is broken" needs: the user fixed the
    thing and wants to be believed without restarting the process.
    """
    if name is None:
        _cache.clear()
    else:
        _cache.pop(name, None)


def forget_usage(name: str | None = None) -> None:
    """Drop the spend window, for one provider or all of them."""
    if name is None:
        _usage.clear()
    else:
        _usage.pop(name, None)


def record_usage(name: str, tokens: int) -> None:
    """Count what a request cost this provider, against its minute.

    Called with the provider's own reported token counts where it returns them
    and an estimate where it does not. An estimate is worth recording: the
    question this feeds is "is this provider near its ceiling", and being
    roughly right about that beats knowing nothing, which is what the system
    knew before -- a tokens-per-minute limit could only be discovered by
    tripping it.
    """
    if tokens <= 0:
        return
    window = _usage.setdefault(name, deque())
    window.append((time.monotonic(), tokens))
    _trim(window)


def _trim(window: deque[tuple[float, int]]) -> None:
    cutoff = time.monotonic() - WINDOW_SECONDS
    while window and window[0][0] < cutoff:
        window.popleft()


def spent(name: str) -> tuple[int, int]:
    """Tokens and requests recorded for this provider inside the window."""
    window = _usage.get(name)
    if not window:
        return (0, 0)
    _trim(window)
    return (sum(tokens for _, tokens in window), len(window))


def headroom(config: ProviderConfig) -> float:
    """How much of this provider's declared minute is left, from 1.0 to 0.0.

    `tokens_per_minute is None` means no ceiling has been declared, which is
    not the same as there being none -- but an undeclared ceiling cannot be
    steered by, so it answers 1.0 and the provider competes on everything else.
    Guessing a number here is the one thing this must not do: a wrong ceiling
    would route around a provider that was fine, silently and forever.
    """
    ceiling = config.tokens_per_minute
    if not ceiling:
        return 1.0
    used, _ = spent(config.name)
    return max(0.0, 1.0 - used / ceiling)


def record_failure(name: str, kind: FailureKind, message: str = "") -> None:
    """Remember that a real turn could not reach this provider.

    Only the kinds that mean "this provider, right now" are recorded. A 404 for
    a model name says nothing about the provider's health and must not take it
    out of the picker -- the fix for that is a different model, not a different
    provider. `NON_RETRYABLE_RATE_LIMIT` belongs here too: an account whose
    tokens-per-minute ceiling is smaller than what this request needed will
    fail the same way on the next turn, and a picker that keeps offering it
    anyway is what turned three near-identical 413s into three separate
    real conversations.
    """
    if kind not in (
        FailureKind.UNREACHABLE,
        FailureKind.UPSTREAM_UNHEALTHY,
        FailureKind.NON_RETRYABLE_RATE_LIMIT,
    ):
        return
    reason = {
        FailureKind.UNREACHABLE: "nothing answered at its endpoint",
        FailureKind.UPSTREAM_UNHEALTHY: "the provider is returning server errors",
        FailureKind.NON_RETRYABLE_RATE_LIMIT: "the account's rate limit or quota was exceeded",
    }[kind]
    _cache[name] = (
        time.monotonic() + FAILURE_TTL_SECONDS,
        Availability(name=name, available=False, reason=message or reason, source="observed"),
    )


def record_exhausted(name: str, *, retry_after: float | None, message: str = "") -> None:
    """Remember that this provider is out of quota, and until when.

    Distinct from `record_failure` in the one respect that matters: the
    provider usually says how long it needs, in `retry-after` or an
    `x-ratelimit-reset-*` header, and a flat five-minute sulk both keeps a
    provider dark for five minutes when it asked for six seconds and lets one
    through after five when it asked for an hour. Honouring the number is the
    difference between routing around a limit and guessing at it.

    Floored at ten seconds because a provider that just refused will refuse the
    retry that lands 800ms later, and clamped by `FAILURE_TTL_SECONDS` because a
    remembered failure is a guess about the future and a long guess is a bad one.
    """
    wait = (
        FAILURE_TTL_SECONDS
        if retry_after is None
        else max(10.0, min(retry_after, FAILURE_TTL_SECONDS))
    )
    # A warning, not an info line: `amethyst serve` configures uvicorn's log
    # level and leaves everything else on the root logger, whose default is
    # WARNING -- so an info line here is written to nobody. A provider going
    # dark is the one thing a person debugging routing needs to see without
    # having to reproduce it.
    log.warning(
        "%s is exhausted for the next %.0fs: %s", name, wait, message or "rate limited"
    )
    _cache[name] = (
        time.monotonic() + wait,
        Availability(
            name=name,
            available=False,
            reason=message or "the account's rate limit or quota was exceeded",
            source="observed",
            exhausted=True,
        ),
    )


def record_success(name: str) -> None:
    """A provider that just answered is available, whatever was remembered."""
    _cache[name] = (
        time.monotonic() + PROBE_TTL_SECONDS,
        Availability(name=name, available=True, source="observed"),
    )


def clears_in(name: str) -> float | None:
    """Seconds until a remembered failure stops being believed, if one is held.

    The status surface's other half: "groq is exhausted" without "for another
    47 seconds" is a fact nobody can act on -- it cannot tell waiting from
    something being genuinely broken.
    """
    entry = _cache.get(name)
    if entry is None:
        return None
    expires, value = entry
    if value.available:
        return None
    return max(0.0, expires - time.monotonic())


def cached(name: str) -> Availability | None:
    entry = _cache.get(name)
    if entry is None:
        return None
    expires, value = entry
    if time.monotonic() >= expires:
        del _cache[name]
        return None
    return value


def needs_probe(config: ProviderConfig) -> bool:
    """Whether this provider's credential leaves its availability unknown.

    An entry declaring no key is either a local server or an unauthenticated
    one; both can be absent while looking perfectly configured. An entry with a
    key has already told us something, and asking the network to confirm it on
    every health poll costs more than it returns.
    """
    return not config.api_key_ref and not config.api_key_env


async def probe(config: ProviderConfig) -> Availability:
    """One cheap request to the endpoint, cached for `PROBE_TTL_SECONDS`."""
    known = cached(config.name)
    if known is not None:
        return known

    lock = _locks.setdefault(config.name, asyncio.Lock())
    async with lock:
        # A second caller that queued behind the probe gets its answer rather
        # than making the same request again.
        known = cached(config.name)
        if known is not None:
            return known
        result = await _probe_now(config)
        _cache[config.name] = (time.monotonic() + PROBE_TTL_SECONDS, result)
        return result


async def _probe_now(config: ProviderConfig) -> Availability:
    import httpx

    base = resolve_base_url(config)

    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            await client.get(f"{base}/models")
    except Exception as exc:
        return Availability(
            name=config.name,
            available=False,
            reason=f"nothing answered at {base} ({type(exc).__name__})",
        )
    # Any status at all means something is listening. A 401 or a 404 is the
    # endpoint disagreeing with the request, which is not the same failure as
    # the endpoint not being there, and is not this function's question.
    return Availability(name=config.name, available=True)


async def ping(config: ProviderConfig) -> Availability:
    """A fresh liveness check the user asked for, cache and key-gate ignored.

    `probe` answers the picker's passive question and only runs for providers
    whose credential says nothing (`needs_probe`); a Ping button is the opposite
    -- a person pressing it means "check this one now, whatever you remember and
    whatever kind of provider it is". So the cache is dropped first and the
    endpoint is hit directly. Any status answering counts as reachable; a
    key-bearing provider's 401 still proves something is there. The fresh result
    is remembered like any other probe, so the picker's badge updates with it.
    """
    forget(config.name)
    result = await _probe_now(config)
    _cache[config.name] = (time.monotonic() + PROBE_TTL_SECONDS, result)
    return result


async def survey(configs: dict[str, ProviderConfig]) -> dict[str, Availability]:
    """Availability for every configured provider, probing only where needed."""
    probes = {name: cfg for name, cfg in configs.items() if needs_probe(cfg)}
    results: dict[str, Availability] = {}

    for name in configs:
        if name not in probes:
            results[name] = cached(name) or Availability(
                name=name, available=True, source="observed"
            )

    if probes:
        answered = await asyncio.gather(
            *(probe(cfg) for cfg in probes.values()), return_exceptions=True
        )
        for name, value in zip(probes, answered, strict=True):
            results[name] = (
                value
                if isinstance(value, Availability)
                else Availability(name=name, available=False, reason=str(value))
            )
    return results
