"""Asking a GitHub account to run something, and nothing else.

One call -- `workflow_dispatch` -- and three things that matter about it.

**Nothing returns a run id.** GitHub answers a dispatch with `204 No Content`.
There is no handle, so correlating the run to the work is only possible if the
name is one *this* machine chose first: every dispatch carries a `job_id` we
generated, the runner reports under it, and `backend/workers/reports.py` reads
it back. Polling GitHub for "which run was mine" would be guessing from
timestamps.

**No credential is ever in a payload.** The inputs carry a task name, its
parameters, and where to report -- that is all. The worker's own secrets (a
model key, the relay token) are GitHub Actions secrets in the worker repo, set
by a person once, and this side never sees or sends them. `_refuse_secrets`
enforces it against the same detector the audit log uses, because "we would
never put a token in there" is a promise and a check is a check.

**As little as possible goes over.** Workflow inputs are visible in the run's
own logs and to anyone with read access to that repository. So a URL batch
sends URLs, a monitor sends addresses, and anything that would mean copying a
person's mail or messages into a run log is `local_only` in
`backend/workers/collectors.py` and never arrives here.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.runtime.http import _client
from backend.secrets import get_secret, redact
from backend.workers.accounts import WorkerAccount, WorkerSettings, load_workers, token_ref

log = logging.getLogger(__name__)

API = "https://api.github.com"
TIMEOUT = 20.0

#: GitHub's own ceiling is 10 inputs and 65,535 characters each. This is far
#: below both, and it is a *data minimisation* limit rather than a protocol one:
#: a task whose parameters do not fit in 32k is a task sending too much to
#: somebody else's log.
MAX_INPUT_CHARS = 32_000


class DispatchRefused(RuntimeError):
    """The dispatch was not attempted. Another try will not change it."""


class DispatchFailed(RuntimeError):
    """GitHub refused or could not be reached. Worth another attempt."""


def _refuse_secrets(params: dict[str, Any]) -> None:
    """Refuse a payload that looks like it carries a credential.

    Checked with `backend.secrets.redact`, the detector the audit log already
    trusts, rather than a second list of patterns here that would drift away
    from it. If redaction would have changed anything, something in the payload
    is credential-shaped and it is not going to GitHub.
    """
    if redact(params) != params:
        raise DispatchRefused(
            "that payload looks like it carries a credential. Worker secrets belong"
            " in the worker repository's Actions secrets, never in a dispatch."
        )


def inputs_for(
    *, job_id: str, task: str, params: dict[str, Any], account: WorkerAccount, relay_url: str
) -> dict[str, str]:
    """The five strings a run is given. Checked before they are strings."""
    _refuse_secrets(params)
    encoded = json.dumps(params, default=str, separators=(",", ":"))
    if len(encoded) > MAX_INPUT_CHARS:
        raise DispatchRefused(
            f"that task's parameters are {len(encoded)} characters; the limit is"
            f" {MAX_INPUT_CHARS}. Send references rather than content."
        )
    if not account.source_repo:
        raise DispatchRefused(
            f"the {account.name} account does not say which AMETHYST the runner"
            " should check out; set source_repo in workers.yaml"
        )
    return {
        "job_id": job_id,
        "task": task,
        "params": encoded,
        "relay_url": relay_url,
        "source_repo": account.source_repo,
        "source_ref": account.source_ref,
    }


async def dispatch(
    account_name: str,
    *,
    job_id: str,
    task: str,
    params: dict[str, Any] | None = None,
    settings: WorkerSettings | None = None,
) -> dict[str, Any]:
    """Ask one account to run one task. Returns what was sent, never the token.

    Idempotency is the caller's: this is wrapped in `JobStore.step`, so a batch
    replayed after a crash returns the recorded dispatch instead of firing a
    second run. There is nothing this function could do about it on its own --
    `workflow_dispatch` has no idempotency key.
    """
    settings = settings if settings is not None else load_workers()
    account = settings.account(account_name)
    if not account.slug or not account.workflow:
        raise DispatchRefused(f"the {account_name} account has no repository configured")
    if not account.enabled:
        raise DispatchRefused(f"the {account_name} account is switched off")
    if not settings.relay_url:
        raise DispatchRefused(
            "no relay is configured, so a worker would have nowhere to report to"
        )

    token = get_secret(token_ref(account_name))
    if not token:
        raise DispatchRefused(
            f"no credential for the {account_name} account."
            f" Run: amethyst secrets set {token_ref(account_name)}"
        )

    body = {
        "ref": account.ref,
        "inputs": inputs_for(
            job_id=job_id,
            task=task,
            params=params or {},
            account=account,
            relay_url=settings.relay_url,
        ),
    }
    url = f"{API}/repos/{account.slug}/actions/workflows/{account.workflow}/dispatches"
    try:
        response = await _client(TIMEOUT).post(
            url,
            json=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "amethyst",
            },
        )
    except Exception as exc:
        raise DispatchFailed(f"could not reach GitHub: {type(exc).__name__}: {exc}") from exc

    if response.status_code == 204:
        log.info("dispatched %s to %s as %s", task, account.slug, job_id)
        return {
            "lane": account_name,
            "repo": account.slug,
            "workflow": account.workflow,
            "ref": account.ref,
            "job_id": job_id,
            "task": task,
        }

    detail = (response.text or "")[:300]
    if response.status_code in (401, 403):
        raise DispatchRefused(
            f"the {account_name} credential was refused by GitHub ({response.status_code})."
            " It needs Actions:write on that repository."
        )
    if response.status_code == 404:
        raise DispatchRefused(
            f"GitHub has no workflow '{account.workflow}' on {account.slug}@{account.ref}"
            " (or the credential cannot see it)"
        )
    if response.status_code == 422:
        # The workflow exists but will not take these inputs -- a renamed input,
        # a missing `workflow_dispatch` trigger. Retrying sends the same thing.
        raise DispatchRefused(f"GitHub refused those inputs: {detail}")
    raise DispatchFailed(f"GitHub answered {response.status_code}: {detail}")


async def check(account_name: str, *, settings: WorkerSettings | None = None) -> dict[str, Any]:
    """Whether this account is actually reachable, for a settings screen.

    A read, so it costs nothing and changes nothing -- and it answers the
    question a person actually has, which is "will the briefing run tomorrow"
    rather than "is there a string in the keychain".
    """
    settings = settings if settings is not None else load_workers()
    account = settings.account(account_name)
    status: dict[str, Any] = {**account.as_json(), "reachable": False, "note": ""}
    if not account.slug or not account.workflow:
        status["note"] = "no repository or workflow configured"
        return status
    token = get_secret(token_ref(account_name))
    if not token:
        status["note"] = f"no credential at {token_ref(account_name)}"
        return status
    try:
        response = await _client(TIMEOUT).get(
            f"{API}/repos/{account.slug}/actions/workflows/{account.workflow}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "amethyst",
            },
        )
    except Exception as exc:
        status["note"] = f"could not reach GitHub: {type(exc).__name__}"
        return status
    status["reachable"] = response.status_code == 200
    status["note"] = {
        200: "ready",
        401: "the credential was refused",
        403: "the credential cannot see that repository",
        404: "no such workflow",
    }.get(response.status_code, f"GitHub answered {response.status_code}")
    return status
