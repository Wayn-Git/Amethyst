"""Applying an approved learning proposal.

The only place a proposal becomes a fact. Two kinds, two existing write paths,
both called rather than reimplemented:

- a skill goes through `backend.skills.manage.create`, which is the same
  validation the agent's `skill_manage` tool and a URL install use, so an
  approved proposal cannot produce a skill the loader refuses;
- a memory goes through `MemoryService.apply`, which is what the extractor
  already uses, so deduplication and embedding happen exactly once.

Anything that fails is marked failed with the reason on the row, not rolled
back silently. An approval that could not be applied has to stay visible -- the
person said yes, and "yes" should not vanish into a log line.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from backend.learning.store import APPROVED, FAILED, LearningStore, Proposal

log = logging.getLogger(__name__)


class ApplyError(RuntimeError):
    pass


def _skill_text(proposal: Proposal) -> str:
    name = (proposal.name or "").strip()
    if not name:
        raise ApplyError("this skill proposal has no name")
    description = " ".join((proposal.title or "").split())
    if not description:
        raise ApplyError("this skill proposal has no description")
    quoted = description.replace("\\", "\\\\").replace('"', '\\"')
    body = (proposal.body or "").strip()
    if not body:
        raise ApplyError("this skill proposal has no instruction")
    return f'---\nname: {name}\ndescription: "{quoted}"\n---\n\n{body}\n'


async def apply(proposal_id: int, *, store: LearningStore | None = None) -> Proposal:
    """Apply one pending proposal, whatever its kind.

    Idempotent in the only way that matters: a proposal already decided is
    returned as it stands, so a double click on Approve cannot write a second
    skill or a duplicate fact.
    """
    store = store or LearningStore()
    proposal = store.get(proposal_id)
    if proposal is None:
        raise ApplyError(f"no learning proposal {proposal_id}")
    if proposal.status != "pending":
        return proposal

    try:
        if proposal.kind == "skill":
            _apply_skill(proposal)
        elif proposal.kind == "memory":
            await _apply_memory(proposal)
        else:
            raise ApplyError(f"unknown proposal kind '{proposal.kind}'")
    except Exception as exc:
        log.warning("learning proposal %s could not be applied: %s", proposal_id, exc)
        return store.decide(proposal_id, FAILED, error=str(exc))
    return store.decide(proposal_id, APPROVED)


def _apply_skill(proposal: Proposal) -> None:
    from backend.skills import manage
    from backend.skills import usage as skill_usage

    text = _skill_text(proposal)
    name = (proposal.name or "").strip()
    skill = manage.create(name, text)
    # The curator is allowed to retire this one day: it came from the review,
    # which is the agent writing, so the same protection rules apply as for a
    # skill the agent wrote itself.
    skill_usage.mark(skill.name, created_by="agent")


async def _apply_memory(proposal: Proposal) -> None:
    from backend.memory.service import MemoryDiff, MemoryService

    fact = re.sub(r"\s+", " ", proposal.title or "").strip()
    if not fact:
        raise ApplyError("this memory proposal has no fact")
    service = MemoryService()
    applied = await service.apply(
        MemoryDiff(create=[fact]), conversation_id=proposal.conversation_id
    )
    if not applied.create:
        # Already held. Not a failure: the fact is true and present, which is
        # the outcome the person approved.
        return


async def approve(proposal_id: int, *, store: LearningStore | None = None) -> Proposal:
    return await apply(proposal_id, store=store)


def reject(proposal_id: int, *, store: LearningStore | None = None) -> Proposal:
    from backend.learning.store import REJECTED

    store = store or LearningStore()
    proposal = store.get(proposal_id)
    if proposal is None:
        raise ApplyError(f"no learning proposal {proposal_id}")
    if proposal.status != "pending":
        return proposal
    return store.decide(proposal_id, REJECTED)


def summary(store: LearningStore | None = None) -> dict[str, Any]:
    store = store or LearningStore()
    counts = store.counts()
    return {
        "counts": {
            "pending": counts.get("pending", 0),
            "approved": counts.get("approved", 0),
            "rejected": counts.get("rejected", 0),
            "failed": counts.get("failed", 0),
        }
    }
