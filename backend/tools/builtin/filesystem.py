"""Filesystem tools, scoped to the workspace root by default."""

from __future__ import annotations

import asyncio
import base64
import fnmatch
import os
import re
import shutil
from pathlib import Path
from typing import Any

from backend.documents import EXTRACTABLE, ExtractionError, extract, missing_reader
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

# Hard limits matching opencode's approach
MAX_READ_BYTES = 50 * 1024  # 50KB (was 400KB)
MAX_READ_LINES = 2000
MAX_LINE_LENGTH = 2000
MAX_DOCUMENT_BYTES = 40_000_000

# Binary file extensions (like opencode)
BINARY_EXTENSIONS = frozenset({
    ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war",
    ".7z", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods",
    ".odp", ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo",
    ".pdf", ".epub", ".mov", ".mp4", ".mp3", ".wav", ".avi", ".gif", ".png",
    ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".ttf", ".otf", ".woff", ".woff2",
})

# Image MIME types
IMAGE_MIMES = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"RIFF": "image/webp",  # Need to check WEBP at offset 8
}


def _is_binary(data: bytes, filename: str) -> bool:
    """Detect binary files like opencode does."""
    # Check extension first
    ext = Path(filename).suffix.lower()
    if ext in BINARY_EXTENSIONS:
        return True
    
    # Check for null bytes or high non-printable ratio
    if not data:
        return False
    
    non_printable = 0
    for byte in data:
        if byte == 0:  # null byte
            return True
        if byte < 9 or (byte > 13 and byte < 32):
            non_printable += 1
    
    return non_printable / len(data) > 0.3


def _detect_image_mime(data: bytes) -> str | None:
    """Detect image MIME type from header bytes."""
    for prefix, mime in IMAGE_MIMES.items():
        if data[:len(prefix)] == prefix:
            # Special case for WEBP: check "WEBP" at offset 8
            if mime == "image/webp":
                if data[8:12] == b"WEBP":
                    return mime
                continue
            return mime
    return None

#: Directories that are never worth walking for a code/content search: package
#: caches and VCS metadata. ripgrep/fd skip these (and .gitignore) for free; the
#: pure-Python fallback below prunes them by hand so a repo with node_modules at
#: its root does not stall the event loop enumerating tens of thousands of files.
_PRUNE_DIRS = frozenset({"node_modules", ".venv", "venv", ".git", "__pycache__"})


def _tool(name: str) -> str | None:
    """Absolute path to a CLI helper if installed, else None. Cached per process."""
    if name not in _TOOL_CACHE:
        _TOOL_CACHE[name] = shutil.which(name)
    return _TOOL_CACHE[name]


_TOOL_CACHE: dict[str, str | None] = {}


