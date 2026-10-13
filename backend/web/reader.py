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

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
}
MAX_PAGE_BYTES = 2_000_000
#: The text kept after reduction. Well above a long article or documentation page,
#: well below the point where scraping explodes model context and rate limit quotas.
MAX_TEXT_CHARS = 24_000
MAX_REDIRECTS = 10
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
    image: str | None = None
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
    "og:image": "image",
    "og:image:url": "image",
    "og:image:secure_url": "image",
    "twitter:image": "image",
    "twitter:image:src": "image",
    "image": "image",
    "thumbnail": "image",
}

_LINK_IMG = re.compile(
    r"""<link\s+[^>]*rel=["'](?:image_src|apple-touch-icon|icon)["'][^>]*href=["']([^"']+)["']""",
    re.IGNORECASE,
)
_LINK_IMG2 = re.compile(
    r"""<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:image_src|apple-touch-icon|icon)["']""",
    re.IGNORECASE,
)
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

    if "image" not in found:
        m_img = _LINK_IMG.search(page[:200_000]) or _LINK_IMG2.search(page[:200_000])
        if m_img:
            found["image"] = html.unescape(m_img.group(1)).strip()

    return {k: v for k, v in found.items() if v}


def is_youtube(url: str) -> bool:
    return (urlparse(url).hostname or "").lower() in YOUTUBE_HOSTS


PINTEREST_HOSTS = {"pinterest.com", "www.pinterest.com", "pin.it"}
PINTEREST_OEMBED_URL = "https://www.pinterest.com/oembed.json?url={url}"


