"""Flow Launcher + Wox Fuzzy String Matcher.
Ported directly from Flow.Launcher (Flow.Launcher.Infrastructure/StringMatcher.cs)
and Wox (wox.core/util/fuzzymatch/fuzzy_match.go).

Features:
- Acronym Matching (IsAcronym):
  Matches word initials, CamelCase transitions, digits (e.g. 'vsc' -> Visual Studio Code, 'am' -> Amethyst).
- Multi-Word Query Token Matching:
  Splits query into whitespace-separated tokens; all tokens must match.
- High-Performance Scoring:
  Exact match (100), prefix match (20), boundary match (8), CamelCase (10), consecutive (5).
- File/Path Weighting:
  Differentiates filename matches from directory path matches for superior file search accuracy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

SCORE_MATCH = 16
SCORE_GAP_START = -3
SCORE_GAP_EXTENSION = -1
BONUS_BOUNDARY = 8
BONUS_CAMEL_CASE = 10
BONUS_FIRST_CHAR_MATCH = 12
BONUS_CONSECUTIVE = 5
BONUS_PREFIX_MATCH = 20
BONUS_EXACT_MATCH = 100
BONUS_ACRONYM_MATCH = 90

BOUNDARY_DELIMITERS = frozenset(" _-/.\\:;,#@()[]{}|")


@dataclass(slots=True)
class WoxMatchResult:
    is_match: bool
    score: float


def is_acronym_char(text: str, idx: int) -> bool:
    """Check if char at idx is an acronym start (Flow Launcher StringMatcher.IsAcronym)."""
    if idx == 0:
        return True
    prev = text[idx - 1]
    curr = text[idx]
    if prev in BOUNDARY_DELIMITERS and curr not in BOUNDARY_DELIMITERS:
        return True
    if prev.islower() and curr.isupper():
        return True
    if not prev.isdigit() and curr.isdigit():
        return True
    return False


def get_acronym_string(text: str) -> str:
    """Extract acronym letters from text (e.g. 'Visual Studio Code' -> 'vsc')."""
    acronyms = []
    for i, ch in enumerate(text):
        if is_acronym_char(text, i):
            acronyms.append(ch.lower())
    return "".join(acronyms)


def is_boundary_char(text: str, idx: int) -> bool:
    if idx == 0:
        return True
    prev = text[idx - 1]
    if prev in BOUNDARY_DELIMITERS:
        return True
    curr = text[idx]
    if prev.islower() and curr.isupper():
        return True
    return False


def calculate_match_bonus(text: str, idx: int) -> int:
    bonus = 0
    if idx == 0:
        bonus += BONUS_FIRST_CHAR_MATCH
    elif text[idx - 1] in BOUNDARY_DELIMITERS:
        bonus += BONUS_BOUNDARY
    elif idx > 0 and text[idx - 1].islower() and text[idx].isupper():
        bonus += BONUS_CAMEL_CASE
    return bonus


def calculate_gap_penalty(prev_idx: int, curr_idx: int) -> int:
    gap = curr_idx - prev_idx - 1
    if gap <= 0:
        return 0
    return SCORE_GAP_START + (gap - 1) * SCORE_GAP_EXTENSION


def _single_token_match(text: str, pattern: str) -> WoxMatchResult:
    """Compute score for a single continuous pattern against text."""
    if not pattern:
        return WoxMatchResult(is_match=True, score=0.0)
    if not text:
        return WoxMatchResult(is_match=False, score=0.0)

    pattern_len = len(pattern)
    text_len = len(text)
    text_lower = text.lower()
    pattern_lower = pattern.lower()

    # 1. Exact match
    if text_lower == pattern_lower:
        return WoxMatchResult(is_match=True, score=float(BONUS_EXACT_MATCH + (pattern_len * SCORE_MATCH)))

    # 2. Prefix match
    if text_lower.startswith(pattern_lower):
        score = BONUS_PREFIX_MATCH + (pattern_len * SCORE_MATCH) + BONUS_FIRST_CHAR_MATCH
        return WoxMatchResult(is_match=True, score=float(score))

    # 3. Flow Launcher Acronym match
    acronym = get_acronym_string(text)
    if acronym and pattern_lower == acronym:
        return WoxMatchResult(is_match=True, score=float(BONUS_ACRONYM_MATCH + pattern_len * 10))
    if acronym and acronym.startswith(pattern_lower):
        return WoxMatchResult(is_match=True, score=float(BONUS_ACRONYM_MATCH - 10 + pattern_len * 8))

    # 4. Word boundary substring match (e.g. 'code' in 'visual-studio-code')
    pos = text_lower.find(pattern_lower)
    if pos >= 0 and is_boundary_char(text, pos):
        score = (
            BONUS_PREFIX_MATCH
            + (pattern_len * SCORE_MATCH)
            + calculate_match_bonus(text, pos)
            + (pattern_len - 1) * BONUS_CONSECUTIVE
        )
        return WoxMatchResult(is_match=True, score=float(score))

    # 5. Sequential character fuzzy match
    matched_indexes: list[int] = []
    pattern_idx = 0
    for text_idx, ch in enumerate(text_lower):
        if ch == pattern_lower[pattern_idx]:
            matched_indexes.append(text_idx)
            pattern_idx += 1
            if pattern_idx == pattern_len:
                break

    if len(matched_indexes) != pattern_len:
        return WoxMatchResult(is_match=False, score=0.0)

    # Shift matches to word boundaries if possible
    for i in range(pattern_len):
        curr_idx = matched_indexes[i]
        if is_boundary_char(text, curr_idx):
            continue
        target_ch = pattern_lower[i]
        next_boundary = matched_indexes[i + 1] if i + 1 < pattern_len else min(text_len, curr_idx + 15)
        for probe_idx in range(curr_idx + 1, next_boundary):
            if text_lower[probe_idx] == target_ch and is_boundary_char(text, probe_idx):
                matched_indexes[i] = probe_idx
                break

    # Calculate fuzzy score
    score = 0
    prev_idx = -1
    for i, match_idx in enumerate(matched_indexes):
        score += SCORE_MATCH + calculate_match_bonus(text, match_idx)
        if i > 0 and match_idx == prev_idx + 1:
            score += BONUS_CONSECUTIVE
        if prev_idx >= 0:
            score += calculate_gap_penalty(prev_idx, match_idx)
        else:
            score += max(-10, -match_idx)
        prev_idx = match_idx

    trailing_gap = text_len - 1 - prev_idx
    if trailing_gap > 0:
        score += max(-15, -trailing_gap // 2)

    # Minimum threshold check
    if score < 10:
        if pattern_lower in text_lower:
            return WoxMatchResult(is_match=True, score=float(max(15, pattern_len * 4)))
        return WoxMatchResult(is_match=False, score=0.0)

    return WoxMatchResult(is_match=True, score=float(score))


def wox_fuzzy_match(text: str, pattern: str) -> WoxMatchResult:
    """Flow Launcher + Wox multi-word fuzzy matcher."""
    if not pattern:
        return WoxMatchResult(is_match=True, score=0.0)
    if not text:
        return WoxMatchResult(is_match=False, score=0.0)

    tokens = pattern.strip().split()
    if not tokens:
        return WoxMatchResult(is_match=True, score=0.0)

    # Single token match
    if len(tokens) == 1:
        return _single_token_match(text, tokens[0])

    # Multi-token match: all tokens must match
    total_score = 0.0
    for tok in tokens:
        res = _single_token_match(text, tok)
        if not res.is_match:
            return WoxMatchResult(is_match=False, score=0.0)
        total_score += res.score

    return WoxMatchResult(is_match=True, score=total_score)


def flow_file_match(filename: str, parent_path: str, pattern: str) -> WoxMatchResult:
    """Specialized file matcher: heavily rewards matching in filename over parent folder."""
    if not pattern:
        return WoxMatchResult(is_match=True, score=50.0)

    clean_pat = pattern.strip()

    # 1. Match against filename
    file_res = wox_fuzzy_match(filename, clean_pat)
    if file_res.is_match:
        # Heavily boost filename matches (+40 bonus + 1.5x score)
        return WoxMatchResult(is_match=True, score=file_res.score * 1.5 + 40.0)

    # 2. Match against full path as fallback
    full_path = f"{parent_path}/{filename}"
    path_res = wox_fuzzy_match(full_path, clean_pat)
    if path_res.is_match:
        return WoxMatchResult(is_match=True, score=path_res.score * 0.6)

    return WoxMatchResult(is_match=False, score=0.0)
