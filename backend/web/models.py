"""Data contracts and representations for modern AI web research.

Decouples search providers from downstream reasoning, provides normalized
results, stable reference IDs, authority scoring, and structured research traces.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class SourceAuthorityTier(str, Enum):
    """Hierarchical classification of source authority."""
    OFFICIAL = "official"          # Primary source: official corporate site, developer blog, government, doc hub (1.0)
    PRIMARY = "primary"            # Primary documentation, SEC filing, original whitepaper/study, release note (0.9)
    REPUTABLE = "reputable"        # Established journalism, major wire services, vetted industry leaders (0.75)
    SPECIALIZED = "specialized"    # Independent tech review, domain blog, specialized publication (0.6)
    COMMUNITY = "community"        # Reddit, Twitter/X, Hacker News, forums, discussion boards (0.4)
    UNVERIFIED = "unverified"      # Content aggregators, SEO farms, anonymous blogs (0.2)

    @property
    def score(self) -> float:
        weights = {
            SourceAuthorityTier.OFFICIAL: 1.0,
            SourceAuthorityTier.PRIMARY: 0.9,
            SourceAuthorityTier.REPUTABLE: 0.75,
            SourceAuthorityTier.SPECIALIZED: 0.6,
            SourceAuthorityTier.COMMUNITY: 0.4,
            SourceAuthorityTier.UNVERIFIED: 0.2,
        }
        return weights[self]


class ClaimStatus(str, Enum):
    """Epistemic status of a factual claim across sources."""
    CONFIRMED = "confirmed"        # Corroborated by official source or >= 2 reputable sources
    REPORTED = "reported"          # Reported by reputable sources without official studio/vendor confirmation
    DISPUTED = "disputed"          # Conflict or contradiction between reputable/official sources
    SPECULATIVE = "speculative"    # Community rumor or unverified leak


class FreshnessWindow(str, Enum):
    """Inferred temporal freshness window."""
    PAST_24H = "past_24h"
    PAST_7D = "past_7d"
    PAST_30D = "past_30d"
    PAST_YEAR = "past_year"
    ANYTIME = "anytime"


class ResearchDepth(str, Enum):
    """Depth mode for adaptive search routing."""
    SIMPLE = "simple"              # 1 fast query, snippet answer
    CURRENT = "current"            # Freshness-aware search + date prioritization
    RESEARCH = "research"          # Multi-query decomposition + authority ranking + dedup
    DEEP_RESEARCH = "deep"         # Multi-query + page inspection + targeted extraction + verification


@dataclass
class SearchResult:
    """Normalized internal representation for any search result.

    Decouples specific search providers (Tavily, Brave, Serper, Bing, DDG)
    from downstream reasoning and presentation.
    """
    ref_id: str
    title: str
    url: str
    domain: str
    snippet: str
    published_date: str | None = None
    relevance: float = 0.0
    freshness_score: float = 0.0
    authority_tier: SourceAuthorityTier = SourceAuthorityTier.UNVERIFIED
    result_type: str = "web"
    raw_source: str = "search"
    is_duplicate_of: str | None = None
    syndicated_urls: list[str] = field(default_factory=list)
    image_url: str | None = None

    @property
    def composite_score(self) -> float:
        """Weighted score balancing relevance (50%), authority (35%), freshness (15%)."""
        return (
            (self.relevance * 0.50)
            + (self.authority_tier.score * 0.35)
            + (self.freshness_score * 0.15)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "ref_id": self.ref_id,
            "title": self.title,
            "url": self.url,
            "domain": self.domain,
            "snippet": self.snippet,
            "published_date": self.published_date,
            "relevance": round(self.relevance, 2),
            "freshness_score": round(self.freshness_score, 2),
            "authority_tier": self.authority_tier.value,
            "result_type": self.result_type,
            "raw_source": self.raw_source,
            "is_duplicate_of": self.is_duplicate_of,
            "syndicated_urls": list(self.syndicated_urls),
            "image_url": self.image_url,
        }

    def format_citation(self) -> str:
        """Compact citation string for prompt/rendering, e.g. [turn0search1] Title (domain)."""
        date_str = f", {self.published_date}" if self.published_date else ""
        return f"[{self.ref_id}] {self.title} ({self.domain}{date_str}) - Tier: {self.authority_tier.value}"


@dataclass
class EvidenceItem:
    """Compact targeted passage extracted from a high-value source."""
    ref_id: str
    url: str
    domain: str
    title: str
    passage: str
    section_heading: str | None = None
    authority_tier: SourceAuthorityTier = SourceAuthorityTier.UNVERIFIED
    published_date: str | None = None
    claim_tag: str | None = None
    relevance_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ref_id": self.ref_id,
            "url": self.url,
            "domain": self.domain,
            "title": self.title,
            "passage": self.passage,
            "section_heading": self.section_heading,
            "authority_tier": self.authority_tier.value,
            "published_date": self.published_date,
            "claim_tag": self.claim_tag,
            "relevance_score": round(self.relevance_score, 2),
        }

    def format_for_context(self) -> str:
        """Formatted passage card designed to consume minimal tokens in reasoning context."""
        heading = f" > {self.section_heading}" if self.section_heading else ""
        date_info = f" | {self.published_date}" if self.published_date else ""
        tier = f" | {self.authority_tier.value.upper()}"
        return (
            f"--- Evidence [{self.ref_id}] {self.domain}{heading}{date_info}{tier} ---\n"
            f"{self.passage.strip()}\n"
            f"Source URL: {self.url}"
        )


@dataclass
class ResearchPlan:
    """Structured plan generated by the query planning layer."""
    original_query: str
    detected_intent: str
    depth: ResearchDepth
    freshness: FreshnessWindow
    entities: list[str] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    query_rationales: dict[str, str] = field(default_factory=dict)
    priority_domains: list[str] = field(default_factory=list)
    requires_verification: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "original_query": self.original_query,
            "detected_intent": self.detected_intent,
            "depth": self.depth.value,
            "freshness": self.freshness.value,
            "entities": self.entities,
            "queries": self.queries,
            "query_rationales": self.query_rationales,
            "priority_domains": self.priority_domains,
            "requires_verification": self.requires_verification,
        }


@dataclass
class ResearchTrace:
    """Structured observability log for inspecting research execution."""
    plan: ResearchPlan | None = None
    queries_executed: list[str] = field(default_factory=list)
    providers_used: list[str] = field(default_factory=list)
    results_retrieved_count: int = 0
    results_deduped_count: int = 0
    results_selected: list[str] = field(default_factory=list)
    pages_inspected: list[str] = field(default_factory=list)
    evidence_extracted: list[dict[str, Any]] = field(default_factory=list)
    claims_verified: list[dict[str, Any]] = field(default_factory=list)
    estimated_tokens_saved: int = 0
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan": self.plan.to_dict() if self.plan else None,
            "queries_executed": self.queries_executed,
            "providers_used": self.providers_used,
            "results_retrieved_count": self.results_retrieved_count,
            "results_deduped_count": self.results_deduped_count,
            "results_selected": self.results_selected,
            "pages_inspected": self.pages_inspected,
            "evidence_extracted": self.evidence_extracted,
            "claims_verified": self.claims_verified,
            "estimated_tokens_saved": self.estimated_tokens_saved,
            "duration_seconds": round(self.duration_seconds, 3),
        }


class SourceRegistry:
    """Task-level source registry maintaining stable reference IDs across turns."""

    def __init__(self, turn_index: int = 0) -> None:
        self._turn_index = turn_index
        self._sources: dict[str, SearchResult] = {}
        self._url_to_ref: dict[str, str] = {}
        self._evidence: list[EvidenceItem] = []
        self._counter = 0

    def register(self, result: SearchResult) -> str:
        """Register a search result, assigning a stable reference ID if needed."""
        norm_url = result.url.rstrip("/").lower()
        if norm_url in self._url_to_ref:
            existing_ref = self._url_to_ref[norm_url]
            return existing_ref

        if not result.ref_id:
            self._counter += 1
            result.ref_id = f"turn{self._turn_index}search{self._counter}"

        self._sources[result.ref_id] = result
        self._url_to_ref[norm_url] = result.ref_id
        return result.ref_id

    def get(self, ref_id: str) -> SearchResult | None:
        return self._sources.get(ref_id)

    def get_by_url(self, url: str) -> SearchResult | None:
        ref_id = self._url_to_ref.get(url.rstrip("/").lower())
        return self.get(ref_id) if ref_id else None

    def add_evidence(self, item: EvidenceItem) -> None:
        self._evidence.append(item)

    def all_sources(self) -> list[SearchResult]:
        return list(self._sources.values())

    def all_evidence(self) -> list[EvidenceItem]:
        return list(self._evidence)

    def format_sources_summary(self) -> str:
        """Generate a concise source reference block for context or citations."""
        if not self._sources:
            return ""
        lines = ["### Sources:"]
        for ref_id, src in self._sources.items():
            date_str = f" ({src.published_date})" if src.published_date else ""
            lines.append(f"- **[{ref_id}]** [{src.title}]({src.url}) — *{src.domain}*{date_str} [{src.authority_tier.value}]")
        return "\n".join(lines)
