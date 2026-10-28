from __future__ import annotations

import contextlib
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import textwrap
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .common import (
    REPO,
    ROOT,
    STATUSES,
    UTC,
    WORKTREES,
    artifact_dir,
    connect,
    event,
    max_agents,
    now,
    task_access,
    valid_id,
)
from .generation import artifacts, generate


def recover_expired(db: sqlite3.Connection) -> None:
    db.execute(
        "UPDATE tasks SET status='ready',session_id=NULL,lease_expires_at=NULL,updated_at=?, "
        "error=COALESCE(error,'Lease expired; preserved worktree for reassignment') "
        "WHERE status IN ('claimed','implementing','review') AND lease_expires_at < ?",
        (now(), now()),
    )


def task_rows(db: sqlite3.Connection, status: str | None = None) -> list[dict[str, Any]]:
    recover_expired(db)
    rows = db.execute(
        "SELECT widget_id,status,created_at,updated_at,attempts,integration_status FROM tasks"
        + (" WHERE status=?" if status else "")
        + " ORDER BY created_at,widget_id",
        ((status,) if status else ()),
    ).fetchall()
    db.commit()
    return [dict(row) for row in rows]


def _git(*args: str, cwd: Path | None = None, timeout: int = 30) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd or REPO, capture_output=True, text=True, timeout=timeout
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "git command failed")
    return result.stdout.strip()


