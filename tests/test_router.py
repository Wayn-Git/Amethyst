"""Phase 4: the dynamic router -- which provider is asked, and why.

`test_providers_and_fallback.py` locks down what happens when the chosen
provider cannot answer. This locks down the choosing: the scoring, the rate
limit ledger it reads, and the explanation it has to be able to produce.

Same convention as its sibling -- each test names the behaviour it pins and,
where the behaviour is easy to break silently, the source mutation that must
turn it red.
"""

from __future__ import annotations

import pytest

from backend.config import ProviderConfig
from backend.runtime import availability
from backend.runtime.chain import build_chain
from backend.runtime.failures import FailureKind
from backend.runtime.registry import ProviderNotConfigured, is_known_provider, resolve
from backend.runtime.router import (
    AUTO,
    LARGE_CONTEXT_TOKENS,
    RouteRequest,
    is_local,
    route,
    strengths_for,
)


@pytest.fixture(autouse=True)
def _forget_provider_state():
    availability.forget()
    availability.forget_usage()
    yield
    availability.forget()
    availability.forget_usage()


def _cloud(name: str, **kw) -> ProviderConfig:
    kw.setdefault("default_model", f"{name}-1")
    return ProviderConfig(name=name, api_key_ref=f"amethyst/{name}", **kw)


def _local(name: str = "ollama", **kw) -> ProviderConfig:
    kw.setdefault("default_model", f"{name}-1")
    return ProviderConfig(name=name, **kw)


def _configs(*configs: ProviderConfig) -> dict[str, ProviderConfig]:
    return {c.name: c for c in configs}


# --- the ledger -------------------------------------------------------------


def test_headroom_is_one_when_no_ceiling_is_declared():
    """An undeclared limit is unknown, not unlimited -- and not zero either.

    The one thing this must never do is guess a ceiling. A provider whose
    account limit nobody has written down has to compete on everything else,
    because a wrong number here would route around a provider that was fine,
    silently and for as long as the file said so.
    """
    availability.record_usage("groq", 500_000)
    assert availability.headroom(_cloud("groq")) == 1.0


def test_headroom_falls_as_the_minute_is_spent():
    """The whole point of the ledger: knowing before the 429 rather than after.

    Mutation check: make `record_usage` a no-op.
    """
    config = _cloud("groq", tokens_per_minute=8_000)
    assert availability.headroom(config) == 1.0
    availability.record_usage("groq", 2_000)
    assert availability.headroom(config) == pytest.approx(0.75)
    availability.record_usage("groq", 6_000)
    assert availability.headroom(config) == 0.0
    assert availability.spent("groq") == (8_000, 2)


def test_spend_outside_the_window_stops_counting(monkeypatch):
    """A rolling minute, not a running total.

    Without the trim the ledger only ever grows, so a long session ends with
    every provider reading as exhausted and the router steering away from all
    of them at once.

    Mutation check: delete the `_trim` call in `spent`.
    """
    import backend.runtime.availability as mod

    now = [1_000.0]
    monkeypatch.setattr(mod.time, "monotonic", lambda: now[0])
    mod.record_usage("groq", 5_000)
    assert mod.spent("groq")[0] == 5_000
    now[0] += mod.WINDOW_SECONDS + 1
    assert mod.spent("groq") == (0, 0)


# --- what the scoring actually prefers --------------------------------------


# Scoring is compared within one tier throughout: core is a tier above the
# user's own providers (see the core tests below), so a test that mixed the two
# would be measuring the tier and not the term it names. `groq` and `cerebras`
# are both non-core in the catalogue, which is what makes them the pair to
# score against each other.


def test_a_small_interactive_turn_prefers_the_fast_provider():
    """The fast endpoint for a one-line question, which is what it is there for.

    Mutation check: drop the `strength` term from `_score`.
    """
    configs = _configs(
        _cloud("big", strengths=frozenset({"large_context"}), context_window=1_000_000),
        _cloud("quick", strengths=frozenset({"fast"}), context_window=131_072),
    )
    decision = route(RouteRequest(context_tokens=400), configs=configs)
    assert decision.head.provider == "quick"


