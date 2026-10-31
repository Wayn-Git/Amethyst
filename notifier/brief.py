"""Standalone Morning Briefing Entrypoint.

Fetches Gmail, Google Calendar, and Discord in parallel using direct API/Composio calls.
Deduplicates against Turso cloud DB, summarizes via a single tool-less LLM call,
sends via AgentMail, and records notified IDs.

Usage:
    python -m notifier.brief
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime
from typing import Any

from notifier.connectors import (
    ConnectorResult,
    fetch_calendar,
    fetch_discord,
    fetch_gmail,
    fetch_whatsapp,
)
from notifier.db import TursoDB
from notifier.llm import generate_completion
from notifier.mailer import Mailer, get_configured_timezone

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("amethyst.notifier.brief")


def _format_fallback_briefing(
    emails: list[dict[str, Any]],
    events: list[dict[str, Any]],
    discord: list[dict[str, Any]],
    errors: list[str],
) -> str:
    """Deterministic fallback briefing when LLM is unavailable."""
    lines = ["# ☀️ Daily Briefing", ""]

    if errors:
        lines.append("### ⚠️ Service Notices")
        for err in errors:
            lines.append(f"- {err}")
        lines.append("")

    lines.append("### 📩 Who's Waiting on a Reply")
    if emails:
        for m in emails:
            lines.append(f"- **{m.get('sender', 'Unknown')}**: {m.get('title', '')} — {m.get('snippet', '')[:100]}...")
    else:
        lines.append("- No pending unreplied emails.")
    lines.append("")

    if discord:
        lines.append("### 💬 Discord Mentions")
        for d in discord:
            lines.append(f"- **{d.get('author', 'User')}**: {d.get('snippet', '')[:100]}...")
        lines.append("")

    lines.append("### 📅 Today's Schedule")
    if events:
        for ev in events:
            conflict_tag = " ⚠️ [CONFLICT]" if ev.get("conflict") else ""
            lines.append(f"- **{ev.get('title', 'Event')}** ({ev.get('start', '')} - {ev.get('end', '')}){conflict_tag}")
    else:
        lines.append("- Your calendar is clear today.")
    lines.append("")

    lines.append("### 🎯 Suggested Actions")
    if emails:
        lines.append(f"- Reply to email from {emails[0].get('sender', 'sender')}")
    if any(ev.get("conflict") for ev in events):
        lines.append("- Reschedule overlapping calendar conflicts")
    if not emails and not events:
        lines.append("- Focus on deep work or review saved library items")
    else:
        lines.append("- Review and clear urgent inbox messages")

    return "\n".join(lines)


async def run_briefing(db: TursoDB | None = None, mailer: Mailer | None = None) -> int:
    """Execute the briefing flow end-to-end."""
    db = db or TursoDB()
    mailer = mailer or Mailer(db=db)

    # 1. Ensure DB schema and purge records older than 30 days
    try:
        db.ensure_schema()
        db.purge_old_notified_items(days=30)
    except Exception as exc:
        log.warning("Could not initialize Turso state: %s", exc)

    from notifier.connectors import CONNECTOR_REGISTRY, get_enabled_connector_names

    enabled_names = get_enabled_connector_names()
    coros = [fetch_gmail(), fetch_calendar(), fetch_discord()]
    names = ["Gmail", "Google Calendar", "Discord"]

    for c_name in enabled_names:
        if c_name not in ("gmail", "calendar", "discord") and c_name in CONNECTOR_REGISTRY:
            coros.append(CONNECTOR_REGISTRY[c_name]())
            names.append(c_name.capitalize())

    log.info("Fetching connectors (%s) in parallel...", ", ".join(names))

    # 2. Parallel connector fetches with isolated error handling
    raw_results = await asyncio.gather(*coros, return_exceptions=True)

    connector_results: list[ConnectorResult] = []
    for i, res in enumerate(raw_results):
        if isinstance(res, Exception):
            connector_results.append(
                ConnectorResult(name=names[i], success=False, error_message=str(res))
            )
        elif isinstance(res, ConnectorResult):
            connector_results.append(res)
        else:
            connector_results.append(
                ConnectorResult(name=names[i], success=False, error_message="Unknown connector error")
            )

    # 3. Separate successful items and failed notices
    errors: list[str] = []
    all_new_items: list[dict[str, Any]] = []
    gmail_items: list[dict[str, Any]] = []
    calendar_items: list[dict[str, Any]] = []
    discord_items: list[dict[str, Any]] = []
    other_items: dict[str, list[dict[str, Any]]] = {}

    for cr in connector_results:
        if not cr.success:
            errors.append(f"Couldn't reach {cr.name}: {cr.error_message}")
        else:
            # Deduplicate against Turso
            item_ids = [it["id"] for it in cr.items if "id" in it]
            unnotified_ids = set(db.filter_unnotified_items(item_ids))
            filtered = [it for it in cr.items if it.get("id") in unnotified_ids]

            if cr.name == "Gmail":
                gmail_items = filtered
            elif cr.name == "Google Calendar":
                calendar_items = filtered
            elif cr.name == "Discord":
                discord_items = filtered
            else:
                other_items[cr.name] = filtered

            all_new_items.extend(filtered)

    log.info(
        "Fetched items (after deduplication): %d emails, %d calendar events, %d discord messages, %d other (%d errors)",
        len(gmail_items),
        len(calendar_items),
        len(discord_items),
        sum(len(v) for v in other_items.values()),
        len(errors),
    )

    # 4. Prepare prompt for single tool-less LLM call
    system_prompt = (
        "You are an executive assistant preparing a concise, structured morning briefing email. "
        "Keep the tone direct, professional, and under 300 words. "
        "Structure your response strictly into three sections:\n"
        "1. Who's waiting on a reply (pending emails, mentions, messages)\n"
        "2. Today's schedule (including warnings for any overlapping conflicts)\n"
        "3. 2-3 suggested actions (actionable steps for today)\n"
        "Use GitHub-flavored markdown. Do not include markdown code block backticks around the email."
    )

    data_payload: dict[str, Any] = {
        "emails": [
            {"from": m.get("sender"), "subject": m.get("title"), "snippet": m.get("snippet", "")[:150]}
            for m in gmail_items
        ],
        "calendar_today": [
            {"summary": e.get("title"), "start": e.get("start"), "end": e.get("end"), "conflict": e.get("conflict")}
            for e in calendar_items
        ],
        "discord_mentions": [
            {"author": d.get("author"), "snippet": d.get("snippet", "")[:150]}
            for d in discord_items
        ],
    }
    for custom_name, c_items in other_items.items():
        data_payload[custom_name.lower()] = c_items

    user_prompt = f"Today's data:\n{data_payload}"
    briefing_text = generate_completion(system_prompt, user_prompt, max_tokens=650)

    # 5. Assemble final message (with deterministic fallback if LLM returned None)
    if not briefing_text:
        briefing_text = _format_fallback_briefing(
            emails=gmail_items,
            events=calendar_items,
            discord=discord_items,
            errors=errors,
        )
    elif errors:
        # Prepend connector failure warnings so user is informed
        notices = "\n".join([f"> ⚠️ {err}" for err in errors])
        briefing_text = f"{notices}\n\n{briefing_text}"

    # 6. Send via Mailer
    tz = get_configured_timezone()
    today_str = datetime.now(tz).strftime("%A, %b %d")
    subject = f"Morning Briefing — {today_str}"

    from notifier.templates import render_briefing_html
    html_body = render_briefing_html(briefing_text, today_str)

    res = mailer.send_email(
        subject=subject,
        text=briefing_text,
        html=html_body,
        urgent=False,
    )

    log.info("Mailer status: %s (sent=%s)", res.status, res.sent)

    # 7. Record notified items in Turso
    if res.sent or res.status == "queued_quiet_hours":
        to_record = [(it["id"], it.get("source", "generic"), None) for it in all_new_items if "id" in it]
        if to_record:
            try:
                db.record_notified_items(to_record)
                log.info("Recorded %d new item IDs into Turso notified_items", len(to_record))
            except Exception as exc:
                log.error("Failed to record notified items to Turso: %s", exc)

    return 0 if (res.sent or res.status == "queued_quiet_hours") else 1


def main() -> None:
    code = asyncio.run(run_briefing())
    sys.exit(code)


if __name__ == "__main__":
    main()
