"""Shipped skills reaching an install that already exists.

Seeding used to skip any directory it found, so a builtin was written into
`~/.amethyst/skills` on the very first run and never again: every later fix to
a shipped skill reached new installs and nobody else. The agent went on reading
a copy of the instructions from whenever the user first started the
application, which is most of what "the skills were not updated with the
project" means.

The line these hold is that updating an untouched copy is not the same as
overwriting somebody's edits.
"""

from __future__ import annotations

from pathlib import Path

from backend.skills.loader import SEED_MARKER, scan, seed_builtin_skills

SHIPPED = Path(__file__).resolve().parents[1] / "backend" / "skills" / "builtin"


def installed(home: Path, name: str = "amethyst-intro") -> Path:
    return home / "skills" / name / "SKILL.md"


def test_a_shipped_skill_that_has_changed_replaces_the_installed_copy(amethyst_home):
    seed_builtin_skills()
    file = installed(amethyst_home)
    current = file.read_text()

    # The install is a version behind: exactly the state anyone who ran the
    # application before a skill was edited is in.
    file.write_text("---\nname: amethyst-intro\ndescription: stale\n---\n\nOld.\n")
    (amethyst_home / "skills" / "amethyst-intro" / SEED_MARKER).write_text(
        __import__("hashlib").sha256(file.read_bytes()).hexdigest()
    )

    assert "amethyst-intro" in seed_builtin_skills()
    assert file.read_text() == current, "the shipped version did not land"


def test_an_edited_skill_is_left_alone(amethyst_home):
    """A skill is a text file the user is invited to write. Updating one they
    have changed would delete their work to fix a typo in ours.

    Mutation check: drop the marker comparison and this loses the edit.
    """
    seed_builtin_skills()
    file = installed(amethyst_home)
    mine = file.read_text() + "\n\nMy own note.\n"
    file.write_text(mine)

    seed_builtin_skills()

    assert file.read_text() == mine


def test_the_renamed_intro_skill_is_retired(amethyst_home):
    """`psok-intro` is `amethyst-intro` under the project's old name, and every
    install made before the rename has both. Two catalogue entries disagreeing
    about what the system is called is worse for a model than one.

    Mutation check: remove RETIRED_BUILTINS and both stay in the catalogue.
    """
    seed_builtin_skills()
    stale = amethyst_home / "skills" / "psok-intro"
    stale.mkdir(parents=True)
    (stale / "SKILL.md").write_text(
        "---\nname: psok-intro\ndescription: Explain what PSOK can do.\n---\n\nPSOK.\n"
    )

    seed_builtin_skills()

    assert not stale.exists()
    names = {s.name for s in scan()[0]}
    assert "psok-intro" not in names
    assert "amethyst-intro" in names


def test_seeding_twice_changes_nothing_the_second_time(amethyst_home):
    """It runs on every boot now, so it has to be quiet when there is nothing
    to do -- otherwise the log says the skills were updated at every start."""
    assert seed_builtin_skills(), "nothing was seeded into an empty home"
    assert seed_builtin_skills() == []
