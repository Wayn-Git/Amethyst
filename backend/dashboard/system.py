"""Local system projections using existing storage and model settings."""

import shutil

from backend.config import paths
from backend.db.connection import get_connection


async def provide(widget_id):
    if widget_id == "sys.notify":
        return {
            "items": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "detail": f"{row['created_at']} · {row['body']}",
                }
                for row in get_connection().execute(
                    "SELECT * FROM notifications ORDER BY id DESC LIMIT 50"
                )
            ]
        }
    if widget_id == "sys.vault":
        conn = get_connection()
        row = conn.execute(
            "SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes),0) AS bytes "
            "FROM documents WHERE source='vault'"
        ).fetchone()
        saved = conn.execute("SELECT COUNT(*) FROM library_items").fetchone()[0]
        disk = shutil.disk_usage(paths().home)
        return {
            "items": [
                {
                    "id": "vault",
                    "title": "Indexed vault",
                    "detail": f"{row['files']} files · {row['bytes']} bytes",
                },
                {
                    "id": "library",
                    "title": "Library",
                    "detail": f"{saved} saved items",
                },
                {
                    "id": "disk",
                    "title": "Storage volume",
                    "detail": f"{disk.free} bytes free of {disk.total} bytes",
                },
            ]
        }
    raise ValueError("Unknown system widget")
