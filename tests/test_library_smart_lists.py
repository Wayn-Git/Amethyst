import pytest
from pathlib import Path
from backend.db.connection import reset_connection
from backend.library.store import LibraryStore


def test_lists_and_extracted_links_store():
    reset_connection()
    store = LibraryStore()

    # Create extracted link
    item_id = store.create(title="Article 1", kind="article", url="https://example.com/art1")
    link_id = store.save_extracted_link(
        source_item_id=item_id,
        url="https://github.com/fastapi/fastapi?utm_source=twitter",
        normalized_url="https://github.com/fastapi/fastapi",
        domain="github.com",
        title="FastAPI Repo",
    )
    assert link_id is not None

    # Test deduplication on save_extracted_link
    dup_id = store.save_extracted_link(
        source_item_id=item_id,
        url="https://github.com/fastapi/fastapi?utm_medium=social",
        normalized_url="https://github.com/fastapi/fastapi",
        domain="github.com",
    )
    assert dup_id == link_id, "Duplicate normalized URL for same item must return existing ID"

    # Create list
    list_id = store.create_list(title="Developer Tools", is_smart=True)
    assert list_id > 0

    # Add item and link to list
    assert store.add_list_member(list_id=list_id, item_id=item_id) is True
    assert store.add_list_member(list_id=list_id, link_id=link_id) is True

    # Test deduplication on list members
    assert store.add_list_member(list_id=list_id, item_id=item_id) is False, "Duplicate item should not be added again"
    assert store.add_list_member(list_id=list_id, link_id=link_id) is False, "Duplicate link should not be added again"

    members = store.get_list_members(list_id)
    assert len(members["items"]) == 1
    assert len(members["links"]) == 1
    assert members["items"][0]["id"] == item_id
    assert members["links"][0]["id"] == link_id


def test_harvest_and_store_links():
    reset_connection()
    store = LibraryStore()
    from backend.library.links import harvest_and_store_links

    item_id = store.create(title="Tech Article", kind="article", url="https://news.ycombinator.com/item?id=123")
    sample_markdown = """
    Check out this [FastAPI Repo](https://github.com/fastapi/fastapi?utm_source=twitter) for web APIs.
    Also read https://anthropic.com/research/overview?ref=hackernews and duplicate https://github.com/fastapi/fastapi.
    """

    links = harvest_and_store_links(store, item_id, sample_markdown)
    assert len(links) == 2
    domains = {l["domain"] for l in links}
    assert "github.com" in domains
    assert "anthropic.com" in domains

    # Verify tracking parameter was removed
    urls = [l["url"] for l in links]
    assert "https://github.com/fastapi/fastapi" in urls


def test_auto_cluster_and_lists_api():
    from fastapi.testclient import TestClient
    from backend.api.main import app
    from backend.library.service import LibraryService

    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)

    id1 = store.create(title="FastAPI High Performance Web", kind="article", url="https://fastapi.tiangolo.com")
    id2 = store.create(title="Async Python and Starlette Architecture", kind="article", url="https://starlette.io")
    store.update(id1, tags='["#python", "#api", "#backend"]')
    store.update(id2, tags='["#python", "#async", "#backend"]')

    client = TestClient(app)
    res = client.post("/api/library/lists/auto-cluster")
    assert res.status_code == 200
    data = res.json()
    assert "clusters_created" in data

    lists_res = client.get("/api/library/lists")
    assert lists_res.status_code == 200
    all_lists = lists_res.json()
    assert len(all_lists) >= 1

    # Verify list detail with members
    list_id = all_lists[0]["id"]
    detail_res = client.get(f"/api/library/lists/{list_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert "items" in detail
    assert "links" in detail


def test_smart_lists_and_extracted_links_end_to_end():
    from fastapi.testclient import TestClient
    from backend.api.main import app
    from backend.library.service import LibraryService

    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)
    client = TestClient(app)

    # 1. Create items with text containing embedded markdown and raw links
    item_id = store.create(
        title="Modern Frontend State Architecture",
        kind="article",
        url="https://frontend-dev.org/state",
    )
    from backend.library.links import harvest_and_store_links
    content = (
        "Read more on [Zustand](https://github.com/pmndrs/zustand?utm_source=docs) "
        "and [Jotai](https://jotai.org?ref=reddit). Also see https://github.com/pmndrs/zustand."
    )
    harvest_and_store_links(store, item_id, content)

    # 2. Query extracted links for this item
    links_res = client.get(f"/api/library/links?item_id={item_id}")
    assert links_res.status_code == 200
    item_links = links_res.json()
    assert len(item_links) == 2, "Normalized links should deduplicate Zustand"
    zustand_link = next(l for l in item_links if l["domain"] == "github.com")
    assert zustand_link["normalized_url"] == "https://github.com/pmndrs/zustand"

    # 3. Create a custom list via API
    create_res = client.post(
        "/api/library/lists",
        json={"title": "Frontend Tooling", "description": "State management tools", "icon": "folder"},
    )
    assert create_res.status_code == 200
    custom_list_id = create_res.json()["id"]

    # 4. Add item and link to list
    add_item_res = client.post(
        f"/api/library/lists/{custom_list_id}/members",
        json={"item_id": item_id},
    )
    assert add_item_res.status_code == 200
    assert add_item_res.json()["status"] == "added"

    add_link_res = client.post(
        f"/api/library/lists/{custom_list_id}/members",
        json={"link_id": zustand_link["id"]},
    )
    assert add_link_res.status_code == 200
    assert add_link_res.json()["status"] == "added"

    # 5. Verify deduplication - adding duplicate returns already_exists
    dup_res = client.post(
        f"/api/library/lists/{custom_list_id}/members",
        json={"item_id": item_id},
    )
    assert dup_res.status_code == 200
    assert dup_res.json()["status"] == "already_exists"

    # 6. Verify list detail
    detail_res = client.get(f"/api/library/lists/{custom_list_id}")
    assert detail_res.status_code == 200
    data = detail_res.json()
    assert len(data["items"]) == 1
    assert len(data["links"]) == 1
    assert data["items"][0]["id"] == item_id
    assert data["links"][0]["id"] == zustand_link["id"]

    # 7. Delete list - item remains in library
    del_res = client.delete(f"/api/library/lists/{custom_list_id}")
    assert del_res.status_code == 200
    assert store.get(item_id) is not None

    # 8. Deleting item cascades to extracted links
    store.delete(item_id)
    links_after = client.get(f"/api/library/links?item_id={item_id}").json()
    assert len(links_after) == 0


