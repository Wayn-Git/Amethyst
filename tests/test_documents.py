"""Reading and writing the documents that are not text.

Every test names the mutation that makes it fail.

Fixtures are generated here rather than committed: there are no binary files
under `tests/`, and a checked-in .docx is a thing nobody can review in a diff.
The PDF is built by hand out of literal PDF syntax so the PDF path is covered
even with none of the optional extras installed; the OOXML formats are built
with the library that owns them, because openpyxl is strict enough about
`[Content_Types].xml` that a hand-rolled workbook is a fixture nobody would
maintain.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from backend.documents import edit as doc
from backend.documents.edit import DocumentError, parse_markdown
from backend.documents.extract import (
    EXTRACTABLE,
    ExtractionError,
    extract,
    missing_reader,
)
from backend.retrieval.chunking import chunk_markdown

DRAWINGML = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _pdf(path: Path, pages: list[str]) -> Path:
    """A minimal, valid multi-page PDF. No dependency, so this always runs."""
    objects: list[bytes] = []
    page_ids = [4 + 2 * i for i in range(len(pages))]

    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{i} 0 R" for i in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for index, text in enumerate(pages):
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]"
            f" /Resources << /Font << /F1 3 0 R >> >>"
            f" /Contents {page_ids[index] + 1} 0 R >>".encode()
        )
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    start = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        start,
    )
    path.write_bytes(bytes(out))
    return path


def _pptx(path: Path, slides: list[list[str]], notes: dict[int, str] | None = None) -> Path:
    """A .pptx as the zip of XML it actually is -- enough for the reading fallback."""

    def xml(texts: list[str]) -> str:
        runs = "".join(f"<a:t>{t}</a:t>" for t in texts)
        return f'<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="{DRAWINGML}">{runs}</p:sld>'

    with zipfile.ZipFile(path, "w") as archive:
        for number, texts in enumerate(slides, 1):
            archive.writestr(f"ppt/slides/slide{number}.xml", xml(texts))
        for number, text in (notes or {}).items():
            archive.writestr(f"ppt/notesSlides/notesSlide{number}.xml", xml([text]))
    return path


# ----------------------------------------------------------------- extraction


async def test_a_pdf_keeps_its_page_boundaries(tmp_path):
    """Page numbers are the whole reason the extractors emit markdown: `## Page 2`
    becomes a heading path, which becomes `report.pdf > Page 2` in a search hit
    with no change to search, the store or the schema.

    Mutation check: emit the pages joined by a blank line instead of headings.
    """
    markdown = await extract(_pdf(tmp_path / "report.pdf", ["First page", "Second page"]))
    assert "## Page 1" in markdown
    assert "## Page 2" in markdown
    assert markdown.index("First page") < markdown.index("## Page 2")


async def test_a_pdf_page_number_survives_into_the_heading_path(tmp_path):
    """The round trip through the real chunker, not an assertion about the
    extractor alone -- what matters is what `SearchHit.label` will be handed.

    Mutation check: emit `**Page 2**` instead of `## Page 2`.
    """
    markdown = await extract(_pdf(tmp_path / "report.pdf", ["Alpha", "Beta"]))
    paths = [chunk.heading_path for chunk in chunk_markdown(markdown)]
    assert "Page 2" in paths


async def test_a_scanned_pdf_names_ocr_rather_than_returning_nothing(tmp_path):
    """A silent empty extraction indexes a 200-page scan as zero chunks, and the
    conclusion a user draws from that is that retrieval is broken rather than
    that this one file is a photograph of text.

    Mutation check: return "" for a text-free PDF instead of raising.
    """
    pymupdf = pytest.importorskip("pymupdf")
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 50))
    pixmap.clear_with(200)
    page.insert_image(pymupdf.Rect(0, 0, 200, 200), pixmap=pixmap)
    document.save(tmp_path / "scan.pdf")
    document.close()

    with pytest.raises(ExtractionError) as raised:
        await extract(tmp_path / "scan.pdf")
    assert "tesseract" in str(raised.value)
    assert "not installed here" in str(raised.value)


async def test_a_spreadsheet_keeps_sheet_names_and_cell_addresses(tmp_path):
    """A grid of numbers nobody can cite is not a readable spreadsheet, and
    "set B7" needs a B7 in the text to refer to.

    Mutation check: drop the column-letter header row.
    """
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Budget"
    sheet["A1"], sheet["B1"] = "Item", "Cost"
    sheet["A2"], sheet["B2"] = "Rent", 900
    workbook.save(tmp_path / "b.xlsx")

    markdown = await extract(tmp_path / "b.xlsx")
    assert "## Sheet: Budget" in markdown
    assert "| B |" in markdown, "column letters, so a cell address is recoverable"
    assert "| 2 | Rent | 900 |" in markdown
    assert chunk_markdown(markdown)[0].heading_path == "Sheet: Budget"


async def test_a_word_outline_becomes_a_heading_path(tmp_path):
    """A Title above a Heading 1 has to nest, or two level-1 headings collapse
    "Report > Method" into "Method" and the document's name is lost.

    Mutation check: map Heading N to level N instead of N + 1.
    """
    docx = pytest.importorskip("docx")
    document = docx.Document()
    document.add_heading("Report", 0)
    document.add_heading("Method", 1)
    document.add_paragraph("We measured it.")
    document.save(tmp_path / "r.docx")

    markdown = await extract(tmp_path / "r.docx")
    assert chunk_markdown(markdown)[0].heading_path == "Report > Method"


async def test_a_deck_reads_without_python_pptx(tmp_path):
    """A .pptx is a zip of XML, so the fallback needs nothing installed. Slide
    boundaries are the heading path, which is why `soffice --convert-to txt` was
    not the fallback: it loses them.

    Mutation check: concatenate the slides without `## Slide N`.
    """
    path = _pptx(tmp_path / "d.pptx", [["Intro"], ["Findings"]], notes={2: "say this slowly"})
    markdown = await extract(path)
    assert "## Slide 1" in markdown and "## Slide 2" in markdown
    assert "### Notes" in markdown and "say this slowly" in markdown
    paths = [chunk.heading_path for chunk in chunk_markdown(markdown)]
    assert "Slide 2 > Notes" in paths


async def test_a_heading_inside_the_content_does_not_become_a_heading(tmp_path):
    """`chunking._HEADING_RE` matches `^#{1,6}\\s`, so a page containing a line
    like "## Terms" would otherwise rewrite that page's heading path -- and the
    page number a search hit cites with it.

    Mutation check: drop the escape in `_escape_body`.
    """
    markdown = await extract(_pdf(tmp_path / "r.pdf", ["## Terms and conditions"]))
    paths = [chunk.heading_path for chunk in chunk_markdown(markdown)]
    # None is the provenance line above the first page heading, which has no
    # section of its own. What must not appear is a heading made of the content.
    assert set(paths) == {None, "Page 1"}, f"content became structure: {paths}"


async def test_a_pipe_in_a_cell_does_not_reshape_the_table(tmp_path):
    """One unescaped pipe adds a column to its own row and to nothing else, so
    every value after it in that row is read against the wrong header.

    Mutation check: drop the `|` escape in `_cell`.
    """
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    workbook.active["A1"] = "pipe | here"
    workbook.active["B1"] = "safe"
    workbook.save(tmp_path / "b.xlsx")

    row = [line for line in (await extract(tmp_path / "b.xlsx")).splitlines() if "pipe" in line][0]
    assert "\\|" in row, f"the pipe was not escaped: {row}"
    # Four unescaped bars: the row opens, closes and separates three cells --
    # the row number, the value holding the pipe, and the one after it.
    assert row.replace("\\|", "").count("|") == 4, f"the escape leaked a column: {row}"


def test_a_missing_library_is_named_with_the_line_that_installs_it(monkeypatch):
    """`convert.py`'s discipline: "converting .docx needs LibreOffice, which is
    not installed here" is a sentence somebody can act on, and an ImportError
    traceback is not. Checked before any work, so a vault scan does not find out
    two hundred files in.

    Mutation check: return None for every suffix.
    """
    # Imported through importlib because `backend.documents` re-exports the
    # `extract` *function* under that name, so the plain import path resolves to
    # the function rather than the module it lives in.
    import importlib

    monkeypatch.setattr(
        importlib.import_module("backend.documents.extract"), "_importable", lambda _: False
    )
    sentence = missing_reader(".docx")
    assert sentence is not None
    assert "python-docx" in sentence
    assert 'pip install "amethyst[documents]"' in sentence


def test_the_old_binary_formats_point_at_the_tool_that_opens_them():
    """python-docx cannot open a .doc and never will, but `convert_file` turns
    one into a .docx with LibreOffice, which is installed far more often than
    not. Refusing without saying that is a dead end for no reason.

    Mutation check: return a bare "unsupported format" for .doc.
    """
    sentence = missing_reader(".doc")
    assert sentence is not None
    assert "convert_file" in sentence and "docx" in sentence
    assert ".doc" not in EXTRACTABLE


# -------------------------------------------------------------------- writing


def test_markdown_parses_into_the_blocks_every_format_can_represent(tmp_path):
    """Headings, bullets, tables and paragraphs is the set .docx, .xlsx and
    .pptx all have. Anything else lands as a paragraph rather than vanishing.

    Mutation check: drop the table branch and let rows fall through as text.
    """
    blocks = parse_markdown(
        "# Title\n\ntext here\n\n- one\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n"
    )
    kinds = [block.kind for block in blocks]
    assert kinds == ["heading", "para", "bullet", "table"]
    assert blocks[3].rows == [["a", "b"], ["1", "2"]]


async def test_a_document_written_from_markdown_reads_back_as_that_markdown(tmp_path):
    """The create mapping is the exact inverse of the extract mapping, which is
    what makes "write me a report, now change one line of it" work at all.

    Mutation check: write headings with `add_heading(level=block.level)`.
    """
    pytest.importorskip("docx")
    path = tmp_path / "r.docx"
    doc.create(path, "# Report\n\n## Method\n\nWe measured it.\n\n- one\n")

    markdown = await extract(path)
    assert "# Report" in markdown and "## Method" in markdown
    assert "We measured it." in markdown
    assert chunk_markdown(markdown)[0].heading_path == "Report > Method"


def test_setting_one_cell_leaves_the_formulas_in_the_file(tmp_path):
    """The trap this file exists to avoid. Extraction opens a workbook with
    `data_only=True` to read the cached value of a formula; saving a handle
    opened that way writes those cached values back over every formula in the
    file. Silent, and total.

    Mutation check: pass data_only=True in `_workbook_for_writing`.
    """
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet["A1"], sheet["B1"], sheet["C1"] = "Rent", 900, "=B1*12"
    path = tmp_path / "b.xlsx"
    workbook.save(path)

    doc.set_cell(path, None, "B1", 1200)

    reopened = openpyxl.load_workbook(path).active
    assert reopened["C1"].value == "=B1*12", "the formula was replaced by its cached value"
    assert reopened["B1"].value == 1200
    assert reopened["A1"].value == "Rent", "an untouched neighbour changed"


def test_replacing_text_matches_across_a_formatting_boundary(tmp_path):
    """python-docx splits a paragraph into runs at every formatting change, so a
    run-by-run replace silently misses any string spanning a bold word and
    reports success having changed nothing.

    Mutation check: replace run by run instead of at paragraph level.
    """
    docx = pytest.importorskip("docx")
    document = docx.Document()
    paragraph = document.add_paragraph("the ")
    paragraph.add_run("quarterly").bold = True
    paragraph.add_run(" report")
    path = tmp_path / "r.docx"
    document.save(path)

    doc.replace_text(path, "quarterly report", "annual review", replace_all=False)
    assert "annual review" in docx.Document(str(path)).paragraphs[0].text


def test_an_ambiguous_replacement_is_refused_in_edit_files_words(tmp_path):
    """The same contract `edit_file` states, word for word, because it is the one
    the model has already learned.

    Mutation check: replace the first occurrence when count > 1.
    """
    docx = pytest.importorskip("docx")
    document = docx.Document()
    document.add_paragraph("cost cost")
    path = tmp_path / "r.docx"
    document.save(path)

    with pytest.raises(DocumentError) as raised:
        doc.replace_text(path, "cost", "price", replace_all=False)
    assert "appears 2 times" in str(raised.value)
    assert "replace_all" in str(raised.value)


def test_writing_a_deck_without_python_pptx_says_so_by_name(tmp_path, monkeypatch):
    """Reading a .pptx degrades to a zip reader; writing one cannot. A .pptx is a
    dozen cross-referenced parts that have to agree, and a hand-rolled one is a
    file PowerPoint refuses to open -- so this refuses instead.

    Mutation check: return None from `missing_writer` for .pptx.
    """
    import importlib

    monkeypatch.setattr(
        importlib.import_module("backend.documents.extract"), "_importable", lambda _: False
    )
    sentence = doc.missing_writer(".pptx")
    assert sentence is not None and "python-pptx" in sentence
    assert "Reading a deck works without it" in sentence
