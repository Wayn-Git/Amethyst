"""The library: capturing what was read, and finding it again.

The rule under every one of these is the same. A capture that goes partly wrong
-- a paywall, a dead link, an embedding server that is not running -- loses some
of what the item could have been, and must never lose the fact that it was read.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.db.connection import get_connection
from backend.library.service import LibraryService
from backend.library.store import LibraryStore
from backend.mcp.ssrf import UnsafeURL
from backend.retrieval.embeddings import EmbeddingError
from backend.retrieval.indexer import Indexer
from backend.retrieval.search import SearchService
from backend.web.reader import FetchedPage, FetchError

ARTICLE = "Attention residue is the cost of switching between tasks. " * 20


class DeadEmbedder:
    """An embedding server that is not running, which is the common case."""

    provider, model = "ollama", "nomic-embed-text"

    async def embed(self, texts):
        raise EmbeddingError("could not reach Ollama at http://localhost:11434")


class FakeEmbedder:
    provider, model = "ollama", "nomic-embed-text"

    async def embed(self, texts):
        return [[float(len(t) % 7), 1.0, 0.5] for t in texts]

    async def embed_one(self, text):
        return (await self.embed([text]))[0]


def page(**over):
    base = dict(
        url="https://calnewport.com/deep-work",
        final_url="https://calnewport.com/deep-work",
        title="Deep Work",
        text=ARTICLE,
        site="calnewport.com",
        author="Cal Newport",
        published_on="2016-01-05",
        content_type="text/html",
    )
    base.update(over)
    return FetchedPage(**base)


def service(*, embedder=None, fetcher=None):
    async def default_fetch(url, **kwargs):
        return page(url=url, final_url=url)

    return LibraryService(
        indexer=Indexer(embedder=embedder or FakeEmbedder()),
        fetcher=fetcher or default_fetch,
    )


@pytest.fixture
def client(db):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def offline(monkeypatch):
    """Let the fake hosts through the SSRF guard without a DNS lookup.

    `check_url` resolves the host, so a made-up domain fails as "cannot resolve"
    -- correct behaviour, and not what these tests are about. The tests that are
    about the guard use a literal address and keep the real one.
    """
    async def allow(url, **kwargs):
        return None

    monkeypatch.setattr("backend.library.service.check_url_async", allow)


async def test_capture_writes_a_real_file_and_indexes_it(db, offline, amethyst_home):
    """The text is a file on disk, not a row pretending to be one.

    AMETHYST stores an index that points at the filesystem and treats the file as
    the source of truth (ADR-0004). A synthetic path would leave `mtime` and
    `size_bytes` NULL and break that for the sake of skipping one write.

    Mutation check: store the text in `library_items` and give `documents` a
    made-up path.
    """
    captured = await service().capture_url("https://calnewport.com/deep-work")

    path = Path(captured.item["text_path"])
    assert path.is_file() and path.parent == amethyst_home / "library"
    assert captured.item["title"] == "Deep Work"
    assert captured.item["author"] == "Cal Newport"
    assert captured.item["published_on"] == "2016-01-05"

    row = get_connection().execute(
        "SELECT source, path, title, mtime, size_bytes FROM documents"
    ).fetchone()
    assert row["source"] == "library"
    assert row["path"] == str(path.resolve())
    assert row["mtime"] is not None and row["size_bytes"] > 0


async def test_a_capture_with_no_embedder_is_still_findable(db, offline):
    """The bug this guards against was invisible until the library existed:
    `chunks_fts` was only created as a side effect of `ensure_indexes`, which
    the indexer only called when the embedder had returned vectors. So the
    keyword half -- the half that is meant to survive a missing embedder --
    had no table to write into.

    Mutation check: call `ensure_keyword_index` only when `vectors` is truthy.
    """
    captured = await service(embedder=DeadEmbedder()).capture_url("https://example.com/a")

    assert captured.item["indexed"] is True
    hits = await SearchService(embedder=DeadEmbedder()).search("attention residue")
    assert [h.label for h in hits] == ["Deep Work"]


async def test_a_library_hit_is_labelled_by_its_title(db, offline):
    """A saved article has no filename the user chose, so `000001-deep-work.md`
    is not what it is called. Its title is."""
    await service().capture_url("https://example.com/a")

    hits = await SearchService(embedder=FakeEmbedder()).search("attention", source="library")
    assert hits and hits[0].label == "Deep Work"
    assert hits[0].source == "library"


async def test_a_vault_hit_keeps_its_filename(db, workspace):
    """The guard on the label change. `documents.title` is `path.stem` for vault
    files, so preferring the title unconditionally would rename every existing
    hit from `notes.md` to `notes`.

    Mutation check: drop the `source != "vault"` condition from `SearchHit.label`.
    """
    note = workspace / "notes.md"
    note.write_text("# Notes\n\nAttention residue is real.\n")
    await Indexer(embedder=FakeEmbedder()).index_vault(workspace)

    hits = await SearchService(embedder=FakeEmbedder()).search("attention residue")
    assert [h.label for h in hits] == ["notes.md > Notes"]


async def test_a_private_address_is_refused_and_writes_no_row(db):
    """The same guard the MCP transports use. A refused capture must not leave
    a half-item behind saying something was logged."""
    from backend.library.service import LibraryError

    with pytest.raises(LibraryError):
        await service().capture_url("http://127.0.0.1:8000/admin")
    assert LibraryStore().list() == []


async def test_a_redirect_to_a_private_address_is_refused(db, offline):
    """The pre-existing hole this change closes: `fetch_url` validated the URL
    it was handed and then followed redirects with no further checks, so a
    public address answering `302 Location: http://169.254.169.254/` was
    fetched and handed back.

    Mutation check: pass `follow_redirects=True` in `fetch_readable` and drop
    the per-hop `check_url_async`.
    """
    from backend.library.service import LibraryError

    async def redirects_inward(url, **kwargs):
        raise UnsafeURL("'169.254.169.254' resolves to a private or loopback address.")

    with pytest.raises(LibraryError, match="private or loopback"):
        await service(fetcher=redirects_inward).capture_url("https://example.com/redirect")
    assert LibraryStore().list() == []


async def test_repasting_a_link_returns_what_is_already_there(db, offline):
    """Re-pasting a link is how you land here, and a duplicate row plus a second
    fetch is not what that meant."""
    svc = service()
    first = await svc.capture_url("https://example.com/a")
    again = await svc.capture_url("https://example.com/a")

    assert again.already_logged is True
    assert again.item["id"] == first.item["id"]
    assert len(LibraryStore().list()) == 1


async def test_a_page_that_gives_up_no_text_is_still_logged(db, offline):
    """A paywall loses the text. It does not lose the fact that you read it --
    and the item says which of those happened rather than looking like a bug.

    Mutation check: raise instead of writing the row when the fetch fails.
    """
    async def refuses(url, **kwargs):
        raise FetchError("https://paywalled.example returned HTTP 403")

    captured = await service(fetcher=refuses).capture_url("https://paywalled.example/x")

    assert captured.item["id"]
    assert captured.item["indexed"] is False
    assert "403" in captured.item["capture_note"]


async def test_a_book_logged_by_hand_is_searchable_through_its_notes(db):
    """There is no page to fetch for a book, so what you wrote about it is the
    only searchable thing there is."""
    captured = await service().log_manual(
        title="Deep Work",
        kind="book",
        author="Cal Newport",
        notes="Attention residue is the cost of switching. Batch shallow work.",
    )
    assert captured.item["capture_note"] is None

    found = await service().search("attention residue")
    assert [item["title"] for item in found] == ["Deep Work"]


async def test_deleting_removes_the_text_the_chunks_and_the_index(db, offline):
    """A removed item leaves nothing searchable behind, or the next query
    returns a passage from something that is no longer there."""
    svc = service()
    captured = await svc.capture_url("https://example.com/a")
    path = Path(captured.item["text_path"])

    assert svc.remove(captured.item["id"]) is True
    assert not path.exists()
    conn = get_connection()
    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM document_chunks").fetchone()[0] == 0
    assert await svc.search("attention residue") == []


def test_an_unknown_kind_names_the_ones_that_work(client):
    """A 400 that lists the accepted values is one the caller can act on."""
    response = client.post("/api/library", json={"title": "x", "kind": "zzz"})
    assert response.status_code == 400
    assert "article" in response.json()["detail"]


def test_the_library_page_loads_on_an_empty_database(client):
    response = client.get("/api/library")
    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "counts": {},
        "category_counts": {},
        "tag_counts": {},
        "query": "",
    }


async def test_the_reader_checks_every_redirect_hop(db, monkeypatch):
    """The guard itself, at the level it lives. `fetch_readable` walks Location
    by hand precisely so the second address is checked as hard as the first.

    Mutation check: hand httpx `follow_redirects=True` and check only the input.
    """
    from backend.web import reader

    checked: list[str] = []

    async def check(url, **kwargs):
        checked.append(url)
        if "169.254" in url:
            raise UnsafeURL("'169.254.169.254' resolves to a private or loopback address.")

    class Hop:
        status_code = 302
        headers = {"location": "http://169.254.169.254/latest/meta-data/"}

    class Client:
        async def get(self, url, **kwargs):
            return Hop()

    monkeypatch.setattr(reader, "check_url_async", check)

    with pytest.raises(UnsafeURL):
        await reader._get_following_redirects(Client(), "https://example.com/go", timeout=1.0)
    assert checked == ["https://example.com/go", "http://169.254.169.254/latest/meta-data/"]


# -- x.com / twitter.com --------------------------------------------------
#
# X serves a JS shell to an ordinary fetch, so these links used to land as a
# bare URL: no text, no document, invisible to search. The capture ladder is
# reader -> oEmbed -> plain fetch; these tests pin the rungs.


async def test_an_x_link_is_captured_through_oembed(db, offline, amethyst_home, monkeypatch):
    """The zero-config rung: a real title and body with no credentials.

    Mutation check: delete the oEmbed rung and this captures a title-less row
    with no text -- exactly the regression it exists to prevent.
    """

    async def oembed(url, **kwargs):
        return {
            "title": "Someone on X",
            "author": "Someone",
            "site": "x.com",
            "text": "the actual post text",
        }

    monkeypatch.setattr("backend.library.service.x_oembed", oembed)

    captured = await service().capture_url("https://x.com/someone/status/12345")

    assert captured.item["title"] == "Someone on X"
    assert captured.item["kind"] == "post"
    assert captured.item["document_id"], "an x capture must be searchable"
    assert "post text via oEmbed" in (captured.item["capture_note"] or "")


async def test_an_x_link_falls_through_when_oembed_is_silent(
    db, offline, amethyst_home, monkeypatch
):
    """oEmbed answering nothing (a deleted post, a bad id) is not an error --
    the link is still logged, with the note the ordinary fetch left."""
    from backend.config import save_social

    save_social({"reader_fallback": False})

    async def nothing(url, **kwargs):
        return None

    monkeypatch.setattr("backend.library.service.x_oembed", nothing)

    async def refuses(url, **kwargs):
        raise FetchError("the page gave no readable text")

    captured = await service(fetcher=refuses).capture_url(
        "https://x.com/someone/status/12345"
    )

    assert captured.item["kind"] == "post"
    assert "gave no readable text" in captured.item["capture_note"]


async def test_a_configured_x_reader_wins_over_oembed(db, offline, amethyst_home, monkeypatch):
    """The top rung: a signed-in reader reads the thread, oEmbed only names it."""

    async def oembed(url, **kwargs):
        return {"title": "Someone on X", "author": "Someone", "site": "x.com",
                "text": "single post"}

    async def social_read(url, *, workspace, allowed):
        return "the whole thread, as the reader printed it", None

    monkeypatch.setattr("backend.library.service.x_oembed", oembed)
    monkeypatch.setattr("backend.web.social.read", social_read)

    from backend.config import save_social

    save_social({"allow": ["x"]})

    captured = await service().capture_url("https://x.com/someone/status/12345")

    assert "whole thread" in Path(captured.item["text_path"]).read_text(encoding="utf-8")
    assert captured.item["kind"] == "post"


def test_library_tag_filtering_and_sorting(client, db):
    # Log two items
    item1 = client.post(
        "/api/library",
        json={"title": "Article One", "kind": "article", "consumed_on": "2026-09-01"},
    ).json()
    item2 = client.post(
        "/api/library",
        json={"title": "Article Two", "kind": "article", "consumed_on": "2026-09-05"},
    ).json()

    # Add tags via patch
    client.patch(f"/api/library/{item1['id']}", json={"tags": ["python", "ai"]})
    client.patch(f"/api/library/{item2['id']}", json={"tags": ["python", "react"]})

    # Test tag_counts
    res = client.get("/api/library").json()
    assert res["tag_counts"]["python"] == 2
    assert res["tag_counts"]["ai"] == 1
    assert res["tag_counts"]["react"] == 1

    # Test filtering by tag
    ai_res = client.get("/api/library?tag=ai").json()
    assert len(ai_res["items"]) == 1
    assert ai_res["items"][0]["title"] == "Article One"

    # Test date ordering
    asc_res = client.get("/api/library?order=asc").json()
    assert asc_res["items"][0]["id"] == item1["id"]

    desc_res = client.get("/api/library?order=desc").json()
    assert desc_res["items"][0]["id"] == item2["id"]



# --- the agent's own view of the library ------------------------------------


def _shelve(client, title, *, category=None, tags=(), kind="video", day="2026-09-01"):
    item = client.post(
        "/api/library", json={"title": title, "kind": kind, "consumed_on": day}
    ).json()
    patch = {}
    if tags:
        patch["tags"] = list(tags)
    if category:
        patch["category"] = category
    if patch:
        client.patch(f"/api/library/{item['id']}", json=patch)
    return item


async def test_the_agent_can_ask_for_a_tag_and_gets_every_item_with_it(client, db):
    """The reported bug, exactly: twenty-one items tagged `cinema`, six returned.

    `search_library` could only search text, so "which movies have I saved"
    became a ranked query against the index and came back with whatever few
    items scored best -- while the tag that answers the question precisely sat
    on every row and the tool had no way to name it. A tag is an exact fact
    about a row, so it is answered by selecting rows, and the count is true.

    Mutation check: delete the `if filtering:` branch in `search_library`.
    """
    from backend.tools.builtin.library import search_library

    for n in range(21):
        # Titles a keyword search cannot help with, which is what half this
        # library actually looks like.
        _shelve(client, "🎬" * (n + 1), category="movie", tags=["cinema"])
    _shelve(client, "A note about python", category="general", tags=["programming"])

    result = await search_library({"tag": "cinema"}, None)

    assert result.content.startswith("21 items:"), result.content[:200]
    assert result.content.count("\n") == 21
    assert "programming" not in result.content


async def test_a_filtered_library_answer_is_not_capped_at_eight(client, db):
    """The default limit is for a ranked text query, where the tail is noise.
    A filter is a "which ones" question and eight of twenty-one is wrong, not
    short.

    Mutation check: use a single default limit of 8 for both paths.
    """
    from backend.tools.builtin.library import search_library

    for n in range(21):
        _shelve(client, f"Film {n}", category="movie", tags=["cinema"])

    assert (await search_library({"category": "movie"}, None)).content.startswith("21 items:")
    # And the caller can still ask for fewer.
    assert (await search_library({"category": "movie", "limit": 5}, None)).content.startswith(
        "5 items:"
    )


async def test_an_unknown_tag_answers_with_the_tags_that_exist(client, db):
    """Otherwise the only recovery from a guessed tag is another guess."""
    from backend.tools.builtin.library import search_library

    _shelve(client, "Film", category="movie", tags=["cinema"])

    result = await search_library({"tag": "films"}, None)

    assert "Nothing in the library has tag 'films'" in result.content
    assert "cinema (1)" in result.content
    assert "movie (1)" in result.content


async def test_the_agent_can_read_back_the_librarys_own_vocabulary(client, db):
    from backend.tools.builtin.library import search_library

    _shelve(client, "Film", category="movie", tags=["cinema"])
    _shelve(client, "Other film", category="movie", tags=["cinema", "streaming"])

    result = await search_library({"list_tags": True}, None)

    assert "cinema (2)" in result.content
    assert "streaming (1)" in result.content
    assert "movie (2)" in result.content


def test_an_item_is_described_with_what_it_is_filed_under(db):
    """A model that cannot see the tags cannot group by them -- and half of
    this library's titles are an emoji and nothing else.

    Mutation check: drop category and tags from `describe`.
    """
    from backend.library.service import describe

    line = describe(
        {
            "title": "🎬",
            "kind": "video",
            "category": "movie",
            "tags": ["cinema", "streaming"],
            "consumed_on": "2026-09-01",
        }
    )
    assert "movie" in line
    assert "cinema, streaming" in line


def test_a_category_filter_finds_what_the_item_is_actually_called(client, db):
    """The chip said twenty-one and the filter returned nineteen.

    `as_dict` infers a category for an item stored as null or 'general', so
    filtering on the stored column alone missed exactly the items whose
    category was inferred -- while the count, which reads the same items
    through `as_dict`, included them. Two views of one word, disagreeing.

    Mutation check: filter on `store.list(category=...)` alone.
    """
    _shelve(client, "Filed as a movie", category="movie", tags=["cinema"])
    # Stored 'general', inferred 'movie' from its tag -- what most captured
    # items in a real library look like.
    inferred = _shelve(client, "Inferred from its tag", tags=["cinema"])
    client.patch(f"/api/library/{inferred['id']}", json={"category": "general"})
    _shelve(client, "A tool", category="tool", tags=["tools"])

    svc = LibraryService()
    movies = svc.recent(category="movie", limit=100)

    assert {i["title"] for i in movies} == {"Filed as a movie", "Inferred from its tag"}
    assert svc.category_counts()["movie"] == len(movies), (
        "the count and the filter have to agree about the same word"
    )


def test_a_filtered_category_pages_in_order(client, db):
    for n in range(5):
        _shelve(client, f"Film {n}", category="movie", day=f"2026-09-0{n + 1}")
    _shelve(client, "A tool", category="tool", day="2026-09-09")

    svc = LibraryService()

    assert [i["title"] for i in svc.recent(category="movie", limit=2)] == ["Film 4", "Film 3"]
    assert [i["title"] for i in svc.recent(category="movie", limit=2, offset=2)] == [
        "Film 2",
        "Film 1",
    ]


def test_category_counts_count_the_whole_shelf(client, db):
    """They were tallied from the first 500 rows, so past that the interface's
    category chips reported the composition of the newest 500 items as the
    whole library.

    Mutation check: go back to `store.list(limit=500)` and count in Python.
    """
    store = LibraryStore()
    for n in range(600):
        store.create(kind="video", title=f"Film {n}", category="movie", consumed_on="2026-01-01")
    store.create(kind="article", title="A tool", category="tool", consumed_on="2026-01-01")

    counts = LibraryService().category_counts()

    assert counts["movie"] == 600
    assert counts["tool"] == 1


async def test_a_library_scoped_search_is_not_starved_by_the_vault(db, workspace, monkeypatch):
    """A search scoped to the library competed against the whole corpus.

    Both indexes rank everything and the `source` filter runs afterwards, so
    with a flat thirty candidates per index a vault full of notes on the same
    subject left almost nothing for the filter to keep -- and `_hydrate` then
    took only the top `limit * 4` of what survived. Asking the library for its
    matches and being handed a third of them was these two together.

    The vault notes here deliberately outrank the library items: that is the
    real shape of the problem, since a note written about a subject says the
    words more often than a captured video's description does.

    Mutation check: drop the widened candidate pool in `SearchService.search`,
    or restore `window = chunk_ids[: limit * 4]` in `_hydrate`.
    """
    from backend.retrieval.indexer import Indexer

    indexer = Indexer(embedder=FakeEmbedder())
    for n in range(120):
        note = workspace / f"note-{n}.md"
        note.write_text(f"# Note {n}\n\n" + ("attention residue focus " * 60))
        await indexer.index_file(note)

    svc = service()
    for n in range(6):
        await svc.log_manual(
            title=f"Focus piece {n}",
            kind="article",
            text="A short piece. attention residue focus is mentioned once here. "
            + ("Filler about something else entirely. " * 30),
        )

    hits = await SearchService(embedder=FakeEmbedder()).search(
        "attention residue focus", limit=6, source="library"
    )

    assert all(h.source == "library" for h in hits)
    assert len(hits) == 6, (
        f"every library match must be reachable, not just the ones that outrank"
        f" the vault -- got {len(hits)}"
    )