def test_a_large_turn_prefers_the_large_context_provider():
    """And the big-window one for the 200,000-token question, though it is listed second.

    The defect this exists for: file order decided both, so whichever provider
    someone happened to add first answered every question regardless of size.

    Mutation check: drop `large_context` from `_wanted`.
    """
    configs = _configs(
        _cloud("quick", strengths=frozenset({"fast"}), context_window=1_000_000),
        _cloud("big", strengths=frozenset({"large_context"}), context_window=1_000_000),
    )
    decision = route(RouteRequest(context_tokens=LARGE_CONTEXT_TOKENS + 1), configs=configs)
    assert decision.head.provider == "big"


def test_a_provider_near_its_limit_loses_to_an_idle_one():
    """Steering away from a rate limit rather than walking into it.

    Both are tagged `fast` and Groq is listed first, so file order and strength
    both say Groq. Ten percent of its minute left is what has to outweigh them.

    Mutation check: drop the `headroom` term from `_score` -- or score it as a
    bonus (`WEIGHTS["headroom"] * left`) rather than a penalty, which is the
    subtler break: declaring a ceiling then buys points when idle, and Groq
    wins again at 10%.
    """
    configs = _configs(
        _cloud("groq", context_window=131_072, tokens_per_minute=8_000),
        _cloud("cerebras"),
    )
    assert route(RouteRequest(context_tokens=400), configs=configs).head.provider == "groq"
    availability.record_usage("groq", 7_200)
    assert route(RouteRequest(context_tokens=400), configs=configs).head.provider == "cerebras"


def test_declaring_metadata_does_not_by_itself_win_points():
    """Two idle providers tie, whatever either of them has declared.

    `headroom` and `window` are penalties for this reason. As bonuses, the
    provider that published a tokens-per-minute ceiling started two points
    ahead of the one that published nothing -- so the file's most carefully
    described entry won every route on the strength of being described.

    Mutation check: flip either weight's sign in `WEIGHTS`.
    """
    described = _cloud("described", context_window=131_072, tokens_per_minute=8_000)
    bare = _cloud("bare")
    decision = route(RouteRequest(context_tokens=400), configs=_configs(described, bare))
    scores = {c.provider: c.score for c in decision.candidates}
    assert scores["described"] == scores["bare"]


def test_file_order_is_the_floor_when_nothing_distinguishes_providers():
    """A machine that declares nothing routes exactly as it did before this.

    The compatibility guarantee. Routing is allowed to reorder on evidence; it
    is not allowed to invent a preference where there is none, because
    providers.yaml's order is itself the user's stated preference.

    Mutation check: make the second sort key in `route` `row[2].provider`
    rather than `row[1]`, so equal scores come out alphabetical.
    """
    configs = _configs(_cloud("zeta"), _cloud("alpha"), _cloud("mid"))
    assert route(RouteRequest(), configs=configs).order == ["zeta", "alpha", "mid"]


def test_a_comfortable_window_is_not_a_penalty():
    """A 400-token question does not care that Groq's window is 131,072.

    Scored as a plain fraction it very slightly did: -0.005, enough to lose a
    tie to a provider that had never declared a window at all -- so publishing
    the number cost you the route, and the best-described entry in the file was
    the least likely to be picked.

    Mutation check: drop the `max(0.0, fills - 0.5) * 2` deadband in `_score`
    for a plain `fills`.
    """
    declared = _cloud("declared", context_window=131_072)
    bare = _cloud("bare")
    decision = route(RouteRequest(context_tokens=400), configs=_configs(declared, bare))
    scores = {c.provider: c.score for c in decision.candidates}
    assert scores["declared"] == scores["bare"]


def test_a_local_provider_is_not_preferred_for_an_interactive_turn():
    """Ollama listed first should not make every composer turn wait on it.

    Mutation check: remove the `local_online` term.
    """
    configs = _configs(_local("ollama"), _cloud("groq"))
    assert route(RouteRequest(context_tokens=400), configs=configs).head.provider == "groq"


# --- core is a tier, not a bonus ---------------------------------------------


def test_auto_prefers_a_core_provider_over_a_better_scoring_user_one():
    """Core first whenever any core provider can answer.

    Mutation check: drop `is_core` from the sort key in `route`.
    """
    configs = _configs(
        _cloud("groq", strengths=frozenset({"fast"})),  # not core, scores well
        _cloud("nvidia"),                               # core, scores nothing
    )
    assert route(RouteRequest(context_tokens=400), configs=configs).head.provider == "nvidia"


