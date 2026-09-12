"""Fetching a page and reducing it to text and metadata.

This used to live inside the `fetch_url` tool. It moved out when a second caller
appeared -- capturing an article into the library -- because the two must not
drift: the tool and the capture path should agree about what a page says, what
it is called, and which addresses are refused.

Two things are fixed here that the tool got wrong on its own:

**Redirects are followed by hand.** `fetch_url` validated the URL and then
handed httpx `follow_redirects=True`, which checks nothing after the first hop.
A public address that answers `302 Location: http://169.254.169.254/…` was
fetched and its body handed to the model. Every hop is checked here.

**The text is bounded before it is chunked, not only before it is stored.** A
2MB page is roughly 1,250 chunks and 40 embedding batches; a capture that takes
minutes inside one POST is indistinguishable from a hang.

What this is not: a readability algorithm. It strips a page to its text and
keeps line structure. It does not score paragraphs, find the "main" article, or
guess at anything the page did not say about itself -- a missing author is
missing, not inferred.
"""

from __future__ import annotations

import html
import json
import logging
import re
from dataclasses import dataclass
from urllib.parse import quote, urljoin, urlparse

import httpx

from backend.mcp.ssrf import UnsafeURL, check_url_async

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; AMETHYST/0.1; +https://github.com/)"
MAX_PAGE_BYTES = 2_000_000
#: The text kept after reduction. Well above a long article, well below the
#: point where chunking and embedding stop being interactive.
MAX_TEXT_CHARS = 120_000
MAX_REDIRECTS = 5
DEFAULT_TIMEOUT = 25.0

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"}
OEMBED_URL = "https://www.youtube.com/oembed?url={url}&format=json"


class FetchError(RuntimeError):
    """The page could not be read. Carries a sentence fit to show someone."""


@dataclass(frozen=True)
class FetchedPage:
    url: str
    final_url: str
    title: str
    text: str
    site: str | None = None
    author: str | None = None
    published_on: str | None = None
    content_type: str = ""
    truncated: bool = False
    #: Why the text is thin or absent, when it is. Empty when nothing is amiss.
    note: str = ""

    @property
    def word_count(self) -> int:
        return len(self.text.split())


