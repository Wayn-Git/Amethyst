from backend.dashboard.system import provide
from backend.db.connection import reset_connection


async def test_vault_counts_existing_index_and_storage(db):
    empty = await provide("sys.vault")
    assert empty["items"][0]["detail"] == "0 files · 0 bytes"
    db.execute("INSERT INTO documents(path,content_hash,size_bytes) VALUES('/fixture','test',125)")
    db.execute(
        "INSERT INTO documents(path,content_hash,size_bytes,source) "
        "VALUES('/article','test',500,'library')"
    )
    db.commit()
    reset_connection()
    value = await provide("sys.vault")
    assert value["items"][0]["detail"] == "1 files · 125 bytes"
    assert "bytes free of" in value["items"][2]["detail"]
