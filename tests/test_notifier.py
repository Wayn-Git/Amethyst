"""Unit tests for the Amethyst Notifier subsystem.

Covers:
- Daily cap enforcement (counted in Turso)
- Quiet-hours queuing and urgent override
- Deduplication of fetched items
- Connector-failure fallback (brief still delivers with warnings)
- Library-save hook debounce and batching
"""

from __future__ import annotations

import asyncio
from datetime import datetime, time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from notifier.brief import run_briefing
from notifier.connectors import ConnectorResult
from notifier.db import TursoDB
from notifier.library_hook import (
    _BATCH,
    flush_library_batch,
    on_library_item_saved,
)
from notifier.mailer import Mailer, SendResult, is_quiet_hours


@pytest.fixture
def mock_db() -> TursoDB:
    """In-memory TursoDB for hermetic testing."""
    db = TursoDB(":memory:")
    db.ensure_schema()
    return db


# ==============================================================================
# 1. Daily Cap Enforcement
# ==============================================================================

def test_daily_cap_enforcement(mock_db: TursoDB) -> None:
    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        daily_cap=3,
        db=mock_db,
    )

    with patch.object(mailer, "_send_agentmail", return_value="msg_123") as mock_send, \
         patch("notifier.mailer.is_quiet_hours", return_value=False):
        # 1st send
        res1 = mailer.send_email("Subject 1", "Body 1")
        assert res1.sent is True
        assert res1.status == "sent"
        assert mock_send.call_count == 1

        # 2nd send
        res2 = mailer.send_email("Subject 2", "Body 2")
        assert res2.sent is True
        assert mock_send.call_count == 2

        # 3rd send (hits limit of 3)
        res3 = mailer.send_email("Subject 3", "Body 3")
        assert res3.sent is True
        assert mock_send.call_count == 3

        # 4th send (exceeds cap)
        res4 = mailer.send_email("Subject 4", "Body 4")
        assert res4.sent is False
        assert res4.status == "daily_cap_exceeded"
        assert "Daily send cap" in (res4.reason or "")
        # Ensure underlying send was NOT invoked for 4th
        assert mock_send.call_count == 3


# ==============================================================================
# 2. Quiet Hours Queuing
# ==============================================================================

def test_quiet_hours_queuing_and_urgent_override(mock_db: TursoDB) -> None:
    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        daily_cap=80,
        db=mock_db,
    )

    with patch.object(mailer, "_send_agentmail", return_value="msg_urgent") as mock_send, \
         patch("notifier.mailer.is_quiet_hours", return_value=True):
        # Non-urgent email during quiet hours -> should queue
        res_non_urgent = mailer.send_email("Daily Briefing", "Quiet content", urgent=False)
        assert res_non_urgent.sent is False
        assert res_non_urgent.status == "queued_quiet_hours"
        assert mock_send.call_count == 0

        # Check Turso queued_emails table
        queued = mock_db.execute("SELECT * FROM queued_emails")
        assert len(queued) == 1
        assert queued[0]["subject"] == "Daily Briefing"

        # Urgent email during quiet hours -> should send immediately
        res_urgent = mailer.send_email("Critical Alert", "Wake up!", urgent=True)
        assert res_urgent.sent is True
        assert res_urgent.status == "sent"
        assert mock_send.call_count == 1


def test_quiet_hours_flush_when_active_vs_cleared(mock_db: TursoDB) -> None:
    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        daily_cap=80,
        db=mock_db,
    )

    with patch("notifier.mailer.is_quiet_hours", return_value=True):
        mailer.send_email("Morning Brief", "Queued 1", urgent=False)

    assert len(mock_db.execute("SELECT * FROM queued_emails")) == 1

    # While still in quiet hours, flush does nothing
    with patch("notifier.mailer.is_quiet_hours", return_value=True):
        flushed = mailer.flush_queued_emails()
        assert flushed == 0
        assert len(mock_db.execute("SELECT * FROM queued_emails")) == 1

    # Once quiet hours are over, flush delivers queued mail
    with patch.object(mailer, "_send_agentmail", return_value="msg_flushed") as mock_send, \
         patch("notifier.mailer.is_quiet_hours", return_value=False):
        flushed = mailer.flush_queued_emails()
        assert flushed == 1
        assert mock_send.call_count == 1
        assert len(mock_db.execute("SELECT * FROM queued_emails")) == 0


# ==============================================================================
# 3. Deduplication in Briefing Job
# ==============================================================================

