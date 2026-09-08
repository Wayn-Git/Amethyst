from __future__ import annotations

import pytest

from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import ToolContext, ToolResult
from backend.tools.builtin import filesystem, shell
from backend.tools.registry import ToolRegistry, mcp_tool_key, truncate


def registry_for(workspace):
    from backend.tools.registry import build_default_registry

    return build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace))


async def test_filesystem_roundtrip(db, workspace):
    reg = registry_for(workspace)
    ctx = ToolContext(workspace_root=str(workspace))

    assert not (
        await reg.dispatch("write_file", {"path": "a.md", "content": "hello"}, ctx)
    ).is_error
    read = await reg.dispatch("view_file", {"path": "a.md"}, ctx)
    assert "hello" in read.content

    await reg.dispatch(
        "edit_file", {"path": "a.md", "old_string": "hello", "new_string": "bye"}, ctx
    )
    assert "bye" in (await reg.dispatch("view_file", {"path": "a.md"}, ctx)).content

    listing = await reg.dispatch("list_files", {}, ctx)
    assert "a.md" in listing.content


async def test_missing_file_is_an_error_result_not_a_crash(db, workspace):
    reg = registry_for(workspace)
    result = await reg.dispatch(
        "view_file", {"path": "nope.md"}, ToolContext(workspace_root=str(workspace))
    )
    assert result.is_error and "no such file" in result.content


async def test_edit_refuses_ambiguous_match(db, workspace):
    (workspace / "d.md").write_text("x\nx\n")
    ctx = ToolContext(workspace_root=str(workspace))
    result = await filesystem.edit_file({"path": "d.md", "old_string": "x", "new_string": "y"}, ctx)
    assert result.is_error and "appears 2 times" in result.content


async def test_grep_finds_matches(db, workspace):
    (workspace / "notes.md").write_text("alpha\nbeta gamma\n")
    result = await filesystem.grep_files(
        {"pattern": "beta"}, ToolContext(workspace_root=str(workspace))
    )
    assert "notes.md:2" in result.content


async def test_shell_captures_output_and_exit_code(db, workspace):
    ctx = ToolContext(workspace_root=str(workspace))
    ok = await shell.run_shell_command({"command": "echo hi", "execution_mode": "direct"}, ctx)
    assert not ok.is_error and "hi" in ok.content

    bad = await shell.run_shell_command({"command": "exit 3", "execution_mode": "direct"}, ctx)
    assert bad.is_error and "exit code 3" in bad.content


async def test_shell_timeout_returns_a_result(db, workspace):
    ctx = ToolContext(workspace_root=str(workspace))
    result = await shell.run_shell_command(
        {"command": "sleep 5", "timeout_seconds": 1, "execution_mode": "direct"}, ctx
    )
    assert result.is_error and "timed out" in result.content


async def test_unknown_tool_lists_alternatives(db):
    reg = ToolRegistry(ConfirmationService(auto_approve))
    result = await reg.dispatch("nonexistent", {}, ToolContext())
    assert result.is_error and "unknown tool" in result.content


async def test_handler_exception_becomes_an_error_result(db):
    from backend.tools.base import RiskLevel, Tool

    async def explode(args, ctx):
        raise RuntimeError("boom")

    reg = ToolRegistry(ConfirmationService(auto_approve))
    reg.register(
        Tool(
            name="x",
            description="",
            parameters={"type": "object"},
            handler=explode,
            risk=RiskLevel.LOW,
        )
    )
    result = await reg.dispatch("x", {}, ToolContext())
    assert result.is_error and "boom" in result.content


async def test_every_dispatch_writes_an_audit_row(db, workspace):
    reg = registry_for(workspace)
    await reg.dispatch("list_files", {}, ToolContext(workspace_root=str(workspace)))
    rows = reg.logs.recent(5)
    assert rows and rows[0]["tool_name"] == "list_files"
    assert rows[0]["confirmation_decision"] == "auto"


def test_mcp_keys_do_not_collide():
    assert mcp_tool_key("search", "notes") != mcp_tool_key("search", "mail")


def test_truncation_marks_omission():
    assert "truncated" in truncate("x" * 200, limit=100)


def test_result_envelope():
    assert not ToolResult.ok("fine").is_error
    assert ToolResult.error("bad").is_error


def _pdf(path, pages):
    """Shares the hand-built fixture with tests/test_documents.py."""
    from tests.test_documents import _pdf as build

    return build(path, pages)


