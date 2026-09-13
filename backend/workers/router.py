"""Where a piece of work runs. Not which model answers it.

`backend/runtime/router.py` chooses a *provider*. This chooses a *machine*, and
the two are deliberately separate files: one is about a request's shape against
a catalogue of endpoints, the other is about whether anybody is waiting and
whether the laptop will even be awake. Folding them together would make a
question about Groq's minute budget an input to a question about GitHub Actions.

Four places work can run, and the rule the requirement states:

    interactive / fast          -> local
    durable / offline           -> Cloudflare relay
    scheduled automation        -> the automation GitHub account
    on-demand parallel / batch  -> the sub-agent GitHub account

Like the provider router this *decides from facts already measured* -- is
somebody waiting, how many nodes are there, does the work need the local
database -- and it never asks a model. A routing decision that cannot be
explained in one sentence is one nobody can debug at seven in the morning when
the briefing did not arrive.

Two rules are absolute and come before the table:

  * Work that needs local data runs locally. The keychain, the SQLite file and
    the vault are on this machine; there is no remote arrangement that reaches
    them, and pretending otherwise would mean shipping the credentials.
  * A lane that is not configured is not a lane. Every decision carries the
    ordered fallbacks behind it, and `local` is always last and always works.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.workers.accounts import AUTOMATION, SUBAGENT, WorkerSettings, load_workers

#: This process. Always available, and the only lane that can touch local data.
LOCAL = "local"
#: The always-on Worker. For work whose deadline a closed laptop cannot meet.
CLOUDFLARE = "cloudflare"

LANES = (LOCAL, CLOUDFLARE, AUTOMATION, SUBAGENT)

#: Job kinds the relay actually registers (`relay/src/jobs/types/index.ts`).
#: Cloudflare is only a lane for work it already knows how to run -- a task not
#: in this set routes past it rather than being dispatched into a 400.
RELAY_KINDS = frozenset({"url_ingest", "document_fetch", "media_fetch"})

#: Above one node the work is a fan-out, which is the case the sub-agent account
#: exists for. At one node the dispatch round trip costs more than the work.
FANOUT = 2


@dataclass(frozen=True)
class ExecutionRequest:
    """What the caller knows about the work, in the terms this router reads.

    Every field defaults to an ordinary interactive single task, so a caller
    that describes nothing still gets `local` -- the answer that is never wrong,
    only sometimes slow.
    """

    #: The collector this runs, e.g. `urls`. Decides whether Cloudflare is even
    #: eligible, and whether the task is local-only.
    task: str = ""
    #: Whether somebody is watching. A briefing at seven can spend two minutes
    #: waiting for a runner to boot; a turn in the composer cannot.
    interactive: bool = True
    #: Put here by the clock rather than by a person.
    scheduled: bool = False
    #: How many nodes go out together.
    fanout: int = 1
    #: Touches the keychain, the database or the vault. A hard bar.
    needs_local_data: bool = False
    #: May run while this machine is off. What makes remote worth the round trip.
    offline_ok: bool = False
    #: Pin a lane. `None` means "decide", which is the useful answer almost
    #: always; a name here still falls back if that lane is not configured.
    prefer: str | None = None


@dataclass(frozen=True)
class ExecutionDecision:
    """The lane, what stands behind it, and why -- in a readable sentence."""

    lane: str
    reason: str
    #: Every lane considered, best first, including the one chosen. What a batch
    #: falls back to when a dispatch is refused at the door.
    order: tuple[str, ...] = ()
    #: Lanes that were preferred and passed over, with why. Kept because "it ran
    #: locally again" is only debuggable if the machine says what it wanted.
    rejected: dict[str, str] = field(default_factory=dict)

    def explain(self) -> str:
        passed = "; ".join(f"{lane}: {why}" for lane, why in self.rejected.items())
        return f"{self.lane} ({self.reason})" + (f" [passed over {passed}]" if passed else "")

    def as_json(self) -> dict[str, Any]:
        return {
            "lane": self.lane,
            "reason": self.reason,
            "order": list(self.order),
            "rejected": dict(self.rejected),
        }


def _available(lane: str, request: ExecutionRequest, settings: WorkerSettings) -> str:
    """Empty if this lane can take the work, else why it cannot."""
    if lane == LOCAL:
        return ""
    if request.needs_local_data:
        return "the work needs this machine's data"
    if lane == CLOUDFLARE:
        if not settings.relay_url:
            return "no relay is configured"
        if request.task and request.task not in RELAY_KINDS:
            return f"the relay does not run '{request.task}'"
        return ""
    account = settings.account(lane)
    if not account.enabled:
        return "the account is switched off"
    if not account.slug:
        return "no repository is configured"
    if not account.workflow:
        return "no workflow is configured"
    if not account.configured:
        return f"no credential at {account.name}"
    return ""


def _preference(request: ExecutionRequest) -> list[tuple[str, str]]:
    """The lanes worth trying, best first, with the reason each was wanted.

    This is the requirement's table and nothing else. It says what the work
    *wants*; `choose` decides what it can have.
    """
    wanted: list[tuple[str, str]] = []
    if request.prefer:
        wanted.append((request.prefer, "asked for by name"))

    if request.needs_local_data:
        # Stated here as well as barred in `_available`, so the explanation says
        # the true reason rather than reporting three lanes as misconfigured.
        wanted.append((LOCAL, "the work needs this machine's data"))
    elif request.scheduled:
        wanted.append((AUTOMATION, "a scheduled automation"))
        wanted.append((CLOUDFLARE, "recurring work that should survive a closed laptop"))
    elif request.fanout >= FANOUT:
        wanted.append((SUBAGENT, f"{request.fanout} tasks dispatched together"))
        wanted.append((CLOUDFLARE, "a batch that need not wait for this machine"))
    elif request.offline_ok and not request.interactive:
        wanted.append((CLOUDFLARE, "durable work with nobody waiting"))
        wanted.append((SUBAGENT, "durable work with nobody waiting"))
    elif request.interactive:
        wanted.append((LOCAL, "one task with somebody waiting"))

    wanted.append((LOCAL, "nothing else is configured"))
    # First mention of each lane wins, so a `prefer` keeps its own reason.
    seen: set[str] = set()
    return [
        (lane, why)
        for lane, why in wanted
        if lane in LANES and not (lane in seen or seen.add(lane))
    ]


def choose(
    request: ExecutionRequest | None = None,
    *,
    settings: WorkerSettings | None = None,
) -> ExecutionDecision:
    """Which lane runs this. Deterministic, and needs no network to answer."""
    request = request or ExecutionRequest()
    settings = settings if settings is not None else load_workers()

    order: list[str] = []
    rejected: dict[str, str] = {}
    chosen: tuple[str, str] | None = None
    for lane, why in _preference(request):
        refusal = _available(lane, request, settings)
        if refusal:
            rejected.setdefault(lane, refusal)
            continue
        order.append(lane)
        if chosen is None:
            chosen = (lane, why)

    # `_preference` always ends with local and `_available` never refuses it, so
    # this cannot be empty. Belt and braces: a lane list that came back empty
    # would be a routing bug that silently dropped work.
    if chosen is None:
        chosen = (LOCAL, "nothing else is configured")
        order.append(LOCAL)

    return ExecutionDecision(
        lane=chosen[0], reason=chosen[1], order=tuple(order), rejected=rejected
    )
