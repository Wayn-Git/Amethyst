"""Post-turn learning: a proposal, never a write.

The review is the mechanism AMETHYST was missing, and the risk it introduces is
also the reason it exists: an unattended model deciding what future turns are
told. The tests here pin the two halves of the bargain -- the cheap gate that
keeps it from costing a call every turn, and the approval step that keeps it from
changing the skill library by itself.
"""

from __future__ import annotations

import pytest

from backend.learning import review as review_module
from backend.learning import service
from backend.learning.review import parse_review, review_turn, should_review
from backend.learning.store import LearningStore


def body(words: int = 80) -> str:
    return " ".join(["Do the step, then check it worked."] * words)


class FakeClient:
    def __init__(self, text: str):
        self.text = text
        self.calls = 0

    async def complete(self, messages, tools=None):
        self.calls += 1
        from backend.runtime.types import ModelResponse

        return ModelResponse(text=self.text)


def test_gate_skips_a_turn_that_did_nothing():
    run, reason = should_review(
        enabled=True, answer="A short answer.", tool_calls=0, user_message="what time is it"
    )
    assert run is False
    assert "short" in reason

    run, reason = should_review(
        enabled=True,
        answer="A" * 300,
        tool_calls=0,
        user_message="what time is it",
    )
    assert run is False
    assert "no tool work" in reason


def test_gate_runs_for_tool_work_or_a_correction():
    run, _ = should_review(
        enabled=True, answer="A" * 300, tool_calls=2, user_message="make the report"
    )
    assert run is True

    run, _ = should_review(
        enabled=True,
        answer="A" * 300,
        tool_calls=0,
        user_message="no, export the CSV with semicolons instead",
    )
    assert run is True


def test_gate_is_off_when_the_feature_is_off():
    run, reason = should_review(
        enabled=False, answer="A" * 300, tool_calls=5, user_message="do it"
    )
    assert run is False
    assert "off" in reason


def test_parse_review_drops_what_the_loader_would_refuse():
    text = """
    {"skills": [
      {"name": "fix-login-today", "description": "x", "body": "%s"},
      {"name": "CSV Dedupe By Key", "description": "Deduplicate rows by one key.",
       "body": "%s"},
      {"name": "weekly-review", "description": "Already installed.", "body": "%s"},
      {"name": "too-short", "description": "x", "body": "tiny"}
    ], "memories": ["Likes terse answers.", "", "x"]}
    """ % (body(), body(), body())

    parsed = parse_review(text, existing_skills={"weekly-review"})
    skills = [p for p in parsed if p["kind"] == "skill"]
    memories = [p for p in parsed if p["kind"] == "memory"]

    assert [p["name"] for p in skills] == ["csv-dedupe-by-key"]
    assert skills[0]["title"] == "Deduplicate rows by one key."
    assert [p["title"] for p in memories] == ["Likes terse answers."]


def test_parse_review_tolerates_a_fence_and_a_wrong_shape():
    parsed = parse_review('```json\n{"skills": [], "memories": []}\n```')
    assert parsed == []
    assert parse_review("not json at all") == []
    assert parse_review('["not", "an", "object"]') == []


@pytest.mark.asyncio
async def test_review_turn_stores_proposals_without_applying_them(amethyst_home, monkeypatch):
    monkeypatch.setattr(
        review_module,
        "_client",
        lambda *args, **kwargs: FakeClient(
            '{"skills": [{"name": "csv-dedupe", "description": "Deduplicate rows by key.",'
            ' "body": "' + body() + '"}], "memories": ["Prefers CSV over XLSX."]}'
        ),
    )

    result = await review_turn(
        conversation_id="c1",
        run_id="r1",
        user_message="dedupe this csv",
        answer="A" * 300,
        tool_calls=3,
        tool_names=["filesystem"],
        settings=type("S", (), {"enabled": True, "provider": None, "model": None})(),
    )

    assert result.ran is True
    assert result.skills == 1
    assert result.memories == 1

    store = LearningStore()
    pending = store.list(status="pending")
    assert {p.kind for p in pending} == {"skill", "memory"}

    # Nothing exists on disk yet: a proposal is not a skill.
    from backend.skills.loader import scan

    assert "csv-dedupe" not in {s.name for s in scan()[0]}


@pytest.mark.asyncio
async def test_approving_a_skill_proposal_writes_it_through_the_loader(amethyst_home, tmp_path, monkeypatch):
    from backend.skills import manage, usage

    root = tmp_path / "skills"
    root.mkdir()
    home = type("Home", (), {"skills_dir": root})()
    for target in (
        "backend.skills.manage.paths",
        "backend.skills.usage.paths",
        "backend.skills.loader.paths",
        # `manage.create` delegates the actual write to `install.install_text`,
        # which holds its own `paths` binding.
        "backend.skills.install.paths",
    ):
        monkeypatch.setattr(target, lambda: home)

    store = LearningStore()
    proposal = store.add(
        kind="skill",
        name="csv-dedupe",
        title="Deduplicate rows by key.",
        body=body(40),
    )

    applied = await service.approve(proposal.id, store=store)

    assert applied.status == "approved"
    assert (root / "csv-dedupe" / "SKILL.md").is_file()
    assert usage.get("csv-dedupe", root)["created_by"] == "agent"


@pytest.mark.asyncio
async def test_a_failed_approval_stays_visible(amethyst_home, tmp_path, monkeypatch):
    from backend.skills import manage

    root = tmp_path / "skills"
    root.mkdir()
    home = type("Home", (), {"skills_dir": root})()
    for target in ("backend.skills.manage.paths", "backend.skills.usage.paths", "backend.skills.install.paths"):
        monkeypatch.setattr(target, lambda: home)
    manage.create(
        "already-there",
        '---\nname: already-there\ndescription: "x"\n---\n\nDo it.\n',
        skills_dir=root,
    )

    store = LearningStore()
    proposal = store.add(
        kind="skill", name="already-there", title="Duplicate.", body=body(40)
    )
    failed = await service.approve(proposal.id, store=store)

    assert failed.status == "failed"
    assert failed.error
    assert "already installed" in failed.error


@pytest.mark.asyncio
async def test_rejecting_a_proposal_never_writes(amethyst_home, tmp_path, monkeypatch):
    from backend.skills import manage

    root = tmp_path / "skills"
    root.mkdir()
    home = type("Home", (), {"skills_dir": root})()
    monkeypatch.setattr("backend.skills.manage.paths", lambda: home)

    store = LearningStore()
    proposal = store.add(kind="skill", name="never-written", title="No.", body=body(40))
    rejected = service.reject(proposal.id, store=store)

    assert rejected.status == "rejected"
    assert not (root / "never-written").exists()
