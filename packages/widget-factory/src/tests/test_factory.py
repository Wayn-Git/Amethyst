from __future__ import annotations

import base64
import importlib.util
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError

import pytest

MODULE_PATH = Path(__file__).parents[1] / "factory.py"
sys.path.insert(0, str(MODULE_PATH.parent))
from widget_factory import common, generation, queue  # noqa: E402

spec = importlib.util.spec_from_file_location("widget_factory", MODULE_PATH)
factory = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(factory)


@pytest.fixture
def local_factory(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "DB", tmp_path / "factory.sqlite3")
    monkeypatch.setattr(common, "GENERATED", tmp_path / "generated")
    monkeypatch.setattr(queue, "WORKTREES", tmp_path / "worktrees")
    return tmp_path


def init_repo(path: Path) -> None:
    path.mkdir()
    subprocess.run(["git", "init", "-b", "main"], cwd=path, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Widget Factory Test"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.email", "factory@example.test"], cwd=path, check=True)
    (path / "README.md").write_text("test repository\n")
    subprocess.run(["git", "add", "README.md"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=path, check=True, capture_output=True)


def add_generated(widget_id: str, root: Path) -> None:
    out = root / widget_id
    out.mkdir(parents=True)
    (out / "template.jsx").write_text("<Card />")
    (out / "data.json").write_text('{"design":true}')
    (out / "metadata.json").write_text(
        json.dumps({"widgetId": widget_id, "prompt": "design prompt"})
    )
    db = common.connect()
    db.execute(
        "INSERT INTO tasks(widget_id,status,created_at,updated_at) VALUES(?,?,?,?)",
        (widget_id, "generated", common.now(), common.now()),
    )
    db.close()


def test_prompt_parser_accepts_multiple_blocks():
    parsed = common.parse_prompts(
        "## air-quality\n```prompt\nAir widget\n```\n\n## clock\n```prompt\nClock widget\n```"
    )
    assert parsed == {"air-quality": "Air widget", "clock": "Clock widget"}


@pytest.mark.parametrize(
    "source, message",
    [
        ("## invalid id\n```prompt\nx\n```", "Invalid widget ID"),
        ("## duplicate\n```prompt\nx\n```\n## duplicate\n```prompt\ny\n```", "Duplicate"),
        ("## empty\n```prompt\n  \n```", "empty"),
        ("## malformed\n```prompt\nmissing close", "exactly one"),
        ("## missing\nno prompt", "exactly one"),
    ],
)
def test_prompt_parser_rejects_invalid_sections(source, message):
    with pytest.raises(ValueError, match=message):
        common.parse_prompts(source)


def test_generation_persists_complete_response_and_hashes(local_factory, monkeypatch):
    timeouts = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self, _limit=-1):
            return json.dumps(
                {
                    "template": "<Card />",
                    "data": {"status": "ready"},
                    "theme": "dark",
                    "designSpec": "round",
                    "stages": ["done"],
                }
            ).encode()

    def generate_request(*_args, **kwargs):
        timeouts.append(kwargs["timeout"])
        return Response()

    monkeypatch.setattr(generation.urllib.request, "urlopen", generate_request)
    meta = generation.generate("test-widget", "Design prompt", endpoint="https://example.test")
    out = local_factory / "generated" / "test-widget"
    assert (out / "template.jsx").read_text() == "<Card />"
    assert json.loads((out / "data.json").read_text()) == {"status": "ready"}
    assert meta["theme"] == "dark" and meta["designSpec"] == "round" and meta["stages"] == ["done"]
    assert meta["contentHashes"]["template.jsx"] == common.digest(b"<Card />")
    assert meta["imageStatus"] == "missing"
    assert timeouts == [600]
    assert queue.task_rows(common.connect())[0]["status"] == "generated"


