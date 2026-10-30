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


async def test_youtube_capture_extracts_description_and_sets_text_source(db, offline, monkeypatch):
    import backend.library.service as svc_mod

    monkeypatch.setattr(
        svc_mod,
        "_extract_youtube_info",
        lambda url: {
            "title": "Sample YouTube Video",
            "uploader": "Test Channel",
            "description": "This is a detailed video description explaining https://example.com/demo and tools.",
            "thumbnail": "https://example.com/thumb.jpg",
            "duration": 120,
        },
    )
    captured = await service().capture_url("https://www.youtube.com/watch?v=12345678")
    assert captured.item["title"] == "Sample YouTube Video"
    assert captured.item["author"] == "Test Channel"
    assert captured.item["kind"] == "video"
    assert captured.item["text_source"] == "video description"
    assert captured.item["duration_seconds"] == 120
    assert captured.item["text_path"] is not None
    from pathlib import Path

    content = Path(captured.item["text_path"]).read_text(encoding="utf-8")
    assert "This is a detailed video description" in content


async def test_pinterest_capture_fetches_oembed_and_tags_app(db, offline, monkeypatch):
    import backend.library.service as svc_mod
    import backend.web.reader as reader_mod

    async def mock_pinterest_oembed(url, **kwargs):
        return {
            "title": "Minimalist Ceramic Cup",
            "author": "DesignStudio",
            "site": "Pinterest",
            "thumbnail_url": "https://i.pinimg.com/736x/ab/cd/ef.jpg",
        }

    monkeypatch.setattr(reader_mod, "pinterest_oembed", mock_pinterest_oembed)
    monkeypatch.setattr(svc_mod, "pinterest_oembed", mock_pinterest_oembed)

    async def mock_fetch(url):
        return FetchedPage(
            url=url,
            final_url=url,
            title="Minimalist Ceramic Cup",
            text="Handmade ceramic cups in white and earth tones.",
            site="Pinterest",
            author="DesignStudio",
            image="https://i.pinimg.com/736x/ab/cd/ef.jpg",
        )

    svc = service(fetcher=mock_fetch)
    saved_thumbs = []

    async def mock_save_thumb(item_id, thumb_url):
        saved_thumbs.append((item_id, thumb_url))
        LibraryStore().update(item_id, thumbnail_path="/tmp/fake_thumb.jpg")

    monkeypatch.setattr(svc, "_save_thumb", mock_save_thumb)

    captured = await svc.capture_url("https://www.pinterest.com/pin/123456789/")
    assert captured.item["title"] == "Minimalist Ceramic Cup"
    assert captured.item["author"] == "DesignStudio"
    assert captured.item["app"] == "pinterest"
    assert "pinterest" in captured.item["tags"]
    assert len(saved_thumbs) == 1
    assert saved_thumbs[0][1] == "https://i.pinimg.com/736x/ab/cd/ef.jpg"


async def test_general_website_captures_og_thumbnail_and_app_tag(db, offline, monkeypatch):
    async def mock_fetch(url):
        return FetchedPage(
            url=url,
            final_url=url,
            title="GitHub Octoverse 2026",
            text="The state of open source software and developer trends in 2026. " * 10,
            site="GitHub",
            author="GitHub",
            image="https://github.blog/wp-content/uploads/2026/header.png",
        )

    svc = service(fetcher=mock_fetch)
    saved_thumbs = []

    async def mock_save_thumb(item_id, thumb_url):
        saved_thumbs.append((item_id, thumb_url))
        LibraryStore().update(item_id, thumbnail_path="/tmp/github_thumb.jpg")

    monkeypatch.setattr(svc, "_save_thumb", mock_save_thumb)

    captured = await svc.capture_url("https://github.com/features/actions")
    assert captured.item["app"] == "github"
    assert "github" in captured.item["tags"]
    assert len(saved_thumbs) == 1
    assert saved_thumbs[0][1] == "https://github.blog/wp-content/uploads/2026/header.png"


