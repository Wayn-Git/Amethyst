#!/usr/bin/env python3
"""CLI entry point for the local Amethyst Widget Factory."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from widget_factory.common import connect, read_prompts, sync_prompt_tasks
from widget_factory.generation import generate, generate_batch, register_image
from widget_factory.mcp_server import mcp_server
from widget_factory.queue import (
    claim,
    complete,
    fail,
    finalize_integration,
    heartbeat,
    integrate,
    integration_queue,
    progress,
    retry,
    task_history,
    task_rows,
)


def cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local Amethyst widget factory")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate-prompts")
    gen = sub.add_parser("generate")
    gen.add_argument("widget_id")
    gen.add_argument("--prompt")
    gen.add_argument("--reference-image", type=Path, action="append")
    sub.add_parser("generate-batch")
    img = sub.add_parser("register-image")
    img.add_argument("widget_id")
    img.add_argument("image", type=Path)
    for command in ("list", "status", "integration-queue"):
        sub.add_parser(command)
    history = sub.add_parser("history")
    history.add_argument("widget_id")
    history.add_argument("--session-id")
    claim_cmd = sub.add_parser("claim")
    claim_cmd.add_argument("session_id")
    claim_cmd.add_argument("--widget-id")
    retry_cmd = sub.add_parser("retry")
    retry_cmd.add_argument("widget_id")
    retry_cmd.add_argument("--session-id")
    hb = sub.add_parser("heartbeat")
    hb.add_argument("widget_id")
    hb.add_argument("session_id")
    report = sub.add_parser("report")
    report.add_argument("widget_id")
    report.add_argument("session_id")
    report.add_argument("--status", choices=("implementing", "review"), default="implementing")
    report.add_argument("detail")
    done = sub.add_parser("complete")
    done.add_argument("widget_id")
    done.add_argument("session_id")
    done.add_argument("commit_sha")
    done.add_argument("report")
    fail_cmd = sub.add_parser("fail")
    fail_cmd.add_argument("widget_id")
    fail_cmd.add_argument("session_id")
    fail_cmd.add_argument("error")
    integ = sub.add_parser("integrate")
    integ.add_argument("widget_id")
    integ.add_argument("session_id")
    finalize = sub.add_parser("finalize")
    finalize.add_argument("widget_id")
    finalize.add_argument("session_id")
    finalize.add_argument("manager_report")
    finalize.add_argument("--cleanup", action="store_true")
    sub.add_parser("mcp")
    args = parser.parse_args(argv)
    try:
        if args.command == "validate-prompts":
            result: Any = {"valid": True, "widgets": list(read_prompts())}
        elif args.command == "generate":
            prompt = args.prompt or read_prompts().get(args.widget_id)
            if prompt is None:
                raise ValueError("Supply --prompt or define this ID in prompts/widgets.md")
            ref_imgs = [p.expanduser().resolve() for p in args.reference_image] if args.reference_image else None
            reference_arg = ref_imgs if ref_imgs and len(ref_imgs) > 1 else (ref_imgs[0] if ref_imgs else None)
            result = generate(args.widget_id, prompt, reference_image=reference_arg)
        elif args.command == "generate-batch":
            result = generate_batch()
        elif args.command == "register-image":
            result = register_image(args.widget_id, args.image.expanduser().resolve())
        elif args.command == "list":
            sync_prompt_tasks(read_prompts())
            db = connect()
            try:
                result = task_rows(db)
            finally:
                db.close()
        elif args.command == "status":
            sync_prompt_tasks(read_prompts())
            db = connect()
            try:
                rows = task_rows(db)
            finally:
                db.close()
            print(f"{'WIDGET':28} {'STATUS':14} {'TRIES':>5} {'INTEGRATION':22}")
            for row in rows:
                print(
                    f"{row['widget_id'][:28]:28} {row['status']:14} "
                    f"{row['attempts']:>5} {row['integration_status']:22}"
                )
            return 0
        elif args.command == "history":
            result = task_history(args.widget_id, args.session_id)
        elif args.command == "integration-queue":
            result = integration_queue()
        elif args.command == "claim":
            result = claim(args.widget_id, args.session_id)
        elif args.command == "retry":
            result = retry(args.widget_id, args.session_id)
        elif args.command == "heartbeat":
            result = heartbeat(args.widget_id, args.session_id)
        elif args.command == "report":
            result = progress(args.widget_id, args.session_id, args.status, args.detail)
        elif args.command == "complete":
            result = complete(args.widget_id, args.session_id, args.commit_sha, args.report)
        elif args.command == "fail":
            result = fail(args.widget_id, args.session_id, args.error)
        elif args.command == "integrate":
            result = integrate(args.widget_id, args.session_id)
        elif args.command == "finalize":
            result = finalize_integration(
                args.widget_id, args.session_id, args.manager_report, args.cleanup
            )
        elif args.command == "mcp":
            mcp_server().run("stdio")
            return 0
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"widget-factory: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(cli())