def test_generation_retries_empty_result_then_saves(local_factory, monkeypatch):
    calls = []

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self, _limit=-1):
            return json.dumps(self.payload).encode()

    def generate_request(*_args, **_kwargs):
        calls.append(1)
        if len(calls) == 1:
            return Response({"template": "", "data": None})
        return Response({"template": "<Card />", "data": {"status": "ready"}})

    monkeypatch.setattr(generation.urllib.request, "urlopen", generate_request)
    monkeypatch.setattr(generation.time, "sleep", lambda _seconds: None)
    metadata = generation.generate(
        "empty-result", "Design prompt", endpoint="https://example.test", retries=1
    )

    assert calls == [1, 1]
    assert metadata["generationStatus"] == "generated"
    assert (local_factory / "generated/empty-result/template.jsx").read_text() == "<Card />"


def test_generation_sends_and_preserves_reference_image(local_factory, tmp_path, monkeypatch):
    image = tmp_path / "reference.png"
    image.write_bytes(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=="
        )
    )
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self, _limit=-1):
            return json.dumps({"template": "<Card />", "data": {"status": "ready"}}).encode()

    def generate_request(request, **_kwargs):
        calls.append(json.loads(request.data))
        return Response()

    monkeypatch.setattr(generation.urllib.request, "urlopen", generate_request)
    metadata = generation.generate(
        "reference-widget", "Design prompt", endpoint="https://example.test", reference_image=image
    )

    assert calls[0]["referenceImages"] == [
        {"dataUrl": "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode("ascii")}
    ]
    artifact = local_factory / "generated/reference-widget/reference.png"
    assert artifact.read_bytes() == image.read_bytes()
    assert metadata["imageStatus"] == "available"
    assert metadata["contentHashes"]["reference.png"] == common.digest(image.read_bytes())


def test_generation_retries_rate_limit_then_saves_failure(local_factory, monkeypatch):
    calls = []

    def rate_limited(*_args, **_kwargs):
        calls.append(1)
        raise HTTPError("https://example.test", 429, "limited", {}, None)

    monkeypatch.setattr(generation.urllib.request, "urlopen", rate_limited)
    monkeypatch.setattr(generation.time, "sleep", lambda _seconds: None)
    with pytest.raises(RuntimeError, match="HTTP 429"):
        generation.generate("retry-me", "Design prompt", endpoint="https://example.test")
    assert len(calls) == 4
    metadata = json.loads((local_factory / "generated/retry-me/metadata.json").read_text())
    assert metadata["generationStatus"] == "failed"
    assert "HTTP 429" in metadata["error"]


def test_image_registration_checks_extension_and_signature(local_factory, tmp_path):
    image = tmp_path / "reference.png"
    image.write_bytes(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=="
        )
    )
    result = generation.register_image("air-quality", image)
    target = local_factory / "generated/air-quality/reference.png"
    assert target.read_bytes() == image.read_bytes()
    assert result["sha256"] == common.digest(image.read_bytes())
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not an image")
    with pytest.raises(ValueError, match="signature"):
        generation.register_image("other", bad)


def test_claims_are_atomic_and_allocate_four_separate_worktrees(local_factory, monkeypatch):
    repo = local_factory / "repo"
    init_repo(repo)
    monkeypatch.setattr(queue, "REPO", repo)
    for widget_id in ("glance.air", "glance.sun", "task.today", "need.mail"):
        add_generated(widget_id, common.GENERATED)

    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(lambda n: queue.claim(None, f"session-{n}"), range(4)))

    assert len({result["widgetId"] for result in results}) == 4
    assert {result["slot"] for result in results} == {1, 2, 3, 4}
    assert len({result["worktree"] for result in results}) == 4
    assert all(Path(result["artifacts"]["data"]).is_file() for result in results)
    with pytest.raises(PermissionError):
        generation.artifacts(results[0]["widgetId"], "wrong-session")
    visible = queue.task_rows(common.connect())
    assert all("session_id" not in row and "worktree" not in row for row in visible)


