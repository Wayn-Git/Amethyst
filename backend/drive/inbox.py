"""Google Drive Inbox Poller via Composio.

Picks up phone jobs from <root>/inbox/<id>.json in Google Drive,
runs the existing media/Instagram/url capture pipeline,
writes the generated summary to <root>/summaries/<id>.md,
and archives the job file to <root>/inbox/done/<id>.json.

All access goes through Composio. Idempotent by job id.
Backs off when inbox is empty (2 to 5 minutes) and uses
exponential backoff with jitter on network/Composio errors.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from datetime import datetime, timezone
from typing import Any, Callable

from backend.config import DriveInboxSettings, load_drive_inbox_settings
from backend.jobs import JobStore
from backend.library.service import LibraryService

log = logging.getLogger(__name__)

JOB_KIND = "drive_inbox"
DEFAULT_MIN_POLL_SECONDS = 120.0  # 2 minutes
DEFAULT_MAX_POLL_SECONDS = 300.0  # 5 minutes
MAX_ERROR_BACKOFF_SECONDS = 600.0  # 10 minutes
MIN_ERROR_WAIT_SECONDS = 30.0


def record_composio_call(action: str) -> int:
    """Record a Composio call for today in app_settings and return total calls today."""
    try:
        from backend.db.connection import get_connection

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"composio.calls.{today}"
        conn = get_connection()
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        count = int(row[0]) + 1 if row and row[0] else 1
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            (key, str(count)),
        )
        conn.commit()
        log.info("Composio call: %s (today's count for %s: %d)", action, today, count)
        return count
    except Exception as exc:
        log.debug("Could not record Composio call: %s", exc)
        return 0


def get_composio_calls_today(date_str: str | None = None) -> int:
    """Retrieve total recorded Composio calls for a given date (defaults to today)."""
    try:
        from backend.db.connection import get_connection

        target = date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"composio.calls.{target}"
        row = get_connection().execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return int(row[0]) if row and row[0] else 0
    except Exception:
        return 0


class DriveInboxError(Exception):
    """Base error for Drive inbox operations."""


class ComposioDriveClient:
    """Interacts with Google Drive via Composio bridge or custom executor."""

    def __init__(self, bridge: Any | None = None, action_executor: Callable | None = None) -> None:
        self._action_executor = action_executor
        if bridge is not None:
            self._bridge = bridge
        else:
            from backend.library.storage.gdrive_bridge import GoogleDriveBridge
            self._bridge = GoogleDriveBridge(action_executor=action_executor)

    async def list_inbox_files(self, inbox_folder_id: str) -> list[dict[str, Any]]:
        """List non-trashed JSON job files directly inside the inbox folder."""
        record_composio_call("list_inbox_files")
        query = f"'{inbox_folder_id}' in parents and trashed = false"
        try:
            if hasattr(self._bridge, "list_files_in_folder"):
                raw_files = await self._bridge.list_files_in_folder(inbox_folder_id)
            else:
                res = await self._bridge._execute("GOOGLEDRIVE_FIND_FILE", {"q": query})
                raw_files = res.get("files", []) if isinstance(res, dict) else []

            job_files: list[dict[str, Any]] = []
            for f in raw_files:
                if not isinstance(f, dict):
                    continue
                # Exclude subdirectories like done/
                if f.get("mimeType") == "application/vnd.google-apps.folder":
                    continue
                name = str(f.get("name") or "")
                if name.endswith(".json"):
                    job_files.append(f)
            return job_files
        except Exception as exc:
            raise DriveInboxError(f"Failed to list files in inbox {inbox_folder_id}: {exc}") from exc

    async def download_job(self, file_id: str) -> dict[str, Any]:
        """Download and parse a job JSON file from Google Drive."""
        record_composio_call("download_job")
        try:
            raw_bytes = await self._bridge.download_file(file_id)
            if isinstance(raw_bytes, str):
                text = raw_bytes
            elif isinstance(raw_bytes, (bytes, bytearray)):
                text = raw_bytes.decode("utf-8")
            elif isinstance(raw_bytes, dict):
                return raw_bytes
            else:
                raise ValueError(f"Unexpected response type: {type(raw_bytes)}")
            return json.loads(text)
        except Exception as exc:
            raise DriveInboxError(f"Failed to download job {file_id}: {exc}") from exc

    async def ensure_subfolder(self, name: str, parent_id: str) -> str:
        """Find or create a designated subfolder within parent_id."""
        record_composio_call(f"ensure_subfolder:{name}")
        try:
            if hasattr(self._bridge, "get_or_create_subfolder"):
                return await self._bridge.get_or_create_subfolder(name, parent_id)
            found = await self._bridge._find_folder(name, parent_id)
            if not found:
                found = await self._bridge._create_folder_direct(name, parent_id)
            return found
        except Exception as exc:
            raise DriveInboxError(f"Failed to ensure subfolder '{name}' under {parent_id}: {exc}") from exc

    async def write_summary(
        self,
        root_folder_id: str,
        job_id: str,
        content: str,
        summaries_folder_id: str | None = None,
    ) -> str:
        """Write completed summary markdown to <root>/summaries/<id>.md."""
        record_composio_call("write_summary")
        target_folder = summaries_folder_id or await self.ensure_subfolder("summaries", root_folder_id)
        filename = f"{job_id}.md"
        payload = content.encode("utf-8")
        try:
            res = await self._bridge.upload_file(
                name=filename,
                content=payload,
                mime_type="text/markdown",
                parent_id=target_folder,
            )
            return str(res.get("id") or "")
        except Exception as exc:
            raise DriveInboxError(f"Failed to write summary for {job_id}: {exc}") from exc

    async def move_job_to_done(
        self,
        file_id: str,
        file_name: str,
        inbox_folder_id: str,
        done_folder_id: str | None = None,
        job_content: bytes | None = None,
    ) -> None:
        """Move job file from inbox to inbox/done/."""
        record_composio_call("move_job_to_done")
        target_done = done_folder_id or await self.ensure_subfolder("done", inbox_folder_id)

        # 1. Try native update/move if supported
        try:
            await self._bridge._execute(
                "GOOGLEDRIVE_UPDATE_FILE",
                {
                    "file_id": file_id,
                    "add_parents": target_done,
                    "remove_parents": inbox_folder_id,
                },
            )
            return
        except Exception as exc:
            log.debug("Native move failed, falling back to copy+delete: %s", exc)

        # 2. Universal fallback: copy to done and delete from inbox
        try:
            content = job_content
            if content is None:
                content = await self._bridge.download_file(file_id)
                if isinstance(content, str):
                    content = content.encode("utf-8")

            await self._bridge.upload_file(
                name=file_name,
                content=content,
                mime_type="application/json",
                parent_id=target_done,
            )
            await self._bridge.delete_file(file_id)
        except Exception as exc:
            raise DriveInboxError(f"Failed to archive job {file_id} to done/: {exc}") from exc


class DriveInboxPoller:
    """Background task polling <root>/inbox via Composio."""

    def __init__(
        self,
        client: ComposioDriveClient | None = None,
        library: LibraryService | None = None,
        job_store: JobStore | None = None,
        settings_loader: Callable[[], DriveInboxSettings] | None = None,
        min_poll_seconds: float = DEFAULT_MIN_POLL_SECONDS,
        max_poll_seconds: float = DEFAULT_MAX_POLL_SECONDS,
    ) -> None:
        self.client = client or ComposioDriveClient()
        self._library = library
        self._job_store = job_store
        self._settings_loader = settings_loader or load_drive_inbox_settings
        self.min_poll_seconds = min_poll_seconds
        self.max_poll_seconds = max_poll_seconds

        self._current_interval: float = min_poll_seconds
        self._next_poll: float = 0.0
        self._consecutive_errors: int = 0
        self._wake: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None

        # Cached folder IDs to minimize round trips
        self._summaries_folder_id: str | None = None
        self._done_folder_id: str | None = None

    @property
    def library(self) -> LibraryService:
        if self._library is None:
            self._library = LibraryService()
        return self._library

    @property
    def job_store(self) -> JobStore:
        if self._job_store is None:
            self._job_store = JobStore()
        return self._job_store

    def nudge(self) -> None:
        """Trigger an immediate poll attempt."""
        self._next_poll = 0.0
        self._current_interval = self.min_poll_seconds
        if self._wake is not None:
            self._wake.set()

    def configured(self) -> bool:
        settings = self._settings_loader()
        return bool(settings.is_configured)

    async def tick(self) -> int:
        """One check of the Drive inbox. Returns count of jobs processed."""
        loop = asyncio.get_running_loop()
        now = loop.time()
        if now < self._next_poll:
            return 0

        settings = self._settings_loader()
        if not settings.is_configured:
            return 0

        self.min_poll_seconds = settings.min_poll_seconds
        self.max_poll_seconds = settings.max_poll_seconds

        lock = self._lock or asyncio.Lock()
        async with lock:
            try:
                processed = await self._poll_and_drain(settings)
                self._consecutive_errors = 0

                if processed > 0:
                    # Active work: reset to minimum poll interval
                    self._current_interval = self.min_poll_seconds
                else:
                    # Inbox empty: back off towards max_poll_seconds (e.g. 2m -> 5m)
                    self._current_interval = min(
                        self.max_poll_seconds,
                        max(self._current_interval * 1.5, self.min_poll_seconds),
                    )
                self._next_poll = loop.time() + self._current_interval
                return processed
            except Exception as exc:
                self._consecutive_errors += 1
                base_delay = min(
                    MAX_ERROR_BACKOFF_SECONDS,
                    self.min_poll_seconds * (1.5 ** min(self._consecutive_errors, 5)),
                )
                jitter = random.uniform(0.85, 1.15)
                self._current_interval = max(MIN_ERROR_WAIT_SECONDS, base_delay * jitter)
                self._next_poll = loop.time() + self._current_interval
                log.warning(
                    "Drive inbox poll failed (attempt %d): %s; backing off for %.1fs",
                    self._consecutive_errors,
                    exc,
                    self._current_interval,
                )
                return 0

    async def _poll_and_drain(self, settings: DriveInboxSettings) -> int:
        """List inbox, process jobs idempotently, write summaries, and archive."""
        root_folder_id = settings.root_folder_id
        inbox_folder_id = settings.inbox_folder_id

        # Resolve subfolder IDs once if not cached
        if not self._summaries_folder_id:
            self._summaries_folder_id = await self.client.ensure_subfolder("summaries", root_folder_id)
        if not self._done_folder_id:
            self._done_folder_id = await self.client.ensure_subfolder("done", inbox_folder_id)

        inbox_files = await self.client.list_inbox_files(inbox_folder_id)
        if not inbox_files:
            return 0

        processed_count = 0
        for f in inbox_files:
            file_id = f.get("id")
            if not file_id:
                continue
            file_name = f.get("name") or f"{file_id}.json"
            success = await self._process_one_job(
                file_id=file_id,
                file_name=file_name,
                root_folder_id=root_folder_id,
                inbox_folder_id=inbox_folder_id,
            )
            if success:
                processed_count += 1

        return processed_count

    async def _process_one_job(
        self,
        file_id: str,
        file_name: str,
        root_folder_id: str,
        inbox_folder_id: str,
    ) -> bool:
        """Process a single inbox job file with strict idempotency."""
        job_data = await self.client.download_job(file_id)
        job_id = str(job_data.get("id") or file_name.replace(".json", "")).strip()
        if not job_id:
            log.warning("Skipping inbox file %s: missing job id", file_id)
            return False

        idempotency_key = f"drive_inbox:{job_id}"

        # 1. Check idempotency: if job is already marked completed in JobStore
        existing_job = self.job_store.by_key(idempotency_key)
        if existing_job and existing_job.state == "completed":
            log.info("Job %s already completed in JobStore; moving file to done/", job_id)
            await self.client.move_job_to_done(
                file_id=file_id,
                file_name=file_name,
                inbox_folder_id=inbox_folder_id,
                done_folder_id=self._done_folder_id,
                job_content=json.dumps(job_data).encode("utf-8"),
            )
            return True

        # 2. Begin durable job record
        job_record = self.job_store.begin(
            JOB_KIND,
            idempotency_key,
            payload={
                "job_id": job_id,
                "kind": job_data.get("kind"),
                "file_id": file_id,
                "url": job_data.get("url"),
            },
        )

        try:
            # Check if summary was already written in a previous crashed attempt
            summary_written, _ = self.job_store.recorded(job_record, "summary_written")

            if not summary_written:
                # 3. Run processing pipeline
                kind = (job_data.get("kind") or "url").lower()
                url = (job_data.get("url") or "").strip()
                text = (job_data.get("text") or "").strip()

                summary_text = ""
                title = f"Job {job_id}"

                if url:
                    # Capture URL (supports Instagram reels, YouTube, media, articles)
                    captured = await self.library.capture_url(
                        url,
                        kind="video" if kind == "video" else None,
                        notes=text or None,
                        source_ref=f"drive:{job_id}",
                    )
                    item = captured.item
                    item_id = item.get("id")
                    title = item.get("title") or title

                    # If item needs enrichment/summary
                    if item_id:
                        if not item.get("summary") or item.get("status") == "enriching":
                            try:
                                enriched = await self.library.enrich(item_id)
                                summary_text = enriched.get("summary") or ""
                            except Exception as enrich_exc:
                                log.warning("Enrichment during job %s failed: %s", job_id, enrich_exc)
                        if not summary_text:
                            summary_text = item.get("summary") or item.get("notes") or item.get("caption_note") or ""
                elif text:
                    captured = await self.library.log_manual(
                        title=f"Note {job_id}",
                        text=text,
                        notes=text,
                        source_ref=f"drive:{job_id}",
                    )
                    item = captured.item
                    item_id = item.get("id")
                    title = item.get("title") or title
                    if item_id and not item.get("summary"):
                        try:
                            enriched = await self.library.enrich(item_id)
                            summary_text = enriched.get("summary") or ""
                        except Exception as enrich_exc:
                            log.warning("Enrichment during manual job %s failed: %s", job_id, enrich_exc)
                    if not summary_text:
                        summary_text = text
                else:
                    summary_text = "No URL or text content provided in job."

                if not summary_text:
                    summary_text = f"Processed {kind} from phone."

                # 4. Format markdown summary
                now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
                summary_md = f"# {title}\n\n"
                if url:
                    summary_md += f"**Source:** {url}\n\n"
                summary_md += f"**Processed:** {now_iso}\n\n"
                summary_md += f"## Summary\n\n{summary_text}\n"

                # 5. Write to <root>/summaries/<id>.md
                await self.client.write_summary(
                    root_folder_id=root_folder_id,
                    job_id=job_id,
                    content=summary_md,
                    summaries_folder_id=self._summaries_folder_id,
                )
                self.job_store.record(job_record, "summary_written", True)
            else:
                log.info("Job %s summary already written before restart; moving file", job_id)

            # 6. Move job file to <root>/inbox/done/<id>.json
            await self.client.move_job_to_done(
                file_id=file_id,
                file_name=file_name,
                inbox_folder_id=inbox_folder_id,
                done_folder_id=self._done_folder_id,
                job_content=json.dumps(job_data).encode("utf-8"),
            )
            self.job_store.record(job_record, "file_moved", True)

            # 7. Complete job record in JobStore
            self.job_store.complete(
                job_record,
                {"status": "completed", "job_id": job_id},
            )
            log.info("Successfully processed Drive inbox job %s", job_id)
            return True

        except Exception as exc:
            log.exception("Failed processing Drive inbox job %s: %s", job_id, exc)
            self.job_store.fail(job_record, f"{type(exc).__name__}: {exc}")
            raise
