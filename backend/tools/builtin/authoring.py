"""Creating and editing Word, Excel, PowerPoint and PDF documents.

Two tools rather than one because they answer different questions. Creating is
"here is the whole thing"; editing is "change this one part and leave the rest
of the file exactly as it is", which for a workbook with charts and formulas in
it is not the same operation at all.

Reading needs no tool here -- `view_file` extracts these formats itself, so the
model is never asked to pick a reader.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.documents import edit as doc
from backend.documents.edit import DocumentError
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.builtin.convert import convert_file

#: Operations `edit_document` understands, and the formats each applies to.
OPERATIONS = {
    "set_cell": (".xlsx",),
    "append_row": (".xlsx",),
    "replace_text": (".docx", ".pptx"),
    "append_paragraph": (".docx",),
}


def _resolve(ctx: ToolContext, raw: str) -> Path:
    root = Path(ctx.workspace_root or Path.cwd()).expanduser().resolve()
    path = Path(raw).expanduser()
    return (path if path.is_absolute() else root / path).resolve()


def _invalidate_index(path: Path) -> None:
    from backend.retrieval.indexer import mark_stale_best_effort

    mark_stale_best_effort(path)


async def _pdf_via_docx(path: Path, content: str, ctx: ToolContext) -> ToolResult:
    """A PDF is written as a .docx and then converted, and the detour is the point.

    Sending markdown straight to `convert_file` routes it to pandoc
    (`convert.plan_conversion`, the markup branch), and pandoc is not installed
    on this machine, so every "write me a PDF" would fail with "needs pandoc"
    while LibreOffice sat right there. docx -> pdf routes to soffice, which is
    installed. `convert_file` is called rather than re-implemented so there is
    one sandboxed subprocess in the codebase, not two.
    """
    intermediate = path.with_name(f".{path.stem}.psok-tmp.docx")
    try:
        doc.create(intermediate, content)
        result = await convert_file(
            {
                "source": str(intermediate),
                "target_format": "pdf",
                "destination": str(path),
                "overwrite": True,
            },
            ctx,
        )
    finally:
        intermediate.unlink(missing_ok=True)

    if result.is_error:
        return result
    _invalidate_index(path)
    return ToolResult.ok(f"wrote {path} (via a temporary .docx and LibreOffice)")


async def create_document(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    raw = (args.get("path") or "").strip()
    content = args.get("content") or ""
    if not raw:
        return ToolResult.error("create_document needs a path")
    if not content.strip():
        return ToolResult.error("create_document needs content to write")

    path = _resolve(ctx, raw)
    refusal = doc.missing_writer(path.suffix)
    if refusal:
        return ToolResult.error(refusal)
    if path.exists() and not args.get("overwrite"):
        return ToolResult.error(
            f"{path} already exists. Pass overwrite: true, or give another path."
        )

    try:
        if path.suffix.lower() == ".pdf":
            return await _pdf_via_docx(path, content, ctx)
        message = doc.create(path, content)
    except DocumentError as exc:
        return ToolResult.error(str(exc))
    except OSError as exc:
        return ToolResult.error(f"cannot write {path}: {exc}")

    _invalidate_index(path)
    return ToolResult.ok(message)


async def edit_document(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    raw = (args.get("path") or "").strip()
    operation = (args.get("operation_type") or "").strip()
    if not raw:
        return ToolResult.error("edit_document needs a path")
    if operation not in OPERATIONS:
        return ToolResult.error(
            f"unknown operation_type {operation!r}. It is one of: {', '.join(OPERATIONS)}"
        )

    path = _resolve(ctx, raw)
    if not path.is_file():
        return ToolResult.error(f"no such file: {path}")

    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return ToolResult.error(
            "a PDF's text cannot be edited in place -- it is a fixed layout, not a document"
            " with paragraphs. Edit the .docx it came from, or write a new one with"
            " create_document."
        )
    if suffix not in OPERATIONS[operation]:
        return ToolResult.error(
            f"{operation} works on {' and '.join(OPERATIONS[operation])}, not {suffix}"
        )
    refusal = doc.missing_writer(suffix)
    if refusal:
        return ToolResult.error(refusal)

    try:
        if operation == "set_cell":
            cell = (args.get("cell") or "").strip()
            if not cell:
                return ToolResult.error("set_cell needs a cell, like 'B7'")
            message = doc.set_cell(path, args.get("sheet"), cell, args.get("value"))
        elif operation == "append_row":
            values = args.get("values")
            if not isinstance(values, list) or not values:
                return ToolResult.error("append_row needs a non-empty list of values")
            message = doc.append_row(path, args.get("sheet"), values)
        elif operation == "replace_text":
            old, new = args.get("old_string"), args.get("new_string")
            if not old:
                return ToolResult.error("replace_text needs old_string")
            message = doc.replace_text(path, old, new or "", bool(args.get("replace_all")))
        else:
            text = args.get("text")
            if not text:
                return ToolResult.error("append_paragraph needs text")
            message = doc.append_paragraph(path, text, args.get("style"))
    except DocumentError as exc:
        return ToolResult.error(str(exc))
    except (OSError, KeyError, ValueError) as exc:
        return ToolResult.error(f"cannot edit {path}: {exc}")

    _invalidate_index(path)
    if suffix == ".xlsx":
        message += ". Charts, images and pivot tables openpyxl does not model are not kept."
    return ToolResult.ok(message)


def tools() -> list[Tool]:
    return [
        Tool(
            name="create_document",
            description=(
                "Write a Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or PDF file"
                " from markdown. Headings become headings, sheets or slides; bullets"
                " become bullets; markdown tables become real tables. Anything else"
                " becomes a plain paragraph. For plain text or markdown files, use"
                " write_file instead. Nothing is uploaded."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Where to write it. The extension picks the format.",
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "The document as markdown. For a spreadsheet, each '## Name'"
                            " section starts a sheet and its table fills it."
                        ),
                    },
                    "overwrite": {
                        "type": "boolean",
                        "description": "Replace the file if it already exists.",
                    },
                },
                "required": ["path", "content"],
            },
            handler=create_document,
            risk=RiskLevel.MEDIUM,
            touches_paths=True,
        ),
        Tool(
            name="edit_document",
            description=(
                "Change part of an existing Word, Excel or PowerPoint file, leaving the"
                " rest of it as it is. set_cell and append_row work on .xlsx;"
                " replace_text works on .docx and .pptx; append_paragraph works on"
                " .docx. A replaced paragraph keeps the formatting of its first run"
                " throughout. A PDF cannot be edited in place."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "The document to change."},
                    "operation_type": {
                        "type": "string",
                        "enum": sorted(OPERATIONS),
                        "description": "Which change to make.",
                    },
                    "sheet": {
                        "type": "string",
                        "description": "Sheet name for set_cell and append_row. Defaults to"
                        " the active sheet.",
                    },
                    "cell": {
                        "type": "string",
                        "description": "Cell address for set_cell, like 'B7'.",
                    },
                    "value": {"description": "New cell value for set_cell."},
                    "values": {
                        "type": "array",
                        "items": {},
                        "description": "One row of values for append_row.",
                    },
                    "old_string": {"type": "string", "description": "Text to replace."},
                    "new_string": {"type": "string", "description": "What to replace it with."},
                    "replace_all": {
                        "type": "boolean",
                        "description": "Replace every occurrence rather than requiring a"
                        " unique one.",
                    },
                    "text": {
                        "type": "string",
                        "description": "Paragraph to add, for append_paragraph.",
                    },
                    "style": {
                        "type": "string",
                        "description": "Word style for append_paragraph, e.g. 'List Bullet'.",
                    },
                },
                "required": ["path", "operation_type"],
            },
            handler=edit_document,
            risk=RiskLevel.MEDIUM,
            touches_paths=True,
        ),
    ]
