import pytest
import asyncio
from backend.db.connection import reset_connection, get_connection
from backend.library.store import LibraryStore
from backend.library.service import LibraryService, as_dict
from fastapi.testclient import TestClient
from backend.api.main import app


def test_collection_crud():
    reset_connection()
    store = LibraryStore()

    # 1. Create collection
    cid = store.create_list("Research Papers", "AI & ML papers", icon="folder")
    assert cid > 0

    col = store.get_list(cid)
    assert col is not None
    assert col["title"] == "Research Papers"
    assert col["description"] == "AI & ML papers"
    assert col["icon"] == "folder"

    # 2. Rename collection
    updated = store.update_list(cid, title="Advanced ML Research")
    assert updated is True
    col = store.get_list(cid)
    assert col["title"] == "Advanced ML Research"

    # 3. Delete collection
    deleted = store.delete_list(cid)
    assert deleted is True
    assert store.get_list(cid) is None


def test_collection_item_membership():
    reset_connection()
    store = LibraryStore()

    cid = store.create_list("Design Inspiration")
    iid1 = store.create(title="Figma Guide", kind="article", url="https://figma.com/guide")
    iid2 = store.create(title="Tailwind Tricks", kind="article", url="https://tailwindcss.com")

    # Add items
    assert store.add_list_member(cid, item_id=iid1) is True
    assert store.add_list_member(cid, item_id=iid2) is True

    # Duplicate add returns False
    assert store.add_list_member(cid, item_id=iid1) is False

    members = store.get_list_members(cid)
    item_ids = {item["id"] for item in members["items"]}
    assert item_ids == {iid1, iid2}

    # Remove item
    assert store.remove_list_member(cid, item_id=iid1) is True
    members_after = store.get_list_members(cid)
    item_ids_after = {item["id"] for item in members_after["items"]}
    assert item_ids_after == {iid2}


def test_items_appear_in_right_collection_after_reload():
    reset_connection()
    store = LibraryStore()

    col_a = store.create_list("Collection A")
    col_b = store.create_list("Collection B")

    item1 = store.create(title="Item in A", kind="article", url="https://example.com/a")
    item2 = store.create(title="Item in B", kind="article", url="https://example.com/b")
    item3 = store.create(title="Item in Both", kind="article", url="https://example.com/both")

    store.add_list_member(col_a, item_id=item1)
    store.add_list_member(col_b, item_id=item2)
    store.add_list_member(col_a, item_id=item3)
    store.add_list_member(col_b, item_id=item3)

    # Simulate reload
    reset_connection()
    store2 = LibraryStore()

    members_a = store2.get_list_members(col_a)
    members_b = store2.get_list_members(col_b)

    ids_a = {it["id"] for it in members_a["items"]}
    ids_b = {it["id"] for it in members_b["items"]}

    assert ids_a == {item1, item3}
    assert ids_b == {item2, item3}

    # Item representation should include its collections
    row3 = store2.get(item3)
    data3 = as_dict(row3)
    assert "collections" in data3
    assert set(data3["collections"]) == {"Collection A", "Collection B"}


def test_get_list_members_formats_items_correctly():
    reset_connection()
    store = LibraryStore()

    cid = store.create_list("Formatted Items")
    iid = store.create(title="Python Async", kind="article", url="https://python.org")
    store.update(iid, tags='["#python", "#async"]', resources='[{"type": "link", "url": "https://python.org"}]')
    store.add_list_member(cid, item_id=iid)

    members = store.get_list_members(cid)
    item = members["items"][0]

    # tags must be a parsed list, not a string
    assert isinstance(item["tags"], list), f"tags must be list, got {type(item['tags'])}"
    assert isinstance(item["resources"], list), f"resources must be list, got {type(item['resources'])}"
    assert "category" in item
    assert "status" in item


def test_library_store_and_api_filter_by_list_id():
    reset_connection()
    store = LibraryStore()
    svc = LibraryService(store)
    client = TestClient(app)

    cid = store.create_list("Target List")
    iid1 = store.create(title="Target Item", kind="article", url="https://target.com")
    iid2 = store.create(title="Other Item", kind="article", url="https://other.com")
    store.add_list_member(cid, item_id=iid1)

    # Store list filtering
    rows = store.list(list_id=cid)
    assert len(rows) == 1
    assert rows[0]["id"] == iid1

    # API filtering via /api/library?list_id=...
    res = client.get(f"/api/library?list_id={cid}")
    assert res.status_code == 200
    data = res.json()
    items = data["items"]
    assert len(items) == 1
    assert items[0]["id"] == iid1