async def _run(argv: list[str], cwd: Path) -> tuple[int, str]:
    """Run a helper CLI without blocking the event loop; return (code, stdout)."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace")
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

    # Check file size first (before reading)
    size = path.stat().st_size
    if size > MAX_READ_BYTES and not path.suffix.lower() in EXTRACTABLE:
        return ToolResult.error(
            f"{path} is too large ({size:,} bytes). "
            f"Maximum read size is {MAX_READ_BYTES:,} bytes. "
            "Use grep_files to search within it, or view_file with offset/limit."
        )

    # Read first bytes for binary detection
    try:
        with open(path, "rb") as f:
            first_bytes = f.read(64 * 1024)  # Read first 64KB
    except OSError as exc:
        return ToolResult.error(f"cannot read {path}: {exc}")

    # Detect binary files
    if _is_binary(first_bytes, path.name):
        # Check if it's an image
        mime = _detect_image_mime(first_bytes)
        if mime:
            # Read entire file for base64 encoding
            try:
                with open(path, "rb") as f:
                    image_data = f.read()
                b64 = base64.b64encode(image_data).decode("ascii")
                return ToolResult.ok(
                    f"[Image: {mime}, {size:,} bytes]\n"
                    f"base64:{b64[:100]}... (truncated for display)"
                )
            except OSError as exc:
                return ToolResult.error(f"cannot read image {path}: {exc}")
        
        # Check if it's an extractable document
        if path.suffix.lower() in EXTRACTABLE:
            refusal = missing_reader(path.suffix)
            if refusal:
                return ToolResult.error(refusal)
            try:
                text = await _extracted(path)
                if len(text) > MAX_READ_BYTES:
                    text = (
                        text[:MAX_READ_BYTES]
                        + f"\n\n[truncated at {MAX_READ_BYTES:,} characters;"
                        " search_documents finds a passage in the rest]"
                    )
            except ExtractionError as exc:
                return ToolResult.error(str(exc))
        else:
            return ToolResult.error(
                f"Binary file detected ({path.suffix or 'no extension'}). "
                "Cannot read binary files as text."
            )
    else:
        # Read as text with hard limits
        try:
            text = path.read_text(errors="replace")
        except OSError as exc:
            return ToolResult.error(f"cannot read {path}: {exc}")

    # Apply pagination with hard limits
    offset = int(args.get("offset") or 0)
    limit = int(args.get("limit") or MAX_READ_LINES)
    limit = min(limit, MAX_READ_LINES)  # Enforce hard limit
    
    lines = text.splitlines()
    total_lines = len(lines)
    
    # Apply offset
    if offset:
        lines = lines[offset:]
    
    # Apply limit
    if len(lines) > limit:
        lines = lines[:limit]
        truncated = True
    else:
        truncated = False
    
    # Truncate long lines
    processed_lines = []
    for line in lines:
        if len(line) > MAX_LINE_LENGTH:
            line = line[:MAX_LINE_LENGTH] + f"... (truncated at {MAX_LINE_LENGTH} chars)"
        processed_lines.append(line)
    
    # Format output with line numbers
    numbered = "\n".join(
        f"{i + offset + 1}\t{line}" for i, line in enumerate(processed_lines)
    )
    
    # Add truncation notices
    notices = []
    if truncated:
        notices.append(f"showing lines {offset + 1}-{offset + limit} of {total_lines}")
    if total_lines > MAX_READ_LINES:
        notices.append(f"file has {total_lines:,} lines (max {MAX_READ_LINES})")
    
    if notices:
        numbered += "\n\n[" + "; ".join(notices) + "]"
    
    return ToolResult.ok(numbered or "(empty file)")


async def list_files(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path, _ = _resolve(ctx, args.get("path") or ".")
    if not path.exists():
        return ToolResult.error(f"no such directory: {path}")
    if not path.is_dir():
        return ToolResult.error(f"{path} is not a directory")
    recursive = bool(args.get("recursive"))
    pattern = args.get("pattern")

    if recursive:
        fd = _tool("fd") or _tool("fdfind")
        if fd is not None:
            argv = [fd, "--type", "f"]
            for name in _PRUNE_DIRS:
                argv += ["--exclude", name]
            # cwd=path + "." so results come back relative to the listed dir.
            code, out = await _run([*argv, ".", "."], path)
            if code < 2:
                rels = [
                    ln[2:] if ln.startswith("./") else ln
                    for ln in out.splitlines()
                    if ln.strip()
                ]
                entries = [r for r in rels if not pattern or fnmatch.fnmatch(r, pattern)]
                if len(entries) > 2000:
                    entries = entries[:2000] + ["... (truncated)"]
                return ToolResult.ok("\n".join(entries) or "(empty directory)")
        entries = await asyncio.to_thread(_walk_python, path, pattern)
    else:
        entries = []
        for child in sorted(path.iterdir()):
            name = child.name + ("/" if child.is_dir() else "")
            if not pattern or fnmatch.fnmatch(child.name, pattern):
                entries.append(name)
    return ToolResult.ok("\n".join(entries) or "(empty directory)")


def _walk_python(path: Path, pattern: str | None) -> list[str]:
    """Pruned recursive listing, run in a thread so it never blocks the loop."""
    entries: list[str] = []
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in _PRUNE_DIRS]
        for name in filenames:
            rel = str(Path(dirpath, name).relative_to(path))
            if not pattern or fnmatch.fnmatch(rel, pattern):
                entries.append(rel)
        if len(entries) > 2000:
            entries.append("... (truncated)")
            break
    return entries


def _skip_note(skipped: int) -> str:
    noun = "document" if skipped == 1 else "documents"
    return (
        f"\n[skipped {skipped} binary {noun}; search_documents indexes those,"
        " or view_file reads one]"
    )


async def grep_files(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root, _ = _resolve(ctx, args.get("path") or ".")
    try:
        re.compile(args["pattern"])
    except re.error as exc:
        return ToolResult.error(f"invalid regex: {exc}")
    if not root.exists():
        return ToolResult.error(f"no such path: {root}")
    glob = args.get("glob")
    max_results = int(args.get("max_results") or 200)

    rg = _tool("rg")
    if rg is not None:
        result = await _grep_ripgrep(rg, root, args["pattern"], glob, max_results)
        if result is not None:
            return result
        # ripgrep rejected the pattern (Rust regex is a subset of Python's) --
        # fall through to the Python engine so lookarounds/backrefs still work.

    # No ripgrep, or a pattern it cannot compile. Run the pure-Python scan off
    # the event loop so a large tree never blocks streaming.
    hits, skipped, capped = await asyncio.to_thread(
        _grep_python, root, args["pattern"], glob, max_results
    )
    if capped:
        return ToolResult.ok("\n".join(hits) + "\n[result limit reached]")
    out = "\n".join(hits) or "no matches"
    if skipped:
        out += _skip_note(skipped)
    return ToolResult.ok(out)


async def _grep_ripgrep(
    rg: str, root: Path, pattern: str, glob: str | None, max_results: int
) -> ToolResult | None:
    """ripgrep path: fast, .gitignore-aware, non-blocking. None => pattern unusable."""
    single_file = root.is_file()
    cwd = root.parent if single_file else root
    argv = [rg, "--line-number", "--no-heading", "--color", "never", "--no-messages"]
    for name in _PRUNE_DIRS:
        argv += ["--glob", f"!{name}"]  # excluded even without a .gitignore
    for suffix in EXTRACTABLE:
        argv += ["--glob", f"!*{suffix}"]  # PDFs/docx grep as compressed noise
    if glob:
        argv += ["--glob", glob]
    argv += ["-e", pattern, "--", root.name if single_file else "."]

    code, out = await _run(argv, cwd)
    # rg exit codes: 0 = matches, 1 = no matches, 2 = error (bad regex, etc.).
    if code >= 2:
        return None

    hits: list[str] = []
    for line in out.splitlines():
        path, _, rest = line.partition(":")
        lineno, _, text = rest.partition(":")
        if path.startswith("./"):  # rg prefixes the '.' search target
            path = path[2:]
        hits.append(f"{path}:{lineno}: {text.strip()[:300]}")
        if len(hits) >= max_results:
            return ToolResult.ok("\n".join(hits) + "\n[result limit reached]")

    result = "\n".join(hits) or "no matches"
    skipped = await _count_extractable(rg, root, single_file)
    if skipped:
        result += _skip_note(skipped)
    return ToolResult.ok(result)


async def _count_extractable(rg: str, root: Path, single_file: bool) -> int:
    """How many binary documents grep passed over, so 'no matches' stays honest."""
    if single_file:
        return 1 if root.suffix.lower() in EXTRACTABLE else 0
    argv = [rg, "--files", "--no-messages"]
    for suffix in EXTRACTABLE:
        argv += ["--glob", f"*{suffix}"]
    for name in _PRUNE_DIRS:  # after includes, so exclusion wins (rg: last glob wins)
        argv += ["--glob", f"!{name}"]
    code, out = await _run(argv, root)
    if code >= 2:
        return 0
    return sum(1 for line in out.splitlines() if line.strip())


def _grep_python(
    root: Path, pattern: str, glob: str | None, max_results: int
) -> tuple[list[str], int, bool]:
    """Pruned recursive grep. Runs in a thread; returns (hits, skipped, capped)."""
    regex = re.compile(pattern)
    hits: list[str] = []
    skipped = 0
    if root.is_file():
        candidates = [root]
    else:
        candidates = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames if not d.startswith(".") and d not in _PRUNE_DIRS
            ]
            candidates.extend(Path(dirpath, name) for name in filenames)
    for candidate in candidates:
        if candidate.suffix.lower() in EXTRACTABLE:
            skipped += 1
            continue
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
                        return hits, skipped, True
        except (OSError, UnicodeDecodeError):
            continue
    return hits, skipped, False


def _invalidate_index(path: Path) -> None:
    """Tell retrieval a file AMETHYST just wrote is stale.

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


