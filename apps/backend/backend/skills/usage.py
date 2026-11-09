"""What the agent does with each skill, kept beside the skills themselves.

The catalog is only useful if it stays small and current: a skill that has not
been read in a month is a line in every prompt that no turn benefits from. This
module records the two facts that make that judgement possible -- how often a
skill was used, and when it was last touched -- plus the two flags a person uses
to overrule the machine (`pinned`, `locked`).

It is a sidecar JSON file rather than a table on purpose. A skill is a directory
on disk; its usage is a property of that directory, and keeping the two together
means copying `~/.amethyst/skills` to another machine brings the history with it.
The file is written atomically, so a crash mid-update leaves the previous counts
rather than a truncated document.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path

from backend.config import paths

USAGE_FILE = ".usage.json"

ACTIVE = "active"
STALE = "stale"
ARCHIVED = "archived"
STATES = (ACTIVE, STALE, ARCHIVED)

_lock = threading.RLock()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _path(skills_dir: Path | None = None) -> Path:
    return (skills_dir or paths().skills_dir) / USAGE_FILE


def _blank(created_by: str = "user") -> dict:
    stamp = _now()
    return {
        "use_count": 0,
        "view_count": 0,
        "patch_count": 0,
        "created_at": stamp,
        "last_activity_at": stamp,
        "state": ACTIVE,
        "pinned": False,
        "locked": False,
        "created_by": created_by,
    }


def load(skills_dir: Path | None = None) -> dict[str, dict]:
    path = _path(skills_dir)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        str(name): {**_blank(), **entry}
        for name, entry in raw.items()
        if isinstance(entry, dict)
    }


def _save(data: dict[str, dict], skills_dir: Path | None = None) -> None:
    path = _path(skills_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(prefix=".usage-", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def get(name: str, skills_dir: Path | None = None) -> dict:
    with _lock:
        return {**_blank(), **load(skills_dir).get(name, {})}


def entry(name: str, skills_dir: Path | None = None) -> dict:
    """The entry as it is stored, without inventing one. Empty when unknown."""
    with _lock:
        return dict(load(skills_dir).get(name, {}))


def bump(name: str, field: str, *, skills_dir: Path | None = None, by: int = 1) -> dict:
    """Increment one counter and stamp the activity time."""
    if field not in ("use_count", "view_count", "patch_count"):
        raise ValueError(f"not a counter: {field}")
    with _lock:
        data = load(skills_dir)
        item = {**_blank(), **data.get(name, {})}
        item[field] = int(item.get(field) or 0) + by
        item["last_activity_at"] = _now()
        data[name] = item
        _save(data, skills_dir)
        return item


def mark(name: str, *, created_by: str | None = None, state: str | None = None,
         skills_dir: Path | None = None) -> dict:
    with _lock:
        data = load(skills_dir)
        item = {**_blank(), **data.get(name, {})}
        if created_by:
            item["created_by"] = created_by
        if state:
            if state not in STATES:
                raise ValueError(f"not a skill state: {state}")
            item["state"] = state
        item["last_activity_at"] = _now()
        data[name] = item
        _save(data, skills_dir)
        return item


def set_flag(name: str, flag: str, value: bool, *, skills_dir: Path | None = None) -> dict:
    if flag not in ("pinned", "locked"):
        raise ValueError(f"not a skill flag: {flag}")
    with _lock:
        data = load(skills_dir)
        item = {**_blank(), **data.get(name, {})}
        item[flag] = bool(value)
        if not value and flag == "pinned" and item.get("state") == ARCHIVED:
            item["state"] = ACTIVE
        data[name] = item
        _save(data, skills_dir)
        return item


def forget(name: str, *, skills_dir: Path | None = None) -> None:
    with _lock:
        data = load(skills_dir)
        if data.pop(name, None) is None:
            return
        _save(data, skills_dir)
