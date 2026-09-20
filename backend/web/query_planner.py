"""Query understanding and rewriting layer for web research.

Determines what the user is actually asking, extracts entities, infers temporal
windows, identifies authoritative domains, and dynamically derives targeted search
queries instead of naively passing raw conversational text to a search provider.
"""

from __future__ import annotations

import datetime
import re
from typing import Any

from backend.web.models import FreshnessWindow, ResearchDepth, ResearchPlan


# Words signalling time sensitivity
_TODAY_SIGNALS = re.compile(
    r"\b(today|tonight|breaking|just now|past 24h|past 24 hours|last 24 hours|this morning)\b",
    re.IGNORECASE,
)
_WEEK_SIGNALS = re.compile(
    r"\b(recently|recent|latest|this week|past week|what happened|news|lately)\b",
    re.IGNORECASE,
)
_MONTH_SIGNALS = re.compile(
    r"\b(this month|current|currently|newest|driver version|new version|patch|update)\b",
    re.IGNORECASE,
)
_YEAR_SIGNALS = re.compile(
    r"\b(this year|roadmap|upcoming|in 202[4-9]|202[4-9])\b",
    re.IGNORECASE,
)

# Words signalling verification / dispute checks
_VERIFICATION_SIGNALS = re.compile(
    r"\b(delayed|canceled|cancelled|rumor|rumours|fake|true|hoax|confirmed|postponed|leak|leaked|dispute|alleged)\b",
    re.IGNORECASE,
)

# Known entity to authoritative domain mappings
_ENTITY_DOMAINS: dict[str, tuple[str, ...]] = {
    "gta": ("rockstargames.com", "take2games.com"),
    "gta 6": ("rockstargames.com", "take2games.com"),
    "gta vi": ("rockstargames.com", "take2games.com"),
    "grand theft auto": ("rockstargames.com", "take2games.com"),
    "rockstar": ("rockstargames.com",),
    "nvidia": ("nvidia.com",),
    "apple": ("apple.com",),
    "microsoft": ("microsoft.com",),
    "google": ("google.com",),
    "openai": ("openai.com",),
    "anthropic": ("anthropic.com",),
    "playstation": ("playstation.com", "blog.playstation.com"),
    "xbox": ("xbox.com", "news.xbox.com"),
    "nintendo": ("nintendo.com",),
    "valve": ("valvesoftware.com", "steampowered.com"),
    "python": ("python.org", "docs.python.org"),
    "rust": ("rust-lang.org",),
    "linux": ("kernel.org",),
    "github": ("github.com",),
}

# Evergreen query patterns that should NOT be forced into recency windows
_EVERGREEN_PATTERNS = re.compile(
    r"\b(who (is|was)|what (is|was)|history of|biography|born|died|invented|discovered|defined as|explain how)\b",
    re.IGNORECASE,
)


def infer_freshness(query: str) -> FreshnessWindow:
    """Infer the temporal freshness requirement from the user's wording."""
    q = query.strip()
    if _TODAY_SIGNALS.search(q):
        return FreshnessWindow.PAST_24H
    if _WEEK_SIGNALS.search(q):
        return FreshnessWindow.PAST_7D
    if _MONTH_SIGNALS.search(q):
        return FreshnessWindow.PAST_30D
    if _YEAR_SIGNALS.search(q):
        return FreshnessWindow.PAST_YEAR
    if _EVERGREEN_PATTERNS.search(q):
        return FreshnessWindow.ANYTIME
    return FreshnessWindow.ANYTIME


def detect_intent(query: str) -> str:
    """Classify the user's high-level research intent."""
    q = query.lower()
    if _VERIFICATION_SIGNALS.search(q):
        return "factual_verification"
    if _TODAY_SIGNALS.search(q) or _WEEK_SIGNALS.search(q):
        return "current_events"
    if any(term in q for term in ("documentation", "api", "function", "method", "sdk", "library", "syntax", "how to")):
        return "technical_docs"
    if any(term in q for term in ("compare", "versus", "vs", "difference between", "better than")):
        return "comparison"
    return "general_information"


