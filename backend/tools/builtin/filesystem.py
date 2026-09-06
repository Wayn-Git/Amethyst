"""Filesystem tools, scoped to the workspace root by default."""

from __future__ import annotations

import fnmatch
import os
import re
from pathlib import Path
from typing import Any

from backend.documents import EXTRACTABLE, ExtractionError, extract, missing_reader
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

MAX_READ_BYTES = 400_000
#: The cap for a binary document, applied to the file on disk. Larger than
#: MAX_READ_BYTES because bytes on disk say nothing about how much text a
#: document holds -- a 3MB PDF is twelve pages of prose and a 3MB note is not a
#: note. Sized to clear the 32MB attachment cap in api/main.py, so anything the
#: composer accepted can be read back.
MAX_DOCUMENT_BYTES = 40_000_000

#: Extracted markdown, keyed by (path, mtime, size). `view_file` takes `offset`
#: and `limit`, which invites paging, and paging a 300-page PDF a hundred lines
#: at a time would re-extract the whole thing on every call. Keyed on mtime and
#: size rather than the path alone so an edit invalidates the entry rather than
#: serving the document as it used to be.
_EXTRACTED: dict[tuple[str, int, int], str] = {}
_EXTRACT_CACHE_SIZE = 8


async def _extracted(path: Path) -> str:
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    cached = _EXTRACTED.get(key)
    if cached is not None:
        return cached
    text = await extract(path)
    if len(_EXTRACTED) >= _EXTRACT_CACHE_SIZE:
        _EXTRACTED.pop(next(iter(_EXTRACTED)))
    _EXTRACTED[key] = text
    return text


def _root(context: ToolContext, override: str | None = None) -> Path:
    return Path(override or context.workspace_root or Path.cwd()).expanduser().resolve()


def _resolve(context: ToolContext, raw: str) -> tuple[Path, bool]:
    """Resolve a path and report whether it escapes the workspace root."""
    root = _root(context)
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = root / path
    path = path.resolve()
    try:
        path.relative_to(root)
        return path, False
    except ValueError:
        return path, True


async def view_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path, _ = _resolve(ctx, args["path"])
    if not path.exists():
        return ToolResult.error(f"no such file: {path}")
    if path.is_dir():
        return ToolResult.error(f"{path} is a directory; use list_files")

    # A PDF read as text is mojibake, and the model has no way to know a path is
    # binary before opening it -- `list_files` returns names. So the routing
    # happens here rather than in a second tool the model would have to choose
    # between. The refusal is asked for before the size check because a named
    # "that needs python-docx" costs nothing and reading 40MB to find out costs
    # 40MB.
    document = path.suffix.lower() in EXTRACTABLE
    if document:
        refusal = missing_reader(path.suffix)
        if refusal:
            return ToolResult.error(refusal)

    size = path.stat().st_size
    cap = MAX_DOCUMENT_BYTES if document else MAX_READ_BYTES
    if size > cap:
        return ToolResult.error(f"{path} is too large to read ({size} bytes)")

    if document:
        try:
            text = await _extracted(path)
        except ExtractionError as exc:
            return ToolResult.error(str(exc))
        if len(text) > MAX_READ_BYTES:
            # The cap that matters for an extracted document is characters, not
            # bytes on disk, and truncation is said out loud rather than left
            # for the model to notice that a report stops mid-sentence.
            text = (
                text[:MAX_READ_BYTES]
                + f"\n\n[truncated at {MAX_READ_BYTES:,} characters;"
                " search_documents finds a passage in the rest]"
            )
    else:
        try:
            text = path.read_text(errors="replace")
        except OSError as exc:
            return ToolResult.error(f"cannot read {path}: {exc}")

    offset = int(args.get("offset") or 0)
    limit = args.get("limit")
    lines = text.splitlines()
    if offset or limit:
        end = offset + int(limit) if limit else len(lines)
        lines = lines[offset:end]
    numbered = "\n".join(f"{i + offset + 1}\t{line}" for i, line in enumerate(lines))
    return ToolResult.ok(numbered or "(empty file)")


