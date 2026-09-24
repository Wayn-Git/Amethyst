"""Speech to text, through a provider that already has a key.

This lives in `backend/runtime/` and not in `backend/media/` because that is
where every other "talk to a configured provider" concern lives -- key
resolution, failure classification, availability. `backend/media/` shells out to
ffmpeg; this posts to an API. They are different layers even though one feeds
the other.

It is also deliberately **not** a fourth tier. `default_chain` describes chat,
and a chat tier that silently doubled as a transcription tier is exactly the kind
of drift that makes a config file stop meaning what it says. The choice is:
an explicit `transcription:` block in providers.yaml, else the first configured
provider on a short allowlist of endpoints observed to serve OpenAI's
`/audio/transcriptions` shape.

A short allowlist rather than a probe, because finding out an endpoint answers
404 by uploading twenty megabytes to it costs a minute of somebody's bandwidth.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

import httpx

from backend.config import ProviderConfig, configured_providers, load_transcription
from backend.runtime import availability
from backend.runtime.failures import FailureKind
from backend.runtime.http import _client
from backend.secrets import resolve_api_key

log = logging.getLogger(__name__)

#: Providers observed to serve `/audio/transcriptions`, and what to ask them for.
KNOWN_MODELS = {
    "groq": "whisper-large-v3-turbo",
    "openai": "whisper-1",
}

#: Groq refuses at 25MB. Under it, with room for the multipart envelope.
MAX_UPLOAD_BYTES = 24 * 1024 * 1024
DEFAULT_TIMEOUT = 300.0

#: Shorter than this and there is nothing to search on or summarise from, so it
#: is treated as no transcript at all rather than as a bad one.
MIN_USEFUL_CHARS = 40


class TranscriptionUnavailable(RuntimeError):
    """Nothing here can transcribe. Carries a sentence fit to show someone."""


@dataclass(frozen=True)
class Transcript:
    text: str
    provider: str
    model: str


def resolve_transcriber() -> tuple[ProviderConfig, str] | None:
    """Which provider and model, or None because none of them can."""
    chain = resolve_transcription_chain()
    return chain[0] if chain else None


def resolve_transcription_chain() -> list[tuple[ProviderConfig, str]]:
    """All providers that can transcribe, ordered by preference.

    The explicit `transcription:` block in providers.yaml is first. After that,
    every configured provider on the KNOWN_MODELS allowlist, in file order. The
    result is a list rather than a single answer so that `transcribe` can fall
    through a rate-limited or unreachable provider to the next one.
    """
    configured = configured_providers()
    chain: list[tuple[ProviderConfig, str]] = []
    seen: set[str] = set()

    chosen = load_transcription()
    if chosen is not None and chosen.provider in configured:
        chain.append((configured[chosen.provider], chosen.model))
        seen.add(chosen.provider)

    for name, config in configured.items():
        if name in seen:
            continue
        model = KNOWN_MODELS.get(name)
        if model:
            chain.append((config, model))
            seen.add(name)
    return chain


def unavailable_reason() -> str:
    return (
        "no configured provider here transcribes audio, so a reel with no caption"
        " has no text at all. Groq and OpenAI both do -- add a key for one in"
        " Settings, then re-enrich."
    )


#: HTTP status codes where the *request* is wrong and a different provider would
#: get the same answer. A 401 is a bad key, a 413 is a too-large file. Retrying
#: those elsewhere wastes bandwidth and might succeed for the wrong reason.
_NON_RETRYABLE_STATUSES = frozenset({400, 401, 403, 413})

#: Rate limits often clear in seconds. A short retry before hopping providers
#: avoids paying the latency cost of uploading 24MB to a second endpoint.
RATE_LIMIT_RETRIES = 2
RATE_LIMIT_BACKOFF = 3.0  # seconds, doubled on each retry


async def transcribe(
    path: Path, *, language: str | None = None, timeout: float = DEFAULT_TIMEOUT
) -> Transcript:
    """What was actually said. Tries every configured Whisper provider in order.

    Rate limits (429), server errors (5xx), and network failures on one provider
    fall through to the next. Non-retryable errors (bad key, file too large)
    raise immediately — a different provider would get the same answer.
    """
    chain = resolve_transcription_chain()
    if not chain:
        raise TranscriptionUnavailable(unavailable_reason())

    if not path.exists():
        raise TranscriptionUnavailable(f"there is no audio at {path}")
    size = path.stat().st_size
    if size > MAX_UPLOAD_BYTES:
        raise TranscriptionUnavailable(
            f"the audio is {size // (1024 * 1024)}MB, over the"
            f" {MAX_UPLOAD_BYTES // (1024 * 1024)}MB a transcription request accepts."
            " Long recordings are not split up yet."
        )

    # Read once, reuse across providers. The file is the same for all of them.
    payload = await asyncio.to_thread(path.read_bytes)

    last_exc: TranscriptionUnavailable | None = None
    for config, model in chain:
        try:
            result = await _try_provider(
                config, model, path.name, payload,
                language=language, timeout=timeout,
            )
            return result
        except TranscriptionUnavailable as exc:
            last_exc = exc
            # Non-retryable: the request itself is wrong, not the provider.
            if _is_non_retryable(exc):
                raise
            # Retryable: log and try the next provider in the chain.
            remaining = len(chain) - chain.index((config, model)) - 1
            if remaining > 0:
                log.info(
                    "%s failed to transcribe, falling back (%d provider(s) left): %s",
                    config.name, remaining, exc,
                )
            continue

    # Every provider in the chain failed with a retryable error.
    raise last_exc or TranscriptionUnavailable(unavailable_reason())


def _is_non_retryable(exc: TranscriptionUnavailable) -> bool:
    """Whether the exception text indicates a non-retryable HTTP status."""
    msg = str(exc)
    return any(f"HTTP {code}" in msg for code in _NON_RETRYABLE_STATUSES)


async def _try_provider(
    config: ProviderConfig,
    model: str,
    filename: str,
    payload: bytes,
    *,
    language: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Transcript:
    """One attempt against one provider, with retry on rate limits.

    A 429 is retried up to RATE_LIMIT_RETRIES times with exponential backoff
    before raising. Rate limit windows are typically seconds, and retrying here
    is far cheaper than re-uploading 24MB to a different provider.
    """
    key = resolve_api_key(ref=config.api_key_ref, env=config.api_key_env)
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    data = {"model": model, "response_format": "text"}
    if language:
        data["language"] = language

    attempts = 1 + RATE_LIMIT_RETRIES  # initial + retries
    backoff = RATE_LIMIT_BACKOFF

    for attempt in range(attempts):
        try:
            response = await _client(timeout).post(
                f"{config.base_url.rstrip('/')}/audio/transcriptions",
                headers=headers,
                data=data,
                files={"file": (filename, payload, "application/octet-stream")},
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            availability.record_failure(config.name, FailureKind.UNREACHABLE, str(exc))
            raise TranscriptionUnavailable(
                f"{config.name} could not be reached to transcribe: {exc}"
            ) from exc

        if response.status_code == 429 and attempt < attempts - 1:
            # Retry after a short backoff — rate limits usually clear quickly.
            log.info(
                "%s rate-limited on transcription, retrying in %.0fs (attempt %d/%d)",
                config.name, backoff, attempt + 1, attempts,
            )
            await asyncio.sleep(backoff)
            backoff *= 2
            continue

        if response.status_code >= 400:
            body = response.text[:300]
            if response.status_code == 429:
                availability.record_failure(
                    config.name, FailureKind.RATE_LIMITED,
                    f"transcription rate-limited (HTTP 429): {body}",
                )
            elif response.status_code >= 500:
                availability.record_failure(
                    config.name, FailureKind.UPSTREAM_UNHEALTHY,
                    f"transcription server error (HTTP {response.status_code}): {body}",
                )
            # 401/413 are deliberately NOT recorded against the provider — see the
            # original comment about cross-contamination.
            raise TranscriptionUnavailable(
                f"{config.name} refused the transcription (HTTP {response.status_code}): {body}"
            )

        availability.record_success(config.name)
        text = _text_of(response)
        if len(text.strip()) < MIN_USEFUL_CHARS:
            return Transcript("", config.name, model)
        return Transcript(text.strip(), config.name, model)

    # Should not be reached, but satisfies the type checker.
    raise TranscriptionUnavailable(f"{config.name} exhausted all retry attempts")


def _text_of(response: httpx.Response) -> str:
    """`response_format=text` returns bare text; some gateways still send JSON."""
    body = response.text or ""
    stripped = body.lstrip()
    if stripped.startswith("{"):
        try:
            return str(response.json().get("text") or "")
        except ValueError:
            return body
    return body
