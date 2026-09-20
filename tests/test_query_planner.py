"""Tests for query understanding, entity extraction, and query planning."""

import datetime
import pytest
from backend.web.models import FreshnessWindow, ResearchDepth
from backend.web.query_planner import (
    detect_intent,
    extract_entities,
    infer_freshness,
    infer_priority_domains,
    plan_research,
)


def test_infer_freshness():
    assert infer_freshness("What happened with GTA 6 recently?") == FreshnessWindow.PAST_7D
    assert infer_freshness("What happened today in tech?") == FreshnessWindow.PAST_24H
    assert infer_freshness("What is the current NVIDIA driver version?") == FreshnessWindow.PAST_30D
    assert infer_freshness("What are the upcoming games in 2026?") == FreshnessWindow.PAST_YEAR
    assert infer_freshness("Who is Ada Lovelace?") == FreshnessWindow.ANYTIME
    assert infer_freshness("Explain how quicksort works") == FreshnessWindow.ANYTIME


def test_detect_intent():
    assert detect_intent("Has GTA 6 been delayed?") == "factual_verification"
    assert detect_intent("What happened with GTA 6 recently?") == "current_events"
    assert detect_intent("Python asyncio documentation and syntax") == "technical_docs"
    assert detect_intent("Compare PyTorch versus TensorFlow") == "comparison"
    assert detect_intent("Who was Alan Turing?") == "general_information"


def test_extract_entities():
    ents = extract_entities("What happened with GTA 6 recently?")
    assert "Gta 6" in ents or "GTA 6" in ents

    ents_nv = extract_entities("What is the latest NVIDIA driver update?")
    assert "Nvidia" in ents_nv or "NVIDIA" in ents_nv

    ents_ada = extract_entities("Tell me about Ada Lovelace and Charles Babbage")
    assert "Ada Lovelace" in ents_ada
    assert "Charles Babbage" in ents_ada


def test_infer_priority_domains():
    domains = infer_priority_domains(["Gta 6"], "What happened with GTA 6?")
    assert "rockstargames.com" in domains
    assert "take2games.com" in domains

    nv_domains = infer_priority_domains(["Nvidia"], "NVIDIA drivers")
    assert "nvidia.com" in nv_domains


def test_plan_research_gta_current_events():
    mock_date = datetime.date(2026, 9, 20)
    plan = plan_research("What happened with GTA 6 recently?", current_date=mock_date)

    assert plan.detected_intent == "current_events"
    assert plan.freshness == FreshnessWindow.PAST_7D
    assert len(plan.queries) >= 3

    # Check for targeted sub-queries
    queries_text = " ".join(plan.queries)
    assert "latest news" in queries_text
    assert "announcement" in queries_text
    assert "September 2026" in queries_text


def test_plan_research_verification():
    plan = plan_research("Has GTA 6 been delayed?")
    assert plan.requires_verification is True
    assert plan.detected_intent == "factual_verification"
    queries_text = " ".join(plan.queries)
    assert "official confirmation" in queries_text or "dispute" in queries_text


def test_plan_research_evergreen():
    plan = plan_research("Who is Ada Lovelace?")
    assert plan.depth == ResearchDepth.SIMPLE
    assert plan.freshness == FreshnessWindow.ANYTIME
    assert len(plan.queries) == 1
    assert "Ada Lovelace" in plan.queries[0]
