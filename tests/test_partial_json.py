"""The incremental reader behind live artifact writing.

The property that matters most is at the bottom: fed a growing prefix one
character at a time, the answer must never shrink and must land exactly on
what `json.loads` would have said. Everything above it is a specific way that
could go wrong.
"""

import json

from backend.runtime.partial_json import partial_string


def test_key_not_arrived_yet():
    assert partial_string('{"path": "a.md"', "content") == ""
    assert partial_string("", "content") == ""
    assert partial_string("{", "content") == ""


def test_reads_a_complete_value():
    assert partial_string('{"content": "hello"}', "content") == "hello"


def test_reads_a_value_that_has_not_closed():
    assert partial_string('{"content": "# Notes\\n\\nFirst', "content") == "# Notes\n\nFirst"


def test_escaped_quote_is_not_the_end():
    raw = '{"content": "it\\"s fine"}'
    assert partial_string(raw, "content") == json.loads(raw)["content"]


def test_backslash_before_the_cut_is_withheld():
    # A lone trailing backslash could still become \\n or \\" -- emitting it
    # would put a stray slash on screen that has to be taken back.
    assert partial_string('{"content": "line\\', "content") == "line"


def test_half_a_unicode_escape_is_withheld():
    for prefix in ("\\u", "\\u0", "\\u00", "\\u00e"):
        got = partial_string('{"content": "caf' + prefix, "content")
        assert got == "caf", prefix
    assert partial_string('{"content": "caf\\u00e9', "content") == "café"


def test_key_name_inside_an_earlier_value_is_not_matched():
    # A document *about* artifacts contains the word "content" in its own text.
    raw = '{"title": "on \\"content\\" fields", "content": "real"}'
    assert partial_string(raw, "content") == "real"


def test_key_appearing_as_text_in_a_previous_value():
    raw = '{"path": "a/\\"content\\": fake.md", "content": "real"}'
    assert partial_string(raw, "content") == "real"


def test_non_string_value_is_not_streamable():
    assert partial_string('{"content": 12', "content") == ""
    assert partial_string('{"content": {"a": 1}', "content") == ""
    assert partial_string('{"content": null', "content") == ""


def test_whitespace_around_the_colon():
    assert partial_string('{"content"   :   "x"', "content") == "x"


def test_every_simple_escape():
    raw = '{"content": "a\\nb\\tc\\\\d\\"e\\/f\\bg\\fh"}'
    assert partial_string(raw, "content") == json.loads(raw)["content"]


def test_malformed_prefix_never_raises():
    for raw in ('{"content": "\\q', '{"content": "\\uZZZZ', '{"content": "\\'):
        partial_string(raw, "content")  # must not raise


def test_growing_prefix_never_shrinks_and_lands_exactly():
    document = (
        "# Title\n\nA paragraph with \"quotes\", a tab\there,\n"
        "a backslash \\ and an accent é and an emoji \U0001f600.\n"
        "| a | b |\n|---|---|\n| 1 | 2 |\n"
    )
    payload = json.dumps({"path": "notes.md", "title": "T", "content": document})

    seen = ""
    for cut in range(len(payload) + 1):
        got = partial_string(payload[:cut], "content")
        # Only ever grows: the caller streams the difference between calls.
        assert got.startswith(seen) or seen.startswith(got) is False or got == seen
        assert len(got) >= len(seen), (cut, len(got), len(seen))
        # And whatever it says is a true prefix of the real value.
        assert document.startswith(got), cut
        seen = got

    assert seen == document
