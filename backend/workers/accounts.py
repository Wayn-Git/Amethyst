"""The two remote worker accounts, and the wall between them.

AMETHYST dispatches work to GitHub Actions in two places that are deliberately
*two accounts* rather than two workflows in one:

  `automation`  runs what the clock asks for -- a briefing at seven, a mailbox
                swept every hour, a page watched for changes. It runs whether or
                not anybody is at the machine, which is the whole reason it is
                not local.
  `subagent`    runs what the agent asks for, now, in parallel -- twenty URLs,
                three lookups, a fan-out the main turn should not sit through.

Separate accounts because a credential is only as isolated as the blast radius
of the thing holding it. The scheduled side holds long-lived access to a
mailbox; the on-demand side is reachable from anything the agent decides to do
with a sentence a person typed. One compromised runner reaching both would make
the split cosmetic.

Nothing in this file ever sees a token. Each account's credential lives in the
OS keychain under a ref derived from the account's *name* -- so there is no
parameter anywhere that could be passed the wrong one, and `workers.yaml` can be
read, copied and pasted into a bug report without leaking anything.

What is in the config file is where to send work: an owner, a repo, the workflow
file to trigger, and which commit of AMETHYST the runner should check out. The
runner is this repository (`backend/workers/remote.py`), so the worker repos
hold a workflow file and their own Actions secrets and no code of ours.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import yaml

from backend.config import paths
from backend.secrets import SERVICE, get_secret

log = logging.getLogger(__name__)

#: The two names, and the only values an account key ever holds. Used as the
#: lane names in `backend/workers/router.py` too, so a decision reads as the
#: account it names.
AUTOMATION = "automation"
SUBAGENT = "subagent"
ACCOUNTS = (AUTOMATION, SUBAGENT)


def token_ref(account: str) -> str:
    """Where this account's credential lives. Derived, never passed in.

    A fine-grained PAT scoped to that one repository with Actions:write and
    nothing else. `amethyst secrets set amethyst/github-subagent-token` puts it
    there; nothing in AMETHYST ever writes it to a file or a payload.
    """
    if account not in ACCOUNTS:
        raise ValueError(f"{account!r} is not a worker account")
    return f"{SERVICE}/github-{account}-token"


@dataclass(frozen=True)
class WorkerAccount:
    """Where one account's work goes. No credential, by construction."""

    name: str
    owner: str = ""
    repo: str = ""
    #: The workflow file in that repo, e.g. `subagent.yml`. Dispatched by file
    #: name because that is the one identifier that survives a rename of the
    #: workflow's `name:` field.
    workflow: str = ""
    #: Which branch of the worker repo the workflow runs from.
    ref: str = "main"
    #: Which AMETHYST the runner checks out. Pin it to a tag in anger: a worker
    #: silently following `main` is a worker whose behaviour changes under you.
    source_repo: str = ""
    source_ref: str = "main"
    enabled: bool = True
    #: Wall-clock ceiling handed to the runner, so a hung collector costs one
    #: run rather than the account's whole minute budget.
    timeout_seconds: int = 600

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}" if self.owner and self.repo else ""

    @property
    def configured(self) -> bool:
        """Whether work can actually be sent here.

        Asked of the keychain as well as the file: a `workers.yaml` naming a
        repo whose token was never set is a lane that would fail on every
        dispatch, and the router must route around it rather than into it.
        """
        if not (self.enabled and self.owner and self.repo and self.workflow):
            return False
        try:
            return bool(get_secret(token_ref(self.name)))
        except Exception as exc:  # a locked keychain is "not configured", not a crash
            log.debug("could not read the %s worker token: %s", self.name, exc)
            return False

    def as_json(self) -> dict[str, Any]:
        """What an interface is shown. There is no credential to withhold."""
        return {
            "name": self.name,
            "repo": self.slug,
            "workflow": self.workflow,
            "ref": self.ref,
            "source": f"{self.source_repo}@{self.source_ref}" if self.source_repo else "",
            "enabled": self.enabled,
            "configured": self.configured,
            "token_ref": token_ref(self.name),
        }


@dataclass(frozen=True)
class WorkerSettings:
    accounts: dict[str, WorkerAccount] = field(default_factory=dict)
    #: Where workers post their results. Defaults to the Instagram relay's URL,
    #: because it is the same Worker -- one always-on mailbox, not two.
    relay_url: str = ""
    #: Whether a worker may spend money on a model. Off, and it is the reason
    #: `backend/workers/llm.py` will return no summary rather than quietly
    #: reaching for a paid endpoint.
    allow_paid_models: bool = False

    def account(self, name: str) -> WorkerAccount:
        return self.accounts.get(name) or WorkerAccount(name=name)


def _account_from(name: str, raw: Any) -> WorkerAccount:
    data = raw if isinstance(raw, dict) else {}
    repo = str(data.get("repo") or "").strip()
    owner = str(data.get("owner") or "").strip()
    # `owner/repo` in one field is what a person pastes from the address bar.
    if "/" in repo and not owner:
        owner, _, repo = repo.partition("/")
    return WorkerAccount(
        name=name,
        owner=owner,
        repo=repo,
        workflow=str(data.get("workflow") or "").strip(),
        ref=str(data.get("ref") or "main").strip() or "main",
        source_repo=str(data.get("source_repo") or "").strip(),
        source_ref=str(data.get("source_ref") or "main").strip() or "main",
        enabled=data.get("enabled", True) is not False,
        timeout_seconds=int(data.get("timeout_seconds") or 600),
    )


def load_workers() -> WorkerSettings:
    """Read `workers.yaml`. Never raises -- an unreadable file is "not set up"."""
    path = paths().workers_yaml
    raw: Any = {}
    try:
        if path.exists():
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        log.warning("could not read %s: %s", path, exc)
        raw = {}
    if not isinstance(raw, dict):
        raw = {}

    relay = str(raw.get("relay_url") or "").strip()
    if not relay:
        # One mailbox. The Instagram relay is already deployed, already holds a
        # token this machine rotates, and is already polled every fifteen
        # seconds -- a second Worker would be a second thing to keep alive.
        try:
            from backend.config import load_instagram

            relay = (load_instagram().relay_url or "").strip()
        except Exception:
            relay = ""

    return WorkerSettings(
        accounts={name: _account_from(name, raw.get(name)) for name in ACCOUNTS},
        relay_url=relay.rstrip("/"),
        allow_paid_models=raw.get("allow_paid_models") is True,
    )


def save_workers(patch: dict[str, Any]) -> WorkerSettings:
    """Merge `patch` into `workers.yaml` and return the whole thing as stored.

    Credentials are refused rather than ignored. A `token` key here would be one
    written to a file in plain text, and silently dropping it would leave
    somebody believing they had configured the account.
    """
    for name in ACCOUNTS:
        section = patch.get(name)
        if isinstance(section, dict) and ({"token", "pat", "secret"} & set(section)):
            raise ValueError(
                f"a worker token does not go in workers.yaml -- run:"
                f" amethyst secrets set {token_ref(name)}"
            )

    path = paths().workers_yaml
    path.parent.mkdir(parents=True, exist_ok=True)
    current: Any = {}
    try:
        if path.exists():
            current = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        current = {}
    if not isinstance(current, dict):
        current = {}

    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            current[key].update(value)
        else:
            current[key] = value

    path.write_text(yaml.safe_dump(current, sort_keys=False), encoding="utf-8")
    return load_workers()
