from __future__ import annotations

import sqlite3
import pytest

from backend.db.connection import get_connection


def test_composio_state_table_exists():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='composio_state'")
    assert cursor.fetchone() is not None, "composio_state table must exist"
