"""Hybrid search over the indexed vault."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from backend.db.connection import get_connection
from backend.retrieval import store
from backend.retrieval.embeddings import Embedder

log = logging.getLogger(__name__)

CANDIDATES_PER_INDEX = 30

#: How much wider the candidate pool goes when the caller filters by source or
#: path. The filter runs after ranking, so every candidate that fails it is a
#: slot the caller paid for and did not get -- see `SearchService.search`.
FILTERED_CANDIDATE_FACTOR = 20


@dataclass
class SearchHit:
    chunk_id: int
    content: str
    path: str
    heading_path: str | None
    score: float
    # Defaulted so anything constructing a hit positionally still works.
    source: str = "vault"
    title: str | None = None

    @property
    def label(self) -> str:
        """How to name this hit to a person, or to a model reading a tool result.

        A vault hit is named by its file: `notes.md` is how the user thinks of
        it. Material with no filename the user chose -- a captured article,
        stored under an id -- is named by its title instead. The source check is
        load-bearing: `documents.title` is set to `path.stem` for vault files,
        so preferring the title unconditionally would rename every existing hit
        from `notes.md` to `notes`.
        """
        named = self.title if (self.source != "vault" and self.title) else Path(self.path).name
        heading = self.heading_path or ""
        # A captured page is written with its title as the top heading, so every
        # chunk's heading path starts with the name we are already using. Left
        # alone that reads "Deep Work > Deep Work", which says nothing twice.
        if heading == named:
            heading = ""
        elif heading.startswith(f"{named} > "):
            heading = heading[len(named) + 3 :]
        return f"{named} > {heading}" if heading else named


class SearchService:
    def __init__(self, embedder: Embedder | None = None, conn=None):
        self.conn = conn or get_connection()
        self.embedder = embedder or self._embedder_matching_index()
        # Whether the last search ran on keywords alone because the embedder
        # could not be reached. It was a log line and nothing else, so a
        # caller -- and through it a model, and through that the user -- was
        # told "here are your results" by a search that had quietly lost half
        # of how it finds things. Anything reporting a count off a search has
        # to be able to say the count is a floor.
        self.degraded: str | None = None

    def _embedder_matching_index(self) -> Embedder:
        """Query with the model that built the index, not a global default.

        Embedding a query with a different model than the documents produces
        vectors in an unrelated space, which returns plausible-looking nonsense
        rather than an error.
        """
        recorded = store.indexed_embedding_model(self.conn)
        if recorded is None:
            return Embedder()
        provider, model = recorded
        return Embedder(provider, model)

    async def search(
        self,
        query: str,
        *,
        limit: int = 8,
        path_glob: str | None = None,
        source: str | None = None,
        semantic: bool = True,
    ) -> list[SearchHit]:
        """Vector and keyword search fused by reciprocal rank.

        Either index alone is a weak default: dense vectors miss exact terms, and
        keyword search misses paraphrase. Fusing ranks covers both.
        """
        if not query.strip():
            return []

        self.degraded = None
        rankings: list[list[tuple[int, float]]] = []

        # A filtered search asks each index for far more candidates.
        #
        # Both indexes rank the whole corpus, and the `source` / `path_glob`
        # filter is applied afterwards -- so with a flat thirty candidates a
        # search scoped to the library was choosing from whatever thirty chunks
        # scored best *overall*, and a vault full of notes on the same subject
        # left almost nothing for the filter to keep. Asking the library for
        # thirty matches and being handed twelve was this. Unfiltered searches
        # keep the cheap ceiling: nothing is discarded there, so a wider pool
        # would only cost time.
        candidates = CANDIDATES_PER_INDEX
        if source or path_glob:
            candidates = CANDIDATES_PER_INDEX * FILTERED_CANDIDATE_FACTOR

        keyword_hits = store.search_keywords(self.conn, query, candidates)
        if keyword_hits:
            rankings.append(keyword_hits)

        if semantic and store.vector_available(self.conn):
            try:
                vector = await self.embedder.embed_one(query)
                vector_hits = store.search_vectors(self.conn, vector, candidates)
                if vector_hits:
                    rankings.append(vector_hits)
            except Exception as exc:
                # Keyword results are still useful, so degrade rather than fail.
                log.warning("semantic search unavailable, using keywords only: %s", exc)
                self.degraded = str(exc)

        if not rankings:
            return []

        fused = store.reciprocal_rank_fusion(rankings)
        return self._hydrate([cid for cid, _ in fused], dict(fused), limit, path_glob, source)

    def _hydrate(
        self,
        chunk_ids: list[int],
        scores: dict[int, float],
        limit: int,
        path_glob: str | None,
        source: str | None = None,
    ) -> list[SearchHit]:
        if not chunk_ids:
            return []
        # A filtered search walks the whole ranking, not a window off the top.
        #
        # This took `chunk_ids[: limit * 4]` and applied the filters to that
        # slice afterwards, which is fine when there is no filter and wrong
        # when there is: the fused ranking covers every source, so a search
        # scoped to `library` was competing for those slots against the whole
        # vault. Asking for thirty library items and getting twelve was this --
        # the other eighteen were ranked below notes that the filter then threw
        # away. Batched because the ranking can be thousands of chunks and
        # SQLite has a ceiling on how many parameters one statement may bind.
        filtered = bool(path_glob or source)
        batch_size = 400
        candidates = chunk_ids if filtered else chunk_ids[: limit * 4]
        rows: list = []
        for start in range(0, len(candidates), batch_size):
            batch = candidates[start : start + batch_size]
            placeholders = ",".join("?" * len(batch))
            sql = (
                "SELECT c.id, c.content, c.heading_path, d.path, d.source, d.title"
                " FROM document_chunks c"
                f" JOIN documents d ON d.id = c.document_id WHERE c.id IN ({placeholders})"
            )
            params: list = list(batch)
            if path_glob:
                sql += " AND d.path GLOB ?"
                params.append(path_glob if "*" in path_glob else f"*{path_glob}*")
            if source:
                sql += " AND d.source = ?"
                params.append(source)
            rows.extend(self.conn.execute(sql, params).fetchall())
            if len(rows) >= limit * 4:
                # Enough to fill the page after ranking; the rest of the
                # ranking is below everything already held.
                break

        hits = [
            SearchHit(
                chunk_id=row["id"],
                content=row["content"],
                path=row["path"],
                heading_path=row["heading_path"],
                score=scores.get(row["id"], 0.0),
                source=row["source"] or "vault",
                title=row["title"],
            )
            for row in rows
        ]
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    async def context_for(self, query: str, *, budget_chars: int = 6000) -> str:
        """Assemble retrieved context for the system prompt, within a budget."""
        text, _ = await self.context_and_hits(query, budget_chars=budget_chars)
        return text

    async def context_and_hits(
        self, query: str, *, budget_chars: int = 6000
    ) -> tuple[str, list[SearchHit]]:
        """The same block, and the hits that actually fitted in it.

        Two returns rather than a second search: the agent loop records what its
        prompt was built from (`backend/agent/state.py`), and the hits the budget
        cut are not part of that -- they never reached the model.
        """
        hits = await self.search(query, limit=6)
        if not hits:
            return "", []

        blocks: list[str] = []
        used: list[SearchHit] = []
        size = 0
        for hit in hits:
            block = f"[{hit.label}]\n{hit.content}"
            if size + len(block) > budget_chars:
                break
            blocks.append(block)
            used.append(hit)
            size += len(block)
        return "\n\n".join(blocks), used
