"""Recent-conversation summaries: ChatGPT layer-3 parity.

ChatGPT injects ~15 precomputed 2-line summaries of recent chats every turn —
no vector search, no embedding on the critical path. Amethyst had vault RAG
but zero cross-chat continuity. This closes that gap.

Design for <5s TTFT:
- Write: post-turn, deterministic from user messages only (no LLM, no embed).
  First user message + last user message, truncated. Cheap enough to run inline
  after _remember without blocking first token of any turn.
- Read: pre-turn single SQLite join, newest 15 excluding current. Rendered as
  <recent_conversations> block, ~600-900 chars. Zero model calls.
- Upgrade path: background LLM rewrite can replace summary text later; version
  via source_max_id keeps it incremental.
"""

from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

MAX_RECENT = 15
MAX_LINE_CHARS = 160


def _clean(text: str | None) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) > MAX_LINE_CHARS:
        text = text[: MAX_LINE_CHARS - 1].rsplit(" ", 1)[0] + "…"
    return text


def summarize_messages(user_texts: list[str], title: str | None = None) -> str:
    """One-line summary from user messages only, ChatGPT-style.

    Prefers title when set, else first ask + latest ask when different.
    """
    cleaned = [_clean(t) for t in user_texts if (t or "").strip()]
    cleaned = [c for c in cleaned if c]
    if not cleaned:
        return _clean(title) or "(no user messages yet)"
    if title and title.strip():
        base = _clean(title)
        # Title plus latest ask when it adds info.
        if len(cleaned) > 1 and cleaned[-1].lower() not in base.lower():
            return f"{base} — latest: {cleaned[-1]}"
        if len(cleaned) == 1 and cleaned[0].lower() not in base.lower():
            return f"{base} — {cleaned[0]}"
        return base
    if len(cleaned) == 1:
        return cleaned[0]
    first, last = cleaned[0], cleaned[-1]
    if last.lower() == first.lower():
        return first
    return f"{first} … latest: {last}"


def _backfill_missing(conn, *, exclude_id: str | None, need: int) -> None:
    """Generate static summaries for recent conversations lacking one.

    Cold-start path: after upgrade the table is empty, so the first
    "what did we talk about yesterday" turn would find nothing and the model
    spelunks the DB with tools (schema dumps, shell ls) — each a slow model
    round trip. Backfill is user-messages-only, no LLM, bounded to `need`
    conversations. Best-effort, never raises.
    """
    try:
        from backend.db.repositories import ConversationRepository

        listed = ConversationRepository(conn).list(limit=50)
        made = 0
        for row in listed:
            if made >= need:
                break
            try:
                cid = row["id"]
            except Exception:
                continue
            if exclude_id and cid == exclude_id:
                continue
            try:
                if row["automation_id"] is not None:
                    continue
            except Exception:
                pass
            try:
                existing = conn.execute(
                    "SELECT 1 FROM conversation_summaries WHERE conversation_id = ?",
                    (cid,),
                ).fetchone()
            except Exception:
                return  # table missing (very old DB mid-migration); skip
            if existing:
                continue
            try:
                if refresh_conversation_summary(cid, conn) is not None:
                    made += 1
            except Exception:
                continue
    except Exception as exc:
        log.debug("conversation summary backfill unavailable: %s", exc)


def refresh_conversation_summary(conversation_id: str, conn=None) -> str | None:
    """Recompute summary for one conversation from its user messages.

    Returns summary text or None when nothing to store. Best-effort: never
    raises — summary must not break a finished turn.
    """
    try:
        from backend.db.connection import get_connection
        from backend.db.repositories import ConversationSummaryRepository, MessageRepository

        c = conn or get_connection()
        history = MessageRepository(c).history(conversation_id, limit=50)
        user_texts: list[str] = []
        max_id = 0
        for m in history:
            max_id = max(max_id, int(getattr(m, "id", 0) or 0))
            role = getattr(m, "role", "")
            content = getattr(m, "content", "") or ""
            if role == "user" and content.strip():
                # Strip tool-ish pastes: keep first 500 chars per message here,
                # summarize_messages truncates to line budget after.
                user_texts.append(content[:500])
        if not user_texts:
            return None
        title = None
        try:
            row = c.execute(
                "SELECT title FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
            title = (row["title"] if row else None) or None
        except Exception:
            title = None
        summary = summarize_messages(user_texts, title)
        ConversationSummaryRepository(c).upsert(conversation_id, summary, max_id)
        return summary
    except Exception as exc:
        log.debug("conversation summary refresh unavailable: %s", exc)
        return None


def recent_block(exclude_id: str | None = None, limit: int = MAX_RECENT, conn=None) -> str | None:
    """Render <recent_conversations> block or None when empty.

    Single SQLite read, no embedding. Called pre-turn. Lazily backfills
    missing summaries from user messages (static, no LLM) so cold starts —
    empty table after upgrade — still get continuity on the first turn.
    """
    try:
        from backend.db.connection import get_connection
        from backend.db.repositories import ConversationSummaryRepository

        c = conn or get_connection()
        repo = ConversationSummaryRepository(c)
        rows = repo.recent(exclude_id=exclude_id, limit=limit)
        if len(rows) < limit:
            _backfill_missing(c, exclude_id=exclude_id, need=limit - len(rows))
            rows = repo.recent(exclude_id=exclude_id, limit=limit)
        if not rows:
            return None
        lines: list[str] = []
        for i, r in enumerate(rows, 1):
            try:
                label = (r["title"] or "").strip() or f"conversation {str(r['conversation_id'])[:8]}"
            except Exception:
                label = "conversation"
            try:
                summary = (r["summary"] or "").strip()
            except Exception:
                summary = ""
            if not summary:
                continue
            # Date is load-bearing for "yesterday" questions. Stored UTC;
            # labeled UTC so an afternoon block never reads as morning.
            day = "unknown date"
            for key in ("convo_updated", "updated_at"):
                try:
                    raw = r[key] or ""
                    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(raw))
                    if m:
                        day = m.group(1)
                        break
                except Exception:
                    continue
            lines.append(f'{i}. [{day}] {label}: "{summary}"')
            if sum(len(x) for x in lines) > 2400:
                break
        if not lines:
            return None
        return "<recent_conversations>\n" + "\n".join(lines) + "\n</recent_conversations>"
    except Exception as exc:
        log.debug("recent conversations block unavailable: %s", exc)
        return None
