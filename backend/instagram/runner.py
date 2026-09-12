"""The drain.

A fourth runner beside automations, reminders and the journal, and for the same
stated reason each of those is separate: the work here is minutes long -- a
download, ffmpeg, a transcription, a model call -- and queueing a reminder or a
briefing behind it would make neither arrive when it should.

It waits on an event with a timeout rather than sleeping on a fixed tick. The
nudge is what matters: a delivery is acknowledged and drained within
microseconds, which is the difference between fetching a `lookaside` asset that
still exists and one that has expired. The timeout is what makes it durable --
a queue left behind by a crash is picked up on the next tick regardless of
whether anything nudges.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import date, datetime, timedelta

from backend.config import load_instagram, save_instagram
from backend.instagram import signature
from backend.instagram.client import InstagramClient, InstagramError
from backend.instagram.relay import POLL_SECONDS as RELAY_POLL_SECONDS
from backend.instagram.relay import RelayPoller
from backend.instagram.service import IngestService
from backend.instagram.store import InstagramEventStore

log = logging.getLogger(__name__)

#: The kind of durable job one delivery's processing is recorded as.
JOB_KIND = "instagram_ingest"

TICK_SECONDS = 5.0
#: How many events one drain will take before yielding, so a large backlog does
#: not hold the lock for an hour.
DRAIN_LIMIT = 20
#: Refresh the access token this far ahead of expiry. A lapsed token cannot be
#: refreshed at all -- only replaced by hand -- so the margin is generous.
TOKEN_REFRESH_DAYS = 14
PRUNE_EVERY_SECONDS = 3600.0


class InstagramRunner:
    def __init__(self, service_factory=IngestService) -> None:
        self._task: asyncio.Task | None = None
        # Both are created in `start`, inside the loop that will use them, and
        # never at import. An asyncio.Event built under one loop keeps waiters
        # belonging to it, so a module-level singleton reused across loops --
        # which is exactly what every test's app lifespan does -- waits on a
        # future that can never be resolved, and the second test hangs forever.
        self._wake: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None
        self._service_factory = service_factory
        self._next_prune = 0.0
        self._checked_token_on: str | None = None
        # Its own interval, not the drain's. The drain is a local database
        # read every five seconds; this is a round trip over the internet, and
        # the free plan it talks to counts requests per day.
        self._relay = RelayPoller()
        self._next_relay = 0.0

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._wake = asyncio.Event()
            self._lock = asyncio.Lock()
            self._task = asyncio.create_task(self._loop(), name="instagram")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._wake = None
        self._lock = None

    def nudge(self) -> None:
        """Something arrived. Drain now rather than at the next tick.

        A no-op when nothing is running -- the delivery is already written down,
        and the next start drains it.
        """
        if self._wake is not None:
            self._wake.set()

    async def _loop(self) -> None:
        wake = self._wake
        while True:
            try:
                if wake is not None:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(wake.wait(), timeout=TICK_SECONDS)
                    wake.clear()
                else:
                    await asyncio.sleep(TICK_SECONDS)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the runner
                log.exception("instagram tick failed")

    async def tick(self) -> list[int]:
        """Recover, drain, and keep the token alive. Returns the events handled."""
        # The cheapest possible no-op on a machine that has not set this up, and
        # it runs on every tick of every test's app lifespan.
        settings = load_instagram()
        if not settings.enabled and not self._relay_wanted(settings):
            return []
        # The relay half runs with Instagram off: a phone share (`kind='share'`)
        # has nothing to do with Instagram, and gating it behind
        # `instagram.enabled` -- which defaults to False -- is what left shares
        # sitting in the relay's D1 for days. Only the drain below is Instagram
        # work, and it no-ops on an empty queue without touching a credential.
        if self._relay_wanted(settings):
            await self._maybe_sync_relay(InstagramEventStore())
        if not settings.enabled:
            return []
        store = InstagramEventStore()
        store.reclaim_stale()
        handled = await self.drain(store=store)
        await self._housekeeping(store)
        return handled

    @staticmethod
    def _relay_wanted(settings) -> bool:
        """Is there a relay to poll for anything this machine can process?

        A share token alone qualifies: shares verify against it, not against
        Instagram's credentials. Deliveries need more, and `relay.sync` makes
        that call per row -- this is only the question "is there any point
        dialling the relay at all", and an unset URL answers it before anything
        else.
        """
        from backend.instagram import relay as ig_relay

        # Presence, not the value: this runs every tick, and the value is only
        # needed when a sync actually happens.
        return bool(settings.relay_enabled and settings.relay_url and ig_relay.token_present())

    async def drain(self, *, store: InstagramEventStore | None = None) -> list[int]:
        """Work the queue, one event at a time.

        Serialised deliberately: two concurrent downloads plus two ffmpeg
        processes while a turn is streaming is not a machine anyone wants.
        """
        from backend.jobs import JobStore

        store = store or InstagramEventStore()
        jobs = JobStore()
        handled: list[int] = []
        lock = self._lock or asyncio.Lock()
        async with lock:
            service = self._service_factory(store=store)
            for _ in range(DRAIN_LIMIT):
                event = store.claim_next()
                if event is None:
                    break
                # The durable half. The event row is still the queue -- it is
                # where Meta's re-deliveries collide, and moving that claim into
                # `jobs` would leave two tables disagreeing about one reel. What
                # the job adds is the ledger: `reclaim_stale` requeues an event
                # whose process died, and without this that retry re-sent the
                # confirmation and skipped the transcript it had not finished.
                job = jobs.begin(
                    JOB_KIND,
                    f"{JOB_KIND}:{event['delivery_key']}",
                    payload={"event_id": event["id"], "route": event["route"]},
                )
                try:
                    status = await service.process(event, job=job, jobs=jobs)
                except Exception as exc:
                    log.exception("instagram event %s failed", event["id"])
                    store.finish(event["id"], status="failed", note=str(exc))
                    jobs.fail(job, f"{type(exc).__name__}: {exc}")
                else:
                    jobs.complete(job, {"status": status, "event_id": event["id"]})
                handled.append(event["id"])
        return handled

    async def sync_relay(self) -> dict:
        """Ask the relay now. The button, and the first thing after a boot."""
        self._next_relay = 0.0
        return await self._relay.sync()

    async def _maybe_sync_relay(self, store: InstagramEventStore) -> None:
        """Collect whatever arrived while this machine was not answering.

        Ahead of the drain in the same tick, so a delivery caught overnight is
        processed on the first tick after boot rather than the second.
        """
        loop_now = asyncio.get_running_loop().time()
        if loop_now < self._next_relay:
            return
        self._next_relay = loop_now + RELAY_POLL_SECONDS
        # Never raises; a relay that is down is a warning and a retry, never a
        # tick that fails and takes the drain with it.
        await self._relay.sync(store=store)

    async def _housekeeping(self, store: InstagramEventStore) -> None:
        now = asyncio.get_running_loop().time()
        if now >= self._next_prune:
            self._next_prune = now + PRUNE_EVERY_SECONDS
            store.prune()
        await self._maybe_refresh_token()

    async def _maybe_refresh_token(self) -> None:
        """Keep the access token alive, and say so loudly when it cannot be.

        A long-lived token refreshes only while it is still valid. Once it has
        lapsed there is no automatic recovery, so the check runs once a day and
        the margin is two weeks.
        """
        today = date.today().isoformat()
        if self._checked_token_on == today:
            return
        self._checked_token_on = today

        settings = load_instagram()
        if not settings.token_expires_on or not signature.access_token():
            return
        try:
            expires = date.fromisoformat(settings.token_expires_on)
        except ValueError:
            return

        remaining = (expires - date.today()).days
        if remaining > TOKEN_REFRESH_DAYS:
            return
        if remaining < 0:
            await self._warn_expired(expires)
            return

        try:
            token, expires_in = await InstagramClient().refresh_token()
        except InstagramError as exc:
            log.warning("could not refresh the Instagram token: %s", exc)
            return
        signature.set_credentials(access_token=token)
        renewed = datetime.now() + timedelta(seconds=expires_in or 60 * 24 * 3600)
        save_instagram({"token_expires_on": renewed.date().isoformat()})
        log.info("refreshed the Instagram token, now good until %s", renewed.date())

    async def _warn_expired(self, expires: date) -> None:
        from backend.notify import notify

        await notify(
            "Instagram needs reconnecting",
            f"The access token expired on {expires:%d %b}. Nothing is being saved"
            " until it is replaced in Settings.",
        )
