"""Headless / Cloud Automation Worker for Amethyst.

Executes an automation definition statelessly in an ephemeral environment
(such as a GitHub Actions runner or local CLI invocation), without requiring
a persistent server, hosted database, or background daemon.

Usage:
    python -m backend.automation_worker --automation-file automations/example_briefing.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# Basic logger configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("amethyst.cloud_worker")


def _setup_ephemeral_environment() -> str:
    """Initialize a clean, temporary AMETHYST_HOME.
    
    The entire SQLite database and configuration exist only for the duration of this
    turn and will be discarded upon exit.
    """
    temp_home = tempfile.mkdtemp(prefix="amethyst-worker-")
    os.environ["AMETHYST_HOME"] = temp_home
    os.environ["AMETHYST_SECRETS_FILE"] = str(Path(temp_home) / "secrets.json")
    return temp_home


def _format_markdown_summary(
    name: str,
    description: str,
    status: str,
    provider: str,
    model: str,
    duration_s: float,
    answer: str,
    steps: list[dict[str, Any]],
    gate_refused: list[str],
) -> str:
    """Generate a GitHub Step Summary in Markdown."""
    status_badge = {
        "ok": "✅ Success",
        "error": "❌ Failed",
        "blocked": "⚠️ Blocked (Missing Permission)",
        "partial": "⚠️ Partial",
    }.get(status, status)

    lines = [
        f"## ⚡ Amethyst Cloud Automation: {name}",
        f"*{description}*\n" if description else "",
        f"| Metric | Details |",
        f"|---|---|",
        f"| **Status** | {status_badge} |",
        f"| **Provider / Model** | `{provider}` / `{model}` |",
        f"| **Duration** | {duration_s:.1f}s |",
        f"| **Tool Invocations** | {len(steps)} |",
        "",
        "### 💬 Agent Response",
        "",
        answer.strip() if answer.strip() else "*(No textual response produced)*",
        "",
    ]

    if gate_refused:
        lines.extend([
            "### ⚠️ Permissions Refused",
            "The following tool calls were blocked because they were not listed in the automation's `actions` list:",
            "",
        ])
        for tool in gate_refused:
            lines.append(f"* `{tool}`")
        lines.append("")

    if steps:
        lines.extend([
            "### 🛠️ Execution Trace",
            "",
            "| Tool | Status | Detail | Duration |",
            "|---|---|---|---|",
        ])
        for step in steps:
            status_icon = "✅" if step.get("ok", True) else "❌"
            tool_name = f"`{step.get('name', 'unknown')}`"
            detail = (step.get("detail") or "")[:150].replace("\n", " ")
            ms = step.get("duration_ms")
            dur = f"{ms}ms" if ms is not None else "-"
            lines.append(f"| {tool_name} | {status_icon} | {detail} | {dur} |")
        lines.append("")

    return "\n".join(lines)


async def execute_automation(definition: dict[str, Any], workspace_root: str) -> int:
    """Run an automation definition end-to-end through Amethyst's Director."""
    from backend.agent.director import Director, Guards
    from backend.automation import RUN_TIMEOUT_SECONDS, UnattendedGate
    from backend.config import configured_providers, load_providers, load_tiers, paths
    from backend.db.connection import get_connection
    from backend.db.repositories import ConversationRepository, ExecutionLogRepository
    from backend.security.confirmation import ConfirmationService
    from backend.tools.registry import build_default_registry

    # 1. Ensure directory layout and database tables
    paths().ensure()
    get_connection()
    load_providers()

    name = definition.get("name", "unnamed_automation")
    description = definition.get("description", "")
    prompt = definition.get("prompt", "").strip()
    actions = definition.get("actions", [])

    if not prompt:
        log.error("Automation definition has an empty prompt.")
        return 1

    # 2. Select Provider & Model
    providers = configured_providers()
    if not providers:
        log.error(
            "No LLM provider has an API key configured. Please set at least one of: "
            "GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, CEREBRAS_API_KEY, GEMINI_API_KEY."
        )
        return 1

    requested_provider = definition.get("provider")
    if requested_provider and requested_provider != "auto" and requested_provider in providers:
        provider = requested_provider
    else:
        default_tier = load_tiers().get("default")
        if default_tier and default_tier.provider in providers:
            provider = default_tier.provider
        else:
            provider = sorted(providers.keys())[0]

    chosen = providers[provider]
    model = definition.get("model") or chosen.default_model or "default"

    log.info("Running automation '%s' with %s:%s", name, provider, model)

    # 3. Build Gated Registry
    gate = UnattendedGate(actions)
    confirmation = ConfirmationService(callback=gate)
    registry = build_default_registry(confirmation=confirmation, workspace_root=workspace_root)

    # 4. Open ephemeral conversation
    conv_repo = ConversationRepository()
    conversation_id = conv_repo.create(provider, model, f"{name} · cloud automation")

    # 5. Execute Turn
    director = Director(
        registry,
        workspace_root=workspace_root,
        stream=True,
        guards=Guards(max_iterations=24, max_seconds=float(RUN_TIMEOUT_SECONDS)),
    )

    answer = ""
    status = "ok"
    start_time = time.time()

    print(f"\n{'='*60}\n▶ Executing: {name}\nPrompt: {prompt}\n{'='*60}\n", flush=True)

    try:
        async with asyncio.timeout(RUN_TIMEOUT_SECONDS):
            async for event in director.run(conversation_id, prompt):
                if event.type in ("assistant_delta", "assistant_text"):
                    chunk = event.data.get("text", "")
                    answer += chunk
                    print(chunk, end="", flush=True)
                elif event.type == "tool_call":
                    tool_name = event.data.get("name")
                    log.info("Tool called: %s", tool_name)
                elif event.type == "error":
                    status = "error"
                    log.error("Director reported error: %s", event.data.get("message"))
                elif event.type == "guard":
                    status = "error"
                    log.error("Director stopped by guard: %s", event.data.get("reason"))
                elif event.type == "done":
                    final_text = event.data.get("text")
                    if final_text:
                        answer = final_text
    except TimeoutError:
        status = "error"
        log.error("Automation timed out after %d seconds", RUN_TIMEOUT_SECONDS)
    except Exception as exc:
        status = "error"
        log.exception("Unexpected error executing turn: %s", exc)

    duration = time.time() - start_time
    print(f"\n\n{'='*60}\n⏹ Completed in {duration:.1f}s (Status: {status})\n{'='*60}\n", flush=True)

    # 6. Retrieve step logs from ExecutionLogRepository
    steps: list[dict[str, Any]] = []
    try:
        rows = ExecutionLogRepository().conn.execute(
            "SELECT tool_name, error, duration_ms, result_summary FROM execution_logs "
            "WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        ).fetchall()
        for r in rows:
            steps.append({
                "name": r["tool_name"],
                "ok": not r["error"],
                "detail": r["error"] or r["result_summary"] or "",
                "duration_ms": r["duration_ms"],
            })
    except Exception as exc:
        log.warning("Could not fetch execution steps: %s", exc)

    if gate.refused and status != "error":
        status = "blocked"

    # 7. Write GitHub Step Summary if running in GitHub Actions
    summary_md = _format_markdown_summary(
        name=name,
        description=description,
        status=status,
        provider=provider,
        model=model,
        duration_s=duration,
        answer=answer,
        steps=steps,
        gate_refused=gate.refused,
    )

    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        try:
            with open(summary_file, "a", encoding="utf-8") as f:
                f.write(summary_md + "\n\n")
            log.info("Appended run summary to $GITHUB_STEP_SUMMARY")
        except Exception as exc:
            log.warning("Could not write to GITHUB_STEP_SUMMARY: %s", exc)

    return 0 if status in ("ok", "partial") else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Amethyst Cloud Automation Worker")
    parser.add_argument(
        "--automation",
        "-a",
        help="Path or name of the JSON automation definition file (e.g. 'example_briefing' or 'automations/example_briefing.json'). Pass 'all' to run all automations in directory.",
    )
    parser.add_argument(
        "--automation-file",
        help="Explicit path to the JSON automation definition file.",
    )
    parser.add_argument(
        "--automation-dir",
        default="automations",
        help="Directory containing automation JSON definitions (default: 'automations').",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all automation definitions found in the automations directory.",
    )
    parser.add_argument(
        "--automation-json",
        help="Inline JSON string of the automation definition.",
    )
    parser.add_argument(
        "--persistent",
        action="store_true",
        help="Do not clean up temporary AMETHYST_HOME upon completion.",
    )

    args = parser.parse_args(argv)

    files_to_run: list[Path] = []
    inline_definition = None

    if args.automation_json:
        try:
            inline_definition = json.loads(args.automation_json)
        except ValueError as exc:
            log.error("Invalid JSON provided to --automation-json: %s", exc)
            return 1
    elif args.all or args.automation == "all":
        dir_path = Path(args.automation_dir)
        if dir_path.is_dir():
            files_to_run = sorted(dir_path.glob("*.json"))
        if not files_to_run:
            log.warning("No .json files found in %s", dir_path)
            return 0
    else:
        target = args.automation_file or args.automation
        if not target:
            parser.error("Must provide an automation to run via --automation, --automation-file, or --all")

        path = Path(target)
        if not path.is_file() and not target.endswith(".json"):
            # Try looking in automation-dir
            candidate = Path(args.automation_dir) / f"{target}.json"
            if candidate.is_file():
                path = candidate

        if not path.is_file():
            log.error("Automation definition file not found: %s", target)
            return 1
        files_to_run.append(path)

    # Initialize scratch environment if AMETHYST_HOME is not explicitly set
    ephemeral = not os.environ.get("AMETHYST_HOME")
    temp_home = _setup_ephemeral_environment() if ephemeral else os.environ["AMETHYST_HOME"]

    try:
        if inline_definition:
            return asyncio.run(execute_automation(inline_definition, workspace_root=temp_home))

        overall_exit_code = 0
        for fpath in files_to_run:
            log.info("Processing automation file: %s", fpath)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    definition = json.load(f)
            except Exception as exc:
                log.error("Could not read %s: %s", fpath, exc)
                overall_exit_code = 1
                continue

            exit_code = asyncio.run(execute_automation(definition, workspace_root=temp_home))
            if exit_code != 0:
                overall_exit_code = exit_code

        return overall_exit_code
    finally:
        if ephemeral and not args.persistent:
            try:
                shutil.rmtree(temp_home, ignore_errors=True)
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