def test_collection_counts_accuracy():
    reset_connection()
    store = LibraryStore()

    cid = store.create_list("Count Accuracy")
    iid1 = store.create(title="Item 1", kind="article", url="https://example.com/1")
    iid2 = store.create(title="Item 2", kind="article", url="https://example.com/2")
    iid3 = store.create(title="Item 3", kind="article", url="https://example.com/3")

    lists = store.get_lists()
    col = next(l for l in lists if l["id"] == cid)
    assert col["item_count"] == 0

    store.add_list_member(cid, item_id=iid1)
    store.add_list_member(cid, item_id=iid2)
    lists = store.get_lists()
    col = next(l for l in lists if l["id"] == cid)
    assert col["item_count"] == 2

    # Remove one member
    store.remove_list_member(cid, item_id=iid1)
    lists = store.get_lists()
    col = next(l for l in lists if l["id"] == cid)
    assert col["item_count"] == 1

    # Delete item from library directly -> cascades and count drops
    store.delete(iid2)
    lists = store.get_lists()
    col = next(l for l in lists if l["id"] == cid)
    assert col["item_count"] == 0


def test_collection_persistence_survives_restart():
    reset_connection()
    store = LibraryStore()

    cid = store.create_list("Persistent Col", "Testing restart")
    iid = store.create(title="Restart Item", kind="article", url="https://example.com/restart")
    store.add_list_member(cid, item_id=iid)

    # Simulate app shutdown and reboot
    reset_connection()
    rebooted_store = LibraryStore()

    col = rebooted_store.get_list(cid)
    assert col is not None
    assert col["title"] == "Persistent Col"
    assert col["description"] == "Testing restart"

    members = rebooted_store.get_list_members(cid)
    assert len(members["items"]) == 1
    assert members["items"][0]["id"] == iid


def test_collection_persistence_survives_sync():
    from backend.library.storage.sync_engine import LibrarySyncEngine

    reset_connection()
    store = LibraryStore()
    conn = get_connection()

    cid = store.create_list("Sync Col", "Testing cloud sync")
    iid = store.create(title="Sync Item", kind="article", url="https://example.com/sync")
    store.add_list_member(cid, item_id=iid)

    engine = LibrarySyncEngine()
    lists = [dict(r) for r in conn.execute("SELECT * FROM library_lists ORDER BY id ASC").fetchall()]
    members = [dict(r) for r in conn.execute("SELECT * FROM library_list_members").fetchall()]
    catalog = {
        "version": 1,
        "app": "amethyst",
        "items": [{"id": iid, "title": "Sync Item", "kind": "article", "url": "https://example.com/sync"}],
        "lists": lists,
        "list_members": members,
    }

    # Wipe tables to simulate syncing to an empty client
    conn.execute("DELETE FROM library_list_members")
    conn.execute("DELETE FROM library_lists")
    conn.execute("DELETE FROM library_items")
    conn.commit()

    asyncio.run(engine.import_catalog_data(catalog))

    store2 = LibraryStore()
    col = store2.get_list(cid)
    assert col is not None
    assert col["title"] == "Sync Col"
    members2 = store2.get_list_members(cid)
    assert len(members2["items"]) == 1
    assert members2["items"][0]["id"] == iid


def test_collection_device_sync():
    from backend.sync import project, ops, hlc
    reset_connection()
    conn = get_connection()
    project.rewind(conn)
    clock = hlc.Clock("test-device")
    store = LibraryStore()

    cid = store.create_list("Device Sync List", "Should be published to peers")
    res_pub = project.publish(conn, clock)
    assert res_pub >= 1

    pending_ops = ops.pending(conn)
    list_ops = [o for o in pending_ops if o.entity == "library_lists"]
    assert len(list_ops) >= 1
    target_op = next(o for o in list_ops if o.fields.get("title") == "Device Sync List")
    assert target_op.fields["title"] == "Device Sync List"
