from __future__ import annotations

import contextlib
import hashlib
import os
import re
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
PROMPTS = ROOT / "prompts" / "widgets.md"
GENERATED = ROOT / "generated"
WORKTREES = ROOT / ".agent-worktrees"
DB = Path(os.environ.get("WIDGET_FACTORY_DB", ROOT / ".factory.sqlite3"))
DEFAULT_ENDPOINT = "https://widgets.gan.dev/api/author-widget"
MAX_GENERATION_BYTES = 25 * 1024 * 1024
MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
STATUSES = (
    "pending",
    "generating",
    "generated",
    "ready",
    "claimed",
    "implementing",
    "review",
    "integrating",
    "completed",
    "failed",
)
ID_RE = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$")
IMAGE_TYPES = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
}


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_name)


def parse_prompts(text: str) -> dict[str, str]:
    """Parse strict ## id + one ```prompt fence blocks; reject ambiguous input."""
    lines = text.splitlines()
    sections: list[tuple[str, list[str]]] = []
    current: tuple[str, list[str]] | None = None
    for line_no, line in enumerate(lines, 1):
        if line.startswith("## "):
            if current:
                sections.append(current)
            widget_id = line[3:].strip()
            if not ID_RE.fullmatch(widget_id):
                raise ValueError(f"Invalid widget ID on line {line_no}: {widget_id!r}")
            current = (widget_id, [])
        elif line.startswith("##") and line.strip():
            raise ValueError(f"Malformed section heading on line {line_no}")
        elif current:
            current[1].append(line)
    if current:
        sections.append(current)
    if not sections:
        raise ValueError("No widget sections found; expected ## <unique-id>")
    result: dict[str, str] = {}
    for widget_id, block in sections:
        if widget_id in result:
            raise ValueError(f"Duplicate widget ID: {widget_id}")
        content = "\n".join(block)
        matches = list(re.finditer(r"(?m)^```prompt[ \t]*\n(.*?)^```[ \t]*$", content, re.S))
        if len(matches) != 1:
            raise ValueError(f"{widget_id}: expected exactly one properly closed ```prompt block")
        match = matches[0]
        if content[: match.start()].strip() or content[match.end() :].strip():
            raise ValueError(f"{widget_id}: malformed prompt fence")
        prompt = match.group(1).strip()
        if not prompt:
            raise ValueError(f"{widget_id}: prompt is empty")
        result[widget_id] = prompt
    return result


def read_prompts(path: Path = PROMPTS) -> dict[str, str]:
    return parse_prompts(path.read_text(encoding="utf-8"))


def max_agents() -> int:
    try:
        value = int(os.environ.get("WIDGET_FACTORY_MAX_AGENTS", "4"))
    except ValueError as exc:
        raise ValueError("WIDGET_FACTORY_MAX_AGENTS must be an integer from 1 to 4") from exc
    if not 1 <= value <= 4:
        raise ValueError("WIDGET_FACTORY_MAX_AGENTS must be from 1 to 4")
    return value


def sync_prompt_tasks(prompts: dict[str, str]) -> None:
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        for widget_id in prompts:
            stamp = now()
            db.execute(
                "INSERT INTO tasks(widget_id,status,created_at,updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(widget_id) DO NOTHING",
                (widget_id, "pending", stamp, stamp),
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def connect() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=15000")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS tasks (
        widget_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN (
          'pending','generating','generated','ready','claimed','implementing',
          'review','integrating','completed','failed')),
        session_id TEXT,
        slot INTEGER CHECK(slot BETWEEN 1 AND 4),
        worktree TEXT,
        branch TEXT,
        commit_sha TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        error TEXT,
        integration_status TEXT NOT NULL DEFAULT 'not_requested',
        report TEXT
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY,
        widget_id TEXT NOT NULL REFERENCES tasks(widget_id),
        session_id TEXT,
        at TEXT NOT NULL,
        event TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS task_status_order ON tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS task_lease ON tasks(lease_expires_at);
    """)
    return db


def event(
    db: sqlite3.Connection, widget_id: str, session_id: str | None, action: str, detail: str = ""
) -> None:
    db.execute(
        "INSERT INTO task_events(widget_id,session_id,at,event,detail) VALUES(?,?,?,?,?)",
        (widget_id, session_id, now(), action, detail[:4000]),
    )


def valid_id(widget_id: str) -> str:
    if not ID_RE.fullmatch(widget_id):
        raise ValueError("Invalid widget ID")
    return widget_id


def artifact_dir(widget_id: str) -> Path:
    return GENERATED / valid_id(widget_id)


def task_access(widget_id: str, session_id: str | None = None) -> None:
    db = connect()
    try:
        row = db.execute(
            "SELECT status,session_id,lease_expires_at FROM tasks WHERE widget_id=?",
            (valid_id(widget_id),),
        ).fetchone()
        if row:
            lease_live = bool(row["lease_expires_at"] and row["lease_expires_at"] >= now())
            active = row["status"] in ("claimed", "implementing", "review", "integrating")
            owner_mismatch = bool(row["session_id"] and row["session_id"] != session_id)
            if owner_mismatch and (not active or lease_live):
                raise PermissionError("Another session owns this task")
            if active and lease_live and not session_id:
                raise PermissionError("Another session owns this task")
    finally:
        db.close()