async def test_mobile_share_sheet_url_extraction(db, offline, monkeypatch):
    from backend.web.reader import is_pinterest

    # International domains
    assert is_pinterest("https://in.pinterest.com/pin/123456/")
    assert is_pinterest("https://pin.it/4k7XYZ")
    assert is_pinterest("https://www.pinterest.com/pin/987654/")

    async def mock_fetch(url):
        return FetchedPage(
            url=url,
            final_url=url,
            title="Spring Outfit Ideas",
            text="Trendy outfits for spring and summer with linen shirts.",
            site="Pinterest",
            author="StyleGuide",
            image="https://i.pinimg.com/736x/ab/cd/ef.jpg",
        )

    svc = service(fetcher=mock_fetch)
    captured = await svc.capture_url("Check out this Pin on Pinterest: https://pin.it/4k7XYZ Spring Outfit Ideas")
    assert captured.item["url"] == "https://pin.it/4k7XYZ"
    assert captured.item["app"] == "pinterest"
    assert captured.item["status"] in ("enriching", "ready")
    assert captured.item["notes"] == "Spring Outfit Ideas"


async def test_failed_relay_url_ingest_recovery(db):
    from backend.instagram.relay import RelayPoller

    captured_calls = []

    class DummyLibrary:
        async def capture_url(self, url, **kwargs):
            captured_calls.append((url, kwargs))
            return None

    poller = RelayPoller(library=DummyLibrary())
    failed_job = {
        "id": "job_123",
        "kind": "url_ingest",
        "state": "failed",
        "last_error": "refused: the source answered 403",
        "params": {
            "url": "https://pin.it/6O3mF4X",
            "kind": "article",
            "note": "Shared from iPhone",
        },
    }

    result = await poller._collect(failed_job)
    assert result is True
    assert len(captured_calls) == 1
    assert captured_calls[0][0] == "https://pin.it/6O3mF4X"
    assert captured_calls[0][1]["notes"] == "Shared from iPhone"


def test_music_kind_and_tag_detection():
    from backend.library.service import kind_for
    from backend.library.store import app_tag_for_url

    # Spotify
    assert kind_for("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT") == "music"
    assert kind_for("https://open.spotify.com/album/4LH4d3cOWNNXdsqFd4G7Av") == "music"
    assert kind_for("https://open.spotify.com/episode/abc") == "podcast"
    assert app_tag_for_url("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT") == "spotify"

    # Apple Music
    assert kind_for("https://music.apple.com/us/album/song/12345") == "music"
    assert app_tag_for_url("https://music.apple.com/us/album/song/12345") == "apple-music"

    # YouTube Music
    assert kind_for("https://music.youtube.com/watch?v=123") == "music"
    assert app_tag_for_url("https://music.youtube.com/watch?v=123") == "youtube"

    # SoundCloud & Bandcamp
    assert kind_for("https://soundcloud.com/artist/track") == "music"
    assert app_tag_for_url("https://soundcloud.com/artist/track") == "soundcloud"
    assert kind_for("https://artist.bandcamp.com/track/song") == "music"
    assert app_tag_for_url("https://artist.bandcamp.com/track/song") == "bandcamp"


def test_export_playlist_requires_items(client):
    res = client.post("/api/library/export-playlist", json={"item_ids": []})
    assert res.status_code == 400
    assert "at least one item" in res.json()["detail"]


def test_caption_music_extraction():
    from backend.media.music import extract_music_from_text

    m1 = extract_music_from_text("Sunday vibe! Song: Blinding Lights by The Weeknd #fyp")
    assert m1 is not None
    assert m1["name"] == "Blinding Lights"
    assert m1["detail"] == "The Weeknd"

    m2 = extract_music_from_text("Morning routine 🎵 Espresso - Sabrina Carpenter")
    assert m2 is not None
    assert m2["name"] == "Espresso"
    assert m2["detail"] == "Sabrina Carpenter"

    m3 = extract_music_from_text("Track: Birds of a Feather")
    assert m3 is not None
    assert m3["name"] == "Birds of a Feather"

    m4 = extract_music_from_text("Just a regular caption with no music credits")
    assert m4 is None


@pytest.mark.asyncio
async def test_reel_music_intent_vs_standard():
    from unittest.mock import AsyncMock, MagicMock
    from backend.library.reels import ReelCapture, Reel

    library = MagicMock()
    library.capture_media = AsyncMock(return_value=MagicMock(already_logged=True))

    rc = ReelCapture(library)
    dummy_reel = Reel(
        url="https://instagram.com/reel/123",
        title="Workout video",
        caption="Daily routine",
        author="fitness_guru",
        duration=15.0,
        thumbnail_url=None,
        video_path=None,
    )

    # Standard reel capture: kind is "video"
    await rc._store(dummy_reel, notes=None, requested_kind=None, settings=MagicMock())
    args, kwargs = library.capture_media.call_args
    assert kwargs["kind"] == "video"
    assert kwargs["category"] is None

    # Music intent reel capture: kind becomes "music", category is "music"
    await rc._store(dummy_reel, notes=None, requested_kind="music", settings=MagicMock())
    args, kwargs = library.capture_media.call_args
    assert kwargs["kind"] == "music"
    assert kwargs["category"] == "music"