def extract_entities(query: str) -> list[str]:
    """Extract primary topics and entities from the query."""
    entities: list[str] = []
    q_lower = query.lower()
    matched_ranges: list[tuple[int, int]] = []

    # Sort known entities longest-first so 'GTA 6' matches before 'GTA'
    for ent in sorted(_ENTITY_DOMAINS.keys(), key=len, reverse=True):
        for m in re.finditer(rf"\b{re.escape(ent)}\b", q_lower):
            start, end = m.span()
            if any(s <= start and end <= e for s, e in matched_ranges):
                continue
            matched_ranges.append((start, end))
            canonical = "GTA 6" if ent in ("gta 6", "gta vi") else (ent.title() if len(ent) > 3 else ent.upper())
            if canonical not in entities:
                entities.append(canonical)

    # Extract capitalized proper noun phrases (e.g. "Ada Lovelace", "PlayStation 5")
    words = re.finditer(r"\b[A-Z][a-zA-Z0-9_\-\.]*(?:\s+[A-Z0-9][a-zA-Z0-9_\-\.]*)*\b", query)
    for m in words:
        word = m.group(0)
        start, end = m.span()
        if any(s <= start and end <= e for s, e in matched_ranges):
            continue
        if word.lower() not in [
            "what", "when", "where", "who", "why", "how", "can", "is", "are",
            "the", "a", "an", "tell", "show", "latest", "news", "recent", "ahhh", "get",
            "fetch", "find", "give", "bring", "check", "lookup", "read", "summarize", "only"
        ] and word not in entities:
            entities.append(word)

    return entities


def infer_priority_domains(entities: list[str], query: str) -> list[str]:
    """Identify authoritative root domains based on entity and query context."""
    domains: list[str] = []
    q_lower = query.lower()
    for ent in entities:
        key = ent.lower()
        if key in _ENTITY_DOMAINS:
            domains.extend(_ENTITY_DOMAINS[key])

    # Check for direct matches in query
    for key, doms in _ENTITY_DOMAINS.items():
        if re.search(rf"\b{re.escape(key)}\b", q_lower):
            for d in doms:
                if d not in domains:
                    domains.append(d)

    return list(dict.fromkeys(domains))