def claim(widget_id: str | None, session_id: str, lease_seconds: int = 1800) -> dict[str, Any]:
    if not session_id.strip() or len(session_id) > 128:
        raise ValueError("Explicit session_id (1..128 chars) required")
    if not 60 <= lease_seconds <= 86400:
        raise ValueError("lease_seconds must be between 60 and 86400")
    db = connect()
    created_worktree = False
    try:
        db.execute("BEGIN IMMEDIATE")
        recover_expired(db)
        row = db.execute(
            "SELECT * FROM tasks WHERE status IN ('generated','ready') "
            "AND (? IS NULL OR widget_id=?) ORDER BY created_at,widget_id LIMIT 1",
            (widget_id, widget_id),
        ).fetchone()
        if row is None:
            db.commit()
            return {"claimed": False, "reason": "No generated or ready task"}
        existing_tree = Path(row["worktree"]) if row["worktree"] else None
        if existing_tree and existing_tree.exists() and row["slot"]:
            expected_branch = row["branch"]
            if (
                Path(
                    _git(
                        "rev-parse", "--path-format=absolute", "--git-common-dir", cwd=existing_tree
                    )
                ).resolve()
                != (REPO / ".git").resolve()
                or _git("branch", "--show-current", cwd=existing_tree) != expected_branch
            ):
                raise RuntimeError(
                    "Expired worktree does not match its recorded branch; recover manually"
                )
            slot = row["slot"]
        else:
            occupied = set()
            for occupied_row in db.execute(
                "SELECT slot,worktree,lease_expires_at,status FROM tasks WHERE slot IS NOT NULL"
            ):
                tree_exists = bool(
                    occupied_row["worktree"]
                    and Path(occupied_row["worktree"]).exists()
                    and occupied_row["status"]
                    in ("ready", "claimed", "implementing", "review", "integrating", "failed")
                )
                lease_live = bool(
                    occupied_row["lease_expires_at"] and occupied_row["lease_expires_at"] >= now()
                )
                if tree_exists or lease_live:
                    occupied.add(occupied_row["slot"])
            slot = next((n for n in range(1, max_agents() + 1) if n not in occupied), None)
        if slot is None:
            db.commit()
            return {"claimed": False, "reason": "All four agent slots are leased"}
        wid = row["widget_id"]
        widget_slug = wid.rsplit(".", 1)[-1].replace("-", "_")
        widget_component = "".join(part.capitalize() for part in widget_slug.split("_"))
        expected_prefix = f"widget-factory/{wid}-"
        if row["branch"] and not row["branch"].startswith(expected_prefix):
            raise RuntimeError("Recorded branch is outside this task's branch namespace")
        branch = row["branch"] or (
            f"widget-factory/{wid}-{re.sub(r'[^a-zA-Z0-9-]', '-', session_id)[:32]}"
        )
        worktree = (
            existing_tree.resolve()
            if existing_tree and existing_tree.exists()
            else (WORKTREES / f"agent-{slot}" / wid).resolve()
        )
        artifact = artifacts(wid, session_id)
        if not (Path(artifact["template"]).is_file() and Path(artifact["data"]).is_file()):
            raise RuntimeError("Task cannot be claimed without generated template and data")
        if not worktree.exists():
            worktree.parent.mkdir(parents=True, exist_ok=True)
            branch_exists = (
                subprocess.run(
                    ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
                    cwd=REPO,
                    capture_output=True,
                ).returncode
                == 0
            )
            if branch_exists:
                _git("worktree", "add", str(worktree), branch)
            else:
                _git("worktree", "add", "-b", branch, str(worktree), "HEAD")
            created_worktree = True
        elif row["branch"] != branch:
            raise RuntimeError(f"Worktree path already exists; refusing overwrite: {worktree}")
        context_dir = worktree / "widget-factory" / "task-context" / wid
        context_dir.mkdir(parents=True, exist_ok=True)
        for source_key, target_name in (
            ("template", "template.jsx"),
            ("data", "data.json"),
            ("metadata", "metadata.json"),
        ):
            if not (context_dir / target_name).exists():
                shutil.copyfile(artifact[source_key], context_dir / target_name)
        if artifact["image"] and not (context_dir / Path(artifact["image"]).name).exists():
            shutil.copyfile(artifact["image"], context_dir / Path(artifact["image"]).name)
        expiry = (datetime.now(UTC) + timedelta(seconds=lease_seconds)).isoformat(
            timespec="seconds"
        )
        db.execute(
            "UPDATE tasks SET status='claimed',session_id=?,slot=?,worktree=?,branch=?,"
            "updated_at=?,lease_expires_at=?,heartbeat_at=?,attempts=attempts+1,error=NULL "
            "WHERE widget_id=?",
            (session_id, slot, str(worktree), branch, now(), expiry, now(), wid),
        )
        event(db, wid, session_id, "claimed", str(worktree))
        db.commit()
    except Exception:
        with contextlib.suppress(Exception):
            db.rollback()
        if created_worktree and worktree.exists():
            with contextlib.suppress(Exception):
                _git("worktree", "remove", str(worktree), "--force")
        raise
    finally:
        db.close()
    context = worktree / "widget-factory" / "task-context" / wid
    prompt_text = json.loads((context / "metadata.json").read_text()).get("prompt", "")
    generated_metadata = json.loads((context / "metadata.json").read_text())
    task_instruction = textwrap.dedent(
        f"""\
        # Agent task: {wid}

        Session: `{session_id}`. Worktree: `{worktree}`. Branch: `{branch}`.

        Artifacts are in `{context}`: `template.jsx`, `data.json`, `metadata.json`, and
        image `{Path(artifact["image"]).name if artifact["image"] else "MISSING"}`
        (no visual comparison is possible without an image).
        Read template and JSON; open and inspect the image first when present.
        Original prompt: {prompt_text}

        Read repository `AGENTS.md`, `docs/agent-context/INDEX.md`, the Today and
        widget-system documents, `docs/widget-playground/WIDGET_LOOP.md`, and
        `widget-factory/AGENTS.md`. Inspect real backend payloads and APIs. JSON is a
        design reference only. Work only on this widget's provider, renderer, scoped
        CSS, assets and tests. The app files allowed for this ID are
        `backend/dashboard/{widget_slug}.py`,
        `frontend/src/dashboard/widgets/{widget_component}.jsx` (or a subdirectory named
        `{widget_slug}/`), `widgets/{wid}/`,
        `tests/test_dashboard_{widget_slug}.py`, and
        `frontend/tests/dashboard-{widget_slug}.mjs`. Do not edit registration,
        routing, global styles, shared provider files, or other widgets. Put the
        registration proposal in
        `widget-factory/task-context/{wid}/registration-proposal.md`. Use real backend
        data and actions; report missing support. Implement every requested size.
        Compare layout, proportions, spacing, type, color and borders against the image;
        if absent, mark visual comparison unavailable. Run relevant tests and lint,
        commit, then submit SHA and findings with `complete_widget_task`.
        """
    )
    (worktree / "WIDGET_FACTORY_TASK.md").write_text(task_instruction, encoding="utf-8")
    exclude = Path(_git("rev-parse", "--git-path", "info/exclude", cwd=worktree))
    with exclude.open("a", encoding="utf-8") as stream:
        stream.write("\n/WIDGET_FACTORY_TASK.md\n")
    return {
        "claimed": True,
        "widgetId": wid,
        "status": "claimed",
        "sessionId": session_id,
        "slot": slot,
        "worktree": str(worktree),
        "branch": branch,
        "artifacts": artifact,
        "context": {
            "prompt": prompt_text,
            "theme": generated_metadata.get("theme"),
            "designSpec": generated_metadata.get("designSpec"),
            "stages": generated_metadata.get("stages"),
            "metadata": str(context / "metadata.json"),
            "template": str(context / "template.jsx"),
            "data": str(context / "data.json"),
            "image": str(context / Path(artifact["image"]).name) if artifact["image"] else None,
            "referenceAvailable": bool(artifact["image"]),
        },
        "referenceRequired": bool(artifact["image"]),
        "taskInstructions": str(worktree / "WIDGET_FACTORY_TASK.md"),
    }


