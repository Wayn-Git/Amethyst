import pytest

from backend.launcher.intent import classify_intent


@pytest.mark.parametrize(
    "query, mode, subject, ask",
    [
        ("", "home", "", False),
        ("chrome", "local", "chrome", False),
        ("chrome release notes", "search", "chrome release notes", False),
        ("how do i center a div", "question", "how do i center a div", True),
        ("2+2", "math", "2+2", False),
        ("10 km to miles", "math", "10 km to miles", False),
        ("/etc/hosts", "files", "/etc/hosts", False),
        ("report.pdf", "files", "report.pdf", False),
        ("volume up", "system", "volume up", False),
        ("clipboard", "clipboard", "", False),
        ("switch to chrome", "windows", "switch to chrome", False),
        ("open chrome", "apps", "open chrome", False),
        ("go to settings", "commands", "go to settings", False),
        (">google rust lifetimes", "web", "rust lifetimes", False),
        ("> library dune", "library", "dune", False),
        ("? what is rust", "question", "what is rust", True),
        ("youtube lofi beats", "youtube", "lofi beats", False),
        ("github react", "github", "react", False),
    ],
)
def test_intent_matrix(query, mode, subject, ask):
    intent = classify_intent(query)
    assert intent["mode"] == mode
    assert intent["subject"] == subject
    assert intent["ask"] is ask


def test_prefix_marks_intent_explicit():
    intent = classify_intent(">yt lofi")
    assert intent["mode"] == "youtube"
    assert intent["explicit"] is True


def test_explicit_mode_wins_over_prefix():
    intent = classify_intent("youtube cats", explicit_mode="web")
    assert intent["mode"] == "web"
    assert intent["subject"] == "youtube cats"
    assert intent["explicit"] is True


def test_local_never_calls_external_sources():
    intent = classify_intent("chrome")
    assert intent["providers"] == ["apps", "commands", "library"]
    assert intent["external"] == []


def test_search_does_not_fire_media_or_answer():
    intent = classify_intent("rust async book")
    assert intent["external"] == ["web"]
    assert intent["ask"] is False
    assert "yt" not in intent["external"]
    assert "img" not in intent["external"]


def test_question_asks_with_wiki_evidence():
    intent = classify_intent("why is the sky blue")
    assert intent["ask"] is True
    assert intent["external"] == ["web"]
    assert intent["evidence"] == ["wiki"]


def test_unknown_provider_never_selected():
    for query in ["", "chrome", "report.pdf", "volume up", "how tall is everest"]:
        intent = classify_intent(query)
        assert "nope" not in intent["providers"]
