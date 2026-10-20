"""Tests verifying accurate code repository resolution and enrichment in backend/library/enrich.py."""

import pytest
from backend.library.enrich import (
    RESOURCE_TYPES,
    resolve_entity_url,
    _clean_resource,
    parse_enrichment,
)


def test_resource_types_includes_repo_and_code():
    assert "repo" in RESOURCE_TYPES
    assert "code" in RESOURCE_TYPES


def test_resolve_entity_url_detects_github_repo():
    url = resolve_entity_url("vllm-project/vllm", "repo")
    assert "github.com" in url

    url2 = resolve_entity_url("fastapi", "code")
    assert "github.com" in url2


def test_clean_resource_normalizes_repository():
    raw = {
        "name": "vllm-project/vllm",
        "type": "repo",
        "detail": "High-throughput and memory-efficient LLM serving engine",
        "url": "",
    }
    cleaned = _clean_resource(raw)
    assert cleaned is not None
    assert cleaned["type"] == "repo"
    assert "github.com/vllm-project/vllm" in cleaned["url"]


def test_clean_resource_formats_owner_slash_repo_pattern():
    raw = {
        "name": "astral-sh/uv",
        "type": "tool",
        "detail": "Fast Python package installer and resolver",
        "url": "astral-sh/uv",
    }
    cleaned = _clean_resource(raw)
    assert cleaned is not None
    assert "https://github.com/astral-sh/uv" == cleaned["url"]