def test_recover_stale_items():
    from datetime import datetime, timedelta
    store = LibraryStore()
    conn = get_connection()

    fresh_id = store.create(kind="article", title="Fresh enriching item", url="https://example.com/fresh-enrich")
    store.update(fresh_id, status="enriching")

    stale_id = store.create(kind="article", title="Stale enriching item", url="https://example.com/stale-enrich")
    old_time = (datetime.now() - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("UPDATE library_items SET status = 'enriching', updated_at = ? WHERE id = ?", (old_time, stale_id))
    conn.commit()

    recovered = store.recover_stale_items(max_age_seconds=180)
    assert stale_id in recovered
    assert fresh_id not in recovered

    fresh_row = store.get(fresh_id)
    assert fresh_row["status"] == "enriching"

    stale_row = store.get(stale_id)
    assert stale_row["status"] == "ready"
    assert "timed out" in stale_row["enrichment_note"].lower()


@pytest.mark.asyncio
async def test_enrich_resets_status_on_failure(monkeypatch, db, offline, amethyst_home):
    from backend.library import enrich as enrichment

    async def fake_fetch(u):
        return page(title="To fail")

    svc = service(fetcher=fake_fetch)
    item = await svc.capture_url("https://example.com/fail-enrich", title="To fail")
    item_id = item.item["id"]

    async def mock_enrich_text(*args, **kwargs):
        raise RuntimeError("LLM exploded")

    monkeypatch.setattr(enrichment, "enrich_text", mock_enrich_text)

    with pytest.raises(RuntimeError):
        await svc.enrich(item_id)

    row = svc.store.get(item_id)
    assert row["status"] == "ready"
    assert "LLM exploded" in (row["enrichment_note"] or "")


@pytest.mark.asyncio
async def test_threads_capture_and_app_tag(monkeypatch, db, offline, amethyst_home):
    from backend.library.store import app_tag_for_url
    from backend.web.reader import is_threads

    assert app_tag_for_url("https://www.threads.net/@user/post/xyz") == "threads"
    assert app_tag_for_url("https://threads.com/@user/post/xyz") == "threads"
    assert is_threads("https://www.threads.net/@user/post/xyz")
    assert is_threads("https://threads.com/@user/post/xyz")

    async def mock_threads_oembed(url):
        return {
            "title": "Inspiring thread on AI agents",
            "author": "tech_lead",
            "site": "threads.net",
            "text": "Here is why AI agents represent a major paradigm shift in systems design.",
            "thumbnail_url": "https://example.com/avatar.jpg",
        }

    monkeypatch.setattr("backend.library.service.threads_oembed", mock_threads_oembed)

    svc = service()
    captured = await svc.capture_url("https://www.threads.net/@tech_lead/post/abc123xyz")
    item = captured.item
    assert item["app"] == "threads"
    assert item["author"] == "tech_lead"
    assert "Inspiring thread on AI agents" in item["title"]
    assert "thread text" in item["text_source"]


async def test_reel_carousel_slides_persisted_and_served(client, monkeypatch):
    import json
    from unittest.mock import AsyncMock, MagicMock
    from backend.library.reels import ReelCapture, Reel
    from backend.library.store import slide_path, thumbnail_path

    svc = service()
    dummy_reel = Reel(
        url="https://www.instagram.com/p/carousel123/",
        title="Carousel Post Title",
        caption="A post with multiple photos",
        author="art_creator",
        duration=None,
        thumbnail_url=None,
        video_path=None,
        slide_urls=["https://fake-cdn.instagram.com/s1.jpg", "https://fake-cdn.instagram.com/s2.jpg"],
    )

    rc = ReelCapture(svc)
    fake_img = b"\xff\xd8\xff\xe0\x00\x10JFIF" + (b"\x00" * 600)

    class MockResp:
        status_code = 200
        content = fake_img

    class MockClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, headers=None):
            return MockResp()

    monkeypatch.setattr("httpx.AsyncClient", lambda **kwargs: MockClient())
    monkeypatch.setattr("backend.runtime.vision.extract_visual_text", AsyncMock(return_value="Slide 1 shows diagram"))

    settings = MagicMock(keep_video=False, enrich=False)
    captured = await rc._store(dummy_reel, notes=None, requested_kind=None, settings=settings)
    item_id = captured.item["id"]

    # Multi-slide post without video should be stored as "post"
    item = svc.store.get(item_id)
    assert item["kind"] == "post"

    # Manually invoke _process_slides to test slide downloading and persistence
    await rc._process_slides(item_id, dummy_reel)

    # Check slide files exist on disk
    s0 = slide_path(item_id, 0)
    s1 = slide_path(item_id, 1)
    assert s0.is_file()
    assert s1.is_file()
    assert s0.read_bytes() == fake_img

    # Check resources in store
    refreshed = svc.store.get(item_id)
    resources = json.loads(refreshed["resources"])
    slide_res = [r for r in resources if r.get("type") == "slide"]
    assert len(slide_res) == 2
    assert slide_res[0]["url"] == f"/api/library/{item_id}/slides/0"
    assert slide_res[1]["url"] == f"/api/library/{item_id}/slides/1"

    # Check GET /api/library/{item_id}/slides/0 returns 200
    res0 = client.get(f"/api/library/{item_id}/slides/0")
    assert res0.status_code == 200
    assert res0.content == fake_img

    # Check slide out of bounds returns 404
    res_bad = client.get(f"/api/library/{item_id}/slides/99")
    assert res_bad.status_code == 404