#: Extension -> (media type, highlight language). What the panel needs to know
#: to render an artifact, decided from the path rather than asked of the model:
#: a model that has already chosen a filename has already said what this is,
#: and asking twice is a second chance to disagree with itself.
ARTIFACT_TYPES = {
    ".md": ("text/markdown", None),
    ".markdown": ("text/markdown", None),
    ".txt": ("text/plain", None),
    ".html": ("text/html", "html"),
    ".css": ("text/css", "css"),
    ".py": ("text/x-python", "python"),
    ".js": ("text/javascript", "javascript"),
    ".jsx": ("text/javascript", "jsx"),
    ".ts": ("text/typescript", "typescript"),
    ".tsx": ("text/typescript", "tsx"),
    ".json": ("application/json", "json"),
    ".yaml": ("application/yaml", "yaml"),
    ".yml": ("application/yaml", "yaml"),
    ".toml": ("application/toml", "toml"),
    ".sh": ("text/x-shellscript", "bash"),
    ".sql": ("application/sql", "sql"),
    ".rs": ("text/x-rust", "rust"),
    ".go": ("text/x-go", "go"),
}


def artifact_type(path: Path) -> tuple[str, str | None]:
    """How to render this artifact. Unknown extensions read as plain text."""
    return ARTIFACT_TYPES.get(path.suffix.lower(), ("text/plain", None))


