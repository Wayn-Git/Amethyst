"""TypeSafe Jev visualization routing client.

Routes user messages to the appropriate presentation format (text, table, chart,
calculator, diagram, simulation, or itinerary) via TypeSafe's System One API
(jev-latest) in sub-second latency.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from backend.secrets import resolve_api_key

log = logging.getLogger(__name__)

#: Default TypeSafe System One API endpoint.
TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone"

#: Default timeout in seconds for Jev routing.
JEV_TIMEOUT = 1.5

#: Maximum total characters of conversation history sent to Jev.
MAX_CONTEXT_CHARS = 6000

#: Supported visualization categories.
ALLOWED_PRESENTATIONS = {
    "text",
    "table",
    "chart",
    "calculator",
    "diagram",
    "simulation",
    "itinerary",
    "comparison",
    "recipe",
    "step_guide",
    "quiz",
}


def resolve_typesafe_key() -> str | None:
    """Resolve the TypeSafe API key from environment or keychain."""
    return resolve_api_key(ref="typesafe", env="TYPESAFE_API_KEY") or os.getenv("TYPESAFE_API_KEY")


def _format_context(messages: list[dict[str, Any]] | str) -> str:
    """Format the last 4 text messages into a clean context string."""
    if isinstance(messages, str):
        return messages.strip()[:MAX_CONTEXT_CHARS]

    text_parts: list[str] = []
    # Take at most the last 4 messages
    for msg in messages[-4:]:
        role = msg.get("role", "user").capitalize()
        content = msg.get("content") or ""
        if isinstance(content, str) and content.strip():
            # Strip internal fences if any
            clean_content = content.split("```amethyst:")[0].strip()
            if clean_content:
                text_parts.append(f"{role}: {clean_content}")

    joined = "\n\n".join(text_parts).strip()
    return joined[-MAX_CONTEXT_CHARS:] if len(joined) > MAX_CONTEXT_CHARS else joined


def _local_heuristic(text: str) -> str:
    """Fast local heuristic classifier when Jev API is unreachable, times out, or unauthorized."""
    lower = text.lower()
    if any(k in lower for k in ("quiz", "trivia", "flashcard", "test my knowledge")):
        return "quiz"
    if any(k in lower for k in ("recipe", "ingredients", "cook time", "prep time", "sourdough bread", "culinary")):
        return "recipe"
    if any(k in lower for k in ("step by step", "step-by-step", "how-to guide", "how to install", "installation guide", "tutorial guide", "guide to")):
        return "step_guide"
    if any(k in lower for k in ("calculator", "calc", "splitter", "split the bill", "split bill", "mortgage", "tip", "counter", "converter", "unit conversion")):
        return "calculator"
    if any(k in lower for k in ("chart", "graph", "plot", "histogram", "trends", "bar chart", "line chart", "pie chart")):
        return "chart"
    if any(k in lower for k in ("compare", "comparison", " vs ", "versus", "pros and cons", "differences between")):
        return "comparison"
    if any(k in lower for k in ("3d", "simulation", "simulator", "pitch", "roll", "yaw", "physics", "canvas")):
        return "simulation"
    if any(k in lower for k in ("diagram", "flowchart", "wireframe", "architecture diagram")):
        return "diagram"
    if any(k in lower for k in ("itinerary", "road trip", "travel route", "trip plan", "coastal map", "coastal trip", "coastil", "coastal road", "sf to la", "highway 1")):
        return "itinerary"
    if any(k in lower for k in ("table", "matrix", "spreadsheet")):
        return "table"
    return "text"


_INVALID_TYPESAFE_KEYS: set[str] = set()


async def classify_presentation(
    messages: list[dict[str, Any]] | str,
    api_key: str | None = None,
    timeout: float = JEV_TIMEOUT,
    model: str | None = None,
) -> str:
    """Classify the user's intent into a presentation format using Jev.

    Returns one of:
      - "text" (default, direct answer)
      - "table" (tabular comparison/data)
      - "chart" (bar/line/pie/distribution chart)
      - "calculator" (interactive calculating tool)
      - "diagram" (flowchart, architecture, hierarchy)
      - "simulation" (3D model, physical simulation, animation)
      - "itinerary" (travel route, map, multi-stop plan)
      - "comparison" (side-by-side feature comparison)
      - "recipe" (culinary recipe with ingredients and steps)
      - "step_guide" (step-by-step tutorial or how-to guide)
      - "quiz" (interactive trivia or quiz questions)

    If the API key is not configured, unauthorized, or if the API call fails or times out,
    falls back seamlessly to local heuristic intent classification in sub-millisecond time.
    """
    context = _format_context(messages)
    if not context:
        return "text"

    key = api_key or resolve_typesafe_key()
    if not key or key in _INVALID_TYPESAFE_KEYS:
        return _local_heuristic(context)

    selected_model = model or os.getenv("JEV_MODEL", "jev-latest")

    payload = {
        "model": selected_model,
        "state": {
            "conversation": context,
        },
        "questions": {
            "visualization": {
                "type": "choice",
                "instructions": (
                    "Which visualization or presentation format best answers the user's latest message? "
                    "Choose 'text' if a direct conversational explanation suffices."
                ),
                "criteria": {
                    "text": "Direct conversational answer or explanation with no complex visuals needed",
                    "table": "Structured tabular comparison or dataset with clear rows and columns",
                    "chart": "Numeric comparison, trends, distributions, bar/line/scatter/pie chart",
                    "calculator": "Interactive calculation, unit conversion, formula or financial tool with inputs",
                    "diagram": "Flowchart, process sequence, architectural diagram, or hierarchy",
                    "simulation": "Interactive 3D model, physical simulation, or animated visualization",
                    "itinerary": "Multi-stop itinerary, geographic route, or chronological sequence",
                    "comparison": "Side-by-side feature or option comparison with pros, cons, and verdict",
                    "recipe": "Culinary recipe with ingredients, prep/cook time, servings, and instructions",
                    "step_guide": "Sequential step-by-step tutorial or technical how-to procedure",
                    "quiz": "Interactive trivia, knowledge assessment, or multiple choice quiz",
                },
            }
        },
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(TYPESAFE_API_URL, headers=headers, json=payload)
            if res.status_code == 401:
                log.warning("TypeSafe Jev API key is unauthorized (401); caching failure and using local heuristics")
                _INVALID_TYPESAFE_KEYS.add(key)
                return _local_heuristic(context)
            if res.status_code != 200:
                log.debug("TypeSafe Jev API returned status %s; using local heuristic", res.status_code)
                return _local_heuristic(context)

            data = res.json()
            decision = _parse_decision(data)
            return decision if decision != "text" else _local_heuristic(context)
    except Exception as exc:
        log.debug("TypeSafe Jev classification skipped or timed out: %s; using local heuristic", exc)
        return _local_heuristic(context)


def _parse_decision(data: Any) -> str:
    """Extract and validate the chosen visualization type from TypeSafe response."""
    if not isinstance(data, dict):
        return "text"

    # Shape 1: {"decisions": {"visualization": "chart"}}
    decisions = data.get("decisions")
    if isinstance(decisions, dict) and "visualization" in decisions:
        val = decisions["visualization"]
        if isinstance(val, str) and val.lower() in ALLOWED_PRESENTATIONS:
            return val.lower()
        if isinstance(val, dict) and "choice" in val and val["choice"].lower() in ALLOWED_PRESENTATIONS:
            return val["choice"].lower()

    # Shape 2: {"questions": {"visualization": {"choice": "chart"}}}
    questions = data.get("questions")
    if isinstance(questions, dict) and "visualization" in questions:
        val = questions["visualization"]
        if isinstance(val, dict) and "choice" in val and val["choice"].lower() in ALLOWED_PRESENTATIONS:
            return val["choice"].lower()
        if isinstance(val, str) and val.lower() in ALLOWED_PRESENTATIONS:
            return val.lower()

    # Shape 3: {"visualization": {"choice": "chart"}}
    if "visualization" in data:
        val = data["visualization"]
        if isinstance(val, dict) and "choice" in val and val["choice"].lower() in ALLOWED_PRESENTATIONS:
            return val["choice"].lower()
        if isinstance(val, str) and val.lower() in ALLOWED_PRESENTATIONS:
            return val.lower()

    # Shape 4: {"answers": {"visualization": "chart"}}
    answers = data.get("answers")
    if isinstance(answers, dict) and "visualization" in answers:
        val = answers["visualization"]
        if isinstance(val, str) and val.lower() in ALLOWED_PRESENTATIONS:
            return val.lower()

    return "text"
