"""Tools over the library.

These handlers translate arguments in and phrase results out; they hold no logic
of their own -- `backend/library/service.py` owns it, and the HTTP routes, the
share endpoint and these tools all go through it.

`search_documents` already finds library material, because it is the same index.
`search_library` exists because "what have I read about X" is a different
question from "what is in my notes about X", and answering it with the item --
title, author, when you read it -- rather than a passage under `~/.amethyst` is what
makes the answer usable.
"""

from __future__ import annotations

from typing import Any

from backend.library.service import LibraryError, LibraryService, describe
from backend.library.store import KINDS
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult


def _service() -> LibraryService:
    return LibraryService()


async def log_library_item(args: dict[str, Any], _: ToolContext) -> ToolResult:
    url = (args.get("url") or "").strip()
    try:
        if url:
            captured = await _service().capture_url(
                url,
                kind=args.get("kind"),
                consumed_on=args.get("consumed_on"),
                notes=args.get("notes"),
                title=args.get("title"),
            )
        else:
            captured = await _service().log_manual(
                title=args.get("title") or "",
                kind=args.get("kind") or "note",
                text=args.get("text"),
                author=args.get("author"),
                notes=args.get("notes"),
                consumed_on=args.get("consumed_on"),
                rating=args.get("rating"),
            )
    except LibraryError as exc:
        return ToolResult.error(str(exc))

    if captured.already_logged:
        return ToolResult.ok(f"Already in the library: {describe(captured.item)}")
    return ToolResult.ok(f"Logged: {describe(captured.item)}")


def _vocabulary(service: LibraryService) -> str:
    """The words this library is actually filed under, for a model that guessed
    wrong. Without it the only recovery from an unknown tag is to guess again."""
    tags = service.tag_counts()
    categories = service.category_counts()
    lines = []
    if categories:
        lines.append(
            "Categories: "
            + ", ".join(f"{name} ({n})" for name, n in sorted(categories.items()))
        )
    if tags:
        lines.append("Tags: " + ", ".join(f"{name} ({n})" for name, n in tags.items()))
    return "\n".join(lines)


async def search_library(args: dict[str, Any], _: ToolContext) -> ToolResult:
    query = (args.get("query") or "").strip()
    tag = (args.get("tag") or "").strip().lower() or None
    category = (args.get("category") or "").strip().lower() or None
    kind = args.get("kind") or None
    service = _service()
    filtering = bool(tag or category or kind)
    # A filtered question is a "how many / which ones" question, and answering
    # eight of twenty-one is a wrong answer rather than a short one. A free-text
    # query stays small because it is ranked and the tail is noise.
    default_limit = 50 if filtering else 8
    limit = max(1, min(int(args.get("limit") or default_limit), 100))

    if args.get("list_tags"):
        vocabulary = _vocabulary(service)
        return ToolResult.ok(vocabulary or "The library is empty.")

    # Filters are answered from the shelf, not from the index.
    #
    # This tool could only search text before, so "which movies have I saved"
    # went to the ranked index and came back with whatever eight items scored
    # best -- six, in the report that found this -- while the library held
    # twenty-one rows tagged `cinema` all along. A tag or a category is an
    # exact fact about a row: it is answered by selecting those rows, and the
    # count is then true.
    if filtering:
        items = service.recent(kind=kind, category=category, tag=tag, limit=limit)
        if not items:
            asked = ", ".join(
                part
                for part in (
                    f"tag {tag!r}" if tag else "",
                    f"category {category!r}" if category else "",
                    f"kind {kind!r}" if kind else "",
                )
                if part
            )
            vocabulary = _vocabulary(service)
            if not vocabulary:
                return ToolResult.ok("The library is empty.")
            return ToolResult.ok(f"Nothing in the library has {asked}.\n{vocabulary}")
        if query:
            # Rank the matching shelf by the query rather than searching the
            # whole library and hoping the filter survives the ranking.
            wanted = {item["id"] for item in items}
            try:
                ranked = await service.search(query, limit=100)
            except Exception:
                ranked = []
            order = {item["id"]: n for n, item in enumerate(ranked)}
            items.sort(key=lambda item: order.get(item["id"], len(order)))
        header = f"{len(items)} item{'' if len(items) == 1 else 's'}"
        return ToolResult.ok(
            f"{header}:\n" + "\n".join(describe(item) for item in items)
        )

    if not query:
        items = service.recent(limit=limit)
        if not items:
            return ToolResult.ok("The library is empty.")
        vocabulary = _vocabulary(service)
        body = "\n".join(describe(item) for item in items)
        return ToolResult.ok(f"{body}\n\n{vocabulary}" if vocabulary else body)

    try:
        results = await service.search(query, limit=limit)
    except Exception as exc:  # a broken index must not look like an empty one
        return ToolResult.error(f"the library index could not be searched: {exc}")

    if not results:
        counts = service.counts()
        if not counts:
            return ToolResult.ok("The library is empty, so there is nothing to search yet.")
        vocabulary = _vocabulary(service)
        return ToolResult.ok(
            f"Nothing in the library matched {query!r}."
            " Items logged without captured text are findable by title only."
            + (f"\n{vocabulary}" if vocabulary else "")
        )
    body = "\n\n".join(f"{describe(item)}\n{item['excerpt']}" for item in results)
    if service.last_search_degraded:
        # Said out loud, because otherwise the model reports a ranked, partial
        # keyword match as though it were everything the user has. The exact
        # answer is a tag or a category, so name the way out as well.
        body += (
            "\n\n(Search ran on keywords only -- the embedder is unreachable, so"
            " meaning-based matches are missing and this is a floor, not a total."
            " Filter by tag or category for an exact count.)"
        )
    return ToolResult.ok(body)


