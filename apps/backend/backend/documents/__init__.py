"""Reading and writing the documents that are not text.

Not to be confused with `backend/tools/builtin/documents.py`, which is the
*search* tool surface over the retrieval index. This package is the format
layer underneath: it turns a PDF, a Word file, a spreadsheet or a deck into
markdown, and turns markdown back into one. The same relationship
`backend/library/` has to `backend/tools/builtin/library.py`.

Two consumers, neither depending on the other: `view_file` reads one document
for the model to look at, and `Indexer.index_file` reads every document in a
folder so retrieval can find them. That is why this is a package beside
`retrieval/` rather than a helper inside it.
"""

from __future__ import annotations

from backend.documents.extract import (
    EXTRACTABLE,
    ExtractionError,
    extract,
    missing_reader,
)

__all__ = ["EXTRACTABLE", "ExtractionError", "extract", "missing_reader"]
