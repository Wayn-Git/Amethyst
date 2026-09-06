"""Choosing which model turns text into vectors.

Every test names the mutation that makes it fail.

Nothing here reaches a provider. What is worth locking down is that a
configured embedder is actually used, that an explicit argument still wins, and
that the sentence a missing Ollama produces names a way out this machine has --
which is the bug this file exists because of: the index sat empty on a machine
with three working embedding providers configured, and the only advice on
offer was "install Ollama".
"""

from __future__ import annotations

import pytest
import yaml

from backend.config import (
    EMBEDDING_CANDIDATES,
    ProviderConfig,
    clear_embeddings,
    load_embeddings,
    save_embeddings,
)
from backend.retrieval import embeddings as emb
from backend.retrieval.embeddings import Embedder, configured_embedders, detect


@pytest.fixture
def providers_yaml(tmp_path, monkeypatch):
    path = tmp_path / "providers.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "providers": [{"name": "cloudflare", "api_key_ref": "psok/cloudflare"}],
                "memory": {"provider": "ollama", "model": "qwen2.5:3b"},
            }
        )
    )

    class Paths:
        providers_yaml = path

    monkeypatch.setattr("backend.config.paths", lambda: Paths())
    return path


def test_nothing_configured_means_the_local_default(providers_yaml):
    """Mutation check: return a provider when the block is absent."""
    assert load_embeddings() is None
    assert Embedder().provider == "ollama"


def test_a_configured_embedder_is_the_one_that_gets_used(providers_yaml):
    """`Embedder()` used to mean Ollama unconditionally, so a machine without it
    had an unusable index while a working endpoint sat in providers.yaml. This is
    the whole point of the setting.

    Mutation check: keep `provider: str = "ollama"` as the default argument.
    """
    save_embeddings("cloudflare", "@cf/baai/bge-base-en-v1.5")
    embedder = Embedder()
    assert (embedder.provider, embedder.model) == ("cloudflare", "@cf/baai/bge-base-en-v1.5")


def test_an_explicit_argument_still_wins(providers_yaml):
    """`psok index --provider x` has to override the setting, or there is no way
    to try one without committing to it.

    Mutation check: read the setting before looking at the arguments.
    """
    save_embeddings("cloudflare", "@cf/baai/bge-base-en-v1.5")
    embedder = Embedder("ollama", "nomic-embed-text")
    assert embedder.provider == "ollama"


def test_the_setting_leaves_the_rest_of_the_file_alone(providers_yaml):
    """providers.yaml carries the providers, the memory model and the tiers. A
    writer that rewrites the document instead of one key destroys the others.

    Mutation check: write only the embeddings block to the file.
    """
    save_embeddings("cloudflare", "@cf/baai/bge-m3")
    raw = yaml.safe_load(providers_yaml.read_text())
    assert raw["memory"] == {"provider": "ollama", "model": "qwen2.5:3b"}
    assert raw["providers"][0]["name"] == "cloudflare"
    assert raw["embeddings"] == {"provider": "cloudflare", "model": "@cf/baai/bge-m3"}


def test_clearing_goes_back_to_the_default(providers_yaml):
    """Mutation check: leave the block in place on clear."""
    save_embeddings("cloudflare", "@cf/baai/bge-m3")
    clear_embeddings()
    assert load_embeddings() is None
    assert yaml.safe_load(providers_yaml.read_text())["memory"], "clear removed too much"


def test_an_incomplete_setting_is_ignored_rather_than_half_applied(providers_yaml):
    """A block naming a provider and no model would otherwise produce an embedder
    pointed at a provider with the *local* default model -- a request that fails
    for a reason nothing explains.

    Mutation check: return the provider with a None model.
    """
    raw = yaml.safe_load(providers_yaml.read_text())
    raw["embeddings"] = {"provider": "cloudflare"}
    providers_yaml.write_text(yaml.safe_dump(raw))
    assert load_embeddings() is None


def test_both_halves_are_required_when_setting_one(providers_yaml):
    """Mutation check: accept an empty model."""
    with pytest.raises(ValueError):
        save_embeddings("cloudflare", "")


# ------------------------------------------------------------- the sentence


def test_a_missing_ollama_names_a_provider_that_would_work(monkeypatch):
    """"Install Ollama" is right on a machine with nothing else and wrong on one
    with a working endpoint already configured -- which is how this index stayed
    empty. The alternative is named when there is one.

    Mutation check: return the bare Ollama sentence.
    """
    monkeypatch.setattr(
        emb,
        "load_providers",
        lambda: {
            "cloudflare": ProviderConfig(name="cloudflare"),
            "groq": ProviderConfig(name="groq"),
        },
    )
    message = Embedder("ollama", "nomic-embed-text")._ollama_missing("http://localhost:11434", "no")
    assert "cloudflare" in message
    assert "psok embeddings detect" in message
    assert "groq" not in message, "groq serves no embeddings and must not be offered"


def test_with_nothing_else_configured_the_sentence_stays_about_ollama(monkeypatch):
    """Naming alternatives that do not exist is worse than naming none.

    Mutation check: always append the alternatives line.
    """
    monkeypatch.setattr(emb, "load_providers", lambda: {"groq": ProviderConfig(name="groq")})
    message = Embedder("ollama", "nomic-embed-text")._ollama_missing("http://localhost:11434", "no")
    assert "ollama pull" in message
    assert "psok embeddings detect" not in message


def test_only_configured_candidates_are_offered(monkeypatch):
    """Mutation check: return every key of EMBEDDING_CANDIDATES."""
    monkeypatch.setattr(emb, "load_providers", lambda: {"cloudflare": ProviderConfig(name="c")})
    assert configured_embedders() == ["cloudflare"]
    assert "openrouter" in EMBEDDING_CANDIDATES, "the candidate table still lists the others"


async def test_detect_reports_one_working_model_per_provider(monkeypatch):
    """A provider that answers is offered once. Listing every model it serves
    turns a two-line answer into a menu nobody needs.

    Mutation check: drop the `break` after the first model that answers.
    """
    monkeypatch.setattr(
        emb, "load_providers", lambda: {"cloudflare": ProviderConfig(name="cloudflare")}
    )

    async def fake_embed_one(self, _text):
        if self.provider == "cloudflare":
            return [0.0] * 768
        raise emb.EmbeddingError("nothing here")

    monkeypatch.setattr(Embedder, "embed_one", fake_embed_one)
    found = await detect()
    assert found == [("cloudflare", "@cf/baai/bge-base-en-v1.5", 768)]


async def test_detect_returns_nothing_rather_than_guessing(monkeypatch):
    """Mutation check: return the candidate table when every probe fails."""
    monkeypatch.setattr(emb, "load_providers", lambda: {})

    async def always_fails(self, _text):
        raise emb.EmbeddingError("no")

    monkeypatch.setattr(Embedder, "embed_one", always_fails)
    assert await detect() == []
