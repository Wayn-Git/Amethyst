#!/usr/bin/env python3
"""Fill GitHub contribution graph with randomized commits across past days.

Usage:
    python3 scripts/fill_contributions.py [--days 14] [--min 2] [--max 6] [--email EMAIL] [--push]
"""

import argparse
import datetime
import os
import random
import subprocess
import sys


def get_git_config(key: str) -> str:
    try:
        out = subprocess.check_output(["git", "config", "--get", key], text=True).strip()
        return out
    except Exception:
        return ""


def run_cmd(cmd: list[str], env: dict[str, str] | None = None) -> None:
    subprocess.run(cmd, env=env, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate randomized commits for GitHub contribution graph.")
    parser.add_argument("--days", type=int, default=14, help="Number of past days to fill (default: 14)")
    parser.add_argument("--min", type=int, default=2, help="Minimum commits per day (default: 2)")
    parser.add_argument("--max", type=int, default=6, help="Maximum commits per day (default: 6)")
    parser.add_argument("--email", type=str, default=None, help="Author/committer email (default: git user.email)")
    parser.add_argument("--name", type=str, default=None, help="Author/committer name (default: git user.name)")
    parser.add_argument("--file", type=str, default=".activity", help="Activity log file (default: .activity)")
    parser.add_argument("--push", action="store_true", help="Push to origin after generating commits")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without committing")
    args = parser.parse_args()

    email = args.email or get_git_config("user.email") or "eosest65@gmail.com"
    name = args.name or get_git_config("user.name") or "wayn-wayn"

    print(f"Target author: {name} <{email}>")
    print(f"Range: past {args.days} days ({args.min}-{args.max} commits/day)")
    print(f"Tracking file: {args.file}")

    now = datetime.datetime.now()
    total_commits = 0

    messages = [
        "chore: routine telemetry ping",
        "chore(sync): update sync checkpoint",
        "refactor(core): streamline internal state cache",
        "docs: update maintenance log entry",
        "test: refresh local benchmark fixtures",
        "chore: touch build verification timestamp",
        "perf: optimize memory footprint on idle",
        "fix(cache): clean up stale temporary cache keys",
    ]

    for day_offset in range(args.days, -1, -1):
        target_date = now - datetime.timedelta(days=day_offset)
        count = random.randint(args.min, args.max)

        # Distribute hours across workday/evening
        hours = sorted(random.sample(range(9, 23), min(count, 14)))
        while len(hours) < count:
            hours.append(random.randint(9, 22))
        hours.sort()

        for h in hours:
            minute = random.randint(0, 59)
            second = random.randint(0, 59)
            dt = target_date.replace(hour=h, minute=minute, second=second, microsecond=0)
            iso_str = dt.isoformat()

            msg = random.choice(messages)
            total_commits += 1

            if args.dry_run:
                print(f"[dry-run] {iso_str} | {msg}")
                continue

            with open(args.file, "a") as f:
                f.write(f"{iso_str} - {msg}\n")

            env = os.environ.copy()
            env["GIT_AUTHOR_NAME"] = name
            env["GIT_AUTHOR_EMAIL"] = email
            env["GIT_AUTHOR_DATE"] = iso_str
            env["GIT_COMMITTER_NAME"] = name
            env["GIT_COMMITTER_EMAIL"] = email
            env["GIT_COMMITTER_DATE"] = iso_str

            run_cmd(["git", "add", args.file], env=env)
            run_cmd(["git", "commit", "-m", msg], env=env)

    print(f"Successfully generated {total_commits} commits over past {args.days} days.")

    if args.push and not args.dry_run:
        print("Pushing commits to origin...")
        branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
        run_cmd(["git", "push", "origin", branch])
        print(f"Pushed to origin/{branch}.")


if __name__ == "__main__":
    main()
