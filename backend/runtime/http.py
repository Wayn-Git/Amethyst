"""Shared HTTP behaviour for every provider adapter.

Retry lived only in the OpenAI-compatible adapter, which meant Anthropic and
Google were exposed to exactly the transient 5xx that was observed in practice
against NVIDIA NIM. Provider quirks belong in provider modules; "the network is
unreliable" is not a provider quirk.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import AsyncIterator
from typing import Any

import httpx

from backend.runtime.failures import (
    FailureKind,
    classify_status,
    classify_stream_error,
    should_retry,
)

MAX_RETRIES = 3
TRANSIENT_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
    httpx.PoolTimeout,
)

log = logging.getLogger(__name__)


class ProviderError(RuntimeError):
    """Base for every provider failure, carrying why rather than only what.

    `kind` is the field callers branch on; the message stays human prose. Both
    exist because the two audiences are different -- a fallback chain needs the
    kind, a user reading a `warning` frame needs the sentence.
    """

    def __init__(
        self,
        message: str,
        *,
        kind: FailureKind = FailureKind.NON_RETRYABLE,
        status: int | None = None,
        body: str | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        #: Seconds until this provider says it will answer again, from its own
        #: `retry-after` or `x-ratelimit-reset-*` header. Carried on the error
        #: because the header is seen here, where the provider's *name* is not
        #: known -- the loop has the name and records the exhaustion. Without
        #: it, "groq is rate limited" was remembered for a flat five minutes
        #: whether it said five seconds or an hour.
        self.retry_after = retry_after
        self.status = status
        self.body = body

    @property
    def retryable(self) -> bool:
        return should_retry(self.kind)


class ProviderHTTPError(ProviderError):
    """Carries the provider's own error body, which is where diagnostics live."""


class ProviderStreamError(ProviderError):
    """An error frame arrived inside an already-successful 200 stream.

    Lives here rather than in an adapter because both the OpenAI-compatible and
    Anthropic adapters raise it, and Anthropic was importing it -- along with a
    private helper -- across module boundaries to do so.
    """


#: Headers a provider uses to say when its limit resets. Ordered by how
#: directly they answer the question: `retry-after` is seconds until this exact
#: request may be repeated, the rest are seconds (or a duration like `5.8s`)
#: until the bucket refills.
RESET_HEADERS = (
    "retry-after",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset",
)

#: Anything longer than this is treated as "not now" rather than a wait. A
#: provider that says it resets in an hour is exhausted for the purposes of
#: this turn, and pinning an availability entry for an hour on one header is
#: how a provider stays dark long after it recovered.
MAX_RESET_SECONDS = 900.0


def _duration(raw: str) -> float | None:
    """Seconds from a header value.

    Providers write this several ways: `5`, `5.835`, `5.8s`, `1m30s`. Groq
    sends the `s` suffix, which `float()` alone rejects -- so a rate limit that
    said exactly when it would clear was read as saying nothing at all.
    """
    text = raw.strip().lower()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        pass

    # `Retry-After` is allowed to be an HTTP-date, and the unit scanner below
    # reads one as a very large number of seconds -- clamped, but still wrong,
    # and wrong in the direction that leaves a healthy provider dark.
    if "," in text or ":" in text:
        try:
            from email.utils import parsedate_to_datetime

            when = parsedate_to_datetime(raw.strip())
        except (TypeError, ValueError):
            return None
        if when is None:
            return None
        from datetime import datetime, timezone

        now = datetime.now(when.tzinfo or timezone.utc)
        return max(0.0, (when - now).total_seconds())

    units = {"ms": 0.001, "h": 3600.0, "m": 60.0, "s": 1.0}
    total, number, index, matched = 0.0, "", 0, False
    while index < len(text):
        char = text[index]
        if char.isdigit() or char == ".":
            number += char
            index += 1
            continue
        unit = "ms" if text[index : index + 2] == "ms" else char
        if unit in units and number:
            total += float(number) * units[unit]
            matched = True
            number = ""
        index += len(unit)
    return total if matched else None


def reset_after(headers: Any) -> float | None:
    """How long this provider says its limit needs, or None if it did not say."""
    for name in RESET_HEADERS:
        raw = headers.get(name)
        if not raw:
            continue
        seconds = _duration(str(raw))
        if seconds is not None and seconds > 0:
            return min(seconds, MAX_RESET_SECONDS)
    return None


