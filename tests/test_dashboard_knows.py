import json

import pytest
from fastapi import HTTPException

from backend.dashboard import knows
from backend.dashboard.items import decide
from backend.db.connection import get_connection, reset_connection


async def test_memory_edits_are_gated_persistent_and_audited(db):
    memory = db.execute("INSERT INTO memories(fact) VALUES('Original fixture')").lastrowid
    db.commit()
    body = knows.MemoryInput(id=memory, fact="Edited fixture")
    draft = knows.draft("edit", body)
    assert (await knows.provide())["items"][0]["fact"] == "Original fixture"
    await decide("agent.knows", draft["draft_id"], False)
    assert (await knows.provide())["items"][0]["fact"] == "Original fixture"
    draft = knows.draft("edit", body)
    await decide("agent.knows", draft["draft_id"], True)
    reset_connection()
    assert (await knows.provide())["items"][0]["fact"] == "Edited fixture"
    audit = (
        get_connection().execute("SELECT arguments FROM execution_logs ORDER BY id DESC").fetchone()
    )
    assert json.loads(audit[0])["fact"] == "Edited fixture"
    draft = knows.draft("delete", knows.MemoryInput(id=memory))
    await decide("agent.knows", draft["draft_id"], True)
    assert (await knows.provide())["items"] == []
    assert get_connection().execute("SELECT count(*) FROM memories").fetchone()[0] == 0
    with pytest.raises(HTTPException):
        await decide("agent.knows", draft["draft_id"], True)


async def test_memory_changed_draft_is_rejected(db):
    memory = db.execute("INSERT INTO memories(fact) VALUES('Fixture')").lastrowid
    db.commit()
    draft = knows.draft("edit", knows.MemoryInput(id=memory, fact="New fixture"))
    db.execute("UPDATE memories SET fact='Changed fixture'")
    db.commit()
    with pytest.raises(HTTPException, match="Memory changed"):
        await decide("agent.knows", draft["draft_id"], True)
