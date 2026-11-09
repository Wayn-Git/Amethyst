"""The post-turn learning review: turn a finished piece of work into a proposal.

This is the mechanism Hermes has and AMETHYST did not. Memory extraction records
what the user *said*; this reads what the turn *did* and asks one narrow
question: did this work produce a procedure worth keeping? A tool sequence that
finally worked, a correction the user made, a shape of task that will come up
again -- those are the raw material of a skill, and without a pass like this they
are re-derived from scratch on every conversation.

Three deliberate limits:

- **A proposal, not a write.** Nothing reaches the skill library until a person
  approves it. The review runs unattended, often overnight, and an unattended
  model choosing what future turns will be told is not a trade worth making.
- **One narrow question.** It is not a general reflection pass. It cannot edit a
  skill it did not see, cannot delete anything, and cannot touch memory (the
  memory extractor already does that on its own schedule).
- **Cheap gates.** A turn that made no tool calls, or produced a short answer, or
  is in plan mode, is skipped without a model call. Most turns produce nothing,
  and the gate is what keeps "learning" from meaning "one extra request every
  turn".
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from backend.learning.store import LearningStore, Proposal

log = logging.getLogger(__name__)

#: How much of each side of the exchange the reviewer sees. Long enough for a
#: real procedure to be visible, bounded so a pasted log cannot become the bill.
MAX_EXCHANGE_CHARS = 12_000

#: Per review. More than one new skill out of a single turn is a sign the review
#: is narrating the session rather than extracting a procedure.
MAX_SKILLS = 1
MAX_MEMORIES = 3

MIN_ANSWER_CHARS = 160
MIN_BODY_CHARS = 200
MAX_BODY_CHARS = 20_000
MAX_DESCRIPTION_CHARS = 500

#: A turn where the user said "no, do it this way" is worth reviewing even
#: without a tool call: the correction is exactly the instruction a skill keeps.
_CORRECTION = re.compile(
    r"\b(?:no|nope|actually|instead|wrong|not what|don't|do not|should(?:n't| not)?|"
    r"always|never|from now on|next time|remember to)\b",
    re.IGNORECASE,
)

_SESSION_NAME = re.compile(
    r"(^|-)(today|tonight|yesterday|this-(?:morning|afternoon|week)|"
    r"fix|debug|investigate)(-|$)|(^|-)pr-?\d+(-|$)",
    re.IGNORECASE,
)
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)

REVIEW_PROMPT = """\
You review one finished exchange between a user and an AI agent that can run
tools. Your only job is to decide whether the exchange contains a *reusable
procedure* worth saving as a skill.

A skill is a short markdown instruction for a class of task. It is not a record
of this conversation. Save one only when all of these are true:

- the task will plausibly come up again, in a different conversation;
- the procedure has real steps, with tool calls, commands, or checks in order;
- the exchange shows the procedure working, or shows the user correcting a step
  so the corrected version now works;
- it does not depend on one file, one URL, one account, or one day.