def owned(
    db: sqlite3.Connection, widget_id: str, session_id: str, statuses: tuple[str, ...] | None = None
) -> sqlite3.Row:
    row = db.execute("SELECT * FROM tasks WHERE widget_id=?", (valid_id(widget_id),)).fetchone()
    if row is None or row["session_id"] != session_id:
        raise PermissionError("Task is not owned by this session")
    if statuses and row["status"] not in statuses:
        raise ValueError(f"Task status {row['status']} does not allow this operation")
    if row["lease_expires_at"] and row["lease_expires_at"] < now():
        raise PermissionError("Task lease expired")
    return row


def mutate(
    widget_id: str,
    session_id: str,
    status: str,
    detail: str = "",
    lease_seconds: int = 1800,
    commit_sha: str | None = None,
    report: str | None = None,
    error: str | None = None,
    allowed_statuses: tuple[str, ...] = ("claimed", "implementing"),
) -> dict[str, Any]:
    if status not in STATUSES:
        raise ValueError("Invalid task status")
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        owned(db, widget_id, session_id, allowed_statuses)
        expiry = (datetime.now(UTC) + timedelta(seconds=lease_seconds)).isoformat(
            timespec="seconds"
        )
        db.execute(
            "UPDATE tasks SET status=?,updated_at=?,heartbeat_at=?,lease_expires_at=?,"
            "commit_sha=COALESCE(?,commit_sha),report=COALESCE(?,report),error=? "
            "WHERE widget_id=?",
            (status, now(), now(), expiry, commit_sha, report, error, widget_id),
        )
        event(db, widget_id, session_id, status, detail or error or report or "")
        db.commit()
        return dict(db.execute("SELECT * FROM tasks WHERE widget_id=?", (widget_id,)).fetchone())
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def heartbeat(widget_id: str, session_id: str, lease_seconds: int = 1800) -> dict[str, Any]:
    return mutate(
        widget_id,
        session_id,
        "implementing",
        "heartbeat",
        lease_seconds,
        allowed_statuses=("claimed", "implementing", "review"),
    )


def progress(widget_id: str, session_id: str, status: str, detail: str) -> dict[str, Any]:
    if status not in ("implementing", "review"):
        raise ValueError("Progress status must be implementing or review")
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        owned(db, widget_id, session_id, ("claimed", "implementing", "review"))
        expiry = (datetime.now(UTC) + timedelta(minutes=30)).isoformat(timespec="seconds")
        db.execute(
            "UPDATE tasks SET status=?,updated_at=?,heartbeat_at=?,lease_expires_at=? "
            "WHERE widget_id=?",
            (status, now(), now(), expiry, widget_id),
        )
        event(db, widget_id, session_id, status, detail)
        db.commit()
        return dict(db.execute("SELECT * FROM tasks WHERE widget_id=?", (widget_id,)).fetchone())
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def complete(widget_id: str, session_id: str, commit_sha: str, report: str) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit_sha):
        raise ValueError("A Git commit SHA is required")
    return mutate(
        widget_id,
        session_id,
        "review",
        "integration requested",
        commit_sha=commit_sha,
        report=report,
        allowed_statuses=("claimed", "implementing"),
    )