def plan_research(
    query: str,
    depth: ResearchDepth = ResearchDepth.RESEARCH,
    current_date: datetime.date | None = None,
) -> ResearchPlan:
    """Build a complete research plan with dynamic query decomposition.

    Generates orthogonal search angles to ensure broad coverage, authoritative
    targeting, and verification of claims.
    """
    now = current_date or datetime.date.today()
    intent = detect_intent(query)
    freshness = infer_freshness(query)
    entities = extract_entities(query)
    priority_domains = infer_priority_domains(entities, query)
    requires_verification = bool(_VERIFICATION_SIGNALS.search(query)) or intent == "factual_verification"

    # Clean the base query from conversational filler
    clean_query = re.sub(
        r"^(ahhh|hey|please|can you|tell me|get me|find me|what happened with|what happened to)\s+",
        "",
        query,
        flags=re.IGNORECASE,
    ).strip("?. ")

    generated_queries: list[str] = []
    rationales: dict[str, str] = {}

    primary_entity = entities[0] if entities else clean_query

    # Fast path: Simple query depth or evergreen intent
    if depth == ResearchDepth.SIMPLE or (freshness == FreshnessWindow.ANYTIME and not requires_verification and intent == "general_information"):
        generated_queries.append(clean_query)
        rationales[clean_query] = "Direct primary search"
        return ResearchPlan(
            original_query=query,
            detected_intent=intent,
            depth=ResearchDepth.SIMPLE,
            freshness=freshness,
            entities=entities,
            queries=generated_queries,
            query_rationales=rationales,
            priority_domains=priority_domains,
            requires_verification=requires_verification,
        )

    # Multi-query path for Current Events / Research / Deep Research
    month_year = now.strftime("%B %Y")  # e.g. "September 2026"
    year_str = str(now.year)

    # 1. Broad latest news
    if freshness in (FreshnessWindow.PAST_24H, FreshnessWindow.PAST_7D, FreshnessWindow.PAST_30D):
        q_news = f"{primary_entity} latest news"
        generated_queries.append(q_news)
        rationales[q_news] = "Recent news and developments"

        # 2. Official announcements / primary source
        if priority_domains:
            # Suffix with primary vendor/studio name or site
            raw_vendor = priority_domains[0].split(".")[0]
            vendor_map = {
                "rockstargames": "Rockstar Games",
                "take2games": "Take-Two Interactive",
                "playstation": "PlayStation",
                "valvesoftware": "Valve",
            }
            vendor_name = vendor_map.get(raw_vendor, raw_vendor.title())
            q_official = f"{primary_entity} {vendor_name} latest announcement"
        else:
            q_official = f"{primary_entity} official announcement"
        generated_queries.append(q_official)
        rationales[q_official] = "Official primary source announcements"

        # 3. Release status / confirmed updates
        if any(w in query.lower() for w in ("release", "date", "launch", "when", "delay", "pc")):
            q_status = f"{primary_entity} release date latest"
            generated_queries.append(q_status)
            rationales[q_status] = "Release schedule and platform status"
        elif "driver" in query.lower():
            q_driver = f"{primary_entity} latest driver version release notes"
            generated_queries.append(q_driver)
            rationales[q_driver] = "Driver version and release notes"

        # 4. Temporal anchor query (Month + Year)
        q_temporal = f"{primary_entity} latest {month_year}"
        generated_queries.append(q_temporal)
        rationales[q_temporal] = f"Time-bounded coverage for {month_year}"

        # 5. Publisher / Investor updates if multiple authority domains exist
        if len(priority_domains) > 1:
            sec_raw = priority_domains[1].split(".")[0]
            sec_vendor = vendor_map.get(sec_raw, sec_raw.title())
            q_sec = f"{primary_entity} {sec_vendor} {month_year}"
            generated_queries.append(q_sec)
            rationales[q_sec] = f"Publisher and investor updates from {sec_vendor}"

        # 6. Breaking day-anchored coverage
        day_str = now.strftime("%B %d %Y")
        q_day = f"{primary_entity} {day_str} news"
        generated_queries.append(q_day)
        rationales[q_day] = f"Breaking news coverage for {day_str}"

        # 7. Specific aspects (platforms, features, or verification)
        if "pc" in query.lower() or "console" in query.lower():
            q_plat = f"{primary_entity} PC latest"
            generated_queries.append(q_plat)
            rationales[q_plat] = "PC platform status"
        elif requires_verification:
            dispute_word = "delayed" if "delay" in query.lower() else "rumors confirmed"
            q_verify = f"{primary_entity} {dispute_word} latest"
            generated_queries.append(q_verify)
            rationales[q_verify] = "Fact-checking rumors and reported claims"

    elif requires_verification:
        # Factual verification mode
        q_verify1 = f"{clean_query} official confirmation"
        q_verify2 = f"{clean_query} rumors dispute"
        generated_queries.extend([clean_query, q_verify1, q_verify2])
        rationales[clean_query] = "Core claim search"
        rationales[q_verify1] = "Official corroboration"
        rationales[q_verify2] = "Conflicting reports and dispute check"

    else:
        # Broad research mode (technical or complex comparison)
        generated_queries.append(clean_query)
        rationales[clean_query] = "Core inquiry"
        if intent == "technical_docs":
            q_docs = f"{clean_query} documentation guide"
            generated_queries.append(q_docs)
            rationales[q_docs] = "Primary technical documentation"
        elif intent == "comparison":
            q_comp = f"{clean_query} comparison analysis"
            generated_queries.append(q_comp)
            rationales[q_comp] = "Comparative benchmark analysis"

    # Deduplicate while preserving order and limit to max 5 queries
    seen = set()
    final_queries = []
    for q in generated_queries:
        if q not in seen:
            seen.add(q)
            final_queries.append(q)

    return ResearchPlan(
        original_query=query,
        detected_intent=intent,
        depth=depth,
        freshness=freshness,
        entities=entities,
        queries=final_queries[:5],
        query_rationales={q: rationales.get(q, "Search angle") for q in final_queries[:5]},
        priority_domains=priority_domains,
        requires_verification=requires_verification,
    )