_SCRIPTS = re.compile(
    r"<(script|style|noscript|template|svg|head)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE
)
_CHROME = re.compile(r"<(nav|header|footer|aside|form)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_BLOCK_END = re.compile(r"</(p|div|section|article|li|h[1-6]|tr|blockquote)>", re.IGNORECASE)
_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
_COMMENTS = re.compile(r"<!--.*?-->", re.DOTALL)
_BLANK_RUN = re.compile(r"\n{3,}")


def reduce_html(page: str) -> str:
    """Strip a page down to its text, keeping line structure."""
    text = _COMMENTS.sub(" ", page)
    text = _SCRIPTS.sub(" ", text)
    # Navigation and footers are the same words on every page of a site, so they
    # dominate a keyword index and say nothing about the article.
    text = _CHROME.sub(" ", text)
    text = _BLOCK_END.sub("\n", text)
    text = _BR.sub("\n", text)
    text = _TAGS.sub("", text)
    text = html.unescape(text)
    lines = [line.strip() for line in text.splitlines()]
    return _BLANK_RUN.sub("\n\n", "\n".join(line for line in lines if line))


_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.DOTALL | re.IGNORECASE)
_META = re.compile(r"<meta\s+([^>]+?)/?>", re.IGNORECASE)
_ATTR = re.compile(r"""(\w[\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")

#: meta keys worth reading, mapped to the field they answer. Only what a page
#: states about itself: nothing here is inferred from the body.
_META_KEYS = {
    "og:title": "title",
    "twitter:title": "title",
    "og:site_name": "site",
    "author": "author",
    "article:author": "author",
    "og:article:author": "author",
    "twitter:creator": "author",
    "citation_author": "author",
    "article:published_time": "published_on",
    "og:article:published_time": "published_on",
    "citation_publication_date": "published_on",
    "date": "published_on",
    "og:description": "description",
    "description": "description",
}

_ISO_DAY = re.compile(r"(\d{4}-\d{2}-\d{2})")


def extract_metadata(page: str) -> dict[str, str]:
    """Title, site, author and publication date, as the page declares them."""
    found: dict[str, str] = {}

    for raw in _META.findall(page[:400_000]):
        attrs = {
            m.group(1).lower(): html.unescape(m.group(2) or m.group(3) or m.group(4) or "")
            for m in _ATTR.finditer(raw)
        }
        key = (attrs.get("property") or attrs.get("name") or attrs.get("itemprop") or "").lower()
        value = (attrs.get("content") or "").strip()
        field = _META_KEYS.get(key)
        if field and value and field not in found:
            found[field] = value

    if "title" not in found:
        match = _TITLE.search(page)
        if match:
            found["title"] = html.unescape(_TAGS.sub("", match.group(1))).strip()

    if "published_on" in found:
        # Keep the day only. A page states a timestamp in whatever zone it likes,
        # and converting one we were not told the zone of would be a guess.
        day = _ISO_DAY.search(found["published_on"])
        found["published_on"] = day.group(1) if day else ""
        if not found["published_on"]:
            del found["published_on"]

    return {k: v for k, v in found.items() if v}


def is_youtube(url: str) -> bool:
    return (urlparse(url).hostname or "").lower() in YOUTUBE_HOSTS


#: X serves a JavaScript shell to an ordinary fetch, so a captured link has
#: historically landed as a title-less row with no text -- findable by neither
#: its content nor its title. The hosts the reader (`backend/web/social.py`)
#: owns are the same ones checked here.
X_HOSTS = {"x.com", "twitter.com", "mobile.twitter.com"}
X_OEMBED_URL = "https://publish.twitter.com/oembed?url={url}"


def is_x_post(url: str) -> bool:
    """An x.com/twitter.com link. Statuses and profiles alike; the oEmbed
    endpoint sorts out which is which, and a non-post answers None."""
    return (urlparse(url).hostname or "").lower() in X_HOSTS


async def x_oembed(url: str, *, timeout: float = 10.0) -> dict[str, str] | None:
    """A post's author and text, from X's own public oEmbed endpoint.

    No credentials, no rate limit worth naming, and no thread context -- the
    single post and nothing before or after it. That is still the difference
    between a captured link with a real title and body and one logged as a bare
    URL, and it is why this is the middle rung of the capture ladder rather
    than a footnote: it works on a machine with no reader installed, which is
    every machine that has not opted in.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(
                X_OEMBED_URL.format(url=quote(url, safe="")),
                headers={"User-Agent": USER_AGENT},
            )
        if response.status_code != 200:
            return None
        data = json.loads(response.text)
    except (httpx.HTTPError, ValueError) as exc:
        log.debug("x oembed lookup failed for %s: %s", url, exc)
        return None
    # `html` is the embed markup with the post text inside it; strip the tags
    # to the words. Not a full readability pass -- a blockquote, a link and
    # the author's handle is the whole of what X puts in there.
    text = re.sub(r"<[^>]+>", " ", data.get("html") or "")
    text = " ".join(text.split())
    title = (data.get("author_name") or "").strip()
    if not title:
        return None
    return {
        "title": f"{title} on X",
        "author": title,
        "site": "x.com",
        "text": text,
    }


async def youtube_oembed(url: str, *, timeout: float = 10.0) -> dict[str, str] | None:
    """Title and channel for a YouTube URL, from YouTube's own public endpoint.

    No API key, and no transcript: YouTube does not offer one here, and a
    transcript AMETHYST invented would be worse than none at all.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(
                OEMBED_URL.format(url=quote(url, safe="")),
                headers={"User-Agent": USER_AGENT},
            )
        if response.status_code != 200:
            return None
        data = json.loads(response.text)
    except (httpx.HTTPError, ValueError) as exc:
        log.debug("oembed lookup failed for %s: %s", url, exc)
        return None
    title = (data.get("title") or "").strip()
    author = (data.get("author_name") or "").strip()
    if not title:
        return None
    result: dict[str, str] = {"title": title, "author": author, "site": "YouTube"}
    # YouTube's oEmbed response includes a thumbnail_url — pass it through so
    # the caller can save it to disk. It is usually the hqdefault.jpg image.
    thumb = (data.get("thumbnail_url") or "").strip()
    if thumb:
        result["thumbnail_url"] = thumb
    return result


async def _get_following_redirects(
    client: httpx.AsyncClient, url: str, *, timeout: float
) -> httpx.Response:
    """GET, checking every hop rather than only the address we were handed."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        await check_url_async(current)
        response = await client.get(
            current, headers={"User-Agent": USER_AGENT}, timeout=timeout
        )
        if response.status_code not in (301, 302, 303, 307, 308):
            return response
        location = response.headers.get("location")
        if not location:
            return response
        current = urljoin(current, location)
    raise FetchError(f"{url} redirected more than {MAX_REDIRECTS} times")


async def fetch_readable(url: str, *, timeout: float = DEFAULT_TIMEOUT) -> FetchedPage:
    """Fetch a URL and return its text and whatever it says about itself.

    Raises `UnsafeURL` for a private address at any hop, and `FetchError` for
    anything else that stopped the page being read.
    """
    url = (url or "").strip()
    if not url:
        raise FetchError("no url was given")
    if "://" not in url:
        url = f"https://{url}"

    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
            response = await _get_following_redirects(client, url, timeout=timeout)
    except UnsafeURL:
        raise
    except httpx.HTTPError as exc:
        raise FetchError(f"could not fetch {url}: {exc}") from exc

    if response.status_code >= 400:
        raise FetchError(f"{url} returned HTTP {response.status_code}")

    final_url = str(response.url)
    content_type = response.headers.get("content-type", "")

    # Read the body as a stream, stopping at the cap. `response.text`
    # materialised the whole response first -- the 2MB limit only trimmed after
    # it was already in memory, so a model fetching a huge file ballooned the
    # process before the slice.
    if response.is_stream_consumed:
        raw = response.text[:MAX_PAGE_BYTES]
    else:
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            chunks.append(chunk)
            size += len(chunk)
            if size >= MAX_PAGE_BYTES:
                break
        raw = b"".join(chunks)[:MAX_PAGE_BYTES].decode("utf-8", errors="replace")
        await response.aclose()

    meta: dict[str, str] = {}
    if "html" in content_type or (not content_type and raw.lstrip().startswith("<")):
        meta = extract_metadata(raw)
        body = reduce_html(raw)
    else:
        body = raw

    truncated = len(body) > MAX_TEXT_CHARS
    if truncated:
        body = body[:MAX_TEXT_CHARS]

    note = ""
    if truncated:
        note = f"the page was longer than {MAX_TEXT_CHARS:,} characters and was cut off"
    elif not body.strip():
        note = "the page returned no readable text"

    title = meta.get("title") or _title_from_url(final_url)
    return FetchedPage(
        url=url,
        final_url=final_url,
        title=title,
        text=body,
        site=meta.get("site") or (urlparse(final_url).hostname or None),
        author=meta.get("author"),
        published_on=meta.get("published_on"),
        content_type=content_type,
        truncated=truncated,
        note=note,
    )


def _title_from_url(url: str) -> str:
    """A last-resort name. Better than an empty title, honest about being a URL."""
    parsed = urlparse(url)
    tail = (parsed.path or "").rstrip("/").rsplit("/", 1)[-1]
    tail = re.sub(r"\.\w{1,5}$", "", tail).replace("-", " ").replace("_", " ").strip()
    return tail or parsed.hostname or url
