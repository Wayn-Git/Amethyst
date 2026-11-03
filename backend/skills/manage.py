"""Writes to the skill library, for the agent and for the curation pass.

The agent can create a procedure it just worked out and patch one that turned
out to be wrong; the curator can move a skill out of the catalog without
deleting it. Both go through this module rather than touching `SKILL.md`
directly, because the rules that keep a skill library usable are all enforced
at the write:

- the name is a slug and the frontmatter name matches the directory, or the
  loader will refuse the skill and the catalog grows a broken entry;
- a patch names a span that occurs exactly once, so a stale instruction cannot
  be applied to two places;
- support files live under four known directories and nowhere else;
- a write is staged and moved into place, so a crash leaves the old skill
  intact rather than half of a new one;
- removing a skill archives it. Superseding a skill is reversible; deleting the
  file is not, and the one time it matters is the time somebody meant to keep it.

`backend/skills/install.py` remains the path for installing text that arrived
over the network. This module is the path for text that came from the agent or
the user, and it shares the same parser so a skill is valid by the same rules
whichever door it came through.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from backend.config import paths
from backend.skills.loader import (
    FRONTMATTER_RE,
    NAME_RE,
    Skill,
    forget_scan_cache,
    parse_skill_md,
)

#: Directories a skill may carry beside its SKILL.md. The loader tolerates
#: anything, but a write surface has to be narrower than the filesystem: an
#: agent that can write `../../` has an agent that can write anywhere the user
#: can, and no skill needs that.
SUPPORT_DIRS = ("references", "templates", "scripts", "assets")

#: Advisory body ceiling. Long enough for a real procedure, short enough that
#: one skill cannot crowd the catalog or a context window.
MAX_BODY_CHARS = 24_000

#: Frontmatter description ceiling. The description is the whole basis on which
#: the model decides relevance; a 4,000-character one is a body pretending to be
#: a description.
MAX_DESCRIPTION_CHARS = 600

#: Names that describe the session rather than a class of task. A skill called
#: `fix-login-bug-today` is a transcript with a filename, and it will not be
#: reusable in a week.
_SESSION_ARTIFACT = re.compile(
    r"(^|-)(today|tonight|yesterday|this-(?:morning|afternoon|week)|"
    r"fix|debug|investigate)(-|$)|(^|-)pr-?\d+(-|$)",
    re.IGNORECASE,
)


class SkillManageError(RuntimeError):
    """A write the library refuses, with a reason the caller can show."""


def _root(skills_dir: Path | None = None) -> Path:
    root = (skills_dir or paths().skills_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _checked_name(name: str) -> str:
    name = (name or "").strip()
    if not NAME_RE.match(name):
        raise SkillManageError(
            f"'{name}' is not a skill name (lowercase letters, digits and hyphens,"
            " up to 64 characters)"
        )
    return name


def _dir(name: str, skills_dir: Path | None = None) -> Path:
    root = _root(skills_dir)
    target = (root / _checked_name(name)).resolve()
    if not target.is_relative_to(root):
        raise SkillManageError("that name resolves outside the skills directory")
    return target


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(prefix=".write-", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SkillManageError(f"could not read {path.name}: {exc}") from exc


def _refresh_cache() -> None:
    forget_scan_cache()


def linter(name: str, text: str) -> list[str]:
    """Advisory findings for a skill that is valid but not yet good.

    Warnings, never a refusal. A linter that blocks a write is a linter the
    agent learns to route around by writing a different, worse skill.
    """
    findings: list[str] = []
    match = FRONTMATTER_RE.match(text)
    body = text[match.end():] if match else text

    if len(body) > MAX_BODY_CHARS:
        findings.append(
            f"body is {len(body):,} characters; the advisory ceiling is"
            f" {MAX_BODY_CHARS:,}. Move depth into references/ and name it by topic."
        )
    if match:
        import yaml

        try:
            meta = yaml.safe_load(match.group(1)) or {}
        except yaml.YAMLError:
            meta = {}
        description = meta.get("description") if isinstance(meta, dict) else None
        if isinstance(description, str) and len(description) > MAX_DESCRIPTION_CHARS:
            findings.append(
                f"description is {len(description):,} characters; it is the"
                " relevance signal, not the procedure"
            )
    if _SESSION_ARTIFACT.search(name):
        findings.append(
            "the name reads like a session artifact. Skills should name a class"
            " of task, not the incident that produced them."
        )
    if re.search(r"\bUPDATE\s*:", body, re.IGNORECASE):
        findings.append(
            "the body contains an 'UPDATE:' block. Fix the wrong step in place;"
            " appended corrections leave the old instruction in force."
        )
    return findings


def create(
    name: str,
    content: str,
    *,
    skills_dir: Path | None = None,
    overwrite: bool = False,
) -> Skill:
    """Validate and write a new skill directory."""
    name = _checked_name(name)
    if not content.lstrip().startswith("---"):
        raise SkillManageError(
            "a skill must start with YAML frontmatter containing name and description"
        )

    from backend.skills.install import SkillInstallError, _declared_name, install_text

    declared = _declared_name(content)
    if declared and declared != name:
        raise SkillManageError(
            f"frontmatter name is '{declared}', not '{name}'"
        )

    try:
        skill = install_text(content, skills_dir=skills_dir, overwrite=overwrite)
    except SkillInstallError as exc:
        raise SkillManageError(str(exc)) from exc
    if skill.name != name:
        raise SkillManageError(f"frontmatter name is '{skill.name}', not '{name}'")
    _refresh_cache()
    return skill


def read(name: str, file_path: str | None = None, *, skills_dir: Path | None = None) -> str:
    target = _dir(name, skills_dir)
    if not target.is_dir():
        raise SkillManageError(f"'{name}' is not installed")
    if file_path:
        path = _support_path(target, file_path)
        if not path.is_file():
            raise SkillManageError(f"'{name}' has no file {file_path}")
        return _read(path)
    return _read(target / "SKILL.md")


def patch(
    name: str,
    old_string: str,
    new_string: str,
    *,
    skills_dir: Path | None = None,
    file_path: str | None = None,
) -> str:
    """Replace one unique span. The preferred edit: it carries context, not a rewrite."""
    target = _dir(name, skills_dir)
    if not target.is_dir():
        raise SkillManageError(f"'{name}' is not installed")
    path = _support_path(target, file_path) if file_path else target / "SKILL.md"
    if not path.is_file():
        raise SkillManageError(f"'{name}' has no file {file_path}")
    text = _read(path)
    if not old_string or old_string == new_string:
        raise SkillManageError("patch needs a non-empty old_string and a change")
    occurrences = text.count(old_string)
    if occurrences == 0:
        raise SkillManageError("old_string does not occur in the file")
    if occurrences > 1:
        raise SkillManageError(
            f"old_string occurs {occurrences} times; include more context so the"
            " patch identifies one span"
        )
    _atomic_write(path, text.replace(old_string, new_string, 1))
    _refresh_cache()
    return f"patched {name}/{file_path or 'SKILL.md'}"


def replace(
    name: str,
    content: str,
    *,
    skills_dir: Path | None = None,
    file_path: str | None = None,
) -> str:
    """Rewrite a file in full. Use when the change is most of the document."""
    target = _dir(name, skills_dir)
    if not target.is_dir():
        raise SkillManageError(f"'{name}' is not installed")
    path = _support_path(target, file_path) if file_path else target / "SKILL.md"
    if path.name == "SKILL.md":
        _, error = parse_skill_md_text(content, target)
        if error:
            raise SkillManageError(error)
    _atomic_write(path, content)
    _refresh_cache()
    return f"replaced {name}/{file_path or 'SKILL.md'}"


def parse_skill_md_text(text: str, directory: Path) -> tuple[Skill | None, str | None]:
    """Parse frontmatter against the directory name it will land in."""
    with tempfile.TemporaryDirectory() as tmp:
        probe = Path(tmp) / directory.name
        probe.mkdir()
        (probe / "SKILL.md").write_text(text, encoding="utf-8")
        return parse_skill_md(probe / "SKILL.md")


def _support_path(skill_dir: Path, file_path: str) -> Path:
    raw = (file_path or "").strip().replace("\\", "/")
    if not raw or raw.startswith("/") or ".." in Path(raw).parts:
        raise SkillManageError("file_path must be a relative path inside the skill")
    parts = Path(raw).parts
    if not parts or parts[0] not in SUPPORT_DIRS:
        raise SkillManageError(
            "file_path must start with one of: " + ", ".join(SUPPORT_DIRS)
        )
    resolved = (skill_dir / raw).resolve()
    if not resolved.is_relative_to(skill_dir.resolve()):
        raise SkillManageError("that path resolves outside the skill directory")
    return resolved


def write_file(
    name: str,
    file_path: str,
    content: str,
    *,
    skills_dir: Path | None = None,
) -> str:
    target = _dir(name, skills_dir)
    if not target.is_dir():
        raise SkillManageError(f"'{name}' is not installed")
    path = _support_path(target, file_path)
    _atomic_write(path, content)
    return f"wrote {name}/{file_path}"


def remove_file(name: str, file_path: str, *, skills_dir: Path | None = None) -> str:
    target = _dir(name, skills_dir)
    path = _support_path(target, file_path)
    if not path.is_file():
        raise SkillManageError(f"'{name}' has no file {file_path}")
    path.unlink()
    return f"removed {name}/{file_path}"


def archive(
    name: str,
    *,
    reason: str = "archived",
    skills_dir: Path | None = None,
) -> Path:
    """Move a skill out of the catalog without deleting it."""
    target = _dir(name, skills_dir)
    if not target.is_dir():
        raise SkillManageError(f"'{name}' is not installed")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination = _root(skills_dir) / ".archive" / stamp / target.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(target), str(destination))
    (destination / ".archive-reason").write_text(reason + "\n", encoding="utf-8")
    _refresh_cache()
    return destination


def restore(name: str, *, skills_dir: Path | None = None) -> Path:
    """Bring the most recent archived copy of `name` back into the catalog."""
    name = _checked_name(name)
    root = _root(skills_dir)
    archive_root = root / ".archive"
    candidates = sorted(
        (p / name for p in archive_root.iterdir() if (p / name).is_dir()),
        reverse=True,
    ) if archive_root.is_dir() else []
    if not candidates:
        raise SkillManageError(f"no archived copy of '{name}'")
    source = candidates[0]
    target = root / name
    if target.exists():
        raise SkillManageError(f"'{name}' is already installed")
    shutil.move(str(source), str(target))
    (target / ".archive-reason").unlink(missing_ok=True)
    _refresh_cache()
    return target


def archived() -> list[dict[str, str]]:
    """What is in the archive, newest first."""
    archive_root = _root() / ".archive"
    if not archive_root.is_dir():
        return []
    found: list[dict[str, str]] = []
    for stamp_dir in sorted(archive_root.iterdir(), reverse=True):
        if not stamp_dir.is_dir():
            continue
        for skill_dir in sorted(stamp_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            reason_file = skill_dir / ".archive-reason"
            found.append({
                "name": skill_dir.name,
                "archived_at": stamp_dir.name,
                "reason": reason_file.read_text(encoding="utf-8").strip()
                if reason_file.is_file() else "archived",
                "path": str(skill_dir),
            })
    return found