def test_scoring_still_decides_inside_the_core_pool():
    """The tier picks the pool; the evidence still picks the provider.

    A core provider is not picked because it is core, only ahead of a non-core
    one. Ranking the pool by anything but the evidence -- file order, say --
    would make the core set a fixed list in a fixed order, which is the
    behaviour this whole file replaces.

    Mutation check: drop the `headroom` term from `_score`, or make the sort
    key `(not is_core(...), row[1])` so file order decides inside the pool.
    """
    configs = _configs(
        _cloud("nvidia", tokens_per_minute=8_000),
        _cloud("mistral"),
    )
    assert route(RouteRequest(context_tokens=400), configs=configs).head.provider == "nvidia"
    availability.record_usage("nvidia", 7_600)
    assert route(RouteRequest(context_tokens=400), configs=configs).head.provider == "mistral"


def test_auto_falls_back_to_the_users_own_providers_when_no_core_one_can_answer():
    """Preferred, not exclusive. Auto must not dead-end on a bad day.

    Mutation check: filter non-core providers out of `ranked` instead of
    sorting them after.
    """
    configs = _configs(_cloud("nvidia"), _cloud("groq"))
    availability.record_exhausted("nvidia", retry_after=60, message="out of quota")
    decision = route(RouteRequest(context_tokens=400), configs=configs)
    assert decision.head.provider == "groq"


def test_a_provider_under_evaluation_is_never_auto_routed():
    """Nous stays in the picker and out of Auto's hands.

    Being evaluated is exactly the state where an unattended turn must not land
    on it, and exactly the state where someone wants to try it on purpose --
    which is why this bars routing and not selection.

    Mutation check: delete the `auto_routable` check in `_rejection`.
    """
    configs = _configs(_cloud("nous"), _cloud("groq"))
    decision = route(RouteRequest(), configs=configs)
    assert decision.head.provider == "groq"
    assert "nous" not in decision.order
    nous = next(c for c in decision.candidates if c.provider == "nous")
    assert "being evaluated" in nous.rejected


def test_a_hand_written_fallback_chain_still_reaches_a_no_auto_provider():
    """Barred from routing is not barred from use.

    The chain is what an explicit choice goes through, and it has no opinion
    about `auto_route` -- only about whether the provider is switched off.

    Mutation check: add an `auto_routable` check to `chain._usable`.
    """
    configs = _configs(_cloud("groq"), _cloud("nous"))
    chain = build_chain("groq", "groq-1", configs=configs, order=["nous"])
    assert [link.provider for link in chain] == ["groq", "nous"]


# --- exclusions, and saying why ---------------------------------------------


def test_a_request_over_a_declared_window_excludes_that_provider_with_a_reason():
    """Excluded, and the explanation says which number it was.

    Only a *declared* window. The adapters guess from substrings in the model
    name and silently answer 128,000 for anything unrecognised, so excluding on
    a guess would take working providers out on a number nobody checked.

    Mutation check: compare against `Capabilities.context_window`'s default
    rather than `config.context_window`, so an undeclared provider is excluded.
    """
    configs = _configs(_cloud("groq", context_window=131_072), _cloud("nodeclared"))
    decision = route(RouteRequest(context_tokens=200_000), configs=configs)
    rejected = {c.provider: c.rejected for c in decision.candidates if c.rejected}
    assert "131,072" in rejected["groq"]
    assert "nodeclared" not in rejected
    assert decision.head.provider == "nodeclared"


def test_an_exhausted_provider_is_excluded_but_still_explained():
    """"Why did it not use Groq" has to have an answer.

    A provider filtered out of the output cannot answer it, so a rejection is a
    candidate carrying a reason rather than an absence.

    Mutation check: `continue` past rejected providers instead of appending a
    `Candidate` with `rejected` set.
    """
    availability.record_exhausted("groq", retry_after=47, message="out of quota")
    configs = _configs(_cloud("groq"), _cloud("cerebras"))
    decision = route(RouteRequest(), configs=configs)
    assert decision.head.provider == "cerebras"
    assert "groq" not in decision.order
    groq = next(c for c in decision.candidates if c.provider == "groq")
    assert "out of quota" in groq.rejected
    assert "clears in" in groq.rejected