async def list_files(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path, _ = _resolve(ctx, args.get("path") or ".")
    if not path.exists():
        return ToolResult.error(f"no such directory: {path}")
    if not path.is_dir():
        return ToolResult.error(f"{path} is not a directory")
    recursive = bool(args.get("recursive"))
    pattern = args.get("pattern")

    entries: list[str] = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                rel = str(Path(dirpath, name).relative_to(path))
                if not pattern or fnmatch.fnmatch(rel, pattern):
                    entries.append(rel)
            if len(entries) > 2000:
                entries.append("... (truncated)")
                break
    else:
        for child in sorted(path.iterdir()):
            name = child.name + ("/" if child.is_dir() else "")
            if not pattern or fnmatch.fnmatch(child.name, pattern):
                entries.append(name)
    return ToolResult.ok("\n".join(entries) or "(empty directory)")


async def grep_files(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root, _ = _resolve(ctx, args.get("path") or ".")
    try:
        regex = re.compile(args["pattern"])
    except re.error as exc:
        return ToolResult.error(f"invalid regex: {exc}")
    glob = args.get("glob")
    max_results = int(args.get("max_results") or 200)

    hits: list[str] = []
    skipped = 0
    targets = [root] if root.is_file() else sorted(root.rglob("*"))
    for candidate in targets:
        if not candidate.is_file():
            continue
        if candidate.suffix.lower() in EXTRACTABLE:
            # Extracting every PDF in a tree to run one regex over it is the
            # wrong cost, and reading one as text produces matches inside
            # compressed bytes that mean nothing. Counted rather than silent, so
            # "no matches" cannot mean "the answer was in a PDF I skipped".
            skipped += 1
            continue
        # Only hidden components *below* the search root matter. Checking the
        # absolute path skipped every file when the root itself lived under a
        # dotted directory, which silently returned "no matches".
        relative = candidate.relative_to(root) if candidate != root else Path(candidate.name)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if glob and not fnmatch.fnmatch(candidate.name, glob):
            continue
        try:
            if candidate.stat().st_size > MAX_READ_BYTES:
                continue
            for lineno, line in enumerate(candidate.read_text(errors="replace").splitlines(), 1):
                if regex.search(line):
                    rel = candidate.relative_to(root) if candidate != root else candidate.name
                    hits.append(f"{rel}:{lineno}: {line.strip()[:300]}")
                    if len(hits) >= max_results:
                        return ToolResult.ok("\n".join(hits) + "\n[result limit reached]")
        except (OSError, UnicodeDecodeError):
            continue

    out = "\n".join(hits) or "no matches"
    if skipped:
        noun = "document" if skipped == 1 else "documents"
        out += (
            f"\n[skipped {skipped} binary {noun}; search_documents indexes those,"
            " or view_file reads one]"
        )
    return ToolResult.ok(out)


def _invalidate_index(path: Path) -> None:
    """Tell retrieval a file PSOK just wrote is stale.

    The real work is `indexer.mark_stale_best_effort`, shared with the document
    authoring tools. Imported inside the call rather than at module scope so a
    filesystem tool never drags the embedder and the vector extension in behind
    it -- reading a file must not depend on retrieval being importable.
    """
    from backend.retrieval.indexer import mark_stale_best_effort

    mark_stale_best_effort(path)


async def write_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path, escaped = _resolve(ctx, args["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(args.get("content") or "")
    except OSError as exc:
        return ToolResult.error(f"cannot write {path}: {exc}")
    _invalidate_index(path)
    note = " (outside workspace root)" if escaped else ""
    return ToolResult.ok(f"wrote {len(args.get('content') or '')} characters to {path}{note}")


async def edit_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path, _ = _resolve(ctx, args["path"])
    if not path.exists():
        return ToolResult.error(f"no such file: {path}")
    old, new = args["old_string"], args["new_string"]
    try:
        text = path.read_text()
    except OSError as exc:
        return ToolResult.error(f"cannot read {path}: {exc}")

    count = text.count(old)
    if count == 0:
        return ToolResult.error(f"old_string not found in {path}")
    if count > 1 and not args.get("replace_all"):
        return ToolResult.error(
            f"old_string appears {count} times in {path}; pass replace_all or use a longer,"
            " unique string"
        )
    path.write_text(
        text.replace(old, new) if args.get("replace_all") else text.replace(old, new, 1)
    )
    _invalidate_index(path)
    return ToolResult.ok(
        f"edited {path} ({count if args.get('replace_all') else 1} replacement(s))"
    )


async def delete_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path, _ = _resolve(ctx, args["path"])
    if not path.exists():
        return ToolResult.error(f"no such file: {path}")
    if path.is_dir():
        return ToolResult.error(f"{path} is a directory; refusing to delete recursively")
    path.unlink()
    _invalidate_index(path)
    return ToolResult.ok(f"deleted {path}")


_PATH_PROP = {"type": "string", "description": "File path, absolute or relative to the workspace"}


def tools(workspace_root: str | None = None) -> list[Tool]:
    return [
        Tool(
            name="view_file",
            description="Read a file and return its line-numbered content. Text and"
            " code files are read directly; PDF, Word (.docx), Excel (.xlsx) and"
            " PowerPoint (.pptx) are extracted to markdown first, keeping page"
            " numbers, sheet names and slide numbers so a passage can be cited.",
            parameters={
                "type": "object",
                "properties": {
                    "path": _PATH_PROP,
                    "offset": {"type": "integer", "description": "First line to return (0-based)"},
                    "limit": {"type": "integer", "description": "Maximum number of lines"},
                },
                "required": ["path"],
            },
            handler=view_file,
            risk=RiskLevel.LOW,
            touches_paths=True,
        ),
        Tool(
            name="list_files",
            description="List files in a directory, optionally recursively and filtered by glob.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory to list"},
                    "recursive": {"type": "boolean"},
                    "pattern": {"type": "string", "description": "Glob filter, e.g. '*.md'"},
                },
            },
            handler=list_files,
            risk=RiskLevel.LOW,
            touches_paths=True,
        ),
        Tool(
            name="grep_files",
            description="Search file contents with a regular expression.",
            parameters={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regular expression"},
                    "path": {"type": "string", "description": "File or directory to search"},
                    "glob": {"type": "string", "description": "Filename glob filter"},
                    "max_results": {"type": "integer"},
                },
                "required": ["pattern"],
            },
            handler=grep_files,
            risk=RiskLevel.LOW,
            touches_paths=True,
        ),
        Tool(
            name="write_file",
            description="Write text to a file, creating or overwriting it.",
            parameters={
                "type": "object",
                "properties": {"path": _PATH_PROP, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
            handler=write_file,
            risk=RiskLevel.MEDIUM,
            touches_paths=True,
        ),
        Tool(
            name="edit_file",
            description="Replace an exact string in a file. old_string must be unique unless"
            " replace_all is set.",
            parameters={
                "type": "object",
                "properties": {
                    "path": _PATH_PROP,
                    "old_string": {"type": "string"},
                    "new_string": {"type": "string"},
                    "replace_all": {"type": "boolean"},
                },
                "required": ["path", "old_string", "new_string"],
            },
            handler=edit_file,
            risk=RiskLevel.MEDIUM,
            touches_paths=True,
        ),
        Tool(
            name="delete_file",
            description="Delete a single file.",
            parameters={
                "type": "object",
                "properties": {"path": _PATH_PROP},
                "required": ["path"],
            },
            handler=delete_file,
            risk=RiskLevel.HIGH,
            touches_paths=True,
        ),
    ]
