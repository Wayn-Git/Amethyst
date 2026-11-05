"""Writing to the skill library: the rules that keep it usable.

Every test here is a rule from `backend/skills/manage.py`'s docstring: the name
matches the directory, a patch replaces one unique span, support files stay
inside four known directories, a delete archives, and an edit requires reading
the file first. These are the constraints that make an agent-managed library
different from a filesystem tool pointed at `~/.amethyst/skills`.
"""

from __future__ import annotations

import pytest

from backend.skills import manage
from backend.skills import usage as skill_usage
from backend.tools.base import ToolContext
from backend.tools.builtin import skills as skill_tools


def skill_text(name: str, body: str = "Do the thing, then check it worked.") -> str:
    return f'---\nname: {name}\ndescription: "When to use {name}"\n---\n\n{body}\n'


@pytest.fixture
def skills_root(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    return root


def _point_default_root(monkeypatch, root):
    """Make the modules that hold `paths` by value look at the test root.

    `from backend.config import paths` binds the function object, so patching
    `backend.config.paths` changes nothing. Each holder has to be patched.
    """
    home = type("Home", (), {"skills_dir": root})()
    for target in (
        "backend.skills.manage.paths",
        "backend.skills.usage.paths",
        "backend.skills.loader.paths",
    ):
        monkeypatch.setattr(target, lambda: home)


def test_create_files_the_skill_under_its_frontmatter_name(skills_root):
    skill = manage.create("weekly-review", skill_text("weekly-review"), skills_dir=skills_root)
    assert skill.name == "weekly-review"
    assert (skills_root / "weekly-review" / "SKILL.md").is_file()
    assert manage.read("weekly-review", skills_dir=skills_root).startswith("---")


def test_create_refuses_a_name_that_disagrees_with_the_frontmatter(skills_root):
    with pytest.raises(manage.SkillManageError, match="not 'other'"):
        manage.create("other", skill_text("weekly-review"), skills_dir=skills_root)
    assert not (skills_root / "other").exists()


def test_create_refuses_a_name_that_is_not_a_slug(skills_root):
    with pytest.raises(manage.SkillManageError):
        manage.create("../escape", skill_text("escape"), skills_dir=skills_root)


def test_patch_requires_a_span_that_occurs_once(skills_root):
    manage.create("one", skill_text("one", "alpha\nbeta"), skills_dir=skills_root)
    manage.patch("one", "alpha", "gamma", skills_dir=skills_root)
    assert "gamma" in manage.read("one", skills_dir=skills_root)

    with pytest.raises(manage.SkillManageError, match="does not occur"):
        manage.patch("one", "missing", "x", skills_dir=skills_root)
    with pytest.raises(manage.SkillManageError, match="occurs 4 times"):
        manage.patch("one", "a", "b", skills_dir=skills_root)


def test_support_files_are_confined_to_known_directories(skills_root):
    manage.create("one", skill_text("one"), skills_dir=skills_root)
    manage.write_file("one", "references/notes.md", "hello", skills_dir=skills_root)
    assert manage.read("one", "references/notes.md", skills_dir=skills_root) == "hello"

    with pytest.raises(manage.SkillManageError, match="must start with one of"):
        manage.write_file("one", "notes.md", "hello", skills_dir=skills_root)
    with pytest.raises(manage.SkillManageError):
        manage.write_file("one", "../outside.md", "x", skills_dir=skills_root)
    with pytest.raises(manage.SkillManageError):
        manage.read("one", "/etc/passwd", skills_dir=skills_root)


def test_delete_archives_and_restore_brings_it_back(skills_root):
    manage.create("one", skill_text("one"), skills_dir=skills_root)
    destination = manage.archive("one", reason="test", skills_dir=skills_root)

    assert not (skills_root / "one").exists()
    assert (destination / "SKILL.md").is_file()
    assert (destination / ".archive-reason").read_text().strip() == "test"
    archived = manage.archived(skills_dir=skills_root)
    assert [item["name"] for item in archived] == ["one"]
    assert archived[0]["reason"] == "test"

    manage.restore("one", skills_dir=skills_root)
    assert (skills_root / "one" / "SKILL.md").is_file()
    assert not (skills_root / "one" / ".archive-reason").exists()


def test_usage_sidecar_records_counters_and_flags(skills_root):
    skill_usage.bump("one", "use_count", skills_dir=skills_root)
    skill_usage.bump("one", "use_count", skills_dir=skills_root)
    record = skill_usage.get("one", skills_root)
    assert record["use_count"] == 2
    assert record["state"] == skill_usage.ACTIVE

    skill_usage.set_flag("one", "pinned", True, skills_dir=skills_root)
    skill_usage.mark("one", state=skill_usage.STALE, skills_dir=skills_root)
    record = skill_usage.get("one", skills_root)
    assert record["pinned"] is True
    assert record["state"] == skill_usage.STALE

    skill_usage.forget("one", skills_dir=skills_root)
    # `get` invents a blank record; `entry` is the honest "we have nothing".
    assert skill_usage.entry("one", skills_root) == {}


@pytest.mark.asyncio
async def test_agent_must_read_a_skill_before_editing_it(skills_root, monkeypatch):
    manage.create("one", skill_text("one", "alpha"), skills_dir=skills_root)
    _point_default_root(monkeypatch, skills_root)

    context = ToolContext(conversation_id="c1")
    refused = await skill_tools.skill_manage(
        {"action": "patch", "name": "one", "old_string": "alpha", "new_string": "beta"},
        context,
    )
    assert refused.is_error
    assert "Read 'one' with skill_view" in refused.content

    viewed = await skill_tools.skill_view({"name": "one"}, context)
    assert not viewed.is_error and "alpha" in viewed.content

    applied = await skill_tools.skill_manage(
        {"action": "patch", "name": "one", "old_string": "alpha", "new_string": "beta"},
        context,
    )
    assert not applied.is_error
    assert "beta" in manage.read("one", skills_dir=skills_root)


@pytest.mark.asyncio
async def test_locked_skills_refuse_agent_edits(skills_root, monkeypatch):
    manage.create("one", skill_text("one", "alpha"), skills_dir=skills_root)
    _point_default_root(monkeypatch, skills_root)
    skill_usage.set_flag("one", "locked", True, skills_dir=skills_root)

    context = ToolContext(conversation_id="c1")
    await skill_tools.skill_view({"name": "one"}, context)
    refused = await skill_tools.skill_manage(
        {"action": "replace", "name": "one", "content": skill_text("one", "beta")},
        context,
    )
    assert refused.is_error
    assert "locked" in refused.content
    assert "alpha" in manage.read("one", skills_dir=skills_root)