def test_a_bad_model_does_not_take_a_provider_out_of_the_running():
    """A 404 for a model name says nothing about the provider's health.

    The same rule `availability.record_failure` already enforces, checked from
    the router's side because the router is what now reads it.

    Mutation check: add `NON_RETRYABLE` to the kinds `record_failure` records.
    """
    availability.record_failure("groq", FailureKind.NON_RETRYABLE, "no such model")
    configs = _configs(_cloud("groq"), _cloud("cerebras"))
    assert route(RouteRequest(), configs=configs).head.provider == "groq"


def test_a_tool_cap_is_a_penalty_and_not_a_bar():
    """A low tool cap costs tools, not the turn.

    `fit_tools_to_budget` already trims the schemas to fit, so excluding on the
    cap would refuse a provider that would have answered -- with fewer tools,
    which is what a small client on the same free tier does implicitly.

    Mutation check: return a rejection from `_rejection` when `max_tools` is
    below `tool_count`.
    """
    configs = _configs(_cloud("groq", max_tools=128))
    decision = route(RouteRequest(tool_count=178), configs=configs)
    assert decision.head.provider == "groq"
    assert any("trimmed" in r for r in decision.candidates[0].reasons)


# --- the user's switches ----------------------------------------------------


def test_a_disabled_provider_is_gone_from_both_the_router_and_the_chain():
    """Switched off has to mean everywhere, including a hand-written chain.

    The router picks the order, but a conversation carrying its own `fallback`
    list bypasses the router entirely -- so checking only in the router would
    leave a setting that held everywhere except where someone had configured
    things by hand.

    Mutation check: delete the `enabled` check in `chain._usable` (the second
    assertion fails), or the one in `router._rejection` (the first).
    """
    configs = _configs(_cloud("groq", enabled=False), _cloud("cerebras"))
    assert route(RouteRequest(), configs=configs).head.provider == "cerebras"
    chain = build_chain("cerebras", "cerebras-1", configs=configs, order=["groq"])
    assert [link.provider for link in chain] == ["cerebras"]


def test_prefer_local_refuses_the_cloud_and_says_so():
    """The offline switch, as an explicit request rather than a guess."""
    configs = _configs(_cloud("groq"), _local("ollama"))
    decision = route(RouteRequest(prefer_local=True), configs=configs)
    assert decision.head.provider == "ollama"
    assert "local was asked for" in next(
        c.rejected for c in decision.candidates if c.provider == "groq"
    )


# --- the network being gone -------------------------------------------------


def test_every_cloud_provider_down_hoists_the_local_one():
    """A laptop on a train still answers, from the model already on it.

    Mutation check: remove the `local_offline` term from `_score`.
    """
    configs = _configs(_cloud("groq"), _cloud("google"), _local("ollama"))
    for name in ("groq", "google"):
        availability.record_failure(name, FailureKind.UNREACHABLE)
    decision = route(RouteRequest(context_tokens=400), configs=configs)
    assert decision.offline is True
    assert decision.head.provider == "ollama"
    assert any("nothing else is reachable" in r for r in decision.candidates[0].reasons)


def test_one_cloud_provider_down_is_not_offline():
    """`offline` means the network, not a provider. The difference is what the
    reasons mean: a local model at the top is right in one case and surprising
    in the other.

    Mutation check: make `offline` an `any(...)` rather than an `all(...)`.
    """
    configs = _configs(_cloud("groq"), _cloud("google"), _local("ollama"))
    availability.record_failure("groq", FailureKind.UNREACHABLE)
    decision = route(RouteRequest(context_tokens=400), configs=configs)
    assert decision.offline is False
    assert decision.head.provider == "google"


def test_nothing_configured_answers_with_no_head_rather_than_a_guess():
    """An empty machine gets None, which the caller must say out loud."""
    decision = route(RouteRequest(), configs={})
    assert decision.head is None
    assert decision.order == []


def test_everything_down_answers_with_no_head_and_every_reason():
    """The total-failure case, with the reasons a person needs to act on."""
    configs = _configs(_cloud("groq"), _local("ollama"))
    for name in configs:
        availability.record_failure(name, FailureKind.UNREACHABLE)
    decision = route(RouteRequest(), configs=configs)
    assert decision.head is None
    assert len(decision.candidates) == 2
    assert all(c.rejected for c in decision.candidates)


