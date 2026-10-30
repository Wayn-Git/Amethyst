from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_RULES_PATH = Path(__file__).with_name("intent_rules.json")
_RULES: dict[str, Any] = json.loads(_RULES_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=256)
def _compile(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


def _is_question(text: str) -> bool:
    rule = next(
        (entry for entry in _RULES.get("rules", []) if entry.get("mode") == "question"),
        None,
    )
    if not rule:
        return False
    if rule.get("min_length") and len(text) < rule["min_length"]:
        return False
    return any(_compile(pattern).search(text) for pattern in rule["patterns"])


def _build_intent(
    mode: str, subject: str, explicit: bool
) -> dict[str, Any]:
    config = _RULES["intents"].get(mode) or _RULES["intents"]["local"]
    ask_value = config.get("ask", False)
    ask = _is_question(subject) if ask_value == "question" else bool(ask_value)
    return {
        "mode": mode,
        "label": config["label"],
        "icon": config.get("icon", "search"),
        "tone": config.get("tone", "cmd"),
        "view": config.get("view", "all"),
        "placeholder": config.get("placeholder", ""),
        "providers": list(config.get("providers", [])),
        "external": list(config.get("external", [])),
        "evidence": list(config.get("evidence", [])) if ask else [],
        "ask": ask,
        "subject": subject,
        "explicit": explicit,
        "localSearch": bool(config.get("localSearch", False)),
    }


def classify_intent(query: str, explicit_mode: str = "all") -> dict[str, Any]:
    """Route a raw Damon query to exactly one intent.

    Explicit mode wins, then an explicit keyword prefix, then a shape rule,
    then the word-count fallback. Pure rules; no model and no I/O.
    """
    text = (query or "").strip()
    explicit = explicit_mode if explicit_mode and explicit_mode != "all" else None

    if explicit and explicit in _RULES["intents"]:
        return _build_intent(explicit, text, True)

    if not text:
        return _build_intent("home", "", False)

    for prefix in _RULES.get("prefixes", []):
        pattern = _compile(prefix["pattern"])
        if pattern.search(text):
            subject = pattern.sub("", text, count=1).strip()
            return _build_intent(prefix["mode"], subject, True)

    for rule in _RULES.get("rules", []):
        if rule.get("min_length") and len(text) < rule["min_length"]:
            continue
        for source in rule["patterns"]:
            pattern = _compile(source)
            if not pattern.search(text):
                continue
            subject = pattern.sub("", text, count=1).strip() if rule.get("strip") else text
            return _build_intent(rule["mode"], subject, False)

    words = len(text.split())
    fallback = _RULES["fallback"]
    mode = (
        fallback["short"]
        if words <= fallback["short_max_words"]
        else fallback["default"]
    )
    return _build_intent(mode, text, False)