def fail(widget_id: str, session_id: str, error: str) -> dict[str, Any]:
    return mutate(
        widget_id,
        session_id,
        "failed",
        error=error,
        allowed_statuses=("claimed", "implementing", "review"),
    )


def agent_status(session_id: str) -> list[dict[str, Any]]:
    db = connect()
    try:
        recover_expired(db)
        rows = [
            dict(r)
            for r in db.execute(
                "SELECT * FROM tasks WHERE session_id=? ORDER BY updated_at DESC", (session_id,)
            )
        ]
        db.commit()
        return rows
    finally:
        db.close()


def task_history(widget_id: str, session_id: str | None = None) -> list[dict[str, Any]]:
    task_access(widget_id, session_id)
    db = connect()
    try:
        return [
            dict(row)
            for row in db.execute(
                "SELECT at,event,detail,session_id FROM task_events WHERE widget_id=? ORDER BY id",
                (valid_id(widget_id),),
            )
        ]
    finally:
        db.close()


def integration_queue() -> list[dict[str, Any]]:
    db = connect()
    try:
        return [
            dict(r)
            for r in db.execute(
                "SELECT widget_id,status,updated_at,commit_sha,integration_status "
                "FROM tasks WHERE status IN ('review','integrating') ORDER BY updated_at"
            )
        ]
    finally:
        db.close()


def verify_agent_commit(worktree: Path, paths: list[str], widget_id: str) -> list[str]:
    """Run only the assigned widget's tests and linters in its worktree."""
    slug = widget_id.rsplit(".", 1)[-1].replace("-", "_")
    python_changes = [p for p in paths if p.startswith("backend/dashboard/")]
    frontend_changes = [p for p in paths if p.startswith("frontend/src/dashboard/widgets/")]
    python_tests = [p for p in paths if p == f"tests/test_dashboard_{slug}.py"]
    frontend_tests = [p for p in paths if p == f"frontend/tests/dashboard-{slug}.mjs"]
    if python_changes and not python_tests:
        raise ValueError(f"Python widget changes require tests/test_dashboard_{slug}.py")
    if frontend_changes and not frontend_tests:
        raise ValueError(f"Frontend widget changes require frontend/tests/dashboard-{slug}.mjs")
    commands: list[tuple[list[str], Path]] = []
    if python_tests:
        commands.append(([sys.executable, "-m", "pytest", *python_tests], worktree))
        py_files = [p for p in paths if p.endswith(".py")]
        commands.append(([sys.executable, "-m", "ruff", "check", *py_files], worktree))
    if frontend_tests:
        commands.append(
            (
                ["node", str(Path(frontend_tests[0]).relative_to("frontend"))],
                worktree / "frontend",
            )
        )
        js_files = [
            str(worktree / p) for p in paths if p.endswith((".js", ".jsx", ".mjs", ".ts", ".tsx"))
        ]
        if js_files:
            linter = ROOT.parent / "frontend" / "node_modules" / ".bin" / "oxlint"
            commands.append(([str(linter), *js_files], worktree))
    results = []
    for command, cwd in commands:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=300)
        output = (result.stdout + result.stderr)[-4000:]
        results.append({"command": " ".join(command), "exit": result.returncode, "output": output})
        if result.returncode:
            raise RuntimeError(f"Verification failed: {' '.join(command)}\n{output}")
    if not commands:
        raise ValueError("No widget-specific tests were found to verify this integration")
    return [item["command"] for item in results]


def require_main_checkout() -> None:
    if not (REPO / ".git").is_dir():
        raise RuntimeError(
            "Integration commands must run from the main checkout, not an agent worktree"
        )