# --- strengths are data, and the user's file wins ---------------------------


def test_the_catalogue_supplies_strengths_and_providers_yaml_overrides_them():
    """Tags are facts about an endpoint, and the user gets the last word.

    Mutation check: read `preset(...)` before `config.strengths` in
    `strengths_for`.
    """
    assert "fast" in strengths_for(_cloud("groq"))
    assert "large_context" in strengths_for(_cloud("google"))
    overridden = _cloud("groq", strengths=frozenset({"reasoning"}))
    assert strengths_for(overridden) == frozenset({"reasoning"})


def test_an_unknown_provider_has_no_strengths_and_still_routes():
    """A custom endpoint nobody has tagged competes on measurements alone."""
    configs = _configs(_cloud("my-vllm-box"))
    assert strengths_for(configs["my-vllm-box"]) == frozenset()
    assert route(RouteRequest(), configs=configs).head.provider == "my-vllm-box"


def test_local_is_decided_by_the_credential_not_by_the_name():
    """The same test `availability.needs_probe` uses, for the same reason."""
    assert is_local(_local("ollama")) is True
    assert is_local(_cloud("groq")) is False
    assert is_local(ProviderConfig(name="x", api_key_env="X_API_KEY")) is False


# --- "auto" is a routing choice, not a provider ------------------------------


def test_auto_is_accepted_by_a_form_and_refused_by_resolve(amethyst_home):
    """The picker must be able to save it; the adapter must never be handed it.

    Without the `resolve` guard, "auto" falls through to the OpenAI-compatible
    adapter -- which builds a client quite happily and fails on the first round
    trip against a base URL nobody meant.

    Mutation check: delete the `AUTO` branch in `resolve`.
    """
    assert is_known_provider(AUTO) is True
    with pytest.raises(ProviderNotConfigured, match="routing choice"):
        resolve(AUTO)


def test_the_explanation_round_trips_as_json():
    """It is persisted on the run row and served over the API, so it has to be
    a plain structure -- not dataclasses that `json.dumps` refuses."""
    import json

    configs = _configs(_cloud("groq", tokens_per_minute=8_000), _cloud("google"))
    availability.record_usage("groq", 4_000)
    explained = route(RouteRequest(context_tokens=400), configs=configs).explain()
    assert json.loads(json.dumps(explained))["head"].startswith("g")
    assert {"head", "order", "offline", "candidates"} == set(explained)


# --- the HTTP surface --------------------------------------------------------


@pytest.fixture
def client(amethyst_home):
    from fastapi.testclient import TestClient

    from backend.api.main import app

    with TestClient(app) as c:
        yield c


def test_the_routing_route_never_returns_a_key(client, amethyst_home):
    """The same rule every other provider route holds to, on the newest one.

    `/api/routing` reads the whole provider config to score it, which is
    exactly the shape of code that leaks a credential by serialising an object
    instead of the fields it meant.

    Mutation check: add `get_secret(cfg.api_key_ref)` to the routing payload.
    """
    secret = "sk-should-never-appear"
    client.post("/api/providers", json={"name": "openai", "api_key": secret})
    assert secret not in client.get("/api/routing").text


def test_the_routing_route_explains_a_rejection(client, amethyst_home):
    """"Why did it not use Groq" has to be answerable from the interface.

    Mutation check: drop `rejected` from `Candidate.as_json`.
    """
    client.post("/api/providers", json={"name": "groq", "api_key": "gsk-x"})
    availability.record_exhausted("groq", retry_after=47, message="out of quota")

    body = client.get("/api/routing").json()
    groq = next(c for c in body["decision"]["candidates"] if c["provider"] == "groq")
    assert "out of quota" in groq["rejected"]
    row = next(p for p in body["providers"] if p["name"] == "groq")
    assert row["exhausted"] is True
    assert row["clears_in"] > 0


