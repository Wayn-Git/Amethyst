"""Turning a binary document into markdown.

**Every extractor emits markdown, and that is the whole design.** It is not a
presentation choice -- it is what makes the rest of retrieval work unchanged.
`chunk_markdown` splits on headings and keeps a heading path, so a `## Page 12`
emitted here becomes `heading_path == "Page 12"`, which `SearchHit.label`
composes into `report.pdf > Page 12` with no change to search, to the store or
to the schema. A plain-text extractor would have needed a new column, a new
field on the hit and a new label branch to say the same thing.

So, per format:

    PDF     ## Page 12
    XLSX    ## Sheet: Budget
    PPTX    ## Slide 3, and ### Notes beneath it
    DOCX    the document's own outline -- Q3 Report > Method

Each format has a primary route through a library and, where an honest one
exists, a fallback that works with nothing installed. Where no route is left,
the failure is a sentence naming what is missing -- `convert.py`'s discipline,
for the same reason: "reading .docx needs python-docx, which is not installed
here" is something a person can act on, and an ImportError traceback is not.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import shlex
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from backend.security.sandbox import SandboxPolicy, wrap_command

#: Formats this module reads. Anything else is either plain text (the caller
#: decodes it) or has no route at all.
EXTRACTABLE = frozenset({".pdf", ".docx", ".xlsx", ".pptx"})

#: The pre-2007 binary formats and the OpenDocument ones. Not read directly --
#: python-docx cannot open a .doc and never will -- but `convert_file` turns
#: every one of them into a format on the list above, using LibreOffice, so the
#: failure sentence names that route rather than just refusing.
LEGACY = {
    ".doc": ("docx", "the old binary Word format"),
    ".xls": ("xlsx", "the old binary Excel format"),
    ".ppt": ("pptx", "the old binary PowerPoint format"),
    ".odt": ("docx", "an OpenDocument text file"),
    ".ods": ("xlsx", "an OpenDocument spreadsheet"),
    ".odp": ("pptx", "an OpenDocument presentation"),
}

#: How long `pdftotext` gets. Generous for a big PDF, short enough that a wedged
#: process is noticed rather than hanging the turn.
PDFTOTEXT_TIMEOUT_S = 120

#: Below this many non-whitespace characters per page, a PDF is a scan rather
#: than a document. Deliberately low: a title page and a page number clear it,
#: and calling a real document a scan is the worse mistake of the two.
SCAN_CHARS_PER_PAGE = 15

_LEADING_HASH = re.compile(r"^(#{1,6}\s)", re.MULTILINE)


class ExtractionError(RuntimeError):
    """The document could not be read. Carries a sentence fit to show someone."""


def _install_line(package: str, extra: str = "documents") -> str:
    return f"install it with 'pip install \"psok[{extra}]\"' and try again"


def _importable(module: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def missing_reader(suffix: str) -> str | None:
    """The sentence saying why this format cannot be read here, or None.

    Checked *before* any work, the way `media/audio.py:ffmpeg_missing` is: a
    named refusal costs nothing, and finding out by way of an ImportError two
    hundred files into a vault scan costs the scan.
    """
    ext = suffix.lower()

    if ext in LEGACY:
        target, described = LEGACY[ext]
        return (
            f"{ext} is {described}, which cannot be read directly. Convert it first with"
            f" convert_file(source=..., target_format='{target}'), which uses LibreOffice."
        )

    if ext == ".pdf":
        if _importable("pymupdf") or _importable("fitz") or shutil.which("pdftotext"):
            return None
        return (
            "reading .pdf needs PyMuPDF, which is not installed here, and pdftotext"
            f" (poppler-utils) is not on PATH either. Either will do: {_install_line('pymupdf')},"
            " or install poppler-utils with your package manager."
        )
    if ext == ".docx":
        if _importable("docx"):
            return None
        return (
            "reading .docx needs python-docx, which is not installed here. It covers Word"
            f" documents; {_install_line('python-docx')}."
        )
    if ext == ".xlsx":
        if _importable("openpyxl"):
            return None
        return (
            "reading .xlsx needs openpyxl, which is not installed here. It covers Excel"
            f" workbooks; {_install_line('openpyxl')}."
        )
    if ext == ".pptx":
        # No sentence is possible here, and that is correct: a .pptx is a zip of
        # XML, so the fallback below reads one with nothing but the standard
        # library. python-pptx makes it exact; its absence makes it approximate.
        return None
    return None


# --------------------------------------------------------------------------
# Markdown hygiene
#
# Two ways extracted text corrupts the chunker, both cheap to prevent here and
# expensive to notice later.
# --------------------------------------------------------------------------


def _escape_body(text: str) -> str:
    """Stop a line of *content* being read as a heading.

    `chunking._HEADING_RE` matches `^#{1,6}\\s`, so a PDF page or a cell holding
    a line like "## Terms" would silently become a heading: it splits the page
    into fragments and rewrites their heading path, so the page number that
    `SearchHit.label` depends on is replaced by whatever the document happened
    to say. Only body text is escaped -- the headings this module emits itself
    are the point.
    """
    return _LEADING_HASH.sub(r"\\\1", text)


def _cell(value: object) -> str:
    """One value, safe inside a markdown table row.

    An unescaped pipe in a cell adds a column to that row and to nothing else,
    which reshapes the table from there down.
    """
    if value is None:
        return ""
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def _column_letters(count: int) -> list[str]:
    """A, B, ... Z, AA, AB -- so a cell address in the table is the real one."""
    names = []
    for index in range(count):
        name, n = "", index
        while True:
            name = chr(ord("A") + n % 26) + name
            n = n // 26 - 1
            if n < 0:
                break
        names.append(name)
    return names


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------


def _pymupdf():
    """PyMuPDF under whichever name it answers to.

    1.28 renamed the import to `pymupdf` and made `import fitz` emit a
    deprecation warning, so the new name is tried first and the old one is the
    fallback rather than the other way round.
    """
    try:
        import pymupdf

        return pymupdf
    except ImportError:
        try:
            import fitz

            return fitz
        except ImportError:
            return None


def _pdf_pages_pymupdf(path: Path) -> tuple[list[str], bool]:
    """(page texts, any page carried an image)."""
    pymupdf = _pymupdf()
    document = pymupdf.open(str(path))
    try:
        pages, has_images = [], False
        for page in document:
            pages.append(page.get_text())
            if not has_images:
                with contextlib.suppress(Exception):
                    has_images = bool(page.get_images())
        return pages, has_images
    finally:
        document.close()


async def _pdf_pages_pdftotext(path: Path) -> tuple[list[str], bool]:
    """The fallback route, and the reason page structure survives it.

    `pdftotext -` writes to stdout with a form feed between pages, so splitting
    on `\\f` recovers exactly the page boundaries PyMuPDF gives directly. It
    cannot say whether a page carried an image, so the scan check falls back to
    "no text at all" -- see `_pdf`.

    Shelled out the way `convert.py` does it: argv as a list, quoted once by
    shlex, through the sandbox, with a timeout and a kill.
    """
    argv = ["pdftotext", "-layout", str(path), "-"]
    workspace = str(path.parent)
    wrapped, _backend = wrap_command(shlex.join(argv), SandboxPolicy.load(), workspace)
    try:
        process = await asyncio.create_subprocess_exec(
            *wrapped,
            cwd=workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise ExtractionError(f"could not start pdftotext: {exc}") from exc

    try:
        out, err = await asyncio.wait_for(process.communicate(), timeout=PDFTOTEXT_TIMEOUT_S)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise ExtractionError(
            f"pdftotext did not finish reading {path.name} within {PDFTOTEXT_TIMEOUT_S}s"
        ) from exc
    except asyncio.CancelledError:
        process.kill()
        with contextlib.suppress(Exception):
            await process.wait()
        raise

    if process.returncode != 0:
        detail = (err.decode(errors="replace") or "").strip().splitlines()
        reason = detail[-1] if detail else f"pdftotext exited {process.returncode}"
        raise ExtractionError(f"could not read {path.name}: {reason}")

    pages = out.decode("utf-8", errors="replace").split("\f")
    # pdftotext terminates every page with a form feed, so the split leaves one
    # empty string past the last page. Exactly one, and popped with an `if`
    # rather than a `while`: a loop would swallow every page of a blank scan and
    # turn the OCR sentence below into "has no pages", which is a true statement
    # about the wrong thing.
    if pages and not pages[-1].strip():
        pages.pop()
    return pages, False


async def _pdf(path: Path) -> str:
    if _pymupdf() is not None:
        pages, has_images = await asyncio.to_thread(_pdf_pages_pymupdf, path)
        engine = "PyMuPDF"
    else:
        pages, has_images = await _pdf_pages_pdftotext(path)
        engine = "pdftotext"

    if not pages:
        raise ExtractionError(f"{path.name} has no pages")

    # The scan check runs against every page, before any is dropped for being
    # blank. A scanned document is *all* blank pages, so trimming first would
    # leave nothing to measure and report an empty file instead of a photograph.
    ink = sum(len("".join(page.split())) for page in pages)
    if ink / len(pages) < SCAN_CHARS_PER_PAGE and (has_images or ink == 0):
        # Named, never silent. Indexing a 200-page scan as zero chunks is how
        # someone concludes retrieval is broken rather than that this one file
        # is a photograph of text.
        raise ExtractionError(
            f"{path.name} has no extractable text -- it is a scan, and reading it needs OCR"
            " (tesseract), which is not installed here. It covers images of text; install it"
            " and try again."
        )

    plural = "page" if len(pages) == 1 else "pages"
    blocks = [f"[{path.name} -- {len(pages)} {plural}, extracted with {engine}]"]
    for number, text in enumerate(pages, 1):
        body = _escape_body(text.strip())
        blocks.append(f"## Page {number}\n\n{body}" if body else f"## Page {number}")
    return "\n\n".join(blocks)


# --------------------------------------------------------------------------
# Word
# --------------------------------------------------------------------------


def _docx_blocks(document):
    """Paragraphs and tables in the order they appear in the document.

    `document.paragraphs` and `document.tables` are two separate lists, so
    reading them one after the other puts every table at the end -- which for a
    report that is mostly tables loses the association between each table and
    the heading it sits under, and the heading path is the thing being built.
    """
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def _docx_table(table) -> str:
    rows = [[_cell(cell.text) for cell in row.cells] for row in table.rows]
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header, *body = rows
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * width) + " |"]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)


def _heading_level(style: str) -> int:
    """Markdown heading level for a Word paragraph style, or 0 for body text.

    Localised Word installs name the styles in the user's language, so this
    recognises the English ones and treats anything else as body -- which loses
    the outline for those documents but never invents one.
    """
    if style == "Title":
        return 1
    if style.startswith("Heading "):
        try:
            # +1 so a Title sitting above Heading 1 actually nests: "# Report"
            # then "## Method" gives the heading path "Report > Method", where
            # two level-1 headings would give just "Method" and lose the
            # document. A file with no Title simply starts at level 2, which
            # shifts every level equally and leaves the nesting intact.
            return min(6, max(1, int(style.split()[-1]) + 1))
        except ValueError:
            return 0
    return 0


def _docx(path: Path) -> str:
    from docx import Document
    from docx.table import Table

    document = Document(str(path))
    out: list[str] = []
    for block in _docx_blocks(document):
        if isinstance(block, Table):
            rendered = _docx_table(block)
            if rendered:
                out.append(rendered)
            continue

        text = block.text.strip()
        if not text:
            continue
        style = (block.style.name or "") if block.style is not None else ""
        # "Title" is the document's own name for its top heading, and Word's
        # Heading 1..6 map onto markdown's levels directly.
        level = _heading_level(style)
        if level:
            out.append(f"{'#' * level} {text}")
        elif style.startswith("List"):
            out.append(f"- {_escape_body(text)}")
        else:
            out.append(_escape_body(text))
    if not out:
        raise ExtractionError(f"{path.name} has no text in it")
    return "\n\n".join(out)


# --------------------------------------------------------------------------
# Excel
# --------------------------------------------------------------------------


def _xlsx(path: Path) -> str:
    from openpyxl import load_workbook

    # data_only=True gives the cached *value* of a formula, which is what a
    # reader wants. The writing side must never open a workbook this way -- see
    # backend/documents/edit.py, where doing so would save the cached values
    # over every formula in the file.
    workbook = load_workbook(str(path), data_only=True, read_only=True)
    try:
        out: list[str] = []
        for name in workbook.sheetnames:
            sheet = workbook[name]
            rows = [list(row) for row in sheet.iter_rows(values_only=True)]
            while rows and not any(_cell(v) for v in rows[-1]):
                rows.pop()
            out.append(f"## Sheet: {name}")
            if not rows:
                out.append("(empty)")
                continue
            width = max(len(row) for row in rows)
            letters = _column_letters(width)
            # The column letters and row numbers are the point: without them a
            # spreadsheet is a grid of numbers nobody can cite, and "set B7" has
            # nothing to refer to.
            out.append(
                "\n".join(
                    ["|  | " + " | ".join(letters) + " |"]
                    + ["| --- " * (width + 1) + "|"]
                    + [
                        f"| {number} | "
                        + " | ".join(_cell(v) for v in (list(row) + [None] * (width - len(row))))
                        + " |"
                        for number, row in enumerate(rows, 1)
                    ]
                )
            )
        if not out:
            raise ExtractionError(f"{path.name} has no sheets")
        return "\n\n".join(out)
    finally:
        workbook.close()


# --------------------------------------------------------------------------
# PowerPoint
# --------------------------------------------------------------------------

_DRAWINGML_TEXT = "{http://schemas.openxmlformats.org/drawingml/2006/main}t"


def _pptx_slide(title_and_body: list[str], notes: str, number: int) -> str:
    body = "\n\n".join(_escape_body(t) for t in title_and_body if t.strip())
    block = f"## Slide {number}" + (f"\n\n{body}" if body else "")
    if notes.strip():
        block += f"\n\n### Notes\n\n{_escape_body(notes.strip())}"
    return block


def _pptx_library(path: Path) -> list[str]:
    from pptx import Presentation

    presentation = Presentation(str(path))
    blocks = []
    for number, slide in enumerate(presentation.slides, 1):
        texts = [
            shape.text_frame.text
            for shape in slide.shapes
            if getattr(shape, "has_text_frame", False)
        ]
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text
        blocks.append(_pptx_slide(texts, notes, number))
    return blocks


def _pptx_zip(path: Path) -> list[str]:
    """A .pptx with nothing installed: it is a zip of XML, so read the zip.

    Approximation to be honest about: slide order is taken from the numeric
    suffix of `slideN.xml`, whereas the true order lives in `<p:sldIdLst>` in
    `ppt/presentation.xml`. They agree for any deck that has not had slides
    reordered after creation. python-pptx gets it exactly right, which is why it
    is the primary route.
    """

    def _text(archive: zipfile.ZipFile, name: str) -> str:
        with archive.open(name) as handle:
            root = ElementTree.parse(handle).getroot()
        return "\n".join(node.text for node in root.iter(_DRAWINGML_TEXT) if node.text)

    def _number(name: str) -> int:
        digits = re.findall(r"(\d+)\.xml$", name)
        return int(digits[0]) if digits else 0

    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        slides = sorted(
            (n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=_number
        )
        notes = {
            _number(n): n for n in names if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", n)
        }
        blocks = []
        for position, name in enumerate(slides, 1):
            note_name = notes.get(_number(name))
            blocks.append(
                _pptx_slide(
                    [_text(archive, name)],
                    _text(archive, note_name) if note_name else "",
                    position,
                )
            )
    return blocks


def _pptx(path: Path) -> str:
    blocks = _pptx_library(path) if _importable("pptx") else _pptx_zip(path)
    if not blocks:
        raise ExtractionError(f"{path.name} has no slides")
    return "\n\n".join(blocks)


# --------------------------------------------------------------------------


async def extract(path: Path) -> str:
    """One document as markdown. Raises ExtractionError with a sentence.

    Raised rather than returned as a union because the two callers want
    different things with it: `view_file` turns it into a `ToolResult.error`,
    where errors are data; `Indexer.index_vault` already catches per file, so
    one unreadable document does not end a scan.

    Async because the PDF fallback shells out to pdftotext, and blocking the
    event loop for a large scan would stall every other tool call in the turn.
    """
    path = Path(path)
    suffix = path.suffix.lower()

    refusal = missing_reader(suffix)
    if refusal:
        raise ExtractionError(refusal)

    try:
        # Every library below parses synchronously, and a 25MB PDF is seconds
        # of CPU -- on the event loop, which stalls every streaming turn and
        # runner for the parse. `to_thread` costs one hop; the pdftotext
        # fallback is already a subprocess and keeps its await.
        if suffix == ".pdf":
            return await _pdf(path)
        if suffix == ".docx":
            return await asyncio.to_thread(_docx, path)
        if suffix == ".xlsx":
            return await asyncio.to_thread(_xlsx, path)
        if suffix == ".pptx":
            return await asyncio.to_thread(_pptx, path)
    except ExtractionError:
        raise
    except (OSError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
        raise ExtractionError(f"could not read {path.name}: {exc}") from exc
    except Exception as exc:  # a library refusing a malformed file
        raise ExtractionError(f"could not read {path.name}: {exc}") from exc

    raise ExtractionError(f"{suffix or 'that'} is not a document format this reads")