def backoff(attempt: int) -> float:
    """Exponential backoff with jitter, so retries do not synchronise."""
    return min(2.0**attempt, 8.0) * (0.5 + random.random() / 2)


# One client per (event loop, read timeout), so connections are reused across
# calls *of the same shape*. A client was built and closed per request and per
# retry, which meant a fresh TCP and TLS handshake to the provider every time.
# A browser task makes on the order of 26 model calls -- each one a tool call's
# worth of round trip -- so that was 26 handshakes to the same host, paid in
# series, before any tokens moved. Keyed by loop because a client is bound to
# the loop that created it, and the CLI, the API and tests each run their own.
#
# The timeout is part of the key because it used to be silently dropped after
# first creation: whichever module touched the pool first fixed everyone
# else's timeout, so Gmail's effective read deadline depended on whether the
# embeddings client (120s) or the relay (20s) had happened to run first.
_CLIENTS: dict[tuple[object, float], httpx.AsyncClient] = {}


#: The longest a connect may take. A dead endpoint should fail fast; it is the
#: *read* -- time to first byte, and time between stream chunks -- that wants to
#: be generous, because a slow model is not a broken one. OpenCode allows 300s
#: for the first byte for exactly this reason; AMETHYST's flat 120s was killing slow
#: reasoning models mid-answer.
CONNECT_TIMEOUT = 10.0


def _as_timeout(timeout: float) -> httpx.Timeout:
    """A float budget as a structured httpx timeout: fast connect, generous rest.

    httpx read-timeout on a stream is the gap *between* chunks, not the whole
    response, so a large value does not let a truly dead stream hang -- the
    per-chunk clock still trips. It only stops a slow-but-alive generation from
    being cut off."""
    return httpx.Timeout(timeout, connect=min(CONNECT_TIMEOUT, timeout))


def _client(timeout: float) -> httpx.AsyncClient:
    loop = asyncio.get_running_loop()
    key = (loop, timeout)
    client = _CLIENTS.get(key)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(
            timeout=_as_timeout(timeout),
            limits=httpx.Limits(max_keepalive_connections=16, keepalive_expiry=300.0),
        )
        _CLIENTS[key] = client
    return client


async def close_clients() -> None:
    """Close this loop's pooled clients. Called on shutdown; safe to skip."""
    loop = asyncio.get_running_loop()
    stale = [key for key in _CLIENTS if key[0] is loop]
    for key in stale:
        client = _CLIENTS.pop(key, None)
        if client is not None and not client.is_closed:
            await client.aclose()


def is_retryable(status: int, body: str | None = None) -> bool:
    """Whether asking this same endpoint again could plausibly work.

    The body is consulted because a 429 is two different failures wearing one
    status: a rate limit clears by waiting, an exhausted quota does not, and
    retrying the second one spends four attempts to learn what the first
    response already said.
    """
    return should_retry(classify_status(status, body))


def _delay_for(response: httpx.Response, attempt: int) -> float:
    delay = backoff(attempt)
    retry_after = response.headers.get("retry-after")
    if retry_after:
        try:
            return max(delay, float(retry_after))
        except ValueError:
            pass
    return delay


async def post_json(
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
    params: dict[str, Any] | None = None,
    max_retries: int = MAX_RETRIES,
) -> dict[str, Any]:
    """POST JSON, retrying transient failures, and surface the error body on give-up."""
    last_error = "no response"
    last_status: int | None = None
    last_body: str | None = None

    for attempt in range(max_retries + 1):
        try:
            response = await _client(timeout).post(
                url, headers=headers, json=payload, params=params, timeout=_as_timeout(timeout)
            )
        except TRANSIENT_EXCEPTIONS as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            last_status, last_body = None, None
            if attempt == max_retries:
                raise ProviderHTTPError(
                    f"{url} unreachable: {last_error}", kind=FailureKind.UNREACHABLE
                ) from exc
            await asyncio.sleep(backoff(attempt))
            continue

        if response.status_code < 400:
            return response.json()

        # raise_for_status() throws the body away; the body is the diagnostic.
        body = response.text[:1000]
        last_error = f"{response.status_code}: {body}"
        last_status, last_body = response.status_code, body
        if not is_retryable(response.status_code, body) or attempt == max_retries:
            raise ProviderHTTPError(
                f"{url} returned {last_error}",
                kind=classify_status(response.status_code, body),
                retry_after=reset_after(response.headers),
                status=response.status_code,
                body=body,
            )

        delay = _delay_for(response, attempt)
        log.warning(
            "%s returned %s, retrying in %.1fs (attempt %d/%d)",
            url,
            response.status_code,
            delay,
            attempt + 1,
            max_retries,
        )
        await asyncio.sleep(delay)

    raise ProviderHTTPError(
        f"{url} returned {last_error}",
        kind=(
            classify_status(last_status, last_body)
            if last_status is not None
            else FailureKind.UNREACHABLE
        ),
        status=last_status,
        body=last_body,
    )


