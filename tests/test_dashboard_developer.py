"""Developer widget fixtures use disposable rows, repos, and simulated connectors."""

import pytest
from fastapi import HTTPException

from backend.dashboard import developer
from backend.dashboard.developer import DeveloperInput, draft
from backend.dashboard.items import decide


async def add_case(title="Case fixture", **kwargs):
    pending = draft(
        "dev.appeal", "add", DeveloperInput(title=title, submitted_on="2020-01-01", **kwargs)
    )
    await decide("dev.appeal", pending["draft_id"], True)


async def test_cases_gate_persistence_rejection_stale_and_single_use(db):
    body = DeveloperInput(title="Case fixture", submitted_on="2020-01-01")
    pending = draft("dev.appeal", "add", body)
    assert (await developer.provide("dev.appeal"))["items"] == []
    await decide("dev.appeal", pending["draft_id"], False)
    assert db.execute("SELECT count(*) FROM support_cases").fetchone()[0] == 0
    await add_case()
    item = (await developer.provide("dev.appeal"))["items"][0]
    assert item["status"] == "Waiting" and item["days"] > 0 and item["reply_at"] is None
    pending = draft("dev.appeal", "reply", DeveloperInput(id=item["id"]))
    await decide("dev.appeal", pending["draft_id"], True)
    assert (await developer.provide("dev.appeal"))["items"][0]["reply_source"] == "manual"
    with pytest.raises(HTTPException) as error:
        await decide("dev.appeal", pending["draft_id"], True)
    assert error.value.status_code == 409
    pending = draft("dev.appeal", "follow-up", DeveloperInput(id=item["id"], text="Unsent fixture"))
    db.execute("UPDATE support_cases SET title='Changed'")
    db.commit()
    with pytest.raises(HTTPException) as error:
        await decide("dev.appeal", pending["draft_id"], True)
    assert error.value.status_code == 409


async def test_inbox_requires_exact_domain_date_and_message_evidence(db, monkeypatch):
    await add_case(sender_domain="example.com")

    async def read(widget_id, toolkit, slug, arguments):
        assert toolkit == "gmail" and slug == "GMAIL_FETCH_EMAILS"
        assert arguments["verbose"] is False
        return {
            "messages": [
                {"id": "other", "from": "a@notexample.com", "date": "2026-01-01T10:00:00Z"},
                {"id": "old", "from": "a@example.com", "date": "2019-01-01T10:00:00Z"},
            ]
        }

    monkeypatch.setattr(developer, "read", read)
    assert (await developer.provide("dev.appeal"))["items"][0]["status"] == "Waiting"

    async def match(*args):
        return {
            "messages": [
                {"id": "real", "from": "Support <a@example.com>", "date": "2026-01-01T10:00:00Z"}
            ]
        }

    monkeypatch.setattr(developer, "read", match)
    item = (await developer.provide("dev.appeal"))["items"][0]
    assert item["status"] == "Reply" and item["reply_source"] == "Gmail"
    assert db.execute("SELECT reply_at FROM support_cases").fetchone()[0] is None


async def test_follow_up_is_optional_and_never_sends(db, monkeypatch):
    from backend.workers import llm

    await add_case()

    async def ask(prompt, **kwargs):
        assert not kwargs["paid_ok"]
        return {"text": "Please update me on Case fixture."}

    monkeypatch.setattr(llm, "ask", ask)
    assert (await developer.follow_up(1))["text"] == "Please update me on Case fixture."
    assert db.execute("SELECT follow_up FROM support_cases").fetchone()[0] is None
    pending = draft("dev.appeal", "follow-up", DeveloperInput(id=1, text="Please update me."))
    await decide("dev.appeal", pending["draft_id"], True)
    assert db.execute("SELECT follow_up FROM support_cases").fetchone()[0] == "Please update me."


async def test_stop_watch_clears_source_cache_and_expiry(db):
    from backend.dashboard.store import cache_read, cache_write

    await add_case(sender_domain="example.com")
    cache_write("dev.appeal", {"items": [{"reply_source": "Gmail"}]}, "ok")
    pending = draft("dev.appeal", "unwatch", DeveloperInput(id=1))
    await decide("dev.appeal", pending["draft_id"], True)
    assert db.execute("SELECT sender_domain FROM support_cases").fetchone()[0] is None
    assert cache_read("dev.appeal")["payload"] is None
    pending = draft("dev.appeal", "reply", DeveloperInput(id=1))
    db.execute("UPDATE widget_action_drafts SET created_at='2000-01-01T00:00:00+00:00'")
    db.commit()
    with pytest.raises(HTTPException) as error:
        await decide("dev.appeal", pending["draft_id"], True)
    assert error.value.status_code == 409


@pytest.mark.parametrize(
    "domain", ["a@example.com", "a.com OR from:attacker", "-bad.com", "a..com"]
)
def test_invalid_watch_domain(domain):
    with pytest.raises(ValueError):
        DeveloperInput(sender_domain=domain)