def integrate(widget_id: str, session_id: str) -> dict[str, Any]:
    """Manager-only CLI merge; leave registration review as an explicit second step."""
    require_main_checkout()
    db = connect()
    worktree: Path | None = None
    try:
        db.execute("BEGIN IMMEDIATE")
        row = owned(db, widget_id, session_id, ("review",))
        if row["integration_status"] == "integrating":
            raise RuntimeError("Integration already in progress")
        if not row["commit_sha"] or not row["branch"]:
            raise ValueError("Agent must submit a branch commit SHA first")
        worktree = Path(row["worktree"])
        if _git("rev-parse", row["branch"], cwd=worktree) != row["commit_sha"]:
            raise ValueError("Submitted commit must be the tip of the assigned task branch")
        _git("merge-base", "--is-ancestor", row["commit_sha"], row["branch"])
        paths = _git("diff", "--name-only", "HEAD..." + row["commit_sha"]).splitlines()
        slug = widget_id.rsplit(".", 1)[-1].replace("-", "_")
        component = "".join(part.capitalize() for part in slug.split("_"))
        allowed = {
            f"backend/dashboard/{slug}.py",
            f"frontend/src/dashboard/widgets/{component}.jsx",
            f"tests/test_dashboard_{slug}.py",
            f"frontend/tests/dashboard-{slug}.mjs",
        }
        allowed_prefixes = (
            f"frontend/src/dashboard/widgets/{slug}/",
            f"widgets/{widget_id}/",
            f"widget-factory/task-context/{widget_id}/",
        )
        forbidden = [
            p
            for p in paths
            if p
            in {
                "backend/dashboard/registry.py",
                "backend/dashboard/router.py",
                "frontend/src/dashboard/registry.js",
                "frontend/src/dashboard/layout.js",
                "frontend/src/dashboard/Home.jsx",
                "frontend/src/globals.css",
                "frontend/src/index.css",
            }
        ]
        unexpected = [
            p
            for p in paths
            if p not in allowed and not any(p.startswith(prefix) for prefix in allowed_prefixes)
        ]
        if forbidden or unexpected:
            raise ValueError(
                f"Unexpected changed paths; integration stopped: {forbidden + unexpected}"
            )
        proposal = f"widget-factory/task-context/{widget_id}/registration-proposal.md"
        if proposal not in paths or not (worktree / proposal).is_file():
            raise ValueError("Integration requires the task's registration proposal")
        dirty = _git("status", "--porcelain").splitlines()
        dirty_paths = {line[3:].split(" -> ")[-1] for line in dirty if len(line) > 3}
        overlap = sorted(dirty_paths.intersection(paths))
        if overlap:
            raise RuntimeError(
                f"Main worktree has uncommitted changes in incoming paths: {overlap}"
            )
        verified = verify_agent_commit(worktree, paths, widget_id)
        db.execute(
            "UPDATE tasks SET status='integrating',integration_status='integrating',"
            "updated_at=? WHERE widget_id=?",
            (now(), widget_id),
        )
        event(
            db,
            widget_id,
            session_id,
            "integration_started",
            json.dumps({"paths": paths, "verified": verified}),
        )
        db.commit()
        # Commit already resides in the repository object database through the worktree.
        _git("merge", "--no-ff", "--no-edit", row["commit_sha"])
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "UPDATE tasks SET status='integrating',integration_status='awaiting_registration',"
            "updated_at=?,error=NULL WHERE widget_id=?",
            (now(), widget_id),
        )
        event(db, widget_id, session_id, "merged_awaiting_registration", row["commit_sha"])
        db.commit()
        return {
            "widgetId": widget_id,
            "status": "integrating",
            "integrationStatus": "awaiting_registration",
            "commit": row["commit_sha"],
            "changedFiles": paths,
            "verifiedCommands": verified,
            "registrationProposal": str(REPO / proposal),
        }
    except Exception as exc:
        with contextlib.suppress(Exception):
            db.rollback()
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE tasks SET status='review',integration_status='blocked',"
                "updated_at=?,error=? WHERE widget_id=?",
                (now(), str(exc)[:4000], widget_id),
            )
            event(db, widget_id, session_id, "integration_blocked", str(exc))
            db.commit()
        raise
    finally:
        db.close()