def _replay_delay(data: str, attempt: int, max_retries: int) -> float | None:
    """How long to wait before replaying a stream that failed inside its own body.

    Some OpenAI-compatible gateways report a transient failure as HTTP 200 with
    SSE headers and an `error` object in the first frame, rather than as a
    status code. NVIDIA's does: an overloaded model answers
    `{"error":{"message":"Service temporarily overloaded","type":
    "service_unavailable","code":503}}` over a 200. The retry loop below only
    ever looked at `response.status_code`, so the same 503 was retried three
    times when it arrived as a status and *zero* times when it arrived as a
    body -- which turned one transient hiccup into a dead turn, on the one
    provider that reports failure this way.

    Returns None when the frame is not an error, when the error is permanent (a
    model that does not exist will not exist on the retry either), or when the
    attempts are spent. Only ever consulted before the first frame has been
    handed on, so replaying cannot duplicate output that is already on screen --
    the same rule the dropped-stream path applies.
    """
    if attempt >= max_retries or '"error"' not in data:
        return None
    try:
        payload = json.loads(data)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if not error:
        return None
    if not should_retry(classify_stream_error(error)):
        return None
    return backoff(attempt)


async def stream_sse(
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
    params: dict[str, Any] | None = None,
    max_retries: int = MAX_RETRIES,
) -> AsyncIterator[str]:
    """Yield raw `data:` payloads from a server-sent-event stream.

    Retries only apply before the first byte arrives. Once tokens are flowing a
    retry would replay a partial response, so a mid-stream failure is raised.
    """
    for attempt in range(max_retries + 1):
        started = False
        # Set when the body itself reported a transient failure before any
        # frame was handed on; the request is replayed after the wait.
        replay: float | None = None
        try:
            async with _client(timeout).stream(
                "POST",
                url,
                headers=headers,
                json=payload,
                params=params,
                timeout=_as_timeout(timeout),
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode(errors="replace")[:1000]
                    error = f"{response.status_code}: {body}"
                    if not is_retryable(response.status_code, body) or attempt == max_retries:
                        raise ProviderHTTPError(
                            f"{url} returned {error}",
                            kind=classify_status(response.status_code, body),
                            retry_after=reset_after(response.headers),
                            status=response.status_code,
                            body=body,
                        )
                    await asyncio.sleep(_delay_for(response, attempt))
                    continue

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    if not started:
                        replay = _replay_delay(data, attempt, max_retries)
                        if replay is not None:
                            break
                    started = True
                    yield data
            if replay is not None:
                log.warning(
                    "%s reported a transient failure inside a 200 response before any"
                    " token; replaying in full (attempt %d/%d): %s",
                    url,
                    attempt + 1,
                    max_retries,
                    data[:200],
                )
                await asyncio.sleep(replay)
                continue
            return
        except TRANSIENT_EXCEPTIONS as exc:
            if started or attempt == max_retries:
                # Once bytes have moved this layer cannot replay the request --
                # it would send the whole answer twice -- so it stops here and
                # says what kind of failure it was.
                #
                # It used to call that `NON_RETRYABLE`, on the reasoning that a
                # different provider could not take over cleanly with half an
                # answer already on screen. True, and still true; but the
                # director can now ask the *same* provider to continue the
                # sentence it was writing, and it decides that from the kind.
                # Calling a dropped socket unrecoverable took that decision
                # away from the only layer holding the partial.
                raise ProviderHTTPError(
                    f"{url} stream failed: {exc}",
                    kind=(FailureKind.UPSTREAM_UNHEALTHY if started else FailureKind.UNREACHABLE),
                ) from exc
            # Nothing had arrived yet, so replaying is safe -- but it is a whole
            # request, and the provider may well have generated a response it
            # then failed to deliver. Unlogged, a turn could silently cost four
            # times the tokens and four times the wall clock with no trace.
            log.warning(
                "%s dropped the stream before any data; retrying in full (attempt %d/%d): %s",
                url,
                attempt + 1,
                max_retries,
                exc,
            )
            await asyncio.sleep(backoff(attempt))
