# ADR-0023: Deterministic routing over the existing fallback chain

## Status

Proposed

## Context

`backend/runtime/chain.py` already answers "this provider is down, who else",
and answers it well: a shared `AttemptBudget`, a failure taxonomy that separates
retrying from falling back, availability that honours a provider's own
`Retry-After`. What it never did was *choose*.

`build_chain`'s candidate order was providers.yaml's order. That is a stated
preference about providers in general and says nothing about the turn in front
of it, so a 200,000-token question and a one-line question both went to
whichever entry happened to be first in the file. On the machine this was built
against, that meant the fast free-tier provider answered the work that needed
the big window, and the big-window provider answered the work that needed the
round trip.

Three further gaps sat behind that one:

- **`tokens_per_minute` was a ceiling nothing counted against.** It was read
  once per turn, to decide whether a single request was too big. Nothing tracked
  what had already been spent, so a rate limit could only ever be discovered by
  tripping it — three near-identical 413s two minutes apart, in the real
  database.
- **A decision with no record.** `agent_runs` stores `link`, the provider that
  answered. Nothing stored why it was asked.
- **No way to stop using a provider without deleting it.** `remove_provider`
  drops the entry, and the next Settings visit offers to re-add it from the
  catalogue, so "stop using this for now" and "I have never heard of this" were
  the same gesture.

## Decision

**Routing produces an order, not a mechanism.** `build_chain` already accepts
`order=`; `backend/runtime/router.py` computes it. Nothing downstream changed —
same chain, same budget, same taxonomy, same announcements. A conversation that
states its own `fallback` list still bypasses routing entirely.

**Scoring is deterministic, and there is no classifier.** Every input is a
number the loop has already measured or a fact already in providers.yaml:
request size and tool count (the TPM precheck computes both), vision need
(the attachments are in hand), headroom (the new ledger), health
(`availability.cached`), local-ness (whether a credential is declared). A
classifier would spend a model call at the head of every turn re-deriving
figures the turn already has, and would make the one part of routing that must
be explainable the one part that could not be. Revisit only on evidence of
routing picking wrong with all of the above correct.

**Quotas are never compiled in.** The only ceiling read is `tokens_per_minute`,
declared per account in providers.yaml. The catalogue's `strengths` tags are
facts about an endpoint's character — of the same kind, and the same shelf life,
as the `context_window` sitting beside them.

**Core is a tier, not a bonus.** A small set of providers is marked `core` in
the catalogue; the router sorts core-first and scores within each pool. A
constant score bonus would behave identically today, but only while no score can
reach it — a magic number carrying an unwritten invariant, enforced nowhere. The
sort key states the rule instead of encoding it in arithmetic. Core is preferred
whenever any core provider can answer, and never exclusive: a provider that
cannot answer is not in the ranking at all, so "no core provider is available"
and "the core pool is empty" are the same thing, and the user's own providers
are reached with no special case.

**Penalties, not bonuses, for declared metadata.** Scored as bonuses, headroom
and window made publishing a number worth points: a provider that declared a
tokens-per-minute ceiling started ahead of one that declared nothing, so an
almost-exhausted provider still beat an idle peer — the exact steer the ledger
exists to make, backwards. As penalties, "nothing declared" and "declared and
comfortable" both score zero, which is the honest reading: an unknown ceiling
cannot be steered by, so it must not move the score. The window penalty carries
a deadband for the same reason.

**The ledger is in memory.** AMETHYST runs one uvicorn worker by design, so
there is no second process to stay coherent with, and losing the window to a
restart costs at most one 429 — which `record_exhausted` already absorbs, using
the provider's own `Retry-After` rather than a guess. A table would buy
durability for a number that is stale after sixty seconds.

## Consequences

- A machine that declares no `strengths` and has spent nothing routes exactly as
  it did before: the ranking's last sort key is providers.yaml's order, which is
  the only stated preference such a machine ever gives.
- Routing is inspectable. `RouteDecision.explain()` is persisted on
  `agent_runs.state.route` and served by `GET /api/routing`, and every excluded
  provider stays in the candidate list carrying the reason it was excluded — a
  provider that vanished from the output could not answer "why not that one".
- `auto_route: false` gives an endpoint under evaluation a real state: offered
  in the picker, honoured in a hand-written chain, never chosen unattended.
- `enabled: false` gives a provider the middle state between configured and
  deleted, and is checked in both the router and `chain._usable` — the chain
  too, because a conversation's own fallback list bypasses the router, and a
  setting that held everywhere except where someone configured things by hand
  would be worse than no setting.
- `"auto"` is stored in `conversations.provider` like any other name, so no
  second column and no nullable one. It is the one value `is_known_provider`
  accepts that `resolve` refuses.

## Addendum: two failure paths this exposed

Neither is routing, but both were found by the same investigation and are
recorded here because the ADR is where someone will look.

**A mid-answer failure could only be retried on the provider that had just
failed.** `can_hand_over` was gated on `not streamed_text`, because a second
provider would have *restarted* the answer underneath the half already on
screen. That reasoning stopped being true when resumes shipped: `state.carried`
is rebuilt into the wire as an assistant message plus `RESUME_AFTER_CUT`, and
neither is provider-specific, so a different provider continues a cut answer
exactly the way the same one does. With the guard in place, once `max_resumes`
ran out the turn died holding half a sentence with healthy providers still in
the chain.

**A turn holding a complete answer still ended on an `error` frame.** The
terminal path persisted the text with `[model error] ...` under it and emitted
`error`, so a provider that sent an error frame instead of closing its stream
cleanly turned a finished, correct turn into a red card. It now ends on `guard`
/ `stopped` when there is an answer and `error` / `failed` only when there is
not. `stopped` rather than `completed` is deliberate: `resumable` is `carried
and phase != "completed"`, so `completed` would have silently retired the
pickup offer from ADR-0021.

Both also motivated `merge_partial`, which drops a repeated seam once when a
continuation restates the clause it was cut off in — more common across a
hand-over, where the model being asked to carry on never wrote the text it is
carrying on from.

## Alternatives considered

- **A local 3B classifier in front of routing.** Rejected for v1, on the
  instruction to check first whether deterministic routing was insufficient. It
  is not: see the table in `backend/runtime/router.py`'s module docstring.
- **Replacing the chain.** The chain's hard-won parts — one shared budget, "no
  fallback on a bad request", "no fallback mid-answer" — are orthogonal to
  choosing, and rebuilding them to add choosing would have put all three at
  risk for no gain.
- **A durable `provider_usage` table.** Buys restart-survival and usage history.
  History is a different feature (spend over time, not routing) and can be added
  without touching the router.