Never propose a skill for: a one-off answer, a question with no procedure, an
environment failure ("the server was down"), a description of what you are,
a negative claim about a tool, or a session narrative ("fixed the login bug
today"). Proposing nothing is the normal outcome. An empty answer is always
better than a weak skill.

Reply with JSON and nothing else:

{"skills": [{"name": "lowercase-hyphen-slug", "description": "when to use this, one sentence", "body": "markdown instructions"}], "memories": ["durable fact about the user, if any"]}

Rules for the skill body:
- Start with the trigger: when the procedure applies.
- Then the steps, in order, imperative voice. Name the tools.
- Include the check that proves it worked, and the failure that made the
  corrected step necessary.
- No secrets, no API keys, no personal data, no placeholders like <your-key>.
- Under 4,000 words.

Rules for names: lowercase letters, digits and hyphens only; describe the class
of task (`csv-dedupe-by-key`), never the incident (`fix-csv-today`).

Rules for memories: only durable facts the user stated about themselves or their
setup. Not the content of the request, not anything you inferred. Most exchanges
have none.

If nothing qualifies: {"skills": [], "memories": []}"""


@dataclass
class ReviewResult:
    """What one review decided, kept separate from what it stored."""

    ran: bool = False
    reason: str = ""
    skills: int = 0
    memories: int = 0
    proposals: list[Proposal] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ran": self.ran,
            "reason": self.reason,
            "skills": self.skills,
            "memories": self.memories,
            "proposal_ids": [p.id for p in self.proposals],
        }


def should_review(
    *,
    enabled: bool,
    answer: str,
    tool_calls: int,
    user_message: str,
) -> tuple[bool, str]:
    """The cheap gate, before any model call.

    Returns ``(run, reason)``. The reason matters for the job's result: "skipped
    because nothing was done" is a different fact from "skipped because the
    feature is off", and a person debugging why nothing is proposed needs to
    tell them apart.
    """
    if not enabled:
        return False, "learning review is off"
    if len((answer or "").strip()) < MIN_ANSWER_CHARS:
        return False, "answer too short to contain a procedure"
    if tool_calls <= 0 and not _CORRECTION.search(user_message or ""):
        return False, "no tool work and no correction"
    return True, ""


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _slug(value: Any) -> str | None:
    slug = _text(value, 64).lower().replace(" ", "-").replace("_", "-")
    slug = re.sub(r"[^a-z0-9-]", "", slug).strip("-")
    if not slug or not _SLUG.match(slug) or _SESSION_NAME.search(slug):
        return None
    return slug


def _extract_json(text: str) -> dict[str, Any]:
    """The object the model meant, tolerating a fence or a leading sentence."""
    candidate = (text or "").strip()
    fenced = _FENCE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    else:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end > start:
            candidate = candidate[start : end + 1]
    try:
        payload = json.loads(candidate)
    except (ValueError, TypeError):
        log.warning("learning review returned unparseable output: %r", text[:200])
        return {}
    return payload if isinstance(payload, dict) else {}


def parse_review(text: str, *, existing_skills: set[str] | None = None) -> list[dict[str, str]]:
    """Validated proposals, ready to store. Malformed items are dropped.

    Dropping rather than repairing is deliberate: a body that lost its steps in
    parsing is not a skill, and a name the rules refuse is one the loader would
    refuse later. The review gets no second chance to be clever here.
    """
    payload = _extract_json(text)
    existing = existing_skills or set()
    found: list[dict[str, str]] = []

    raw_skills = payload.get("skills")
    skills_found = 0
    if isinstance(raw_skills, list):
        # The cap is on proposals worth keeping, not on items offered. Slicing
        # the input first let one rejected item spend the whole allowance: a
        # review that named a session-shaped slug first lost the valid skill
        # behind it.
        for item in raw_skills:
            if skills_found >= MAX_SKILLS:
                break
            if not isinstance(item, dict):
                continue
            name = _slug(item.get("name"))
            description = _text(item.get("description"), MAX_DESCRIPTION_CHARS)
            body = _text(item.get("body"), MAX_BODY_CHARS)
            if not name or name in existing:
                continue
            if not description or len(body) < MIN_BODY_CHARS:
                continue
            found.append(
                {
                    "kind": "skill",
                    "name": name,
                    "title": description,
                    "body": body,
                    "rationale": "Proposed from a finished turn with tool work.",
                }
            )
            skills_found += 1

    raw_memories = payload.get("memories")
    if isinstance(raw_memories, list):
        for item in raw_memories[:MAX_MEMORIES]:
            if not isinstance(item, str):
                continue
            fact = " ".join(item.split())[:400]
            if len(fact) < 8:
                continue
            found.append(
                {
                    "kind": "memory",
                    "name": None,
                    "title": fact,
                    "body": "",
                    "rationale": "Proposed as a durable fact about the user.",
                }
            )

    return found


def _client(settings, answered_provider: str | None, answered_model: str | None):
    """The reviewer model: the configured one, then the turn's own.

    The review should not cost the model that just answered the turn again if a
    small one is named. Falling back to the answering model keeps the feature
    working on a one-provider machine, the same choice memory extraction makes.
    """
    from backend.config import load_memory_model, load_tiers
    from backend.runtime.registry import resolve

    candidates: list[tuple[str, str]] = []
    if settings.provider and settings.model:
        candidates.append((settings.provider, settings.model))
    pinned_memory = load_memory_model()
    if pinned_memory:
        candidates.append(pinned_memory)
    try:
        fast = load_tiers().get("fast")
        if fast:
            candidates.append((fast.provider, fast.model))
    except Exception:
        pass
    if answered_provider and answered_model:
        candidates.append((answered_provider, answered_model))

    seen: set[tuple[str, str]] = set()
    for provider, model in candidates:
        if not provider or not model or (provider, model) in seen:
            continue
        seen.add((provider, model))
        try:
            return resolve(provider, model).client
        except Exception as exc:
            log.debug("learning reviewer candidate %s/%s unavailable: %s", provider, model, exc)
    return None


def _existing_skill_names() -> set[str]:
    try:
        from backend.skills.loader import scan

        return {skill.name for skill in scan()[0]}
    except Exception:
        return set()


async def review_turn(
    *,
    conversation_id: str | None,
    run_id: str | None,
    user_message: str,
    answer: str,
    tool_calls: int,
    tool_names: list[str] | None = None,
    answered_provider: str | None = None,
    answered_model: str | None = None,
    settings=None,
    store: LearningStore | None = None,
) -> ReviewResult:
    """Run the review and store whatever survived validation.

    Never raises for a model failure: the job that calls this is post-turn and
    its failure has no user to tell. A provider that is down costs this review
    and nothing else.
    """
    from backend.config import load_learning_settings

    settings = settings or load_learning_settings()
    run, reason = should_review(
        enabled=settings.enabled,
        answer=answer,
        tool_calls=tool_calls,
        user_message=user_message,
    )
    if not run:
        return ReviewResult(ran=False, reason=reason)

    client = _client(settings, answered_provider, answered_model)
    if client is None:
        return ReviewResult(ran=False, reason="no reviewer model is available")

    tools = ", ".join(tool_names or []) or "(none recorded)"
    exchange = (
        f"<tools-used>{tools}</tools-used>\n\n"
        f"<user>\n{user_message[:MAX_EXCHANGE_CHARS]}\n</user>\n\n"
        f"<assistant>\n{answer[:MAX_EXCHANGE_CHARS]}\n</assistant>"
    )
    try:
        response = await client.complete(
            [
                {"role": "system", "content": REVIEW_PROMPT},
                {"role": "user", "content": exchange},
            ],
            tools=None,
        )
    except Exception as exc:
        log.warning("learning review call failed: %s", exc)
        return ReviewResult(ran=False, reason=f"reviewer call failed: {exc}")

    parsed = parse_review(response.text or "", existing_skills=_existing_skill_names())
    store = store or LearningStore()
    stored: list[Proposal] = []
    for item in parsed:
        try:
            stored.append(
                store.add(
                    kind=item["kind"],
                    name=item.get("name") or None,
                    title=item["title"],
                    body=item.get("body") or "",
                    rationale=item.get("rationale"),
                    conversation_id=conversation_id,
                    run_id=run_id,
                )
            )
        except Exception as exc:
            log.warning("could not store a learning proposal: %s", exc)

    return ReviewResult(
        ran=True,
        reason="",
        skills=sum(1 for p in stored if p.kind == "skill"),
        memories=sum(1 for p in stored if p.kind == "memory"),
        proposals=stored,
    )