@pytest.mark.asyncio
async def test_deduplication_in_briefing(mock_db: TursoDB) -> None:
    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        db=mock_db,
    )

    fake_gmail_items = [
        {"id": "gmail:msg_001", "source": "gmail", "title": "Invoice Q3", "sender": "billing@corp.com", "snippet": "Attached"},
        {"id": "gmail:msg_002", "source": "gmail", "title": "Team Standup", "sender": "manager@corp.com", "snippet": "Notes"},
    ]
    fake_cal_items = [
        {"id": "calendar:ev_001", "source": "calendar", "title": "Project Review", "start": "10:00", "end": "11:00", "conflict": False},
    ]

    with patch("notifier.brief.fetch_gmail", return_value=ConnectorResult("Gmail", True, fake_gmail_items)), \
         patch("notifier.brief.fetch_calendar", return_value=ConnectorResult("Google Calendar", True, fake_cal_items)), \
         patch("notifier.brief.fetch_discord", return_value=ConnectorResult("Discord", True, [])), \
         patch("notifier.brief.generate_completion", return_value="Mocked AI Briefing summary"), \
         patch.object(mailer, "_send_agentmail", return_value="brief_123"), \
         patch("notifier.mailer.is_quiet_hours", return_value=False):

        # First run: should notify both emails and calendar event
        code1 = await run_briefing(db=mock_db, mailer=mailer)
        assert code1 == 0

        # Verify items were recorded in notified_items
        notified = mock_db.execute("SELECT id FROM notified_items")
        assert len(notified) == 3
        ids = {r["id"] for r in notified}
        assert "gmail:msg_001" in ids
        assert "gmail:msg_002" in ids
        assert "calendar:ev_001" in ids

        # Second run: same items returned by connectors
        # They must be deduplicated out
        with patch("notifier.brief.generate_completion") as mock_llm:
            mock_llm.return_value = "All caught up"
            code2 = await run_briefing(db=mock_db, mailer=mailer)
            assert code2 == 0

            # Inspect what payload was passed to the LLM in the 2nd run
            call_args = mock_llm.call_args[0]
            user_prompt = call_args[1]
            # Since items were deduplicated, emails and calendar lists in payload should be empty
            assert "'emails': []" in user_prompt
            assert "'calendar_today': []" in user_prompt


# ==============================================================================
# 4. Connector Failure Fallback (Brief Still Sends)
# ==============================================================================

@pytest.mark.asyncio
async def test_connector_failure_fallback(mock_db: TursoDB) -> None:
    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        db=mock_db,
    )

    fake_cal_items = [
        {"id": "calendar:ev_999", "source": "calendar", "title": "Dentist", "start": "14:00", "end": "15:00", "conflict": False},
    ]

    # Gmail fails, Discord fails with exception, Calendar succeeds
    with patch("notifier.brief.fetch_gmail", return_value=ConnectorResult("Gmail", False, [], "401 Unauthorized")), \
         patch("notifier.brief.fetch_calendar", return_value=ConnectorResult("Google Calendar", True, fake_cal_items)), \
         patch("notifier.brief.fetch_discord", side_effect=RuntimeError("Discord API connection timeout")), \
         patch("notifier.brief.generate_completion", return_value=None), \
         patch.object(mailer, "_send_agentmail", return_value="sent_with_warnings") as mock_send, \
         patch("notifier.mailer.is_quiet_hours", return_value=False):

        code = await run_briefing(db=mock_db, mailer=mailer)
        assert code == 0
        assert mock_send.call_count == 1

        # Check content passed to _send_agentmail
        call_kwargs = mock_send.call_args[1]
        text = call_kwargs["text"]

        # Must include "couldn't reach" line for both failed connectors
        assert "Couldn't reach Gmail: 401 Unauthorized" in text
        assert "Couldn't reach Discord: Discord API connection timeout" in text
        # And must still include the successful calendar event
        assert "Dentist" in text


# ==============================================================================
# 5. Library-Save Hook Debounce & Batching
# ==============================================================================

def test_library_save_hook_batching(mock_db: TursoDB) -> None:
    from notifier import library_hook

    # Clear batch state
    library_hook._BATCH.clear()
    if library_hook._TIMER:
        library_hook._TIMER.cancel()
        library_hook._TIMER = None

    mock_mailer = MagicMock()
    mock_mailer.send_email.return_value = SendResult(sent=True, status="sent")

    # Simulate saving 5 items within the 10-minute window
    with patch("notifier.library_hook.TursoDB", return_value=mock_db):
        for i in range(1, 6):
            on_library_item_saved(
                item_id=i,
                title=f"Article #{i}",
                url=f"https://example.com/article/{i}",
                kind="article",
                db=mock_db,
            )

    # Allow background threads to mirror to mock_db
    import time
    time.sleep(0.15)

    # Check that all 5 items were mirrored to Turso
    mirrored = mock_db.execute("SELECT id, title, url FROM library_mirror ORDER BY id")
    assert len(mirrored) == 5
    assert mirrored[0]["title"] == "Article #1"
    assert mirrored[4]["title"] == "Article #5"

    # Verify that exactly 5 items are in the batch
    assert len(library_hook._BATCH) == 5

    # Flush the batch
    flushed_count = flush_library_batch(mailer=mock_mailer)
    assert flushed_count == 5

    # Exactly ONE email was sent for all 5 items
    assert mock_mailer.send_email.call_count == 1
    call_args = mock_mailer.send_email.call_args[1]
    subject = call_args["subject"]
    body = call_args["text"]

    assert "You saved 5 items to your library" in subject
    assert "You saved 5 items, want to look at them on your laptop?" in body
    for i in range(1, 6):
        assert f"Article #{i}" in body
        assert f"https://example.com/article/{i}" in body

    # Batch is now empty
    assert len(library_hook._BATCH) == 0