def test_expired_lease_reuses_worktree_and_keeps_uncommitted_files(local_factory, monkeypatch):
    repo = local_factory / "repo"
    init_repo(repo)
    monkeypatch.setattr(queue, "REPO", repo)
    add_generated("glance.air", common.GENERATED)
    first = queue.claim("glance.air", "session-one")
    marker = Path(first["worktree"]) / "uncommitted-agent-work.txt"
    marker.write_text("preserve this\n")
    db = common.connect()
    db.execute(
        "UPDATE tasks SET status='implementing',"
        "lease_expires_at='2000-01-01T00:00:00+00:00' WHERE widget_id='glance.air'",
    )
    db.close()

    resumed = queue.claim("glance.air", "session-two")

    assert resumed["worktree"] == first["worktree"]
    assert resumed["branch"] == first["branch"]
    assert marker.read_text() == "preserve this\n"


def test_mcp_server_exposes_expected_tool_surface():
    server = factory.mcp_server()
    names = {tool.name for tool in server._tool_manager.list_tools()}
    assert names == {
        "list_widget_tasks",
        "generate_widget",
        "generate_batch",
        "get_widget_artifacts",
        "register_widget_image",
        "claim_widget_task",
        "heartbeat_widget_task",
        "report_widget_progress",
        "complete_widget_task",
        "fail_widget_task",
        "get_agent_status",
        "get_widget_task_history",
        "get_integration_queue",
        "retry_widget_task",
    }


def test_integration_rejects_registry_edits_without_merging(local_factory, monkeypatch):
    repo = local_factory / "repo"
    init_repo(repo)
    monkeypatch.setattr(queue, "REPO", repo)
    worktree = local_factory / "worker"
    subprocess.run(
        ["git", "worktree", "add", "-b", "widget-factory/glance-air-agent", str(worktree), "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    registry = worktree / "backend/dashboard/registry.py"
    registry.parent.mkdir(parents=True)
    registry.write_text("# forbidden shared change\n")
    subprocess.run(["git", "add", "backend/dashboard/registry.py"], cwd=worktree, check=True)
    subprocess.run(
        ["git", "commit", "-m", "bad shared edit"], cwd=worktree, check=True, capture_output=True
    )
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=worktree, check=True, capture_output=True, text=True
    ).stdout.strip()
    db = common.connect()
    db.execute(
        "INSERT INTO tasks(widget_id,status,session_id,worktree,branch,commit_sha,"
        "created_at,updated_at,lease_expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (
            "glance.air",
            "review",
            "agent-session",
            str(worktree),
            "widget-factory/glance-air-agent",
            sha,
            common.now(),
            common.now(),
            "2999-01-01T00:00:00+00:00",
        ),
    )
    db.close()
    before = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()

    with pytest.raises(ValueError, match="Unexpected changed paths"):
        queue.integrate("glance.air", "agent-session")

    after = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    assert after == before
    db = common.connect()
    assert db.execute(
        "SELECT status,integration_status FROM tasks WHERE widget_id='glance.air'"
    ).fetchone()[:] == ("review", "blocked")
    db.close()


