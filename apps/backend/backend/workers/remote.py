"""What runs inside a GitHub Actions runner. The only file that runs off-machine.

    python -m backend.workers.remote --job-id ... --task urls --params '{...}'

The workflow checks out *this* repository and runs this module, so a collector
has one implementation and it is the one in `backend/workers/collectors.py`. A
self-contained worker package copied into the two worker repos would be the same
code in three places, drifting apart within a month -- and the first symptom
would be a briefing that is subtly wrong rather than one that fails.

Three rules this side keeps, and each is a thing it deliberately cannot do:

**It never reads the local machine.** No SQLite, no keychain, no vault. It is
given a task and its parameters and it has an environment; that is everything.
`AMETHYST_HOME` is pointed at a scratch directory so anything that idly looks
for a config file finds an empty one rather than inventing state that dies with
the runner.

**It never handles a laptop credential.** Its own secrets -- the relay token, a
model key -- are GitHub Actions secrets in the worker repository, put there by a
person. Nothing arrives in the workflow inputs but the task, its parameters and
where to report.

**It reports, it does not return.** Results go to the relay, which is the only
address both sides can reach. The exit code is for the run log; the answer
travels over HTTP.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import tempfile
import time
from typing import Any

log = logging.getLogger("amethyst.worker")

#: How long the runner will spend on the task before reporting a timeout itself.
#: Below the workflow's own `timeout-minutes` on purpose: a worker that says
#: "this took too long" is worth much more than one GitHub kills silently.
DEFAULT_TIMEOUT = 540.0
REPORT_TIMEOUT = 20.0
#: Tries for the *report*, not the work. Losing an answer that was computed
#: because one POST failed is the one failure here that wastes a whole run.
REPORT_ATTEMPTS = 4


def _env_flag(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


async def post_report(
    relay_url: str,
    token: str,
    body: dict[str, Any],
    *,
    attempts: int = REPORT_ATTEMPTS,
) -> bool:
    """Tell the relay what happened. Retried, because the answer is the run."""
    import httpx

    url = relay_url.rstrip("/") + "/worker/report"
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=REPORT_TIMEOUT) as client:
                response = await client.post(
                    url, json=body, headers={"Authorization": f"Bearer {token}"}
                )
            if response.status_code < 300:
                return True
            # 401/400 will not improve with another try: a wrong token stays
            # wrong, and a malformed body stays malformed.
            if response.status_code in (400, 401, 403, 413):
                log.error("the relay refused the report: %s %s", response.status_code,
                          response.text[:200])
                return False
            log.warning("the relay answered %s", response.status_code)
        except Exception as exc:
            log.warning("could not reach the relay (%s/%s): %s", attempt, attempts, exc)
        if attempt < attempts:
            await asyncio.sleep(delay)
            delay *= 2
    return False


async def run(args: argparse.Namespace) -> int:
    relay_url = args.relay_url or os.environ.get("AMETHYST_RELAY_URL") or ""
    token = os.environ.get("AMETHYST_WORKER_TOKEN") or ""
    if not relay_url or not token:
        # Nothing useful can happen: the work might succeed and nobody would
        # ever learn the answer. Fail loudly in the run log instead.
        log.error("AMETHYST_RELAY_URL and AMETHYST_WORKER_TOKEN must both be set")
        return 2

    try:
        params = json.loads(args.params) if args.params else {}
    except ValueError as exc:
        await post_report(
            relay_url, token,
            {"job_id": args.job_id, "state": "failed", "error": f"bad params: {exc}"},
        )
        return 2
    if not isinstance(params, dict):
        params = {}
    # The remote side never decides to spend money. The flag is an Actions
    # variable a person sets on the worker repository, not something a dispatch
    # payload can turn on.
    params.setdefault("paid_ok", _env_flag("AMETHYST_ALLOW_PAID"))

    from backend.workers import collectors

    await post_report(
        relay_url, token,
        {"job_id": args.job_id, "state": "running",
         "progress": {"note": f"running {args.task}"}},
        attempts=1,  # a lost progress ping costs nothing; do not spend a minute on it
    )

    started = time.time()
    try:
        result = await asyncio.wait_for(
            collectors.run(args.task, params), timeout=args.timeout
        )
        body = {
            "job_id": args.job_id,
            "state": "completed",
            "result": result,
            "progress": {"done": 1, "total": 1, "note": f"{time.time() - started:.1f}s"},
        }
    except TimeoutError:
        body = {
            "job_id": args.job_id,
            "state": "failed",
            "error": f"{args.task} took longer than {args.timeout:.0f}s",
        }
    except collectors.NotConfigured as exc:
        body = {"job_id": args.job_id, "state": "failed", "error": str(exc)}
    except Exception as exc:
        log.exception("the task failed")
        body = {
            "job_id": args.job_id,
            "state": "failed",
            "error": f"{type(exc).__name__}: {exc}",
        }

    delivered = await post_report(relay_url, token, body)
    if not delivered:
        log.error("the work finished but the report could not be delivered")
        return 1
    return 0 if body["state"] == "completed" else 1


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr
    )
    parser = argparse.ArgumentParser(prog="amethyst-worker", description=__doc__)
    parser.add_argument("--job-id", required=True, help="the id this machine chose")
    parser.add_argument("--task", required=True, help="which collector to run")
    parser.add_argument("--params", default="{}", help="its parameters, as JSON")
    parser.add_argument("--relay-url", default="", help="where to report; else $AMETHYST_RELAY_URL")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    args = parser.parse_args(argv)

    # A scratch home, so nothing here reads or writes a real one. The runner is
    # thrown away after the job; anything that wanted to persist has the relay.
    if not os.environ.get("AMETHYST_HOME"):
        os.environ["AMETHYST_HOME"] = tempfile.mkdtemp(prefix="amethyst-worker-")

    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
