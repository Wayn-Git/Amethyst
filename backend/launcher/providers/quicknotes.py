"""Quick notes provider for Amethyst Damon launcher."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, AsyncIterator

from backend.db.repositories import TaskRepository
from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)
from backend.remote.clipboard import set_clipboard

log = logging.getLogger(__name__)


def _notes_file() -> Path:
    base = Path.home() / ".amethyst"
    base.mkdir(parents=True, exist_ok=True)
    return base / "quick_notes.jsonl"


def save_quick_note(text: str) -> dict[str, Any]:
    clean = text.strip()
    if not clean:
        raise ValueError("Note text cannot be empty")

    now = time.time()
    iso = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now))
    entry = {
        "id": f"note_{int(now * 1000)}",
        "text": clean,
        "created_at": now,
        "date_str": iso,
    }

    # 1. Append to local file
    f = _notes_file()
    with f.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # 2. Also register in TaskRepository so it appears in tasks / notes view
    try:
        TaskRepository().create(
            title=clean[:120],
            notes=clean if len(clean) > 120 else None,
            source="quick_note",
        )
    except Exception as e:
        log.debug("Could not mirror note to TaskRepository: %s", e)

    return entry


def load_recent_notes(limit: int = 15) -> list[dict[str, Any]]:
    f = _notes_file()
    if not f.exists():
        return []
    lines = []
    try:
        with f.open("r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if line:
                    lines.append(json.loads(line))
    except Exception:
        pass
    return lines[-limit:][::-1]


class QuickNoteProvider(BaseLauncherProvider):
    id = "quicknotes"
    name = "Quick Notes"
    priority = 72

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        term = raw.lower()

        is_note_prefix = False
        note_content = ""

        if term.startswith("note:"):
            is_note_prefix = True
            note_content = raw[5:].strip()
        elif term.startswith("note "):
            is_note_prefix = True
            note_content = raw[5:].strip()
        elif term.startswith("take note "):
            is_note_prefix = True
            note_content = raw[10:].strip()

        # If user is typing a new note
        if is_note_prefix and note_content:
            yield LauncherResult(
                id=f"create_note:{note_content}",
                provider_id=self.id,
                title=f"Create Note: “{note_content[:60]}”",
                subtitle="Save to quick notes and tasks",
                icon="note",
                badge="NEW NOTE",
                score=120.0,
                preview_type="markdown",
                preview_data={
                    "markdown": f"### Quick Note\n\n> {note_content}\n\nPress **Enter** to save note instantly."
                },
                actions=[
                    LauncherAction(
                        id="save_note",
                        title="Save Quick Note",
                        shortcut="↵",
                        is_primary=True,
                        handler_payload={"text": note_content},
                    )
                ],
            )

        # Search existing notes
        import asyncio
        recent = await asyncio.to_thread(load_recent_notes, 25)
        for item in recent:
            txt = item.get("text", "")
            date_str = item.get("date_str", "")

            score = 0.0
            if is_note_prefix and not note_content:
                score = 85.0
            elif not term and not is_note_prefix:
                score = 0.0
            elif term and term in txt.lower():
                score = 80.0
            elif is_note_prefix and note_content.lower() in txt.lower():
                score = 90.0

            if score > 0:
                yield LauncherResult(
                    id=item["id"],
                    provider_id=self.id,
                    title=txt[:80],
                    subtitle=f"Saved note • {date_str}",
                    icon="note",
                    badge="NOTE",
                    score=score,
                    preview_type="markdown",
                    preview_data={
                        "markdown": f"### Note\n\n{txt}\n\n- **Created:** {date_str}\n\nPress **Enter** to copy to clipboard."
                    },
                    actions=[
                        LauncherAction(
                            id="copy_note",
                            title="Copy Note",
                            shortcut="↵",
                            is_primary=True,
                            handler_payload={"text": txt},
                        )
                    ],
                )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        text = payload.get("text", "").strip()
        if not text:
            return {"ok": False, "error": "Empty note text"}

        if action_id == "copy_note":
            set_clipboard(text)
            return {"ok": True, "copied": text}

        if action_id == "save_note":
            saved = save_quick_note(text)
            return {"ok": True, "note": saved}

        return {"ok": False, "error": f"Unknown action: {action_id}"}