def test_a_provider_can_be_switched_off_and_back_on_over_http(client, amethyst_home):
    """Off keeps the entry and the key; DELETE keeps only the key.

    Mutation check: make the PATCH route call `remove_provider`.
    """
    client.post("/api/providers", json={"name": "groq", "api_key": "gsk-keep"})
    assert client.patch("/api/providers/groq", json={"enabled": False}).status_code == 200

    listed = client.get("/api/providers").json()["configured"]
    assert next(p for p in listed if p["name"] == "groq")["enabled"] is False
    # Still listed with its key, and no longer offered by the picker.
    assert next(p for p in listed if p["name"] == "groq")["has_key"] is True
    assert "groq" not in client.get("/api/health").json()["providers"]

    assert client.patch("/api/providers/groq", json={"enabled": True}).status_code == 200
    assert "groq" in client.get("/api/health").json()["providers"]


def test_switching_off_an_unknown_provider_is_a_404(client, amethyst_home):
    """A form acting on a stale list should be told, not silently succeed."""
    assert client.patch("/api/providers/nope", json={"enabled": False}).status_code == 404


def test_health_names_the_core_set_and_the_no_auto_set(client, amethyst_home):
    """So the picker can group them without a second round trip.

    Mutation check: drop `provider_core` from the health payload.
    """
    client.post("/api/providers", json={"name": "nvidia", "api_key": "nv-x"})
    client.post("/api/providers", json={"name": "groq", "api_key": "gsk-x"})

    body = client.get("/api/health").json()
    assert "nvidia" in body["provider_core"]
    assert "groq" not in body["provider_core"]
    assert body["routing"] is True


def test_a_conversation_can_be_created_on_auto(client, amethyst_home):
    """The picker's Auto entry has to be saveable, with no model named.

    Mutation check: remove the `AUTO` branch from `_validate_model`, which
    rejects it for declaring no `default_model`.
    """
    client.post("/api/providers", json={"name": "groq", "api_key": "gsk-x"})
    created = client.post("/api/conversations", json={"provider": "auto", "model": ""})
    assert created.status_code == 200


def test_a_preset_without_an_endpoint_is_refused_until_one_is_given(client, amethyst_home):
    """A gateway listed with no confirmed URL must not quietly post to OpenAI.

    The guard used to be "has a preset", which is the wrong question: a preset
    is a set of facts, and some of them deliberately omit the endpoint so the
    form can ask for it. OpenCode Zen and Nous are listed exactly that way, and
    both slipped through to `api.openai.com` -- where the 401 reads as a bad
    key rather than as a missing endpoint.

    Mutation check: restore `and not preset` on the base-URL check.
    """
    refused = client.post("/api/providers", json={"name": "opencode-zen", "api_key": "sk-x"})
    assert refused.status_code == 400
    assert "base URL" in refused.json()["detail"]

    ok = client.post(
        "/api/providers",
        json={
            "name": "opencode-zen",
            "base_url": "https://example.invalid/v1",
            "default_model": "zen-1",
            "api_key": "sk-x",
        },
    )
    assert ok.status_code == 200
    assert ok.json()["ready"] is True


def test_a_native_adapter_still_needs_no_base_url(client, amethyst_home):
    """Anthropic, Google and Ollama each know their own endpoint, so demanding
    one from the user would be asking for something AMETHYST already has.

    Mutation check: require a base URL unconditionally.
    """
    for name in ("anthropic", "google"):
        added = client.post("/api/providers", json={"name": name, "api_key": "k-x"})
        assert added.status_code == 200, name


def test_set_primary_provider_moves_to_top_and_aligns_default_tier(client, amethyst_home):
    client.post("/api/providers", json={"name": "google", "api_key": "k-1"})
    client.post("/api/providers", json={"name": "groq", "api_key": "k-2"})
    
    # Set groq as primary
    res = client.post("/api/providers/groq/primary")
    assert res.status_code == 200
    assert res.json()["primary"] == "groq"

    # Check providers list order
    p_res = client.get("/api/providers")
    names = [p["name"] for p in p_res.json()["configured"]]
    assert names[0] == "groq"


def test_reorder_providers_endpoint(client, amethyst_home):
    client.post("/api/providers", json={"name": "google", "api_key": "k-1"})
    client.post("/api/providers", json={"name": "groq", "api_key": "k-2"})
    
    res = client.post("/api/providers/reorder", json={"order": ["groq", "google"]})
    assert res.status_code == 200
    assert res.json()["order"][:2] == ["groq", "google"]
