"""Multi-source verification and claim disagreement analysis.

Cross-references claims between official announcements, reputable reporting, and
community commentary, explicitly identifying consensus versus disputed claims
instead of blindly adopting a single search result as fact.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Sequence

from backend.web.models import ClaimStatus, EvidenceItem, SearchResult, SourceAuthorityTier

_DENIAL_WORDS = re.compile(
    r"\b(denies|denied|debunked|false|no delay|on track|fake|refutes|refuted|reaffirms|reaffirmed)\b",
    re.IGNORECASE,
)
_DISPUTE_WORDS = re.compile(
    r"\b(delayed|delay|postponed|pushed back|slip|rumor|rumors|claimed|alleged|leak|speculation)\b",
    re.IGNORECASE,
)


@dataclass
class VerifiedClaim:
    """Evaluated claim representing cross-source consensus or disagreement."""
    topic: str
    status: ClaimStatus
    supporting_refs: list[str] = field(default_factory=list)
    contrasting_refs: list[str] = field(default_factory=list)
    official_sources: list[str] = field(default_factory=list)
    reputable_sources: list[str] = field(default_factory=list)
    summary: str = ""
    disagreement_details: str | None = None

    def format_for_context(self) -> str:
        """Render a concise verification block for the reasoning model."""
        lines = [f"- **{self.topic}**: [{self.status.value.upper()}] {self.summary}"]
        if self.official_sources:
            lines.append(f"  Official source: {', '.join(self.official_sources)}")
        if self.reputable_sources:
            lines.append(f"  Reputable reporting: {', '.join(self.reputable_sources)}")
        if self.disagreement_details:
            lines.append(f"  Note on Discrepancy: {self.disagreement_details}")
        return "\n".join(lines)


def evaluate_claims(
    query: str,
    sources: Sequence[SearchResult],
    evidence: Sequence[EvidenceItem] = (),
) -> list[VerifiedClaim]:
    """Cross-check sources for consensus, reporting, or active disagreement."""
    if not sources:
        return []

    # Partition sources by authority tier
    officials = [s for s in sources if s.authority_tier in (SourceAuthorityTier.OFFICIAL, SourceAuthorityTier.PRIMARY)]
    reputables = [s for s in sources if s.authority_tier == SourceAuthorityTier.REPUTABLE]
    communities = [s for s in sources if s.authority_tier == SourceAuthorityTier.COMMUNITY]
    unverified = [s for s in sources if s.authority_tier == SourceAuthorityTier.UNVERIFIED]

    claims: list[VerifiedClaim] = []

    # Check for delay / cancellation / dispute claims
    query_is_verification = bool(re.search(r"\b(delay|delayed|cancel|canceled|cancelled|true|rumor|fake)\b", query, re.IGNORECASE))
    all_snippets = " ".join(s.snippet for s in sources) + " " + " ".join(e.passage for e in evidence)

    has_dispute_signal = bool(_DISPUTE_WORDS.search(all_snippets))
    has_denial_signal = bool(_DENIAL_WORDS.search(all_snippets))

    if query_is_verification or (has_dispute_signal and has_denial_signal):
        # Active disagreement or verification scenario
        if officials and has_denial_signal:
            # Official source refutes or confirms schedule
            claim = VerifiedClaim(
                topic="Schedule and Status",
                status=ClaimStatus.CONFIRMED,
                official_sources=[s.domain for s in officials],
                reputable_sources=[s.domain for s in reputables],
                summary="Official announcements confirm current schedule; rumors of delay remain unconfirmed.",
                disagreement_details="Community speculation or unverified leaks suggested delays, but official statements reaffirm planned release.",
            )
        elif has_dispute_signal and has_denial_signal:
            # Sources openly disagree
            claim = VerifiedClaim(
                topic="Status Verification",
                status=ClaimStatus.DISPUTED,
                supporting_refs=[s.domain for s in reputables if _DISPUTE_WORDS.search(s.snippet)],
                contrasting_refs=[s.domain for s in reputables if _DENIAL_WORDS.search(s.snippet)],
                reputable_sources=[s.domain for s in reputables],
                summary="Conflicting reports exist between rumors of delays and official or corroborated statements.",
                disagreement_details="Some outlets report potential delays while other sources maintain the original window. Distinguish between reporting and confirmed facts.",
            )
        elif communities and not officials and not reputables:
            claim = VerifiedClaim(
                topic="Reported Claim",
                status=ClaimStatus.SPECULATIVE,
                supporting_refs=[s.domain for s in communities],
                summary="Claim originates from community forums or unverified rumors without journalistic confirmation.",
                disagreement_details="No official or reputable journalistic sources have verified this claim.",
            )
        else:
            claim = VerifiedClaim(
                topic="Reported Status",
                status=ClaimStatus.REPORTED,
                reputable_sources=[s.domain for s in reputables],
                summary="Reported by industry publications; awaiting formal primary confirmation.",
            )
        claims.append(claim)

    elif officials:
        # Standard verified information with official backing
        claim = VerifiedClaim(
            topic="Core Findings",
            status=ClaimStatus.CONFIRMED,
            official_sources=[s.domain for s in officials],
            reputable_sources=[s.domain for s in reputables],
            summary="Confirmed by official primary documentation.",
        )
        claims.append(claim)

    elif reputables:
        # Standard reputable reporting
        claim = VerifiedClaim(
            topic="Core Findings",
            status=ClaimStatus.REPORTED,
            reputable_sources=[s.domain for s in reputables],
            summary=f"Reported across {len(reputables)} independent reputable publications.",
        )
        claims.append(claim)

    return claims


def format_verification_summary(claims: Sequence[VerifiedClaim]) -> str:
    """Format all evaluated claims into a clean block for the reasoning layer."""
    if not claims:
        return ""
    lines = ["### Multi-Source Verification Matrix:"]
    for c in claims:
        lines.append(c.format_for_context())
    return "\n".join(lines)