async def test_enrich_sqlite_row_get_fix(monkeypatch):
    from backend.library.enrich import Enrichment
    from backend.library.store import LibraryStore

    svc = service()
    item_id = svc.store.create(
        kind="article",
        title="Test Threads Item",
        url="https://www.threads.net/@user/post/123",
        notes="A threads post to enrich",
    )
    # Store some initial text
    await svc._store_text(item_id, "Test Threads Item", "This is an insightful thread about software systems.", "")

    async def mock_enrich_text(*args, **kwargs):
        return Enrichment(
            summary="A deep dive into software systems design.",
            tags=("software", "systems"),
            resources=({"name": "Python", "type": "code", "url": "https://python.org", "detail": ""},),
            note="",
            provider="mock",
            model="mock",
        )

    monkeypatch.setattr("backend.library.enrich.enrich_text", mock_enrich_text)

    # Calling enrich should succeed without 'sqlite3.Row' object has no attribute 'get'
    result = await svc.enrich(item_id)
    assert result["summary"] == "A deep dive into software systems design."
    assert "threads" in result["tags"]
    assert "programming" in result["tags"]


@pytest.mark.asyncio
async def test_capture_url_updates_staged_skeleton_item():
    async def fake_fetch(u):
        return page(title="Fetched Page Title", text="Some real article body")

    svc = service(fetcher=fake_fetch)
    test_url = "https://example.com/staged-article"

    # Stage a skeleton card like the relay does
    staged_id = svc.store.create(kind="article", title=test_url, url=test_url)
    svc.store.update(staged_id, status="received")

    staged = svc.store.get(staged_id)
    assert staged["status"] == "received"
    assert staged["title"] == test_url

    # Ingesting the real page should update the existing row in place
    captured = await svc.capture_url(test_url)
    assert captured.already_logged is False
    assert captured.item["id"] == staged_id
    assert captured.item["title"] == "Fetched Page Title"
    assert captured.item["status"] in ("ready", "enriching")

    updated = svc.store.get(staged_id)
    assert updated["title"] == "Fetched Page Title"
    assert updated["text_path"] is not None


def test_normalize_url_strips_tracking_and_rewrites_instagram():
    from backend.library.enrich import normalize_url

    # Strips xtok and query
    reel_url = "https://www.instagram.com/reel/DeWdjLTuV1A/?xtok=MWR4azJvb2l0M3lmbg=="
    assert normalize_url(reel_url) == "https://www.instagram.com/reel/DeWdjLTuV1A/"

    # Strips igsh and rewrites /share/p/ to /p/
    share_url = "https://www.instagram.com/share/p/DeWdjLTuV1A/?igsh=xyz123"
    assert normalize_url(share_url) == "https://www.instagram.com/p/DeWdjLTuV1A/"

    # Rewrites /share/reel/ to /reel/
    share_reel = "https://www.instagram.com/share/reel/DeWdjLTuV1A/"
    assert normalize_url(share_reel) == "https://www.instagram.com/reel/DeWdjLTuV1A/"

    # Supports instagr.am
    short_domain = "https://instagr.am/p/DeWdjLTuV1A/?utm_source=ig_web_copy_link"
    assert normalize_url(short_domain) == "https://instagr.am/p/DeWdjLTuV1A/"


