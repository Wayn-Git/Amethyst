"""The one tool that asks instead of acting.

`BASE_PROMPT` opens with "prefer acting over asking", and that stays right: a
model that checks in before every step is a model the user is doing the work
for. This is the narrow exception -- the request is genuinely ambiguous, the
readings lead to *different work*, and guessing wrong means the whole turn is
thrown away.

The turn suspends rather than ending, so the answer arrives as an ordinary tool
result and the loop carries on with everything it had already read and
concluded. See `backend/agent/questions.py` for why that is the shape.
"""

from __future__ import annotations

from typing import Any

from backend.agent import questions as q
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult


def _format(asked: list[q.Question], answers: list[str]) -> str:
    """The exchange, as the model reads it back.

    Question and answer together, rather than the answers alone: a bare
    "Habits & daily routines" a few thousand tokens later is a word with no
    question attached to it, and the model has to guess which of the two it
    asked that was for.
    """
    lines = []
    for index, question in enumerate(asked):
        given = answers[index] if index < len(answers) else "(no answer)"
        lines.append(f"Q: {question.question}\nA: {given}")
    return "\n\n".join(lines)


async def ask_user(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    try:
        asked = q.parse(args.get("questions"))
    except q.TooManyQuestions as exc:
        return ToolResult.error(str(exc))
    except ValueError as exc:
        return ToolResult.error(f"{exc}. Send a list of objects with a 'question' field.")

    # One turn, two questions. The counter lives on the context because the
    # registry is shared by every conversation and a per-turn limit kept on the
    # tool would be a limit across all of them.
    asked_already = int(ctx.extra.get("asks_this_turn", 0))
    if asked_already >= q.MAX_ASKS_PER_TURN:
        return ToolResult.error(
            f"You have already asked the user {asked_already} times this turn."
            " Continue with the most reasonable assumption and say what you"
            " assumed."
        )
    ctx.extra["asks_this_turn"] = asked_already + 1

    answers = await q.ask(ctx.conversation_id, asked, ctx.events)
    return ToolResult.ok(_format(asked, answers))


def tools() -> list[Tool]:
    return [
        Tool(
            name="ask_user",
            description=(
                "Ask the user a short multiple-choice question and wait for the"
                " answer, when the request is genuinely ambiguous and the"
                " readings would lead to different work. Use it BEFORE doing the"
                " work, not after: the point is to avoid building the wrong"
                " thing. Do NOT use it for anything you can look up with another"
                " tool, for permission (the system asks separately), or to"
                " confirm something you are already confident about --"
                " unnecessary questions are the user doing your job. Give real"
                " options with short descriptions; the user can always write"
                " their own answer instead."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "description": (
                            f"At most {q.MAX_QUESTIONS}. Ask only what blocks the work."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": {
                                    "type": "string",
                                    "description": "One clear question, in the user's terms",
                                },
                                "options": {
                                    "type": "array",
                                    "description": (
                                        f"Up to {q.MAX_OPTIONS} concrete choices."
                                        " Omit for an open question."
                                    ),
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {"type": "string"},
                                            "description": {
                                                "type": "string",
                                                "description": "What picking this would mean",
                                            },
                                        },
                                        "required": ["label"],
                                    },
                                },
                                "multi_select": {
                                    "type": "boolean",
                                    "description": "Whether several options can be picked",
                                },
                            },
                            "required": ["question"],
                        },
                    }
                },
                "required": ["questions"],
            },
            handler=ask_user,
            # It reads nothing and writes nothing. The permission gate exists
            # for what a tool does to the machine, and this does nothing to it.
            risk=RiskLevel.LOW,
        )
    ]
