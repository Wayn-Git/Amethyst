"""Targeted passage extraction from web pages.

Extracts only the most relevant, context-rich passages from full web pages
instead of dumping 120,000 characters into the model context, achieving a
~90-95% reduction in context consumption.
"""

from __future__ import annotations

import logging
import re
from typing import Sequence

from backend.web.models import EvidenceItem, SearchResult, SourceAuthorityTier
from backend.web.reader import FetchedPage, fetch_readable

log = logging.getLogger(__name__)

# Heading detector in readable markdown/text
_HEADING_RE = re.compile(r"^(?:#{1,6}\s+|[A-Z0-9\s]{4,}:?\n[=\-]{3,})([^\n]+)", re.MULTILINE)
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


def _tokenize(text: str) -> set[str]:
    clean = re.sub(r"[^\w\s]", " ", text.lower())
    return {w for w in clean.split() if len(w) > 2}


def _score_passage(passage: str, heading: str, query_terms: set[str], entity_terms: set[str]) -> float:
    """Score a passage based on query term frequency and entity presence."""
    if not passage.strip():
        return 0.0

    p_tokens = _tokenize(passage)
    h_tokens = _tokenize(heading)

    # Base match
    term_matches = len(p_tokens & query_terms)
    entity_matches = len(p_tokens & entity_terms)
    heading_matches = len(h_tokens & query_terms)

    # Penalize extremely short (< 20 words) or navigation-like passages
    words = passage.split()
    length_penalty = 0.5 if len(words) < 20 else 1.0
    if len(words) > 300:
        length_penalty = 0.8  # slightly penalize run-on unsegmented blobs

    score = (
        (term_matches * 1.5)
        + (entity_matches * 3.0)
        + (heading_matches * 2.0)
    ) * length_penalty

    return score


def extract_relevant_passages(
    text: str,
    query: str,
    entities: Sequence[str] = (),
    max_passages: int = 2,
    max_words_per_passage: int = 220,
) -> list[tuple[str, str, float]]:
    """Extract the highest scoring passages matching query and entities.

    Returns a list of tuples: (section_heading, passage_text, score).
    """
    if not text.strip():
        return []

    query_terms = _tokenize(query)
    entity_terms = set()
    for ent in entities:
        entity_terms.update(_tokenize(ent))

    # Parse text into sections and paragraphs
    paragraphs = _PARAGRAPH_SPLIT.split(text)
    scored_blocks: list[tuple[str, str, float]] = []

    current_heading = "Overview"

    for p in paragraphs:
        p_clean = p.strip()
        if not p_clean:
            continue

        # Check if paragraph is or starts with a heading
        if p_clean.startswith("#"):
            lines = p_clean.split("\n", 1)
            current_heading = lines[0].lstrip("# ").strip()
            p_clean = lines[1].strip() if len(lines) > 1 else ""
            if not p_clean:
                continue

        score = _score_passage(p_clean, current_heading, query_terms, entity_terms)
        if score > 0.5:
            # Truncate to max_words_per_passage if too verbose
            words = p_clean.split()
            if len(words) > max_words_per_passage:
                p_clean = " ".join(words[:max_words_per_passage]) + "..."

            scored_blocks.append((current_heading, p_clean, score))

    # Sort descending by relevance score
    scored_blocks.sort(key=lambda x: x[2], reverse=True)

    # Deduplicate similar passages
    selected: list[tuple[str, str, float]] = []
    seen_texts: set[str] = set()

    for h, p, s in scored_blocks:
        first_few = " ".join(p.split()[:8])
        if first_few not in seen_texts:
            seen_texts.add(first_few)
            selected.append((h, p, s))
            if len(selected) >= max_passages:
                break

    return selected


async def inspect_and_extract(
    search_result: SearchResult,
    query: str,
    entities: Sequence[str] = (),
    max_passages: int = 2,
) -> list[EvidenceItem]:
    """Open a high-value search result, fetch its readable content, and extract

    Returns compact EvidenceItem objects without bloating the main model context.
    """
    try:
        page = await fetch_readable(search_result.url)
    except Exception as exc:
        log.debug("fetch_readable failed for %s: %s", search_result.url, exc)
        return []

    if not page or not page.text:
        return []

    passages = extract_relevant_passages(
        page.text,
        query=query,
        entities=entities,
        max_passages=max_passages,
    )

    evidence_items = []
    for heading, text, score in passages:
        item = EvidenceItem(
            ref_id=search_result.ref_id,
            url=search_result.url,
            domain=search_result.domain,
            title=page.title or search_result.title,
            passage=text,
            section_heading=heading,
            authority_tier=search_result.authority_tier,
            published_date=page.published_on or search_result.published_date,
            relevance_score=score,
        )
        evidence_items.append(item)

    return evidence_items