async def test_view_file_reads_a_pdf_rather_than_mojibake(db, workspace):
    """The Chat composer appends "Attached files (read them with view_file)" to
    every message carrying an upload, so this sentence being false is the bug.
    `read_text(errors="replace")` on a PDF returns replacement characters.

    Mutation check: drop the EXTRACTABLE branch in `view_file`.
    """
    _pdf(workspace / "report.pdf", ["Quarterly revenue rose"])
    reg = registry_for(workspace)
    result = await reg.dispatch(
        "view_file", {"path": "report.pdf"}, ToolContext(workspace_root=str(workspace))
    )
    assert not result.is_error
    assert "�" not in result.content, "the file was read as text"
    assert "Quarterly revenue rose" in result.content
    assert "Page 1" in result.content


async def test_view_file_still_numbers_a_text_file_from_one(db, workspace):
    """The numbering contract is what every other caller depends on; extraction
    must slot in above it rather than replace it.

    Mutation check: return extracted text without going through the numbering.
    """
    (workspace / "a.md").write_text("alpha\nbeta\n")
    reg = registry_for(workspace)
    result = await reg.dispatch(
        "view_file", {"path": "a.md"}, ToolContext(workspace_root=str(workspace))
    )
    assert result.content.startswith("1\talpha")


async def test_a_document_larger_than_the_text_cap_is_still_readable(db, workspace):
    """400KB is a large note and a small report. Bytes on disk say nothing about
    how much text a PDF holds -- the megabytes are images.

    Mutation check: apply MAX_READ_BYTES to documents too.
    """
    from backend.tools.builtin.filesystem import MAX_READ_BYTES

    path = _pdf(workspace / "big.pdf", ["Findings here"])
    path.write_bytes(path.read_bytes() + b"\n%% " + b"x" * MAX_READ_BYTES)
    reg = registry_for(workspace)
    result = await reg.dispatch(
        "view_file", {"path": "big.pdf"}, ToolContext(workspace_root=str(workspace))
    )
    assert not result.is_error, result.content
    assert "Findings here" in result.content


async def test_grep_skips_binary_documents_and_says_how_many(db, workspace):
    """Extracting every PDF in a tree to run one regex is the wrong cost, but a
    silent skip means "no matches" can mean "the answer was in a PDF".

    Mutation check: skip without counting.
    """
    _pdf(workspace / "report.pdf", ["Quarterly"])
    (workspace / "a.md").write_text("nothing here\n")
    reg = registry_for(workspace)
    result = await reg.dispatch(
        "grep_files", {"pattern": "Quarterly"}, ToolContext(workspace_root=str(workspace))
    )
    assert "skipped 1 binary document" in result.content
    assert "search_documents" in result.content


async def test_the_document_tools_are_registered_and_ask_before_writing(db, workspace):
    """`operation_key` falls back to `arguments["operation_type"]`, so naming the
    discriminator anything else would collapse every edit_document operation into
    one "don't ask again" preference: approving set_cell would grant replace_text.

    Mutation check: rename the parameter to `operation`.
    """
    from backend.tools.base import RiskLevel

    reg = registry_for(workspace)
    for name in ("create_document", "edit_document"):
        tool = reg.get(name)
        assert tool is not None, f"{name} is not registered"
        assert tool.risk is RiskLevel.MEDIUM
        assert tool.touches_paths

    edit = reg.get("edit_document")
    assert edit.operation_key({"operation_type": "set_cell"}) != edit.operation_key(
        {"operation_type": "replace_text"}
    )


async def test_a_pdf_is_written_through_libreoffice_not_pandoc(db, workspace):
    """markdown -> pdf routes to pandoc in `plan_conversion`, and pandoc is not
    installed here, so the direct route fails with "needs pandoc" while
    LibreOffice sits on PATH. docx -> pdf routes to soffice.

    Mutation check: pass the markdown straight to convert_file.
    """
    import shutil

    if shutil.which("soffice") is None:
        pytest.skip("LibreOffice is not installed")

    reg = registry_for(workspace)
    result = await reg.dispatch(
        "create_document",
        {"path": "out.pdf", "content": "# Hello\n\nBody text.\n"},
        ToolContext(workspace_root=str(workspace)),
    )
    assert not result.is_error, result.content
    assert "LibreOffice" in result.content
    assert (workspace / "out.pdf").exists()
    assert not list(workspace.glob(".*amethyst-tmp*")), "the intermediate .docx was left behind"


async def test_a_pdf_cannot_be_edited_in_place(db, workspace):
    """PyMuPDF can redact and re-insert text, and the result is a visibly broken
    page reported as a success. Refusing points at the thing that does work.

    Mutation check: let replace_text through for .pdf.
    """
    _pdf(workspace / "report.pdf", ["Quarterly"])
    reg = registry_for(workspace)
    result = await reg.dispatch(
        "edit_document",
        {
            "path": "report.pdf",
            "operation_type": "replace_text",
            "old_string": "Quarterly",
            "new_string": "Annual",
        },
        ToolContext(workspace_root=str(workspace)),
    )
    assert result.is_error
    assert "fixed layout" in result.content and "create_document" in result.content
