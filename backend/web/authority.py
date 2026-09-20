"""Source authority evaluation and provenance classification.

Distinguishes official primary sources from reputable journalism, specialized
commentary, community forums, and unverified scrapers to weight evidential value
and preserve provenance in final answers.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from backend.web.models import SourceAuthorityTier

# Major global news wire and investigative reporting domains
_GLOBAL_NEWS_DOMAINS = frozenset({
    "reuters.com", "apnews.com", "bloomberg.com", "bbc.com", "bbc.co.uk",
    "nytimes.com", "wsj.com", "theguardian.com", "washingtonpost.com",
    "ft.com", "economist.com", "afp.com", "npr.org", "pbs.org",
})

# Reputable tech & science journalism
_TECH_NEWS_DOMAINS = frozenset({
    "arstechnica.com", "theverge.com", "wired.com", "techcrunch.com",
    "engadget.com", "zdnet.com", "anandtech.com", "tomshardware.com",
    "nature.com", "science.org", "newscientist.com", "spectrum.ieee.org",
})

# Reputable gaming & entertainment journalism
_GAMING_NEWS_DOMAINS = frozenset({
    "ign.com", "gamespot.com", "eurogamer.net", "polygon.com", "pcgamer.com",
    "kotaku.com", "gematsu.com", "videogameschronicle.com", "vgc.com",
    "gameinformer.com", "gamesradar.com", "rockpapershotgun.com",
})

# Community and forum domains
_COMMUNITY_DOMAINS = frozenset({
    "reddit.com", "twitter.com", "x.com", "news.ycombinator.com",
    "threads.net", "resetera.com", "neogaf.com", "quora.com",
    "youtube.com", "tiktok.com", "facebook.com", "instagram.com",
})

# Specialized developer & blogging platforms
_SPECIALIZED_DOMAINS = frozenset({
    "medium.com", "substack.com", "dev.to", "hashnode.com",
    "hackernoon.com", "towardsdatascience.com", "infoq.com",
    "stackoverflow.com", "stackexchange.com", "superuser.com",
})


def _extract_root_domain(netloc: str) -> str:
    """Extract root domain from hostname, handling subdomains."""
    host = netloc.lower().split(":")[0]
    parts = host.split(".")
    if len(parts) >= 2:
        if parts[-2] in ("co", "com", "gov", "org", "edu", "ac") and len(parts) >= 3:
            return ".".join(parts[-3:])
        return ".".join(parts[-2:])
    return host


def classify_authority(
    url: str,
    domain: str = "",
    priority_domains: list[str] | None = None,
) -> SourceAuthorityTier:
    """Classify the source into an authority tier."""
    parsed = urlparse(url)
    host = (domain or parsed.netloc or "").lower().split(":")[0]
    root = _extract_root_domain(host)

    # 1. Match against known priority / official entity domains
    if priority_domains:
        for p in priority_domains:
            p_clean = p.lower().strip()
            if host == p_clean or host.endswith(f".{p_clean}") or root == p_clean:
                return SourceAuthorityTier.OFFICIAL

    # 2. Government and higher education institutions
    if host.endswith(".gov") or host.endswith(".mil") or ".gov." in host:
        return SourceAuthorityTier.OFFICIAL
    if host.endswith(".edu") or ".edu." in host:
        return SourceAuthorityTier.PRIMARY

    # 3. Documentation and developer portals
    if any(host.startswith(prefix) for prefix in ("docs.", "developer.", "support.", "api.", "wiki.")):
        return SourceAuthorityTier.PRIMARY
    if host in ("github.com", "gitlab.com") and "/releases" in parsed.path:
        return SourceAuthorityTier.PRIMARY

    # 4. Reputable reporting (Global news, tech journalism, gaming journalism)
    if root in _GLOBAL_NEWS_DOMAINS or root in _TECH_NEWS_DOMAINS or root in _GAMING_NEWS_DOMAINS:
        return SourceAuthorityTier.REPUTABLE

    # 5. Specialized publications & professional blogging
    if root in _SPECIALIZED_DOMAINS or "blog." in host:
        return SourceAuthorityTier.SPECIALIZED

    # 6. Community discussion and social media
    if root in _COMMUNITY_DOMAINS:
        return SourceAuthorityTier.COMMUNITY

    return SourceAuthorityTier.UNVERIFIED


def determine_provenance(
    tier: SourceAuthorityTier,
    is_disputed: bool = False,
    corroboration_count: int = 1,
) -> str:
    """Format an explicit provenance tag describing the evidential standing."""
    if is_disputed:
        return "DISPUTED_CLAIM"
    if tier == SourceAuthorityTier.OFFICIAL:
        return "OFFICIAL_CONFIRMATION"
    if tier == SourceAuthorityTier.PRIMARY:
        return "PRIMARY_DOCUMENTATION"
    if tier == SourceAuthorityTier.REPUTABLE:
        return "CORROBORATED_REPORTING" if corroboration_count > 1 else "REPUTABLE_REPORTING"
    if tier == SourceAuthorityTier.SPECIALIZED:
        return "INDUSTRY_ANALYSIS"
    if tier == SourceAuthorityTier.COMMUNITY:
        return "COMMUNITY_SPECULATION"
    return "UNVERIFIED_SOURCE"
