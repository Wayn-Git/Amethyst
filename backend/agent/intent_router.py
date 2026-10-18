"""Unified intent router for AMETHYST pre-flight pipeline.

Merges Jev presentation routing and widget gating into a single intent router
that classifies each turn into one of four lanes:
  - chat: Lightweight conversational turn (greetings, simple Q&A, math, explanations)
  - connector: External connected-service intents (email, calendar, github, slack, notion, etc.)
  - widget: Fast interactive UI or presentation format (calculator, chart, recipe, itinerary, etc.)
  - agent: Multi-step reasoning, coding, shell commands, or any uncertain turn (fallthrough invariant)

Drives:
  1. Tool selection (withholding irrelevant tool groups to reduce prompt tokens)
  2. Step budget (capping iterations according to task character)
  3. Prompt steer (instructing model on presentation format)
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import re
from typing import Any, Literal

from backend.agent.jev import _local_heuristic, has_widget_signals
from backend.agent.widgets import is_connected_service_intent

log = logging.getLogger(__name__)

Lane = Literal["chat", "connector", "widget", "research", "agent"]

_CODE_SIGNALS: set[str] = {
    "fix", "bug", "error", "refactor", "edit", "write", "create",
    "delete", "rename", "move", "debug", "test", "lint", "build",
    "compile", "run", "deploy", "commit", "push", "pull", "merge",
    "review", "analyze", "explain", "implement", "add", "remove",
    "update", "change", "modify", "install", "configure", "setup",
}

_RESEARCH_SIGNALS: set[str] = {
    "search", "lookup", "google", "browse", "tavily", "firecrawl",
    "arxiv", "wikipedia", "documentation", "docs", "research",
}

_TRIVIAL_GREETINGS: set[str] = {
    "hi", "hello", "hey", "howdy", "sup", "yo",
    "good morning", "good afternoon", "good evening",
    "thanks", "thank you", "thx", "cool", "great", "ok", "okay",
}

VISUALIZATION_STEER_INSTRUCTIONS: dict[str, str] = {
    "chart": (
        "PRESENTATION STEER (Jev router): The user wants an interactive chart or data visualization. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool. DO NOT output plain markdown tables or text descriptions of charts. "
        "Deliver the working, fully interactive chart via `generate_sandboxed_ui` (e.g. using Chart.js or SVG). "
        "The surrounding container already shows the title banner — do not duplicate large <h1> titles in HTML; start directly with the chart and controls. "
        "Match theme variables var(--canvas), var(--surface), var(--text), var(--text-dim), var(--accent), var(--border)."
    ),
    "calculator": (
        "PRESENTATION STEER (Jev router): The user wants an interactive tool or calculator. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool. DO NOT output plain markdown tables, code explanations, or static text. "
        "Deliver the working, fully interactive application with live inputs, responsive controls, and reactive JavaScript calculation via `generate_sandboxed_ui`. "
        "The surrounding container already shows the title banner — do not duplicate large <h1> titles in HTML; start directly with the controls and result displays. "
        "Aesthetic guidance: use clean modern card layouts, preset pill buttons, formatted currency/numbers, smooth CSS transitions, and Amethyst theme variables (var(--canvas), var(--surface), var(--surface-2), var(--text), var(--text-dim), var(--accent), var(--border))."
    ),
    "diagram": (
        "PRESENTATION STEER (Jev router): The user wants an interactive diagram, flowchart, or architecture view. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool with interactive SVG or HTML/CSS elements. "
        "Do not duplicate large <h1> titles in HTML. Match theme variables var(--canvas), var(--surface), var(--text), var(--accent), var(--border)."
    ),
    "simulation": (
        "PRESENTATION STEER (Jev router): The user wants an interactive simulation, 3D model, or animation. "
        "CRITICAL: You MUST call the `generate_sandboxed_ui` tool with interactive controls (e.g. Canvas or Three.js). "
        "Do not duplicate large <h1> titles in HTML. Match theme variables var(--canvas), var(--surface), var(--text), var(--accent), var(--border)."
    ),
    "comparison": (
        "PRESENTATION STEER (Jev router): The user wants a comparison or scorecard between options or technologies. "
        "CRITICAL: Deliver the response directly as an actual, integrated part of the chat with clear headings, detailed analysis, and a clean markdown comparison table, or call `generate_sandboxed_ui` for an interactive UI. "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested; keep it flowing naturally as conversation."
    ),
    "itinerary": (
        "PRESENTATION STEER (Jev router): The user wants an itinerary or travel route. "
        "CRITICAL: Deliver the response directly as an integrated part of the chat with day-by-day sections, recommendations, driving/travel times, and highlights (or via `generate_sandboxed_ui` for interactive maps/routes). "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "recipe": (
        "PRESENTATION STEER (Jev router): The user wants a culinary recipe. "
        "CRITICAL: Deliver directly as an integrated part of the chat with ingredients, step-by-step instructions, and cooking tips (or via `generate_sandboxed_ui` for interactive calculators). "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "step_guide": (
        "PRESENTATION STEER (Jev router): The user wants a step-by-step tutorial or technical procedure. "
        "CRITICAL: Deliver directly as an integrated part of the chat with numbered steps, explanations, and code/terminal snippets (or via `generate_sandboxed_ui` for interactive steppers). "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "quiz": (
        "PRESENTATION STEER (Jev router): The user wants a quiz, trivia, or knowledge test. "
        "CRITICAL: Call `generate_sandboxed_ui` for a live interactive quiz with score tracking, or present questions directly in the chat. "
        "Do not isolate into a standalone ```amethyst:widget``` component envelope unless specifically requested."
    ),
    "table": (
        "PRESENTATION STEER (Jev router): The user wants a tabular comparison or data view. "
        "CRITICAL: Call `generate_sandboxed_ui` for a rich searchable, sortable interactive table."
    ),
}


@dataclass
class IntentRoute:
    lane: Lane
    presentation: str = "text"
    presentation_steer: str | None = None
    step_budget: int = 40
    tool_filter: str | None = None
    reason: str = ""


def route_intent_fast(
    user_message: str,
    history_raw: list[Any] | None = None,
    mode: str = "agent",
    attachments: list[Any] | None = None,
    max_iterations: int = 40,
) -> tuple[IntentRoute, bool, bool]:
    """Synchronously evaluate intent routing in sub-millisecond time.

    Returns:
      (initial_route, need_remote_jev, need_widget_extract)

    Where:
      - initial_route: The tentative route based on synchronous heuristics
      - need_remote_jev: Whether the Jev API call should be run concurrently
      - need_widget_extract: Whether classify_and_extract should be run concurrently
    """
    # Guard 1: Plan mode and attachments always require the full agent loop
    if mode == "plan" or attachments:
        return (
            IntentRoute(
                lane="agent",
                step_budget=max_iterations,
                presentation="text",
                reason="plan mode or attachments present",
            ),
            False,
            False,
        )

    clean_text = (user_message or "").strip()
    if not clean_text:
        return (
            IntentRoute(
                lane="chat",
                step_budget=min(max_iterations, 1),
                presentation="text",
                tool_filter="chat",
                reason="empty message",
            ),
            False,
            False,
        )

    words = set(re.findall(r"\b[a-zA-Z0-9_\-]+\b", clean_text.lower()))

    # Guard 2: Connected service intent routes to connector lane
    if is_connected_service_intent(clean_text):
        return (
            IntentRoute(
                lane="connector",
                step_budget=min(max_iterations, 4),
                tool_filter="connector",
                presentation="text",
                reason="connected service intent detected",
            ),
            False,
            False,
        )

    # Guard 3: Code/development signals or long payloads route to agent lane
    if bool(words & _CODE_SIGNALS) or "```" in clean_text or len(clean_text) > 500:
        return (
            IntentRoute(
                lane="agent",
                step_budget=min(max_iterations, 20),
                presentation="text",
                reason="code signals or structured payload detected",
            ),
            False,
            False,
        )

    # Guard 4: Presentation / Widget signals
    local_pres = _local_heuristic(clean_text)
    if local_pres != "text":
        steer = VISUALIZATION_STEER_INSTRUCTIONS.get(local_pres)
        # Direct UI presentations (calculator, simulation, diagram, chart) are generated via tools
        # Content widgets (recipe, quiz, itinerary, comparison, step_guide) may extract directly
        need_extract = local_pres not in ("calculator", "simulation", "diagram", "chart")
        return (
            IntentRoute(
                lane="widget",
                presentation=local_pres,
                presentation_steer=steer,
                step_budget=min(max_iterations, 4),
                tool_filter="widget",
                reason=f"local heuristic presentation match: {local_pres}",
            ),
            False,
            need_extract,
        )

    # Guard 5: Research / Web search / Documentation lookups
    is_research = bool(words & _RESEARCH_SIGNALS) or bool(
        re.search(
            r"\b(search the web|search web|search for|look up|find out|research|browse the web|google|read the docs|read documentation)\b",
            clean_text,
            re.IGNORECASE,
        )
    )
    if is_research:
        return (
            IntentRoute(
                lane="research",
                step_budget=min(max_iterations, 8),
                tool_filter="research",
                presentation="text",
                reason="research or web lookup intent detected",
            ),
            False,
            False,
        )

    if has_widget_signals(clean_text):
        # Has widget signals, but local heuristic was inconclusive ("text")
        # Run Jev API and widget extraction concurrently with prefetch
        return (
            IntentRoute(
                lane="widget",
                presentation="text",
                step_budget=min(max_iterations, 4),
                tool_filter="widget",
                reason="widget signals present, awaiting concurrent confirmation",
            ),
            True,
            True,
        )

    # Guard 6: Conversational / greeting / math / simple chat turns
    lowered_clean = clean_text.lower().rstrip("!?. ")
    conversational_phrases = {
        "who are you", "what are you", "what can you do", "introduce yourself",
        "tell me a joke", "how are you", "how's it going", "what's up", "help me",
    }
    if (
        lowered_clean in _TRIVIAL_GREETINGS
        or lowered_clean in conversational_phrases
        or (len(clean_text.split()) <= 3 and bool(words & _TRIVIAL_GREETINGS))
    ):
        return (
            IntentRoute(
                lane="chat",
                step_budget=min(max_iterations, 1),
                tool_filter="chat",
                presentation="text",
                reason="trivial greeting or conversational turn",
            ),
            False,
            False,
        )

    # Math expressions or calculation turns
    if re.search(r"\b\d+\s*[\+\-\*/\^]\s*\d+\b", clean_text):
        return (
            IntentRoute(
                lane="chat",
                step_budget=min(max_iterations, 1),
                tool_filter="chat",
                presentation="text",
                reason="calculation turn",
            ),
            False,
            False,
        )

    # Fall-through invariant: anything uncertain routes to agent
    return (
        IntentRoute(
            lane="agent",
            step_budget=min(max_iterations, 20),
            presentation="text",
            reason="uncertain intent, fall through to agent loop",
        ),
        False,
        False,
    )


def resolve_intent_route(
    initial_route: IntentRoute,
    jev_decision: str = "text",
    widget_extracted: bool = False,
    max_iterations: int = 40,
) -> IntentRoute:
    """Finalize the route after concurrent preflight tasks finish.

    Preserves the invariant: if a widget is not confirmed, fall through to
    the normal agent loop with full step budget and tools.
    """
    if initial_route.lane == "widget":
        decision = jev_decision if jev_decision != "text" else initial_route.presentation
        if decision != "text":
            steer = VISUALIZATION_STEER_INSTRUCTIONS.get(decision)
            return IntentRoute(
                lane="widget",
                presentation=decision,
                presentation_steer=steer,
                step_budget=min(max_iterations, 4),
                tool_filter="widget",
                reason=f"confirmed presentation: {decision}",
            )
        elif widget_extracted:
            return IntentRoute(
                lane="widget",
                presentation="text",
                step_budget=1,
                tool_filter="widget",
                reason="widget extraction succeeded",
            )
        else:
            # Did not confirm a widget or presentation; fall through to normal agent loop
            return IntentRoute(
                lane="agent",
                presentation="text",
                presentation_steer=None,
                step_budget=min(max_iterations, 20),
                reason="widget not confirmed, fell through to agent",
            )
    return initial_route