async def create_artifact(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Write a file, and say that it is the deliverable.

    Identical to `write_file` in what it does to the disk -- it calls it -- and
    different in one respect the model cannot express any other way: the name
    says this output is a document the user wants to look at, not a config the
    agent happened to touch on the way to something else.

    The declaration is a tool *name* rather than a flag on `write_file` because
    of ordering. JSON key order belongs to the model, so a `artifact: true`
    argument can arrive after the `content` it qualifies -- and by then the
    interface has either buffered the whole document, losing the progressive
    render this exists for, or opened a panel it must now retract. A tool's
    name arrives in the first fragment of the call, before any argument, on
    every provider. See ADR-0020.
    """
    result = await write_file(args, ctx)
    if result.is_error:
        return result

    path, _ = _resolve(ctx, args["path"])
    media_type, language = artifact_type(path)
    title = (args.get("title") or "").strip() or path.name
    # Reported back to the model in its own terms. It has no panel to look at,
    # so "shown to the user" is the only way it learns that this landed
    # somewhere different from an ordinary write.
    return ToolResult.ok(
        f"{result.content}\nShown to the user as an artifact: {title} ({media_type})",
        artifacts=[
            {
                "type": "artifact",
                "path": str(path),
                "title": title,
                "media_type": media_type,
                "language": language,
            }
        ],
    )


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
            description=(
                "Read a file and return its line-numbered content.\n"
                "WHEN TO USE: before editing any file (edit_file needs the exact"
                " current text); when a grep hit needs surrounding context; when"
                " you need to know what a file actually contains rather than"
                " guessing from its name.\n"
                "OUTPUT: one line per line of the file, as `<number>\\t<text>`.\n"
                "TIPS: use offset and limit to page through a long file instead of"
                " reading it whole. PDF, .docx, .xlsx and .pptx are extracted to"
                " markdown automatically, keeping page numbers, sheet names and"
                " slide numbers so a passage can be cited.\n"
                "LIMITS: 400KB of text, 40MB for a document; a directory is an"
                " error -- use list_files."
            ),
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
            description=(
                "List files in a directory.\n"
                "WHEN TO USE: to learn a project's shape before changing it, and"
                " to find a real path instead of guessing one.\n"
                "OUTPUT: one name per line; directories end in `/`. Recursive"
                " listings are paths relative to the directory listed.\n"
                "TIPS: set recursive for a whole tree and pattern to filter"
                " (e.g. '*.py'). Build caches and VCS metadata (node_modules,"
                " .venv, .git) are skipped, so the listing is the project.\n"
                "LIMITS: recursive listings stop at 2000 entries. To search file"
                " *contents* rather than names, use grep_files."
            ),
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
            description=(
                "Search file contents with a regular expression.\n"
                "WHEN TO USE: first, on almost any question about a codebase --"
                " to find where something is defined, used, or configured before"
                " reading or editing anything. Prefer this over guessing paths.\n"
                "OUTPUT: `path:line: matching text`, one hit per line.\n"
                "TIPS: narrow with glob (e.g. '*.py') and path. Raise max_results"
                " when a broad pattern matters. Follow a hit with view_file to"
                " read around it. Build caches and VCS metadata are skipped.\n"
                "LIMITS: 200 hits by default. Binary documents (PDF, .docx) are"
                " not grepped -- search_documents indexes those."
            ),
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
            description=(
                "Write text to a file, creating it or overwriting it whole.\n"
                "WHEN TO USE: for a new file, or a rewrite so complete that"
                " editing would be pointless. To change part of an existing"
                " file use edit_file instead.\n"
                "WHEN NOT TO USE: when the file is the thing the user asked you"
                " to produce -- a document, README, script or report they will"
                " read. Use create_artifact so it opens in the side panel.\n"
                "LIMITS: overwrites without warning; parent directories are"
                " created for you."
            ),
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
            name="create_artifact",
            description=(
                "Write a file AND show it to the user in the side panel. Use this"
                " instead of write_file whenever the file IS the thing the user"
                " asked for -- a document, a README, an email draft, a script, a"
                " report, a config they asked you to produce. Use plain write_file"
                " for files you are only touching along the way. The panel renders"
                " markdown as markdown and code with highlighting; HTML files run"
                " live in a sandboxed iframe with full JavaScript and CDN access,"
                " so charts, diagrams and interactive visualizations should use"
                " Chart.js, D3, or Plotly from a CDN rather than hand-drawn SVG."
                " Follow the interactive-artifacts skill for quality requirements."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": _PATH_PROP,
                    "content": {"type": "string", "description": "The whole file"},
                    "title": {
                        "type": "string",
                        "description": "What to call it in the panel. Defaults to the"
                        " filename.",
                    },
                },
                "required": ["path", "content"],
            },
            handler=create_artifact,
            # Deliberately the same risk as `write_file`, which it calls: a tool
            # that writes to the filesystem outside the permission gate because
            # its output is nicely rendered would be a hole in the gate.
            risk=RiskLevel.MEDIUM,
            touches_paths=True,
        ),
        Tool(
            name="edit_file",
            description=(
                "Replace an exact string in a file.\n"
                "WHEN TO USE: for every change to an existing file. Prefer this"
                " over write_file, which replaces the whole file and loses"
                " anything you did not reproduce.\n"
                "TIPS: read the file with view_file first and copy old_string"
                " from what you read, including its indentation. Include enough"
                " surrounding text to make it unique; set replace_all only when"
                " you mean every occurrence.\n"
                "LIMITS: old_string must appear exactly once unless replace_all"
                " is set, and must match the file byte for byte -- a near miss"
                " is an error, not a fuzzy match."
            ),
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