def is_pinterest(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host == "pin.it" or host == "pinterest.com" or host.endswith(".pinterest.com") or "pinterest." in host


async def pinterest_oembed(url: str, *, timeout: float = 10.0) -> dict[str, str] | None:
    """Fetch pin title, author, and high-res thumbnail via Pinterest's public oEmbed."""
    try:
        async with httpx.AsyncClient(headers=DEFAULT_HEADERS, timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(PINTEREST_OEMBED_URL.format(url=quote(url, safe="")))
            if resp.status_code == 200:
                data = resp.json()
                title = (data.get("title") or "").strip()
                author = (data.get("author_name") or "").strip()
                thumb = (data.get("thumbnail_url") or "").strip()
                if thumb:
                    thumb = thumb.replace("/236x/", "/736x/")
                return {
                    "title": title or "Pinterest Pin",
                    "author": author or None,
                    "site": "Pinterest",
                    "thumbnail_url": thumb or None,
                }
    except Exception as exc:
        log.debug("Pinterest oEmbed failed for %s: %s", url, exc)
    return None


THREADS_HOSTS = {"threads.net", "www.threads.net", "threads.com", "www.threads.com"}
THREADS_OEMBED_URLS = (
    "https://graph.threads.com/oembed?url={url}",
    "https://graph.threads.net/oembed?url={url}",
)


def is_threads(url: str) -> bool:
    """A threads.net or threads.com link."""
    host = (urlparse(url).hostname or "").lower()
    return host in THREADS_HOSTS or any(host.endswith(f".{h}") for h in THREADS_HOSTS)


async def threads_oembed(url: str, *, timeout: float = 10.0) -> dict[str, Any] | None:
    """Fetch post text, author, and embed metadata via Threads' oEmbed API or rendered reader fallback."""
    clean_url = re.sub(r"^https?://(?:www\.)?threads\.com", "https://www.threads.net", url)
    author = None
    m_author = re.search(r"/@([A-Za-z0-9_.-]+)", clean_url)
    if m_author:
        author = m_author.group(1)

    clean_text = ""
    thumb: str | None = None
    slide_urls: list[str] = []

    # Attempt 1: Tokenless public oEmbed API
    for endpoint in (
        "https://graph.threads.net/v1.0/oembed?url={url}",
        "https://graph.threads.com/v1.0/oembed?url={url}",
        *THREADS_OEMBED_URLS,
    ):
        try:
            target = endpoint.format(url=quote(clean_url, safe=""))
            async with httpx.AsyncClient(timeout=min(timeout, 6.0), follow_redirects=True) as client:
                resp = await client.get(target, headers=DEFAULT_HEADERS)
            if resp.status_code == 200:
                data = resp.json()
                raw_html = data.get("html") or ""
                # Strip HTML tags
                raw_extracted = re.sub(r"<[^>]+>", " ", raw_html)
                raw_extracted = " ".join(raw_extracted.split())
                raw_extracted = re.sub(r"\s*View on Threads\s*", "", raw_extracted, flags=re.IGNORECASE).strip()
                if raw_extracted:
                    clean_text = raw_extracted
                if not author and data.get("author_name"):
                    author = str(data["author_name"]).strip()
                if data.get("thumbnail_url"):
                    thumb = str(data["thumbnail_url"]).strip()
                if clean_text:
                    break
        except Exception as exc:
            log.debug("Threads oEmbed failed for %s via %s: %s", clean_url, endpoint, exc)

    # Attempt 2: Rendered Reader fallback when oEmbed provides no text (only SVG logo)
    if not clean_text or len(clean_text) < 5:
        try:
            from backend.web.jina import fetch_rendered
            rendered_page = await fetch_rendered(clean_url, timeout=timeout)
            if rendered_page and rendered_page.text:
                full_md = rendered_page.text
                # Match post text right under date link or # [Thread]
                m_post = re.search(
                    r"\[\d{2}/\d{2}/\d{2,4}\]\(https?://[^\)]+/post/[^\)]+\)\s*\n\s*\n(.*?)(?:\n\s*\n\d+(?:\.\d+)?[KMBkmb]?|\Z)",
                    full_md,
                    re.DOTALL,
                )
                if m_post:
                    clean_text = m_post.group(1).strip()
                else:
                    m2 = re.search(r"#\s*\[Thread\][^\n]*\n(.*?)(?:\n\s*\n\d+(?:\.\d+)?[KMBkmb]?|\Z)", full_md, re.DOTALL)
                    if m2:
                        lines = [l.strip() for l in m2.group(1).splitlines() if l.strip() and not l.startswith("![") and not l.startswith("[")]
                        clean_text = " ".join(lines[:6])

                # Extract post images
                all_imgs = re.findall(r"!\[(.*?)\]\((https?://[^\)]+)\)", full_md)
                post_imgs = [img for alt, img in all_imgs if "profile picture" not in alt.lower() and "profile_pic" not in img and "rsrc.php" not in img]
                if post_imgs:
                    thumb = post_imgs[0]
                    slide_urls = post_imgs
                elif all_imgs and not thumb:
                    thumb = all_imgs[0][1]
        except Exception as exc:
            log.debug("Threads rendered reader fallback failed for %s: %s", url, exc)

    if not clean_text and not author and not thumb:
        return None

    title = f"Thread by @{author}" if author else "Threads Post"
    if clean_text:
        first_line = clean_text.splitlines()[0][:90].strip()
        title = f"@{author}: {first_line}" if author else first_line

    return {
        "title": title,
        "author": author or None,
        "site": "threads.net",
        "text": clean_text,
        "thumbnail_url": thumb,
        "slide_urls": slide_urls,
    }


#: X serves a JavaScript shell to an ordinary fetch, so a captured link has
#: historically landed as a title-less row with no text -- findable by neither
#: its content nor its title. The hosts the reader (`backend/web/social.py`)
#: owns are the same ones checked here.
X_HOSTS = {"x.com", "twitter.com", "mobile.twitter.com"}
X_OEMBED_URL = "https://publish.twitter.com/oembed?url={url}"
X_OEMBED_V2_URL = "https://publish.x.com/oembed?url={url}"


def is_x_post(url: str) -> bool:
    """An x.com/twitter.com link. Statuses and profiles alike; the oEmbed
    endpoint sorts out which is which, and a non-post answers None."""
    return (urlparse(url).hostname or "").lower() in X_HOSTS


def _tweet_token(tweet_id: str) -> str:
    """Calculate syndication token for public tweet fetch."""
    import math
    try:
        val = (float(tweet_id) / 1e15) * math.pi
        chars = "0123456789abcdefghijklmnopqrstuvwxyz"
        int_part = int(val)
        frac_part = val - int_part
        res = []
        if int_part > 0:
            temp = int_part
            s = []
            while temp > 0:
                s.append(chars[temp % 36])
                temp //= 36
            res.extend(reversed(s))
        for _ in range(16):
            frac_part *= 36
            d = int(frac_part)
            res.append(chars[d])
            frac_part -= d
        raw = "".join(res)
        cleaned = re.sub(r"[0.]+", "", raw)
        return cleaned[:11]
    except Exception:
        return ""


async def x_oembed(url: str, *, timeout: float = 10.0) -> dict[str, Any] | None:
    """Fetch post author, text, images, and thumbnail from Twitter's syndication API, vxTwitter, or oEmbed."""
    m_id = re.search(r"/(?:status|statuses)/(\d+)", url)
    tweet_id = m_id.group(1) if m_id else None

    # Attempt 1: Twitter Syndication API (gives text, user, full attachments, high-res photos)
    if tweet_id:
        token = _tweet_token(tweet_id)
        syndication_url = f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&lang=en&token={token}"
        try:
            async with httpx.AsyncClient(timeout=min(timeout, 8.0), follow_redirects=True) as client:
                resp = await client.get(syndication_url, headers=DEFAULT_HEADERS)
            if resp.status_code == 200:
                data = resp.json()
                if data and isinstance(data, dict):
                    user = data.get("user") or {}
                    name = user.get("name") or ""
                    screen_name = user.get("screen_name") or ""
                    author = f"{name} (@{screen_name})" if (name and screen_name) else (screen_name or name or None)
                    text = (data.get("text") or "").strip()
                    photos = [p["url"] for p in data.get("photos", []) if isinstance(p, dict) and "url" in p]
                    media = [
                        m.get("media_url_https") for m in data.get("mediaDetails", [])
                        if isinstance(m, dict) and m.get("media_url_https")
                    ]
                    all_media = list(dict.fromkeys(photos + media))
                    avatar = user.get("profile_image_url_https") or (f"https://unavatar.io/x/{screen_name}" if screen_name else None)
                    thumb = all_media[0] if all_media else None
                    title = f"@{screen_name}: {text.splitlines()[0][:80]}" if screen_name and text else (text[:80] or f"Post by @{screen_name or 'author'}")
                    video_url = None
                    v_obj = data.get("video")
                    if v_obj and isinstance(v_obj, dict):
                        variants = v_obj.get("variants") or []
                        mp4_variants = [v for v in variants if isinstance(v, dict) and v.get("type") == "video/mp4" and v.get("src")]
                        if mp4_variants:
                            video_url = mp4_variants[0].get("src")
                    if not video_url:
                        for md in data.get("mediaDetails", []):
                            if isinstance(md, dict) and md.get("type") in ("video", "animated_gif"):
                                vi = md.get("video_info") or {}
                                for var in vi.get("variants") or []:
                                    if isinstance(var, dict) and var.get("content_type") == "video/mp4" and var.get("url"):
                                        video_url = var["url"]
                                        break
                            if video_url:
                                break
                    return {
                        "title": title,
                        "author": author,
                        "site": "x.com",
                        "text": text,
                        "thumbnail_url": thumb,
                        "avatar_url": avatar,
                        "video_url": video_url,
                        "slide_urls": all_media if len(all_media) > 1 else [],
                    }
        except Exception as exc:
            log.debug("Twitter syndication fetch failed for %s: %s", url, exc)

    # Attempt 2: fxtwitter / fixupx public API
    if tweet_id:
        try:
            async with httpx.AsyncClient(timeout=min(timeout, 8.0), follow_redirects=True) as client:
                fx_resp = await client.get(f"https://api.fxtwitter.com/status/{tweet_id}", headers=DEFAULT_HEADERS)
            if fx_resp.status_code == 200:
                fx_json = fx_resp.json()
                tweet = fx_json.get("tweet") or {}
                if tweet and tweet.get("text"):
                    author_obj = tweet.get("author") or {}
                    name = author_obj.get("name") or ""
                    screen_name = author_obj.get("screen_name") or ""
                    author = f"{name} (@{screen_name})" if (name and screen_name) else (screen_name or name or None)
                    text = (tweet.get("text") or "").strip()
                    media = tweet.get("media") or {}
                    photos = [p.get("url") for p in media.get("photos", []) if isinstance(p, dict) and p.get("url")]
                    videos = [v.get("url") for v in media.get("videos", []) if isinstance(v, dict) and v.get("url")]
                    all_media = list(dict.fromkeys(photos + videos))
                    avatar = author_obj.get("avatar_url") or (f"https://unavatar.io/x/{screen_name}" if screen_name else None)
                    thumb = all_media[0] if all_media else None
                    title = f"@{screen_name}: {text.splitlines()[0][:80]}" if screen_name and text else (text[:80] or f"Post by @{screen_name or 'author'}")
                    return {
                        "title": title,
                        "author": author,
                        "site": "x.com",
                        "text": text,
                        "thumbnail_url": thumb,
                        "avatar_url": avatar,
                        "video_url": videos[0] if videos else None,
                        "slide_urls": all_media if len(all_media) > 1 else [],
                    }
        except Exception as exc:
            log.debug("fxtwitter API fetch failed for %s: %s", url, exc)

    # Attempt 3: vxTwitter public API
    if tweet_id:
        try:
            async with httpx.AsyncClient(timeout=min(timeout, 8.0), follow_redirects=True) as client:
                vx_resp = await client.get(f"https://api.vxtwitter.com/Twitter/status/{tweet_id}", headers=DEFAULT_HEADERS)
            if vx_resp.status_code == 200:
                data = vx_resp.json()
                if data and isinstance(data, dict) and data.get("text"):
                    name = data.get("user_name") or ""
                    screen_name = data.get("user_screen_name") or ""
                    author = f"{name} (@{screen_name})" if (name and screen_name) else (screen_name or name or None)
                    text = (data.get("text") or "").strip()
                    media_urls = data.get("mediaURLs") or []
                    thumb = (
                        media_urls[0]
                        if media_urls
                        else (
                            data.get("user_profile_image_url")
                            or (f"https://unavatar.io/x/{screen_name}" if screen_name else None)
                        )
                    )
                    video_url = None
                    for me in data.get("media_extended", []):
                        if isinstance(me, dict) and me.get("type") in ("video", "gif") and me.get("url"):
                            video_url = me["url"]
                            break
                    if not video_url:
                        for u in media_urls:
                            if isinstance(u, str) and (".mp4" in u or ".m3u8" in u or ".mov" in u):
                                video_url = u
                                break
                    title = f"@{screen_name}: {text.splitlines()[0][:80]}" if screen_name and text else (text[:80] or f"Post by @{screen_name or 'author'}")
                    return {
                        "title": title,
                        "author": author,
                        "site": "x.com",
                        "text": text,
                        "thumbnail_url": thumb,
                        "video_url": video_url,
                        "slide_urls": media_urls if len(media_urls) > 1 else [],
                    }
        except Exception as exc:
            log.debug("vxTwitter API fetch failed for %s: %s", url, exc)

    # Attempt 3: Public publish.twitter.com / publish.x.com oEmbed (requires unencoded URL parameter)
    for oembed_base in ("https://publish.twitter.com/oembed?url=", "https://publish.x.com/oembed?url="):
        for candidate_url in (url, re.sub(r"^https?://(?:www\.)?x\.com", "https://twitter.com", url)):
            try:
                target = f"{oembed_base}{candidate_url}"
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    response = await client.get(target, headers=DEFAULT_HEADERS)
                if response.status_code == 200:
                    data = json.loads(response.text)
                    raw_html = data.get("html") or ""
                    m_p = re.search(r"<p[^>]*>(.*?)</p>", raw_html, re.DOTALL)
                    text = m_p.group(1) if m_p else raw_html
                    text = re.sub(r"<[^>]+>", " ", text)
                    text = html.unescape(" ".join(text.split()))
                    author_name = (data.get("author_name") or "").strip()
                    author_url = (data.get("author_url") or "").strip()
                    handle = None
                    m_h = re.search(r"/(?:x|twitter)\.com/([^/?#]+)", author_url)
                    if m_h:
                        handle = m_h.group(1)
                    avatar = f"https://unavatar.io/x/{handle}" if handle else None
                    title = f"@{handle}: {text[:80]}" if handle and text else (f"{author_name} on X" if author_name else "X Post")
                    return {
                        "title": title,
                        "author": f"{author_name} (@{handle})" if (author_name and handle) else (author_name or handle or None),
                        "site": "x.com",
                        "text": text,
                        "thumbnail_url": None,
                        "avatar_url": avatar,
                        "slide_urls": [],
                    }
            except Exception as exc:
                log.debug("x oembed lookup failed for %s via %s: %s", candidate_url, oembed_base, exc)

    # Attempt 4: Fallback for deleted or private tweets - extract handle from URL
    m_handle = re.search(r"/(?:x|twitter)\.com/([^/?#]+)/status/(\d+)", url)
    if m_handle:
        handle = m_handle.group(1)
        if handle.lower() not in ("i", "intent", "share"):
            return {
                "title": f"Post by @{handle}",
                "author": f"@{handle}",
                "site": "x.com",
                "text": f"Post by @{handle} on X (formerly Twitter). The original post content could not be retrieved from X's public endpoints (post may be private or deleted).",
                "thumbnail_url": None,
                "avatar_url": f"https://unavatar.io/x/{handle}",
                "slide_urls": [],
            }

    return None


REDDIT_HOSTS = {"reddit.com", "www.reddit.com", "old.reddit.com", "redd.it", "v.redd.it"}


def is_reddit(url: str) -> bool:
    """True for Reddit post, comments or media URLs."""
    host = (urlparse(url).hostname or "").lower()
    return host in REDDIT_HOSTS or any(host.endswith("." + h) for h in REDDIT_HOSTS)


async def reddit_post(url: str, *, timeout: float = 10.0) -> dict[str, Any] | None:
    """Fetch post author, text, images, and thumbnail from Reddit's public Atom/RSS, JSON, or oEmbed."""
    clean_url = url.split("?")[0].rstrip("/")
    m_short = re.search(r"redd\.it/([A-Za-z0-9]+)", clean_url)
    if m_short:
        clean_url = f"https://www.reddit.com/comments/{m_short.group(1)}"

    # 1. First attempt: Reddit Atom RSS feed (<clean_url>.rss)
    rss_url = clean_url + ".rss"
    try:
        import xml.etree.ElementTree as ET
        async with httpx.AsyncClient(timeout=min(timeout, 8.0), follow_redirects=True) as client:
            resp = await client.get(rss_url, headers=DEFAULT_HEADERS)
        if resp.status_code == 200 and "<feed" in resp.text:
            root = ET.fromstring(resp.text)
            ns = {"atom": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/"}
            entry = root.find("atom:entry", ns)
            if entry is not None:
                title = entry.findtext("atom:title", namespaces=ns) or ""
                # Strip trailing " : subreddit_name" from title
                title = re.sub(r"\s*:\s*[A-Za-z0-9_]+$", "", title).strip()
                author_el = entry.find("atom:author", ns)
                author = author_el.findtext("atom:name", namespaces=ns) if author_el is not None else None
                raw_content = entry.findtext("atom:content", namespaces=ns) or ""

                # Extract image or thumbnail
                thumb = None
                media_thumb = entry.find("media:thumbnail", ns)
                if media_thumb is not None:
                    thumb = media_thumb.attrib.get("url")
                if not thumb:
                    imgs = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', raw_content)
                    if imgs:
                        thumb = imgs[0]

                # Clean readable markdown/plain text
                text = re.sub(r"<br\s*/?>", "\n", raw_content)
                text = re.sub(r"</(p|div|li|h[1-6]|blockquote)>", "\n\n", text)
                text = re.sub(r"<[^>]+>", " ", text)
                text = html.unescape(text)
                clean_lines = [line.strip() for line in text.splitlines()]
                text = "\n".join(l for l in clean_lines if l)

                m_sub = re.search(r"/r/([^/]+)", clean_url)
                sub = m_sub.group(1) if m_sub else None

                return {
                    "title": title or "Reddit Post",
                    "author": author,
                    "site": "reddit.com",
                    "text": text,
                    "thumbnail_url": thumb,
                    "subreddit": sub,
                }
    except Exception as exc:
        log.debug("Reddit RSS fetch failed for %s: %s", url, exc)

    # 2. Second attempt: Reddit oEmbed
    try:
        oembed_url = f"https://www.reddit.com/oembed?url={quote(clean_url, safe='')}"
        async with httpx.AsyncClient(timeout=min(timeout, 6.0), follow_redirects=True) as client:
            resp = await client.get(oembed_url, headers=DEFAULT_HEADERS)
        if resp.status_code == 200:
            data = resp.json()
            title = data.get("title") or ""
            author_name = data.get("author_name") or ""
            author = f"/u/{author_name}" if author_name else None
            m_sub = re.search(r"/r/([^/]+)", clean_url)
            sub = m_sub.group(1) if m_sub else None
            return {
                "title": title or "Reddit Post",
                "author": author,
                "site": "reddit.com",
                "text": title,
                "thumbnail_url": None,
                "subreddit": sub,
            }
    except Exception as exc:
        log.debug("Reddit oembed fetch failed for %s: %s", url, exc)

    return None


async def youtube_oembed(url: str, *, timeout: float = 10.0) -> dict[str, str] | None:
    """Title and channel for a YouTube URL, from YouTube's own public endpoint.

    No API key, and no transcript: YouTube does not offer one here, and a
    transcript AMETHYST invented would be worse than none at all.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(
                OEMBED_URL.format(url=quote(url, safe="")),
                headers=DEFAULT_HEADERS,
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
            current, headers=DEFAULT_HEADERS, timeout=timeout
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
    image_url = meta.get("image")
    if image_url:
        image_url = urljoin(final_url, image_url)
    elif content_type.startswith("image/"):
        image_url = final_url

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
        image=image_url,
        note=note,
    )


def _title_from_url(url: str) -> str:
    """A last-resort name. Better than an empty title, honest about being a URL."""
    parsed = urlparse(url)
    tail = (parsed.path or "").rstrip("/").rsplit("/", 1)[-1]
    tail = re.sub(r"\.\w{1,5}$", "", tail).replace("-", " ").replace("_", " ").strip()
    return tail or parsed.hostname or url