def test_is_reel_url_variants():
    from backend.media.reel import is_reel_url

    assert is_reel_url("https://www.instagram.com/reel/DeWdjLTuV1A/") is True
    assert is_reel_url("https://instagr.am/p/DeWdjLTuV1A/") is True
    assert is_reel_url("https://www.instagram.com/share/reel/DeWdjLTuV1A/") is True
    assert is_reel_url("https://www.instagram.com/share/p/DeWdjLTuV1A/") is True
    assert is_reel_url("https://example.com/not-a-reel") is False


@pytest.mark.asyncio
async def test_capture_media_updates_skeleton_item():
    svc = service()
    url = "https://www.instagram.com/reel/test_media_123/"
    staged_id = svc.store.create(kind="video", title=url, url=url)
    svc.store.update(staged_id, status="received")

    captured = await svc.capture_media(
        title="Real Media Title",
        kind="video",
        url=url,
        text="Caption and visual content",
        duration_seconds=30,
        existing_id=staged_id,
    )
    assert captured.already_logged is False
    assert captured.item["id"] == staged_id
    assert captured.item["title"] == "Real Media Title"
    assert captured.item["status"] == "ready"

    row = svc.store.get(staged_id)
    assert row["status"] == "ready"
    assert row["duration_seconds"] == 30


@pytest.mark.asyncio
async def test_savetolist_library_features():
    import json
    from backend.api.main import app
    from starlette.testclient import TestClient

    svc = service()
    item_id = svc.store.create(kind="book", title="Piranesi", author="Susanna Clarke")

    client = TestClient(app)

    # 1. Update progress to 'in_progress', pin item, set reminder, add private notes
    patch_payload = {
        "progress": "in_progress",
        "is_pinned": True,
        "remind_at": "2026-11-01 10:00:00",
        "remind_action": "read",
        "private_notes": "Read chapters 1 to 3, marvelous setting.",
    }
    res = client.patch(f"/api/library/{item_id}", json=patch_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["progress"] == "in_progress"
    assert data["is_pinned"] is True
    assert data["remind_at"] == "2026-11-01 10:00:00"
    assert data["remind_action"] == "read"
    assert data["private_notes"] == "Read chapters 1 to 3, marvelous setting."

    # 2. Verify sorting by is_pinned
    unpinned_id = svc.store.create(kind="article", title="Regular Article")
    listed = svc.store.list()
    # Pinned item Piranesi should appear first before unpinned_id
    ids = [r["id"] for r in listed]
    assert ids.index(item_id) < ids.index(unpinned_id)

    # 3. Add anything: place and idea kinds
    place_id = svc.store.create(kind="place", title="Fushimi Inari", notes="Kyoto shrine trail")
    svc.store.update(place_id, tags=json.dumps(["japan", "travel"]))
    idea_id = svc.store.create(kind="idea", title="Local-First Sync Protocol", notes="CRDT state replication")
    svc.store.update(idea_id, tags=json.dumps(["tech", "ideas"]))
    assert svc.store.get(place_id)["kind"] == "place"
    assert svc.store.get(idea_id)["kind"] == "idea"

    # 4. Search everything: finding by private note, tag, or title
    search_res = await svc.search("marvelous setting")
    assert any(it["id"] == item_id for it in search_res)

    search_place = await svc.search("Kyoto shrine")
    assert any(it["id"] == place_id for it in search_place)

    # 5. Arrange items / manual reordering
    reorder_res = client.post("/api/library/reorder", json={"item_ids": [idea_id, place_id, unpinned_id, item_id]})
    assert reorder_res.status_code == 200
    manual_list = svc.store.list(order="manual")
    # Pinned items still come first (item_id is pinned), then unpinned in custom position order (idea_id before place_id)
    manual_ids = [r["id"] for r in manual_list]
    assert manual_ids.index(idea_id) < manual_ids.index(place_id)

    # 6. Merge lists: combining two tags into one
    merge_res = client.post("/api/library/merge-lists", json={"source": "travel", "destination": "japan", "type": "tag"})
    assert merge_res.status_code == 200
    merged_data = merge_res.json()
    assert merged_data["merged"] >= 1
    updated_place = svc.store.get(place_id)
    updated_tags = json.loads(updated_place["tags"])
    assert "japan" in updated_tags
    assert "travel" not in updated_tags