def test_task_mutations_require_current_owner(local_factory, monkeypatch):
    repo = local_factory / "repo"
    init_repo(repo)
    monkeypatch.setattr(queue, "REPO", repo)
    add_generated("glance.air", common.GENERATED)
    claim = queue.claim("glance.air", "owner-session")
    assert (
        "WIDGET_FACTORY_TASK.md"
        not in subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=claim["worktree"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    with pytest.raises(PermissionError):
        queue.heartbeat("glance.air", "other-session")
    with pytest.raises(PermissionError):
        queue.task_history("glance.air", "other-session")
    queue.heartbeat("glance.air", "owner-session")
    queue.fail("glance.air", "owner-session", "agent stopped")
    with pytest.raises(PermissionError):
        queue.retry("glance.air", "other-session")
    assert queue.retry("glance.air", "owner-session")["status"] == "generated"


def test_integration_runs_widget_test_before_serial_merge(local_factory, monkeypatch):
    repo = local_factory / "repo"
    init_repo(repo)
    monkeypatch.setattr(queue, "REPO", repo)
    worktree = local_factory / "worker"
    branch = "widget-factory/glance-air-agent"
    subprocess.run(
        ["git", "worktree", "add", "-b", branch, str(worktree), "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    component = worktree / "frontend/src/dashboard/widgets/Air.jsx"
    component.parent.mkdir(parents=True)
    component.write_text("export default function Air() { return null }\n")
    test = worktree / "frontend/tests/dashboard-air.mjs"
    test.parent.mkdir(parents=True)
    test.write_text('import assert from "node:assert/strict"; assert.equal(1, 1);\n')
    proposal = worktree / "widget-factory/task-context/glance.air/registration-proposal.md"
    proposal.parent.mkdir(parents=True)
    proposal.write_text("Register `glance.air` with the Air component.\n")
    subprocess.run(["git", "add", "."], cwd=worktree, check=True)
    subprocess.run(
        ["git", "commit", "-m", "implement air widget"],
        cwd=worktree,
        check=True,
        capture_output=True,
    )
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=worktree, check=True, capture_output=True, text=True
    ).stdout.strip()
    db = common.connect()
    db.execute(
        "INSERT INTO tasks(widget_id,status,session_id,worktree,branch,commit_sha,"
        "created_at,updated_at,lease_expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (
            "glance.air",
            "review",
            "agent-session",
            str(worktree),
            branch,
            sha,
            common.now(),
            common.now(),
            "2999-01-01T00:00:00+00:00",
        ),
    )
    db.close()

    result = queue.integrate("glance.air", "agent-session")

    assert "node tests/dashboard-air.mjs" in result["verifiedCommands"]
    assert (repo / "frontend/src/dashboard/widgets/Air.jsx").is_file()
    assert result["status"] == "integrating"
    backend_registry = repo / "backend/dashboard/registry.py"
    frontend_registry = repo / "frontend/src/dashboard/registry.js"
    widget_map_check = repo / "scripts/check-widget-map.py"
    package_json = repo / "frontend/package.json"
    backend_registry.parent.mkdir(parents=True, exist_ok=True)
    frontend_registry.parent.mkdir(parents=True, exist_ok=True)
    widget_map_check.parent.mkdir(parents=True, exist_ok=True)
    package_json.parent.mkdir(parents=True, exist_ok=True)
    backend_registry.write_text('MANIFEST = "glance.air"\n')
    frontend_registry.write_text('WIDGET = "glance.air"\n')
    widget_map_check.write_text("print('widget map: ok')\n")
    package_json.write_text('{"scripts":{"test:renderers":"node tests/renderers.mjs"}}\n')
    renderer_test = repo / "frontend/tests/renderers.mjs"
    renderer_test.write_text('import assert from "node:assert/strict"; assert.equal(1, 1);\n')
    finalized = queue.finalize_integration(
        "glance.air", "agent-session", "Reviewed proposal and verified registrations."
    )
    assert finalized["status"] == "completed"
    assert "npm run test:renderers --prefix frontend" in finalized["verifiedCommands"]
    db = common.connect()
    assert (
        db.execute("SELECT status FROM tasks WHERE widget_id='glance.air'").fetchone()[0]
        == "completed"
    )
    db.close()


@pytest.mark.parametrize("value", ["1", "2", "4"])
def test_agent_limit_accepts_one_through_four(value, monkeypatch):
    monkeypatch.setenv("WIDGET_FACTORY_MAX_AGENTS", value)
    assert common.max_agents() == int(value)


@pytest.mark.parametrize("value", ["0", "5", "many"])
def test_agent_limit_rejects_out_of_range_values(value, monkeypatch):
    monkeypatch.setenv("WIDGET_FACTORY_MAX_AGENTS", value)
    with pytest.raises(ValueError, match="WIDGET_FACTORY_MAX_AGENTS"):
        common.max_agents()