def tools() -> list[Tool]:
    return [
        Tool(
            name="log_library_item",
            description=(
                "Log something the user read, watched or listened to. Give a url to"
                " capture the page's text, or a title for a book or a talk with no"
                " url. Use when the user says they have read or watched something,"
                " or asks to save a link."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The address, if there is one"},
                    "title": {
                        "type": "string",
                        "description": "Required when there is no url; otherwise taken from"
                        " the page",
                    },
                    "kind": {"type": "string", "enum": list(KINDS)},
                    "author": {"type": "string"},
                    "notes": {
                        "type": "string",
                        "description": "The user's own thoughts about it, in their words",
                    },
                    "text": {
                        "type": "string",
                        "description": "The body, when there is no url to fetch it from",
                    },
                    "consumed_on": {
                        "type": "string",
                        "description": "YYYY-MM-DD. Defaults to today. Do not compute this"
                        " yourself unless the user gave an exact date.",
                    },
                    "rating": {"type": "integer", "description": "1 to 5, the user's own"},
                },
            },
            handler=log_library_item,
            # It writes a row and a file, and fetches a URL the user named.
            risk=RiskLevel.MEDIUM,
        ),
        Tool(
            name="search_library",
            description=(
                "Search what the user has read, watched and listened to. Every item"
                " carries a category (movie, tool, book, general) and tags (cinema,"
                " ai, programming, ...). For a question about a group -- 'which"
                " movies have I saved', 'how many are tagged cinema', 'list my"
                " tools' -- filter with `category` or `tag`: that selects the rows"
                " exactly and the count is complete. Use `query` only to search the"
                " text by meaning and keyword ('what was that article about Y'),"
                " which ranks and returns the best few rather than all of them."
                " `list_tags` returns the categories and tags this library actually"
                " uses, with counts; call it first rather than guessing a tag."
                " With nothing at all, lists the most recent items."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Text to search for"},
                    "tag": {
                        "type": "string",
                        "description": "Only items carrying this tag. Exact, complete,"
                        " and countable. See list_tags for what exists.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Only items in this category, e.g. 'movie'."
                        " See list_tags for what exists.",
                    },
                    "kind": {
                        "type": "string",
                        "enum": list(KINDS),
                        "description": "Only items of this kind (how it was captured,"
                        " not what it is about)",
                    },
                    "list_tags": {
                        "type": "boolean",
                        "description": "Return the categories and tags in use, with counts",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum items. Default 8 for a text query, 50"
                        " when filtering by tag, category or kind. Up to 100.",
                    },
                },
            },
            handler=search_library,
            risk=RiskLevel.LOW,
        ),
    ]