def finalize_integration(
    widget_id: str, session_id: str, manager_report: str, cleanup: bool = False
) -> dict[str, Any]:
    """Complete only after the manager applies registration and verifies the live map."""
    if not manager_report.strip():
        raise ValueError("Manager verification report is required")
    require_main_checkout()
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = owned(db, widget_id, session_id, ("integrating",))
        if row["integration_status"] not in ("awaiting_registration", "blocked"):
            raise ValueError("Task has not completed its isolated-branch merge")
        backend_registry = REPO / "backend/dashboard/registry.py"
        frontend_registry = REPO / "frontend/src/dashboard/registry.js"
        for path in (backend_registry, frontend_registry):
            if not path.is_file() or widget_id not in path.read_text(encoding="utf-8"):
                raise ValueError(f"Widget is not registered in {path.relative_to(REPO)}")
        check = subprocess.run(
            [sys.executable, "scripts/check-widget-map.py"],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if check.returncode:
            raise RuntimeError("Widget map check failed: " + (check.stdout + check.stderr)[-4000:])
        worktree = Path(row["worktree"])
        paths = _git("diff", "--name-only", row["commit_sha"] + "^..HEAD").splitlines()
        # The manager's registry changes are checked by the map script; rerun the
        # widget-specific suite from the integrated main tree before completion.
        verification = verify_agent_commit(REPO, paths, widget_id)
        existing_widgets = subprocess.run(
            ["npm", "run", "test:renderers", "--prefix", "frontend"],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if existing_widgets.returncode:
            raise RuntimeError(
                "Existing widget renderer check failed: "
                + (existing_widgets.stdout + existing_widgets.stderr)[-4000:]
            )
        verification.append("npm run test:renderers --prefix frontend")
        if cleanup and worktree.exists():
            _git("worktree", "remove", str(worktree))
        db.execute(
            "UPDATE tasks SET status='completed',integration_status='completed',"
            "updated_at=?,error=NULL,report=COALESCE(report,'') || ? WHERE widget_id=?",
            (now(), "\nIntegration manager: " + manager_report.strip(), widget_id),
        )
        event(
            db,
            widget_id,
            session_id,
            "integration_verified",
            json.dumps({"widgetMapCheck": check.stdout[-2000:], "commands": verification}),
        )
        db.commit()
        return {
            "widgetId": widget_id,
            "status": "completed",
            "widgetMapCheck": check.stdout.strip(),
            "verifiedCommands": verification,
            "worktreeRemoved": bool(cleanup),
        }
    except Exception as exc:
        with contextlib.suppress(Exception):
            db.rollback()
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE tasks SET integration_status='blocked',updated_at=?,error=? "
                "WHERE widget_id=? AND status='integrating'",
                (now(), str(exc)[:4000], widget_id),
            )
            event(db, widget_id, session_id, "final_verification_blocked", str(exc))
            db.commit()
        raise
    finally:
        db.close()


def retry(widget_id: str, session_id: str | None = None) -> dict[str, Any]:
    meta_path = artifact_dir(widget_id) / "metadata.json"
    metadata = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    if (
        not (artifact_dir(widget_id) / "template.jsx").exists()
        or not (artifact_dir(widget_id) / "data.json").exists()
        or metadata.get("generationStatus") == "failed"
    ):
        if not metadata:
            raise ValueError("No saved prompt is available for generation retry")
        prompt = metadata.get("prompt", "")
        if not prompt:
            raise ValueError("Saved prompt is empty; provide a new prompt with generate_widget")
        return generate(widget_id, prompt)
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT status,session_id FROM tasks WHERE widget_id=?", (valid_id(widget_id),)
        ).fetchone()
        if row is None:
            raise ValueError("Unknown widget task")
        if row["status"] not in ("failed", "generated"):
            raise ValueError(
                "Only failed generation/tasks or unclaimed generated tasks can be retried"
            )
        if row["session_id"] and row["session_id"] != session_id:
            raise PermissionError("Only the owning session may retry this task")
        db.execute(
            "UPDATE tasks SET status='generated',updated_at=?,error=NULL,session_id=NULL,"
            "lease_expires_at=NULL WHERE widget_id=?",
            (now(), widget_id),
        )
        event(db, widget_id, None, "retried")
        db.commit()
        return dict(db.execute("SELECT * FROM tasks WHERE widget_id=?", (widget_id,)).fetchone())
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
