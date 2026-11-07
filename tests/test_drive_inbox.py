"""Tests for Google Drive inbox job pickup via Composio."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend.config import DriveInboxSettings
from backend.drive.inbox import (
    ComposioDriveClient,
    DriveInboxError,
    DriveInboxPoller,
)
from backend.jobs import JobStore
from backend.library.service import Captured


class FakeComposioClient:
    """In-memory simulation of Google Drive accessed through Composio."""

    def __init__(self, root_id: str = "root_1", inbox_id: str = "inbox_1") -> None:
        self.root_id = root_id
        self.inbox_id = inbox_id
        self.summaries_id = "summaries_1"
        self.done_id = "done_1"

        # file_id -> {"id", "name", "content": bytes, "parents": list[str]}
        self.files: dict[str, dict] = {}
        # path -> folder_id
        self.subfolders: dict[str, str] = {
            f"{root_id}/summaries": self.summaries_id,
            f"{inbox_id}/done": self.done_id,
        }
        self.fail_error: Exception | None = None
        self.call_history: list[str] = []

    def seed_job(
        self,
        job_id: str,
        kind: str = "url",
        url: str | None = None,
        text: str | None = None,
        created_at: str | None = "2026-11-07T12:00:00Z",
    ) -> str:
        payload = {
            "id": job_id,
            "kind": kind,
            "url": url,
            "text": text,
            "created_at": created_at,
            "source": "phone",
        }
        file_id = f"file_{job_id}"
        self.files[file_id] = {
            "id": file_id,
            "name": f"{job_id}.json",
            "content": json.dumps(payload).encode("utf-8"),
            "parents": [self.inbox_id],
            "mimeType": "application/json",
        }
        return file_id

    async def list_inbox_files(self, inbox_folder_id: str) -> list[dict]:
        self.call_history.append("list_inbox_files")
        if self.fail_error:
            raise self.fail_error
        res = []
        for f in self.files.values():
            if inbox_folder_id in f.get("parents", []) and f["name"].endswith(".json"):
                res.append({"id": f["id"], "name": f["name"], "mimeType": f["mimeType"]})
        return res

    async def download_job(self, file_id: str) -> dict:
        self.call_history.append(f"download_job:{file_id}")
        if self.fail_error:
            raise self.fail_error
        f = self.files.get(file_id)
        if not f:
            raise DriveInboxError(f"File not found: {file_id}")
        return json.loads(f["content"].decode("utf-8"))

    async def ensure_subfolder(self, name: str, parent_id: str) -> str:
        key = f"{parent_id}/{name}"
        if key not in self.subfolders:
            self.subfolders[key] = f"folder_{name}_{parent_id}"
        return self.subfolders[key]

    async def write_summary(
        self,
        root_folder_id: str,
        job_id: str,
        content: str,
        summaries_folder_id: str | None = None,
    ) -> str:
        self.call_history.append(f"write_summary:{job_id}")
        if self.fail_error:
            raise self.fail_error
        target_folder = summaries_folder_id or await self.ensure_subfolder("summaries", root_folder_id)
        file_id = f"summary_{job_id}"
        self.files[file_id] = {
            "id": file_id,
            "name": f"{job_id}.md",
            "content": content.encode("utf-8"),
            "parents": [target_folder],
            "mimeType": "text/markdown",
        }
        return file_id

    async def move_job_to_done(
        self,
        file_id: str,
        file_name: str,
        inbox_folder_id: str,
        done_folder_id: str | None = None,
        job_content: bytes | None = None,
    ) -> None:
        self.call_history.append(f"move_job_to_done:{file_id}")
        if self.fail_error:
            raise self.fail_error
        target_done = done_folder_id or await self.ensure_subfolder("done", inbox_folder_id)
        f = self.files.get(file_id)
        if f:
            f["parents"] = [target_done]
        else:
            self.files[file_id] = {
                "id": file_id,
                "name": file_name,
                "content": job_content or b"{}",
                "parents": [target_done],
                "mimeType": "application/json",
            }


class FakeLibraryService:
    def __init__(self) -> None:
        self.captures: list[dict] = []
        self.enrichments: list[int] = []

    async def capture_url(self, url: str, kind: str | None = None, notes: str | None = None, source_ref: str | None = None) -> Captured:
        item_id = len(self.captures) + 1
        item = {
            "id": item_id,
            "title": f"Captured from {url}",
            "url": url,
            "kind": kind or "article",
            "notes": notes,
            "summary": "Auto summary for " + url,
            "status": "ready",
            "source_ref": source_ref,
        }
        self.captures.append(item)
        return Captured(item)

    async def log_manual(self, title: str, text: str, notes: str | None = None, source_ref: str | None = None) -> Captured:
        item_id = len(self.captures) + 1
        item = {
            "id": item_id,
            "title": title,
            "text": text,
            "kind": "note",
            "notes": notes,
            "summary": "Summary of manual text: " + text[:50],
            "status": "ready",
            "source_ref": source_ref,
        }
        self.captures.append(item)
        return Captured(item)

    async def enrich(self, item_id: int) -> dict:
        self.enrichments.append(item_id)
        for c in self.captures:
            if c["id"] == item_id:
                c["summary"] = f"Enriched detailed summary for {item_id}"
                return c
        return {"id": item_id, "summary": f"Enriched summary for {item_id}"}


@pytest.fixture
def poller_setup(amethyst_home):
    client = FakeComposioClient()
    library = FakeLibraryService()
    job_store = JobStore()
    settings = DriveInboxSettings(
        root_folder_id="root_1",
        inbox_folder_id="inbox_1",
        enabled=True,
        min_poll_seconds=120.0,
        max_poll_seconds=300.0,
    )
    poller = DriveInboxPoller(
        client=client,
        library=library,
        job_store=job_store,
        settings_loader=lambda: settings,
        min_poll_seconds=120.0,
        max_poll_seconds=300.0,
    )
    return poller, client, library, job_store


@pytest.mark.asyncio
async def test_empty_inbox_backs_off(poller_setup):
    poller, client, library, _ = poller_setup
    assert poller._current_interval == 120.0

    # 1. First tick on empty inbox
    processed = await poller.tick()
    assert processed == 0
    assert poller._current_interval == 180.0  # 120 * 1.5

    # 2. Advance time and tick again
    poller._next_poll = 0.0
    await poller.tick()
    assert poller._current_interval == 270.0  # 180 * 1.5

    # 3. Third tick caps at max_poll_seconds (300.0)
    poller._next_poll = 0.0
    await poller.tick()
    assert poller._current_interval == 300.0


@pytest.mark.asyncio
async def test_job_pickup_url_and_video(poller_setup):
    poller, client, library, job_store = poller_setup

    client.seed_job("job_url", kind="url", url="https://example.com/test", text="read later")
    client.seed_job("job_video", kind="video", url="https://instagram.com/reel/123", text="look at this reel")

    processed = await poller.tick()
    assert processed == 2
    assert len(library.captures) == 2

    # Check summaries created in fake Drive
    assert "summary_job_url" in client.files
    url_summary = client.files["summary_job_url"]["content"].decode("utf-8")
    assert "# Captured from https://example.com/test" in url_summary
    assert "https://example.com/test" in url_summary
    assert "## Summary" in url_summary

    assert "summary_job_video" in client.files
    video_summary = client.files["summary_job_video"]["content"].decode("utf-8")
    assert "https://instagram.com/reel/123" in video_summary

    # Check files moved to done/
    assert client.files["file_job_url"]["parents"] == [client.done_id]
    assert client.files["file_job_video"]["parents"] == [client.done_id]

    # Check JobStore recorded completed
    rec_url = job_store.by_key("drive_inbox:job_url")
    assert rec_url is not None
    assert rec_url.state == "completed"

    # Interval resets to min_poll_seconds after processing jobs
    assert poller._current_interval == 120.0


@pytest.mark.asyncio
async def test_job_pickup_text(poller_setup):
    poller, client, library, job_store = poller_setup

    client.seed_job("job_text", kind="text", text="Meeting notes: ship self-hosted Amethyst")

    processed = await poller.tick()
    assert processed == 1
    assert len(library.captures) == 1

    assert "summary_job_text" in client.files
    text_summary = client.files["summary_job_text"]["content"].decode("utf-8")
    assert "Meeting notes: ship self-hosted Amethyst" in text_summary
    assert client.files["file_job_text"]["parents"] == [client.done_id]


@pytest.mark.asyncio
async def test_idempotency_prevents_duplicate_processing(poller_setup):
    poller, client, library, job_store = poller_setup

    client.seed_job("job_dup", kind="url", url="https://example.com/once")

    # First tick processes the job
    processed1 = await poller.tick()
    assert processed1 == 1
    assert len(library.captures) == 1

    # Simulate double-read: job file is re-introduced in inbox folder with same job_id
    client.files["file_job_dup"]["parents"] = [client.inbox_id]

    poller._next_poll = 0.0
    processed2 = await poller.tick()
    assert processed2 == 1  # Handled, but without running pipeline again
    assert len(library.captures) == 1  # No duplicate capture in library!
    assert client.files["file_job_dup"]["parents"] == [client.done_id]


@pytest.mark.asyncio
async def test_error_backoff_with_jitter_no_tight_loop(poller_setup):
    poller, client, _, _ = poller_setup

    # Inject failure
    client.fail_error = DriveInboxError("Composio API rate limit 429")

    processed = await poller.tick()
    assert processed == 0
    assert poller._consecutive_errors == 1

    # Delay must be at least 30s (no tight loop!)
    assert poller._current_interval >= 30.0

    # Advance and fail again
    poller._next_poll = 0.0
    await poller.tick()
    assert poller._consecutive_errors == 2
    assert poller._current_interval > 30.0

    # Next attempt succeeds
    client.fail_error = None
    poller._next_poll = 0.0
    await poller.tick()
    assert poller._consecutive_errors == 0


@pytest.mark.asyncio
async def test_nudge_resets_poll_interval(poller_setup):
    poller, _, _, _ = poller_setup
    poller._current_interval = 300.0
    poller._next_poll = 999999.0

    poller.nudge()
    assert poller._current_interval == 120.0
    assert poller._next_poll == 0.0


@pytest.mark.asyncio
async def test_runner_integration_prefers_drive_inbox_over_relay(amethyst_home):
    from backend.instagram.runner import InstagramRunner

    client = FakeComposioClient()
    client.seed_job("job_runner", kind="url", url="https://example.com/runner")

    settings = DriveInboxSettings(
        root_folder_id="root_1",
        inbox_folder_id="inbox_1",
        enabled=True,
        min_poll_seconds=120.0,
        max_poll_seconds=300.0,
    )
    poller = DriveInboxPoller(
        client=client,
        library=FakeLibraryService(),
        job_store=JobStore(),
        settings_loader=lambda: settings,
    )

    runner = InstagramRunner(drive_inbox=poller)
    runner._maybe_sync_relay = AsyncMock()

    # Tick runner
    await runner.tick()

    # Drive inbox poller was called and processed the job
    assert "summary_job_runner" in client.files
    # Relay sync was NOT called because Drive inbox is configured and took precedence!
    runner._maybe_sync_relay.assert_not_called()


@pytest.mark.asyncio
async def test_runner_integration_no_relay_fallback_when_drive_unconfigured(amethyst_home):
    from backend.config import save_instagram
    from backend.instagram import signature
    from backend.instagram.runner import InstagramRunner

    signature.set_credentials(app_secret="sec", verify_token="v", access_token="tok")
    save_instagram({"enabled": True})

    unconfigured_settings = DriveInboxSettings(
        root_folder_id="",
        inbox_folder_id="",
        enabled=False,
    )
    poller = DriveInboxPoller(
        client=FakeComposioClient(),
        settings_loader=lambda: unconfigured_settings,
    )

    runner = InstagramRunner(drive_inbox=poller)
    # Confirms runner has no relay poller and falls back to nothing relay-related
    assert not hasattr(runner, "_relay")
    result = await runner.tick()
    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_crash_recovery_mid_job(poller_setup):
    """Simulate killing the process right after writing summary, before moving to done."""
    poller, client, library, job_store = poller_setup

    client.seed_job("job_crash", kind="url", url="https://example.com/crash-test")

    # Hook move_job_to_done to crash
    original_move = client.move_job_to_done
    crash_called = False

    async def _crashing_move(*args, **kwargs):
        nonlocal crash_called
        crash_called = True
        raise RuntimeError("Process killed abruptly mid-job!")

    client.move_job_to_done = _crashing_move

    # Run tick, which crashes on move
    with pytest.raises(RuntimeError, match="Process killed abruptly mid-job!"):
        await poller._poll_and_drain(poller._settings_loader())

    assert crash_called is True
    # Summary was already written
    assert "summary_job_crash" in client.files
    # Library captured exactly once
    assert len(library.captures) == 1
    # File is still in inbox because move failed
    assert client.files["file_job_crash"]["parents"] == [client.inbox_id]

    # Now restore normal client (simulating restart after crash)
    client.move_job_to_done = original_move
    poller._next_poll = 0.0

    # Next tick runs recovery
    processed = await poller._poll_and_drain(poller._settings_loader())
    assert processed == 1

    # Library capture was NOT called again (still 1!)
    assert len(library.captures) == 1
    # File is now moved to done/
    assert client.files["file_job_crash"]["parents"] == [client.done_id]
    # Job is completed
    rec = job_store.by_key("drive_inbox:job_crash")
    assert rec is not None
    assert rec.state == "completed"


@pytest.mark.asyncio
async def test_composio_daily_calls_tracking(poller_setup):
    from backend.drive.inbox import get_composio_calls_today, record_composio_call

    initial = get_composio_calls_today()
    record_composio_call("test_action_1")
    record_composio_call("test_action_2")

    current = get_composio_calls_today()
    assert current == initial + 2
