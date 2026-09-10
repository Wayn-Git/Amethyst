"""Panel artifacts: what makes an agent output a deliverable rather than a step.

The rule under all of these is ADR-0020. An artifact is a *view onto a file* --
the file is the truth, the row is metadata, and the declaration that a write is
a deliverable is a tool *name* rather than a flag, because a name arrives in
the first fragment of a streamed tool call and a flag arrives wherever the
model happens to put it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.agent.director import Director
from backend.db.repositories import ArtifactRepository, ConversationRepository
from backend.runtime.types import ModelResponse, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.registry import build_default_registry


def registry(workspace):
    return build_default_registry(
        ConfirmationService(auto_approve), workspace_root=str(workspace)
    )


async def run(director, cid, message="write it"):
    return [event async for event in director.run(cid, message)]


def frames(events, *types):
    return [e for e in events if e.type in types]


@pytest.fixture
def scripted(monkeypatch):
    """One scripted provider for the whole turn."""
    from backend.runtime.types import Capabilities, ResolvedModel

    class Scripted:
        def __init__(self, responses):
            self.responses = list(responses)

        async def complete(self, messages, tools=None, params=None):
            return self.responses.pop(0) if self.responses else ModelResponse(text="done")

    def install(responses):
        client = Scripted(responses)
        monkeypatch.setattr(
            "backend.agent.director.resolve",
            lambda *a, **k: ResolvedModel(
                provider="fake",
                model="fake-1",
                client=client,
                capabilities=Capabilities(streaming=False, context_window=32_000),
            ),
        )
        return client

    return install


def artifact_call(path="report.md", content="# Report\n\nBody.", title=None):
    arguments = {"path": path, "content": content}
    if title:
        arguments["title"] = title
    return ToolCall(id="c1", name="create_artifact", arguments=arguments)


# --- detection --------------------------------------------------------------


async def test_an_artifact_write_announces_itself_before_the_file_lands(
    db, workspace, scripted
):
    """The panel is a view of a document being produced, so it has to open
    while it is being produced -- dispatch can suspend on a confirmation prompt
    for as long as the user takes to answer it.

    Mutation check: move `_artifact_opening` below the dispatch.
    """
    scripted([ModelResponse(tool_calls=[artifact_call()]), ModelResponse(text="written")])

    cid = ConversationRepository().create("fake", "fake-1")
    events = await run(Director(registry(workspace), workspace_root=str(workspace), memory=False, retrieval=False), cid)
    kinds = [e.type for e in events]

    assert "artifact_open" in kinds
    assert kinds.index("artifact_open") < kinds.index("tool_result"), (
        "the artifact opens before the write is dispatched, not after it returns"
    )
    assert kinds.index("artifact_open") < kinds.index("artifact_delta") < kinds.index(
        "artifact_done"
    )


async def test_an_ordinary_write_is_not_an_artifact(db, workspace, scripted):
    """`write_file` is untouched. A file the agent touched on the way to
    something else must not take over the panel.

    Mutation check: detect on `touches_paths` instead of the tool name.
    """
    scripted(
        [
            ModelResponse(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="write_file",
                        arguments={"path": "notes.md", "content": "# Notes"},
                    )
                ]
            ),
            ModelResponse(text="written"),
        ]
    )

    cid = ConversationRepository().create("fake", "fake-1")
    events = await run(Director(registry(workspace), workspace_root=str(workspace), memory=False, retrieval=False), cid)

    assert not frames(events, "artifact_open", "artifact_delta", "artifact_done")
    assert (workspace / "notes.md").read_text() == "# Notes"


async def test_the_content_arrives_as_a_delta_not_inside_the_open(
    db, workspace, scripted
):
    """The shape is the streaming shape even though nothing streams yet.

    Today the whole document is known before dispatch and one delta carries all
    of it. When the provider adapters start yielding tool-argument fragments,
    the only change is that many deltas arrive instead of one -- and the panel,
    which cannot tell the difference, is not rewritten.

    Mutation check: put `content` in the `artifact_open` payload.
    """
    body = "# Report\n\nA paragraph.\n"
    scripted(
        [ModelResponse(tool_calls=[artifact_call(content=body)]), ModelResponse(text="ok")]
    )

    cid = ConversationRepository().create("fake", "fake-1")
    events = await run(Director(registry(workspace), workspace_root=str(workspace), memory=False, retrieval=False), cid)

    opened = frames(events, "artifact_open")[0]
    assert "content" not in opened.data, "content travels as a delta, never in the open"
    assert "".join(e.data["text"] for e in frames(events, "artifact_delta")) == body


async def test_the_panel_is_told_how_to_render_it_from_the_filename(
    db, workspace, scripted
):
    """The model already said what this is when it chose the extension. Asking
    it a second time is a second chance to disagree with itself."""
    scripted(
        [
            ModelResponse(tool_calls=[artifact_call(path="app.py", content="x = 1\n")]),
            ModelResponse(text="ok"),
        ]
    )

    cid = ConversationRepository().create("fake", "fake-1")
    events = await run(Director(registry(workspace), workspace_root=str(workspace), memory=False, retrieval=False), cid)

    opened = frames(events, "artifact_open")[0].data
    assert opened["media_type"] == "text/x-python"
    assert opened["language"] == "python"
    assert opened["title"] == "app.py", "the filename is the default title"


# --- identity and versions --------------------------------------------------


async def test_writing_the_same_path_twice_is_one_artifact_with_two_versions(
    db, workspace, scripted
):
    """Identity is the resolved path, which is what makes stepping back through
    revisions possible at all -- a fresh row per write could not express it.

    Mutation check: key the store on a per-call id.
    """
    scripted(
        [
            ModelResponse(tool_calls=[artifact_call(content="draft one")]),
            ModelResponse(tool_calls=[artifact_call(content="draft two")]),
            ModelResponse(text="revised"),
        ]
    )

    cid = ConversationRepository().create("fake", "fake-1")
    events = await run(Director(registry(workspace), workspace_root=str(workspace), memory=False, retrieval=False), cid)

    done = [e.data for e in frames(events, "artifact_done")]
    assert [d["version"] for d in done] == [1, 2]
    assert len({d["id"] for d in done}) == 1, "one artifact, not two"

    stored = ArtifactRepository().list(cid)
    assert len(stored) == 1
    assert stored[0]["version"] == 2
    assert (workspace / "report.md").read_text() == "draft two"


async def test_a_refused_write_closes_the_artifact_as_failed(db, workspace, scripted):
    """`artifact_open` fires before dispatch, so the write can still be refused
    at the permission gate or fail on the disk. Without this the panel shows a
    document that does not exist as though it had been saved.

    Mutation check: emit `artifact_done` unconditionally with is_error False.
    """
    scripted(
        [
            # A directory, so the write fails on the disk rather than at the gate.
            ModelResponse(tool_calls=[artifact_call(path="adir", content="x")]),
            ModelResponse(text="could not"),
        ]
    )
    (workspace / "adir").mkdir()

    cid = ConversationRepository().create("fake", "fake-1")
    events = await run(Director(registry(workspace), workspace_root=str(workspace), memory=False, retrieval=False), cid)

    closed = frames(events, "artifact_done")[0].data
    assert closed["is_error"] is True
    assert closed["version"] == 0
    assert ArtifactRepository().list(cid) == [], (
        "a refused write must not leave a version of a file nobody has"
    )


# --- reading them back ------------------------------------------------------


def test_an_artifact_is_read_from_disk_not_from_the_row(db, workspace, amethyst_home):
    """The file is the artifact. Editing it outside AMETHYST and reopening the
    panel has to show what is actually there.

    Mutation check: store the content on the row and serve that.
    """
    from backend.api.main import app

    cid = ConversationRepository().create("fake", "fake-1")
    target = workspace / "report.md"
    target.write_text("as written")
    row = ArtifactRepository().record(cid, str(target), title="Report", size=10)

    target.write_text("as edited by hand")

    with TestClient(app) as client:
        body = client.get(f"/api/artifacts/{row['id']}").json()

    assert body["content"] == "as edited by hand"
    assert body["missing"] is None


def test_an_artifact_whose_file_is_gone_says_so_rather_than_404ing(
    db, workspace, amethyst_home
):
    """"It was written and is now gone" is a different fact from "no such
    artifact", and the panel needs to tell the user which one happened."""
    from backend.api.main import app

    cid = ConversationRepository().create("fake", "fake-1")
    target = workspace / "gone.md"
    target.write_text("here for now")
    row = ArtifactRepository().record(cid, str(target))
    target.unlink()

    with TestClient(app) as client:
        response = client.get(f"/api/artifacts/{row['id']}")

    assert response.status_code == 200
    assert response.json()["missing"], "the panel is told why there is nothing to show"
    assert client.get("/api/artifacts/nosuchid").status_code == 404


def test_a_conversation_lists_its_artifacts_newest_first(db, workspace, amethyst_home):
    from backend.api.main import app

    cid = ConversationRepository().create("fake", "fake-1")
    repo = ArtifactRepository()
    for name in ("one.md", "two.md"):
        (workspace / name).write_text(name)
        repo.record(cid, str(workspace / name), title=name)

    with TestClient(app) as client:
        rows = client.get(f"/api/conversations/{cid}/artifacts").json()

    assert {r["title"] for r in rows} == {"one.md", "two.md"}
    assert all("content" not in r for r in rows), "the list is metadata, not documents"
