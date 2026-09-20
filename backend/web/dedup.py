"""Search result deduplication and story syndication clustering.

Detects when multiple outlets report on the same underlying press release or event,
identifies the primary authority source, and clusters syndicated copies together
instead of presenting them as independent confirmations.
"""

from __future__ import annotations

import re
from typing import Sequence
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from backend.web.models import SearchResult

# Tracking and analytics query parameters to strip
_TRACKING_PARAMS = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "msclkid", "ref", "source", "_ga", "ocid", "cmpid",
})

# Punctuation and common publisher suffixes
_PUBLISHER_SUFFIX = re.compile(
    r"\s*([\|\-\–—]\s*(IGN|The Verge|Polygon|Kotaku|GameSpot|PC Gamer|Eurogamer|Reuters|Bloomberg|BBC|NYTimes|CNN|Forbes|Tom's Guide|Reddit|YouTube)).*$",
    re.IGNORECASE,
)
_PUNCT = re.compile(r"[^\w\s]")
_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "if", "in", "on", "at", "to", "for",
    "with", "about", "against", "between", "into", "through", "during", "before",
    "after", "above", "below", "from", "up", "down", "is", "are", "was", "were",
    "be", "been", "being", "have", "has", "had", "do", "does", "did", "this",
    "that", "these", "those", "it", "its", "as", "by", "of",
})


def canonical_url(url: str) -> str:
    """Normalize a URL to its canonical form, stripping tracking and noise."""
    if not url:
        return ""
    if url.startswith("//"):
        url = f"https:{url}"
    try:
        parsed = urlparse(url)
    except Exception:
        return url.strip().lower()

    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    # Convert mobile subdomains
    if host.startswith("m.") and len(host) > 2:
        host = host[2:]
    elif ".m." in host:
        host = host.replace(".m.", ".")

    # Filter out tracking query parameters
    query_parts = []
    if parsed.query:
        for k, v in parse_qs(parsed.query, keep_blank_values=False).items():
            if k.lower() not in _TRACKING_PARAMS:
                query_parts.append((k, v[0]))
    query_parts.sort()
    clean_query = urlencode(query_parts) if query_parts else ""

    path = parsed.path.rstrip("/")
    # Reassemble without fragment
    return urlunparse(("https", host, path, "", clean_query, ""))


def clean_title(title: str) -> str:
    """Strip publisher suffixes and punctuation for cleaner matching."""
    cleaned = _PUBLISHER_SUFFIX.sub("", title).strip()
    return cleaned


def tokenize_title(title: str) -> set[str]:
    """Tokenize a title into meaningful content words."""
    cleaned = clean_title(title).lower()
    cleaned = _PUNCT.sub(" ", cleaned)
    tokens = {word for word in cleaned.split() if word not in _STOPWORDS and len(word) > 1}
    return tokens


def jaccard_similarity(set_a: set[str], set_b: set[str]) -> float:
    """Calculate Jaccard similarity index between two token sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def deduplicate_and_cluster(results: Sequence[SearchResult], similarity_threshold: float = 0.55) -> list[SearchResult]:
    """Deduplicate exact URLs and cluster syndicated articles covering the same event.

    Retains the highest-authority source as the primary item and attaches
    syndicated URLs to it.
    """
    if not results:
        return []

    # 1. Exact URL deduplication
    unique_by_url: dict[str, SearchResult] = {}
    for r in results:
        canon = canonical_url(r.url)
        if canon in unique_by_url:
            existing = unique_by_url[canon]
            # Keep whichever has the richer snippet or higher score
            if len(r.snippet) > len(existing.snippet) or r.composite_score > existing.composite_score:
                unique_by_url[canon] = r
        else:
            unique_by_url[canon] = r

    candidates = list(unique_by_url.values())

    # 2. Sort candidates by authority and relevance so highest quality sources become cluster leaders
    candidates.sort(key=lambda x: x.composite_score, reverse=True)

    clustered: list[SearchResult] = []
    # Token sets for existing cluster leaders
    leader_tokens: list[tuple[SearchResult, set[str]]] = []

    for item in candidates:
        item_toks = tokenize_title(item.title)
        is_duplicate = False

        for leader, l_toks in leader_tokens:
            sim = jaccard_similarity(item_toks, l_toks)
            if sim >= similarity_threshold:
                # Matches an existing event cluster!
                leader.syndicated_urls.append(item.url)
                item.is_duplicate_of = leader.ref_id
                is_duplicate = True
                break

        if not is_duplicate:
            clustered.append(item)
            leader_tokens.append((item, item_toks))

    return clustered
