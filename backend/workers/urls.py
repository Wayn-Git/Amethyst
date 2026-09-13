"""A batch of URLs, read once each and reasoned about at most once in total.

    fetch -> extract -> normalize -> canonicalize -> deduplicate -> hash
          -> relevance -> optionally, one model call

The shape exists because the obvious implementation is quadratically wasteful.
Handed a hundred links, the naive worker fetches a hundred pages and makes a
hundred model calls -- and roughly a third of those pages are the same article
behind a different tracking query, a syndicated copy, or an AMP mirror. Every
stage before `relevance` is deterministic and cheap, and every one of them
removes work the expensive stage would otherwise have done:

  * canonicalising before fetching means a link shared twice with different
    `utm_` tags is *one* HTTP request, not two followed by a comparison
  * hashing the extracted text catches the copies canonicalisation cannot know
    about -- the same wire story on four sites
  * scoring for relevance decides which handful is worth a model's attention

The model is then called **once**, over the survivors, or not at all. That is
the whole point: a hundred URLs is a reason to fetch a hundred times and think
once, not to think a hundred times.

Fetching goes through `backend/web/reader.fetch_readable` rather than an HTTP
call of its own, so this inherits the protection that already lives there: a
host resolving to a private or loopback address is refused. That matters more
here than anywhere else in AMETHYST, because the addresses in a batch can come
from a page the agent just read -- which makes "read these twenty URLs" the one
place a stranger gets to choose what this machine connects to.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from backend.library.enrich import normalize_url
from backend.web.reader import FetchError, fetch_readable

log = logging.getLogger(__name__)

#: How many pages are in flight at once. Enough to hide latency, low enough not
#: to look like a scraper to any one host.
CONCURRENCY = 8
DEFAULT_TIMEOUT = 25.0
#: A batch is a batch, not a crawl. Above this the caller wanted a crawler.
MAX_URLS = 200

#: Query parameters that identify the *sharer* rather than the page. Stripping
#: them is what makes two shares of one article one fetch.
TRACKING = re.compile(
    r"^(utm_\w+|fbclid|gclid|gbraid|wbraid|msclkid|mc_[ce]id|igshid|ref|ref_src|"
    r"ref_url|source|spm|si|s_cid|cmpid|ncid|_ga|yclid|twclid|trk|trkCampaign)$",
    re.I,
)

#: Words carrying no signal about what a page is about. Deliberately short: this
#: is a relevance gate in front of a model, not a search engine.
STOP = frozenset(
    "a an and are as at be but by for from has have he her his i if in into is it its of"
    " on or she that the their them they this to was were what when which who will with"
    " you your".split()
)

#: Below this a page is not about the query and does not go to the model. Zero
#: when no query was given -- with nothing to be relevant to, everything passes
#: and `limit` alone decides.
RELEVANT = 0.08
#: How many pages one model call may be given. The cap is the cost control: a
#: batch of five hundred and a batch of five cost the same to reason about.
LLM_BATCH = 8


def canonicalize(raw: str) -> str:
    """The address two shares of the same page agree on.

    Lowercased host, no default port, no fragment, no tracking parameters, and
    remaining parameters sorted -- because `?b=2&a=1` and `?a=1&b=2` are one
    page and a string comparison does not know it. Path case is *kept*: a lot
    of the web serves different documents from `/A` and `/a`, and folding it
    would merge two articles into one.
    """
    url = normalize_url(raw)
    if not url:
        return ""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""

    host = (parts.hostname or "").lower()
    if not host:
        return ""
    if parts.port and not (
        (parts.scheme == "http" and parts.port == 80)
        or (parts.scheme == "https" and parts.port == 443)
    ):
        host = f"{host}:{parts.port}"

    query = urlencode(
        sorted(
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not TRACKING.match(key)
        )
    )
    path = parts.path or "/"
    # One trailing slash is a formatting choice, not a different document -- but
    # the root's slash is the path, so it stays.
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    return urlunsplit((parts.scheme, host, path, query, ""))


def content_hash(text: str) -> str:
    """A fingerprint of what a page *said*, blind to how it was formatted.

    Whitespace collapsed and case folded before hashing, so the same article
    with a different byline wrapper still collides. The same sha256 the document
    index uses (`backend/retrieval/chunking.py`), for the same reason: one
    fingerprint function across the system means one thing to reason about.
    """
    normalized = " ".join(text.split()).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _terms(text: str) -> list[str]:
    return [word for word in re.findall(r"[a-z0-9']{2,}", text.casefold()) if word not in STOP]


def relevance(text: str, title: str, query: str) -> float:
    """How much of the query this page actually covers, between 0 and 1.

    Coverage of the *query's* terms rather than frequency of them, which is the
    difference between "mentions all four things asked about" and "says one of
    them forty times". Title matches count double: a page whose headline carries
    the term is about it, and a page that mentions it in a footer is not.

    Deterministic and free. It exists so the model call downstream is made over
    eight pages instead of a hundred, and a gate that needed a model to decide
    what to send a model would be the problem it is here to solve.
    """
    wanted = set(_terms(query))
    if not wanted:
        return 1.0
    body = set(_terms(text)[:4000])
    head = set(_terms(title))
    hits = sum(1.0 for term in wanted if term in body) + sum(
        1.0 for term in wanted if term in head
    )
    return min(hits / (len(wanted) * 2), 1.0)


@dataclass
class PageResult:
    """One URL, and everything known about how it got here.

    The provenance fields are not decoration. A synthesis built from twenty
    pages is only checkable if each claim can be traced to the address it came
    from and the moment it was read -- and `duplicate_of` is how a reader knows
    two sources agreeing were one source counted twice.
    """

    url: str
    canonical: str = ""
    status: str = "pending"  # fetched | duplicate | skipped | failed
    final_url: str = ""
    title: str = ""
    text: str = ""
    site: str | None = None
    published_on: str | None = None
    word_count: int = 0
    hash: str = ""
    score: float = 0.0
    #: The canonical URL this repeats, when it repeats one.
    duplicate_of: str = ""
    error: str = ""
    fetched_at: str = ""

    def as_json(self, *, with_text: bool = False) -> dict[str, Any]:
        data = {
            "url": self.url,
            "canonical": self.canonical,
            "status": self.status,
            "final_url": self.final_url,
            "title": self.title,
            "site": self.site,
            "published_on": self.published_on,
            "words": self.word_count,
            "hash": self.hash[:16],
            "score": round(self.score, 3),
            "fetched_at": self.fetched_at,
        }
        if self.duplicate_of:
            data["duplicate_of"] = self.duplicate_of
        if self.error:
            data["error"] = self.error
        if with_text:
            data["text"] = self.text
        return data


@dataclass
class BatchResult:
    pages: list[PageResult] = field(default_factory=list)
    #: What each stage removed. The evidence that the pipeline earned its keep.
    counts: dict[str, int] = field(default_factory=dict)
    #: What the model was asked, if it was asked anything. `calls` is the number
    #: this run made, and the test that holds it at most 1 is the point.
    llm: dict[str, Any] = field(default_factory=dict)

    def as_json(self, *, with_text: bool = False) -> dict[str, Any]:
        return {
            "pages": [page.as_json(with_text=with_text) for page in self.pages],
            "counts": self.counts,
            "llm": self.llm,
        }


async def _fetch_one(
    result: PageResult, *, gate: asyncio.Semaphore, timeout: float
) -> PageResult:
    async with gate:
        try:
            page = await asyncio.wait_for(
                fetch_readable(result.canonical, timeout=timeout), timeout=timeout + 5
            )
        except TimeoutError:
            result.status, result.error = "failed", f"took longer than {timeout:.0f}s"
            return result
        except FetchError as exc:
            result.status, result.error = "failed", str(exc)
            return result
        except Exception as exc:  # a batch must not end because one host is odd
            result.status, result.error = "failed", f"{type(exc).__name__}: {exc}"
            return result

    result.status = "fetched"
    result.final_url = page.final_url
    result.title = page.title
    result.text = page.text
    result.site = page.site
    result.published_on = page.published_on
    result.word_count = page.word_count
    result.hash = content_hash(page.text) if page.text else ""
    result.fetched_at = time.strftime("%Y-%m-%d %H:%M:%S")
    return result


async def run_batch(
    urls: list[str],
    *,
    query: str = "",
    limit: int = LLM_BATCH,
    concurrency: int = CONCURRENCY,
    timeout: float = DEFAULT_TIMEOUT,
    summarize: bool = False,
    with_text: bool = False,
    paid_ok: bool | None = None,
) -> BatchResult:
    """Read every one of these, then think about them once.

    `summarize` is the only thing here that can spend a model, and it spends at
    most one call however many URLs were given. It is off by default, because a
    caller that wanted twenty pages fetched usually wanted twenty pages fetched.
    """
    seen: dict[str, PageResult] = {}
    results: list[PageResult] = []
    refused = 0
    for raw in urls[:MAX_URLS]:
        canonical = canonicalize(raw if isinstance(raw, str) else "")
        result = PageResult(url=str(raw)[:2000], canonical=canonical)
        if not canonical:
            result.status, result.error = "skipped", "not a usable http(s) address"
            refused += 1
        elif canonical in seen:
            # Before a single request is made. This is the stage that turns a
            # hundred shared links into sixty fetches.
            result.status, result.duplicate_of = "duplicate", canonical
        else:
            seen[canonical] = result
        results.append(result)

    fetchable = [r for r in results if r.status == "pending"]
    gate = asyncio.Semaphore(max(1, concurrency))
    await asyncio.gather(
        *(_fetch_one(r, gate=gate, timeout=timeout) for r in fetchable),
        return_exceptions=False,
    )

    # The second dedupe, on what the pages said rather than on their addresses.
    by_hash: dict[str, str] = {}
    for result in results:
        if result.status != "fetched" or not result.hash:
            continue
        first = by_hash.get(result.hash)
        if first is None:
            by_hash[result.hash] = result.canonical
            continue
        result.status = "duplicate"
        result.duplicate_of = first
        result.text = ""

    for result in results:
        if result.status == "fetched":
            result.score = relevance(result.text, result.title, query)

    kept = [r for r in results if r.status == "fetched"]
    kept.sort(key=lambda r: (-r.score, -r.word_count))
    counts = {
        "given": len(urls),
        "fetched": len(kept),
        "duplicates": sum(1 for r in results if r.status == "duplicate"),
        "failed": sum(1 for r in results if r.status == "failed"),
        "skipped": refused,
    }

    batch = BatchResult(pages=results, counts=counts, llm={"calls": 0})
    if not summarize:
        return batch

    floor = RELEVANT if query else 0.0
    shortlist = [r for r in kept if r.score >= floor][: max(1, limit)]
    batch.llm = await _summarize(shortlist, query=query, paid_ok=paid_ok)
    return batch


async def _summarize(
    pages: list[PageResult], *, query: str, paid_ok: bool | None = None
) -> dict[str, Any]:
    """One call, over the shortlist. Never one per page.

    Returns what happened rather than raising: a batch whose fetches all
    succeeded is a useful answer even when no model was reachable to read them,
    and losing sixty pages because a free tier was exhausted would be the worse
    outcome by a distance.
    """
    from backend.workers.llm import summarize_pages

    if not pages:
        return {"calls": 0, "note": "nothing passed the relevance gate"}
    return await summarize_pages(
        [
            {
                "url": page.canonical,
                "title": page.title,
                "site": page.site,
                "text": page.text[:6000],
            }
            for page in pages
        ],
        query=query,
        paid_ok=paid_ok,
    )
