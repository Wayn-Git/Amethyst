"""A renderer for the pages that are a JavaScript bundle.

`fetch_readable` fetches HTML and reduces it. That is the right thing for an
article and produces nothing at all for a single-page app, where the markup is
a loader and the words arrive later from an API. The note it writes -- "the
page returned no readable text" -- is true and useless.

`r.jina.ai` renders the page and returns markdown, with no key and no account.
Prefixing a URL with it is the whole interface.

**It is a third party, and that is the cost.** The URL is sent to jina.ai, so
the fact that this machine read that page leaves the machine. Two things follow,
and both are enforced:

* It runs **only after the ordinary fetch has already failed** to produce text,
  so a page PSOK could read itself is never sent anywhere.
* It is a setting the user can see and switch off (`social.reader_fallback`).

The local alternative is obscura -- a Rust headless browser with a real V8, CDP
compatible, ~70MB, which would render here and send nothing. It is the right
end state and it is an install; this is what works today with neither.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx

from backend.web.reader import MAX_TEXT_CHARS, USER_AGENT, FetchedPage

log = logging.getLogger(__name__)

ENDPOINT = "https://r.jina.ai/{url}"
#: Rendering a page takes longer than fetching one -- there is a browser at the
#: other end -- so this is deliberately more generous than DEFAULT_TIMEOUT.
TIMEOUT = 45.0

#: Jina puts its own headers above the content and they are worth keeping: the
#: title and the real URL are often better than anything in the markup.
_HEADERS = ("Title:", "URL Source:", "Published Time:", "Warning:", "Markdown Content:")


def _split(payload: str) -> tuple[dict[str, str], str]:
    """Jina's `Key: value` preamble, and the markdown after it."""
    meta: dict[str, str] = {}
    lines = payload.splitlines()
    body_at = 0
    for index, line in enumerate(lines):
        if line.startswith("Markdown Content:"):
            body_at = index + 1
            break
        for header in _HEADERS:
            if line.startswith(header):
                meta[header.rstrip(":").lower()] = line[len(header) :].strip()
                break
    else:
        # No "Markdown Content:" marker at all: treat the whole payload as body
        # rather than throwing away a page over a format change.
        return meta, payload
    return meta, "\n".join(lines[body_at:]).strip()


async def fetch_rendered(url: str, *, timeout: float = TIMEOUT) -> FetchedPage | None:
    """The page as markdown, or None to leave the caller's own result standing.

    None rather than an exception because this is a fallback: every caller
    already has a `FetchedPage` with an honest note on it, and a failure here
    means that note stands rather than that the capture failed.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(
                ENDPOINT.format(url=url),
                headers={"User-Agent": USER_AGENT, "X-Return-Format": "markdown"},
            )
        if response.status_code != 200:
            log.debug("jina reader returned %s for %s", response.status_code, url)
            return None
    except httpx.HTTPError as exc:
        log.debug("jina reader failed for %s: %s", url, exc)
        return None

    meta, body = _split(response.text)

    # Jina answers 200 and puts the failure in the body -- a blocked page comes
    # back as "Warning: Target URL returned error 403". Reading only the status
    # code would file "You've been blocked by network security" as the article.
    warning = meta.get("warning", "")
    if "returned error" in warning:
        log.debug("jina reader could not reach %s: %s", url, warning)
        return None
    if not body.strip():
        return None

    truncated = len(body) > MAX_TEXT_CHARS
    if truncated:
        body = body[:MAX_TEXT_CHARS]

    note = "rendered by r.jina.ai, because the page itself returned no readable text"
    if truncated:
        note += f"; cut off at {MAX_TEXT_CHARS:,} characters"

    return FetchedPage(
        url=url,
        final_url=meta.get("url source") or url,
        title=meta.get("title") or "",
        text=body,
        site=urlparse(url).hostname,
        author=None,
        published_on=None,
        content_type="text/markdown",
        truncated=truncated,
        note=note,
    )
