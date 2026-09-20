from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.db.repositories import ConversationRepository, MessageRepository, ResponseArtifactRepository


def test_branch_conversation_endpoint():
    client = TestClient(app)
    conv_repo = ConversationRepository()
    msg_repo = MessageRepository()
    art_repo = ResponseArtifactRepository()

    # 1. Create a source conversation with messages and an artifact
    cid = conv_repo.create("openai", "gpt-4o", "Original Chat")
    m1 = msg_repo.append(cid, "user", "What is Amethyst?")
    m2 = msg_repo.append(cid, "assistant", "Amethyst is a private, local-first AI assistant.")
    m3 = msg_repo.append(cid, "user", "Tell me more about its research engine.")
    m4 = msg_repo.append(cid, "assistant", "Its research engine provides multi-query planning and verification.")

    # Attach artifact to m2
    art = art_repo.get_or_create(cid, m2, "Amethyst is a private, local-first AI assistant.")
    art_repo.save_version(art["id"], "Amethyst is an advanced private AI assistant.", author="user", change_summary="Polished description")

    # 2. Branch from message m2
    res = client.post(f"/api/conversations/{cid}/branch", json={"from_message_id": m2, "title": "Branched Branch"})
    assert res.status_code == 200
    data = res.json()
    assert data["id"] != cid
    assert data["title"] == "Branched Branch"
    assert data["messages_copied"] == 2

    # Verify history of the branched conversation
    branched_cid = data["id"]
    branched_msgs = msg_repo.history(branched_cid)
    assert len(branched_msgs) == 2
    assert branched_msgs[0].role == "user"
    assert branched_msgs[0].content == "What is Amethyst?"
    assert branched_msgs[1].role == "assistant"
    assert branched_msgs[1].content == "Amethyst is an advanced private AI assistant."

    # Verify that the artifact was also duplicated
    branched_art = art_repo.get_by_message(branched_cid, branched_msgs[1].id)
    assert branched_art is not None
    assert branched_art["current_content"] == "Amethyst is an advanced private AI assistant."


def test_branch_conversation_nonexistent():
    client = TestClient(app)
    res = client.post("/api/conversations/nonexistent-id/branch", json={})
    assert res.status_code == 404
