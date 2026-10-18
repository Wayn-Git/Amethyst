"""Standalone Weekly Library Digest Entrypoint.

Reads saved but unopened items from Turso library_mirror, summarizes them
with a single tool-less LLM call, and sends one email via AgentMail.

Usage:
    python -m notifier.digest
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime
from typing import Any

from notifier.db import TursoDB
from notifier.llm import generate_completion
from notifier.mailer import Mailer, get_configured_timezone

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("amethyst.notifier.digest")


def _format_fallback_digest(items: list[dict[str, Any]]) -> str:
    """Deterministic fallback format when LLM is unavailable."""
    lines = [
        f"# 📚 Weekly Library Digest ({len(items)} unread items)",
        "",
        "Here are the items you saved recently that you haven't opened yet:",
        "",
    ]
    for it in items:
        title = it.get("title") or "Untitled item"
        url = it.get("url")
        link = f"[{title}]({url})" if url else f"**{title}**"
        saved = (it.get("saved_at") or "")[:10]
        lines.append(f"- {link} *(Saved on {saved})*")

    lines.extend([
        "",
        "---",
        "Tip: Open these on your desktop or laptop when you have downtime.",
    ])
    return "\n".join(lines)


def run_digest(db: TursoDB | None = None, mailer: Mailer | None = None) -> int:
    """Execute weekly library digest."""
    db = db or TursoDB()
    mailer = mailer or Mailer(db=db)

    try:
        db.ensure_schema()
    except Exception as exc:
        log.warning("Could not ensure DB schema: %s", exc)

    items = db.get_unopened_library_items(limit=30)
    if not items:
        log.info("No unopened items in library_mirror. Digest email skipped.")
        return 0

    log.info("Found %d unopened items in library_mirror for digest", len(items))

    # Single tool-less LLM call for one-line summaries
    system_prompt = (
        "You are an assistant preparing an inspiring, concise weekly reading digest email. "
        "For each saved item, provide a punchy one-line summary or key reason to read/watch it. "
        "Format as clean GitHub-flavored markdown with bullet points and links."
    )
    user_prompt = (
        f"Items saved in library:\n"
        + "\n".join([f"- Title: {it.get('title')}, URL: {it.get('url')}, Saved: {it.get('saved_at')}" for it in items])
    )

    digest_text = generate_completion(system_prompt, user_prompt, max_tokens=700)
    if not digest_text:
        digest_text = _format_fallback_digest(items)

    tz = get_configured_timezone()
    week_str = datetime.now(tz).strftime("Week of %B %d")
    subject = f"Weekly Library Digest — {len(items)} Items ({week_str})"

    res = mailer.send_email(
        subject=subject,
        text=digest_text,
        urgent=False,
    )

    log.info("Digest mailer status: %s (sent=%s)", res.status, res.sent)
    return 0 if (res.sent or res.status == "queued_quiet_hours") else 1


def main() -> None:
    code = run_digest()
    sys.exit(code)


if __name__ == "__main__":
    main()
