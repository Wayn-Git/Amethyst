"""The curator: deterministic, protected, and reversible.

The interesting part is not the two thresholds. It is everything that must
survive them: a pinned skill, a locked one, a shipped builtin, a skill the user
installed, a brand-new skill, and one an automation still names. A curator that
gets the thresholds right and archives a builtin is worse than no curator.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from backend.skills import curator, manage
from backend.skills import usage as skill_usage


def skill_text(name: str) -> str:
    return f'---\nname: {name}\ndescription: "When to use {name}"\n---\n\nDo it.\n'


def make_skill(root, name: str, *, created_by: str, idle_days: int, age_days: int):
    manage.create(name, skill_text(name), skills_dir=root)
    data = skill_usage.load(root)
    stamp_activity = (FIXED - timedelta(days=idle_days)).isoformat(timespec="seconds")
    stamp_created = (FIXED - timedelta(days=age_days)).isoformat(timespec="seconds")
    data[name] = {
        **skill_usage._blank(created_by),
        "created_by": created_by,
        "created_at": stamp_created,
        "last_activity_at": stamp_activity,
    }
    skill_usage._save(data, root)


FIXED = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)


@pytest.fixture
def skills_root(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    return root


def test_curator_moves_agent_skills_through_the_three_states(skills_root, monkeypatch):
    monkeypatch.setattr(curator, "_automation_text", lambda: "")
    make_skill(skills_root, "recent-one", created_by="agent", idle_days=2, age_days=20)
    make_skill(skills_root, "idle-one", created_by="agent", idle_days=20, age_days=40)
    make_skill(skills_root, "forgotten-one", created_by="agent", idle_days=45, age_days=90)

    report = curator.run(now=FIXED, force=True, skills_dir=skills_root)

    assert {item["name"] for item in report["stale"]} == {"idle-one"}
    assert {item["name"] for item in report["archived"]} == {"forgotten-one"}
    assert skill_usage.get("idle-one", skills_root)["state"] == skill_usage.STALE
    assert skill_usage.get("forgotten-one", skills_root)["state"] == skill_usage.ARCHIVED
    assert not (skills_root / "forgotten-one").exists()
    assert any(item["name"] == "forgotten-one" for item in manage.archived(skills_dir=skills_root))
    assert (skills_root / "recent-one").is_dir()

    # The report is on disk, both shapes, and the Markdown names the recovery path.
    from pathlib import Path

    report_dir = Path(report["report_path"]).parent
    assert (report_dir / "run.json").is_file()
    assert "Restore" in (report_dir / "REPORT.md").read_text()


def test_curator_never_touches_a_protected_skill(skills_root, monkeypatch):
    monkeypatch.setattr(curator, "_automation_text", lambda: "run the weekly review each friday")
    # Pinned, locked, builtin, user-installed, too young, automation-referenced.
    for name in ("pinned-one", "locked-one", "builtin-one", "user-one", "young-one", "weekly-review"):
        make_skill(skills_root, name, created_by="agent", idle_days=45, age_days=90)

    skill_usage.set_flag("pinned-one", "pinned", True, skills_dir=skills_root)
    skill_usage.set_flag("locked-one", "locked", True, skills_dir=skills_root)
    (skills_root / "builtin-one" / ".seeded").write_text("hash\n")
    data = skill_usage.load(skills_root)
    data["user-one"]["created_by"] = "user"
    skill_usage._save(data, skills_root)
    data = skill_usage.load(skills_root)
    data["young-one"]["created_at"] = FIXED.isoformat(timespec="seconds")
    data["young-one"]["last_activity_at"] = FIXED.isoformat(timespec="seconds")
    skill_usage._save(data, skills_root)

    report = curator.run(now=FIXED, force=True, skills_dir=skills_root)

    assert report["archived"] == []
    assert {item["name"] for item in report["stale"]} == set()
    for name in ("pinned-one", "locked-one", "builtin-one", "user-one", "young-one", "weekly-review"):
        assert (skills_root / name / "SKILL.md").is_file()
        assert skill_usage.get(name, skills_root)["state"] == skill_usage.ACTIVE


def test_curator_reactivates_a_stale_skill_that_was_used_again(skills_root, monkeypatch):
    monkeypatch.setattr(curator, "_automation_text", lambda: "")
    make_skill(skills_root, "revived", created_by="agent", idle_days=1, age_days=40)
    skill_usage.mark("revived", state=skill_usage.STALE, skills_dir=skills_root)

    report = curator.run(now=FIXED, force=True, skills_dir=skills_root)

    assert {item["name"] for item in report["reactivated"]} == {"revived"}
    assert skill_usage.get("revived", skills_root)["state"] == skill_usage.ACTIVE


def test_curator_ignores_a_skill_with_no_usage_record(skills_root, monkeypatch):
    """No record is not evidence of disuse, and `get()` would invent today."""
    monkeypatch.setattr(curator, "_automation_text", lambda: "")
    manage.create("unknown-origin", skill_text("unknown-origin"), skills_dir=skills_root)

    report = curator.run(now=FIXED, force=True, skills_dir=skills_root)

    assert report["archived"] == []
    assert (skills_root / "unknown-origin").is_dir()
    assert any(item["name"] == "unknown-origin" for item in report["skipped"])


def test_should_run_is_daily(skills_root):
    assert curator.should_run(FIXED) is True
    curator.run(now=FIXED, force=True, skills_dir=skills_root)
    assert curator.should_run(FIXED + timedelta(hours=1)) is False
    assert curator.should_run(FIXED + timedelta(hours=25)) is True


def test_reference_matching_is_whole_token(monkeypatch):
    haystack = "run the weekly review every friday"
    assert curator._referenced("weekly-review", haystack) is True
    assert curator._referenced("review", haystack) is True
    assert curator._referenced("monthly-review", haystack) is False
    assert curator._referenced("weekly-review", "weekly-review-old is different") is False