# ==============================================================================
# 6. Weekly Library Digest
# ==============================================================================

def test_weekly_library_digest(mock_db: TursoDB) -> None:
    from notifier.digest import run_digest

    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        db=mock_db,
    )

    # Insert 3 unopened items into library_mirror
    mock_db.insert_library_mirror(item_id=101, title="AI Architecture 2026", url="https://example.com/ai")
    mock_db.insert_library_mirror(item_id=102, title="Postgres Deep Dive", url="https://example.com/pg")
    mock_db.insert_library_mirror(item_id=103, title="Designing Data Systems", url="https://example.com/data")

    with patch("notifier.digest.generate_completion", return_value="AI Generated One-Line Summaries for 3 items"), \
         patch.object(mailer, "_send_agentmail", return_value="digest_msg_001") as mock_send, \
         patch("notifier.mailer.is_quiet_hours", return_value=False):

        code = run_digest(db=mock_db, mailer=mailer)
        assert code == 0
        assert mock_send.call_count == 1

        call_args = mock_send.call_args[1]
        assert "Weekly Library Digest — 3 Items" in call_args["subject"]
        assert "AI Generated One-Line Summaries" in call_args["text"]


def test_weekly_library_digest_empty(mock_db: TursoDB) -> None:
    from notifier.digest import run_digest

    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        db=mock_db,
    )

    with patch.object(mailer, "_send_agentmail") as mock_send:
        # No items in library_mirror -> should skip sending email
        code = run_digest(db=mock_db, mailer=mailer)
        assert code == 0
        assert mock_send.call_count == 0


# ==============================================================================
# 7. Pluggable Connector Registry
# ==============================================================================

@pytest.mark.asyncio
async def test_dynamic_connector_registration(mock_db: TursoDB) -> None:
    from notifier.connectors import register_connector

    mailer = Mailer(
        api_key="test_key",
        inbox_id="test_inbox",
        recipient="user@example.com",
        db=mock_db,
    )

    # Register a new custom app (e.g. Linear) on the fly
    @register_connector("linear")
    async def mock_linear_connector() -> ConnectorResult:
        return ConnectorResult(
            name="Linear",
            success=True,
            items=[{"id": "linear:lin_101", "source": "linear", "title": "Fix memory leak in parser"}],
        )

    with patch("notifier.brief.fetch_gmail", return_value=ConnectorResult("Gmail", True, [])), \
         patch("notifier.brief.fetch_calendar", return_value=ConnectorResult("Google Calendar", True, [])), \
         patch("notifier.brief.fetch_discord", return_value=ConnectorResult("Discord", True, [])), \
         patch.dict("os.environ", {"NOTIFIER_ENABLED_CONNECTORS": "gmail,calendar,discord,linear"}), \
         patch("notifier.brief.generate_completion") as mock_llm, \
         patch.object(mailer, "_send_agentmail", return_value="sent_linear"), \
         patch("notifier.mailer.is_quiet_hours", return_value=False):

        mock_llm.return_value = "Brief with Linear issue"
        code = await run_briefing(db=mock_db, mailer=mailer)
        assert code == 0

        # Verify linear item was included in payload passed to LLM
        prompt_passed = mock_llm.call_args[0][1]
        assert "linear" in prompt_passed
        assert "Fix memory leak in parser" in prompt_passed

        # Verify linear item was recorded in Turso dedupe table
        recorded = mock_db.execute("SELECT id FROM notified_items WHERE id = 'linear:lin_101'")
        assert len(recorded) == 1


def test_email_templates_render() -> None:
    from notifier.templates import (
        render_base_card,
        render_library_batch_html,
        render_briefing_html,
        render_digest_html,
        render_test_verification_html,
    )

    # 1. Library batch
    items = [{"title": "PostgreSQL Tutorial", "url": "https://example.com/pg", "kind": "article"}]
    lib_html = render_library_batch_html(items)
    assert "PostgreSQL Tutorial" in lib_html
    assert "https://example.com/pg" in lib_html
    assert "max-width: 600px" in lib_html

    # 2. Briefing
    brief_text = "> ⚠️ Gmail service down\n### Schedule\n- Team sync (10:00)\n- [Review PR](https://github.com/pr/1)"
    brief_html = render_briefing_html(brief_text, "Monday, Oct 31")
    assert "Gmail service down" in brief_html
    assert "Schedule" in brief_html
    assert "Team sync" in brief_html
    assert "Review PR" in brief_html

    # 3. Digest
    digest_text = "- [Amethyst Arch](https://example.com/doc) *(Saved on 2026-10-25)*"
    digest_html = render_digest_html(items, digest_text, "Week of October 31")
    assert "Weekly Library Digest" in digest_html
    assert "Amethyst Arch" in digest_html

    # 4. Test verification
    test_html = render_test_verification_html()
    assert "AgentMail" in test_html
    assert "Turso Cloud DB" in test_html



