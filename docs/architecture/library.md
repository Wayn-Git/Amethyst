# The library

Everything read, watched or listened to, logged as it is consumed, and findable
afterwards by meaning as well as by keyword.

`backend/library/` — `store.py` for the rows and the files, `service.py` for the
decisions, `reels.py` for Instagram permalinks, `enrich.py` for what the item is
about. `backend/tools/builtin/library.py` and the `/api/library` routes are
thin callers, the same arrangement `backend/tasks/service.py` established.

Instagram is one door. There are seven more, and they all end in the same two
functions — `capture_url` and `capture_media` (or `log_manual` for a thing with
no URL at all). Nothing downstream knows which door a row came through.

---

## What an item is

| Field | What it means |
|---|---|
| `kind` | `article`, `book`, `video`, `podcast`, `music`, `newsletter`, `paper`, `post`, `note`, `other` — see `store.KINDS` |
| `category` | Free-form shelf the person files it under. `NULL`/`general` is normal; `as_dict` infers one on the way out |
| `app` | Derived from the host — `youtube`, `x`, `reddit`, `spotify`, `github`, `pinterest`, `substack`, `medium`, `arxiv`, `tiktok`, `soundcloud`, `bandcamp`, `apple-music`, `instagram`, `linkedin` (`store.app_tag_for_url`) |
| `tags` | Three to eight written by enrichment, plus the app tag |
| `url` | Dedupe key. `by_url` is checked before any fetch, so catching up on forty tabs twice does not fetch twice |
| `source_ref` | Dedupe key for the *origin* rather than the page — a browser bookmark's guid, checked before the URL. Same bookmark filed twice after its page moved is one item |
| `text_source` | `page`, `transcript`, `caption`, `notes`, `video description`, `title`, or `none` |
| `capture_note` | Why the item is partial: paywall, 403, no transcript, embedder down |
| `document_id` | NULL is a normal state, not an error — see below |

`kind` is chosen by `kind_for(url)` when the caller does not name one: a YouTube
link is a `video`, arXiv a `paper`, an X status a `post`, a Spotify `/show`
episode a `podcast` while `/track` is `music`. Spotify needs a path-prefix check
after the host map misses, because one host holds both.

---

## Where items come from

Eight doors. Each is listed with its entry point, because "the library captures
Instagram" was true once and is now the smallest of them.

### 1. The Library page itself

`frontend/src/views/Library.jsx`, two affordances and one modal:

| Affordance | What it does | Backend |
|---|---|---|
| **The command bar** — search, or paste to capture | a URL pasted into it captures instead of searching; anything else searches | `POST /api/library` → `capture_url`, or `log_manual` for plain text |
| **More capture options** | opens `AddContentModal`: **Upload file**, **Note**, **Wikipedia** (a topic, resolved to `https://en.wikipedia.org/wiki/<slug>`) | `POST /api/attachments` indexes a file as `source="attachment"` then a Library row records it; `POST /api/library` → `log_manual` / `capture_url` |

The file upload is the one asymmetry worth naming: the bytes are indexed under
`source="attachment"` where `Indexer` can read them, and the Library row is the
pointer that makes them browsable. `DOCUMENT_EXTENSIONS` and `TEXT_EXTENSIONS`
are the formats that get indexed at all.


### 2. The bookmarklet

`javascript:void(window.open('<origin>/library?url=' + encodeURIComponent(location.href)))`,
built in `library/SharePanels.jsx`. It is a **navigation**, not a cross-origin
request, so nothing has to be switched on and the CORS allowlist stays as narrow
as it is.

> **How `?url=` is consumed.** `Library.jsx` reads the parameter during the
> *first render*, not in an effect: the filter-sync effect rewrites the query
> string on mount (turning `?url=` into `?q=&kind=…`) and would have dropped it
> before an effect could act on it. It captures once, then lets that rewrite
> clear the bar, so reloading the page does not log the same link twice.

### 3. The phone, straight to this machine

```
POST /api/share/capture     Authorization: Bearer <share token>     {"url": "..."}
```

It can log a URL and nothing else — it cannot read, list, delete or reach a
tool. It does not exist until a token is generated (`amethyst share-token --new`,
or **Library → Capture integrations → Phone / Shortcuts**); without one the
route answers 404, because an endpoint that answers 401 is an endpoint worth
guessing at. Comparison is constant time, and repeated failures close the
window for five minutes — including for the correct token, which is deliberate:
letting it through would be an oracle.

The route accepts four body shapes so that whatever a share target emits works:
JSON `{"url":…}`, `?url=…` as a query parameter, a bare `text/plain` body, and
form fields.

### 4. The phone, through the Cloudflare relay

`POST https://amethyst-relay.<you>.workers.dev/share` with the same token. The
Worker holds the delivery in D1, and `_take_share` in
`backend/instagram/relay.py` re-checks the token **on this machine** before a
row is written — the relay echoes back the token it verified, and nothing out
there is authoritative about what enters the library.

This is the path that works with the laptop closed. It 404s until the share
token has been pushed up on a `/sync` (every fifteen seconds while the machine
is awake, or `amethyst instagram relay --sync`), because until then the relay
does not know who is allowed to be answered. See [relay/README.md](../../relay/README.md).

### 5. Instagram

A DM, a mention, or a comment on a reel → Meta's webhook → either
`POST /api/instagram/webhook` directly or the relay → `InstagramService` →
`capture_media`. This is the only door with media: audio is extracted, passed
through ffmpeg, transcribed, then the file is discarded unless
`instagram.keep_video` is on.

An **Instagram permalink arriving through any other door** — pasted into Add
URL, sent from a phone, dropped in by the agent — is caught inside `capture_url`
itself by `is_reel_url(url)` and routed to `backend/library/reels.py`. That is
deliberate: hooking it at the single chokepoint means every door gets caption,
author, video and transcript, rather than eight callers each remembering to.

### 6. Browser bookmarks

`backend/browser/` — a background `BrowserRunner` polls `places.sqlite` every
**300 seconds** (Firefox-family profiles), captures anything not already seen by
`source_ref`, and files the bookmark's folder as the note:
*"Bookmarked in Reading list"*.

**Off by default**, and deliberately: `places.sqlite` holds every page you have
ever visited, and a personal OS reading that without being asked is not a
feature.

```bash
amethyst bookmarks status    # profile, counts, whether it is on
amethyst bookmarks enable    # then, any time:
amethyst bookmarks sync
```

`GET /api/browser` reports the profile, the real counts, and the last sync —
measured, not claimed. `POST /api/browser/sync` and `PATCH /api/browser` exist
for the same thing over HTTP.

> **Current state.** The interface has no client for those three routes, so
> browser capture is driven from the CLI today. The Library header button is
> labelled "Sync & Capture (browser, phone, relay)" but its modal carries only
> the bookmarklet, the phone path and the relay.


### 7. The agent

`log_library_item` — "bookmark this link", "save this to my library",
"remember this recipe". Also reachable as a standing tool from any turn. Reads
back through `search_library`, which is the same hybrid index the Library page
uses, so the agent answers from your library rather than the web.

### 8. Anything the reader can open

The generic path: `capture_url` normalises, SSRF-checks, dedupes, then tries
things in order — Instagram permalink, X post, YouTube oEmbed, Pinterest
oEmbed, plain readable text. What it cannot get, it records. What it got less
than all of, it records too.

---

## The text is a real file

`~/.amethyst/library/{id:06d}-{slug}.md`, indexed by the ordinary `Indexer` with
`source="library"`.

This is not a detail. AMETHYST stores an *index* that points at the filesystem and
treats the file as the source of truth (ADR-0004), and a synthetic
`amethyst://library/42` path would leave `mtime` and `size_bytes` NULL and break
that invariant to save one write. What the file buys instead:

* a real path, hash, size and mtime, so incremental re-indexing works unchanged
* **no second search stack** — chunking, FTS5, sqlite-vec, RRF and
  `SearchService` all apply, and `search_documents` finds a saved article in
  chat without knowing the library exists
* `documents.path` UNIQUE collisions are structurally impossible: the row id is
  allocated before the filename is built
* `Indexer._prune_missing` never touches these rows (it only scans
  `WHERE path LIKE '{root}%'` for a vault root), and would be *correct* if
  someone did index `~/.amethyst`
* the user can open the text

`SearchHit` carries `source` and `title`, and `label` prefers the title only for
non-vault sources — `documents.title` is `path.stem` for vault files, so
preferring it unconditionally would rename every existing hit from `notes.md` to
`notes`. It also drops a heading path identical to the title, because a captured
page is written with its title as the top heading and "Deep Work > Deep Work"
says nothing twice.

Media lives beside it in `~/.amethyst/library/media/`, not under the markdown.

## A partial capture is still a capture

A paywall, a dead link, a video with no transcript, an embedder that is not
running — each loses part of what the item could have been, and none of them may
lose the fact that it was read. Every partial outcome writes `capture_note`
saying which one happened, and the interface shows it. An item with no text and
no explanation is indistinguishable from a bug.

`document_id IS NULL` is therefore a normal state, not an error.

Two consequences worth stating:

* `Indexer.index_file(..., require_embeddings=False)` indexes keyword-only when
  the embedder is unreachable. The vault path keeps `require_embeddings=True`:
  a broken embedder affects every file there and should fail once, loudly.
* `POST /api/library/{id}/reindex` calls `embeddings.forget_unreachable()`
  first. `_UNREACHABLE` is cached for the life of the process, so before this
  there was no way to start Ollama and get semantic search without restarting
  AMETHYST.

**No transcript scraping.** YouTube's oEmbed endpoint gives a title and a
channel with no API key; it does not give a transcript, and one AMETHYST invented
would be worse than none.

## Capture, and the SSRF fix that came with it

`backend/web/reader.py` is shared by `fetch_readable` and the `fetch_url` tool,
so the two cannot disagree about what a page says or which addresses are
refused. It follows redirects **by hand**, running `check_url_async` on every
hop.

That fixed a real hole: `fetch_url` used to validate the URL it was handed and
then pass `follow_redirects=True`, so a public address answering
`302 Location: http://169.254.169.254/` was fetched and its body handed to the
model. `tests/test_library.py` has the guard.

Text is capped at `MAX_TEXT_CHARS` (120,000). A 2 MB page is roughly 1,250
chunks and 40 embedding batches — minutes inside one POST, which is
indistinguishable from a hang. Anything under `MIN_INDEXABLE_CHARS` (200) is a
cookie banner or a paywall stub rather than an article, and is not indexed.

## Saying what a thing is about

`backend/library/enrich.py` turns an item's text into a summary, three to eight
tags, and the concrete things it names -- a place, a product, a book, a recipe.
That list is the point: it is what makes a library answer "where was that
restaurant" rather than "here are forty links".

**It runs on text that exists, or it does not run.** `text_source` records where
an item's words came from -- `caption`, `transcript`, `page`, `notes`, or `none`
-- and `none` is a hard structural refusal: `enrich_text` returns before a model
client is resolved, and a test asserts the model is never called. Summarising a
reel that arrived with a title and no words would be inventing from a filename,
and the invention would be indistinguishable from the real thing on the page.

It runs automatically on every URL capture — a pasted link, a bookmark, a phone
share, an Instagram permalink — and inline on the reel path. In `capture_url` it
is **backgrounded**: the relay poll calls that on a fifteen-second loop, and
holding it for a model call while more shares pile up is not a trade worth
making. A hand-written note is not enriched at all; you already wrote what it is
about.

All of it is gated on `library.auto_enrich` (`config.load_library`), so a machine
with no provider key can turn it off rather than log a refusal per capture.

The result is stored **twice**, and neither place alone would do. The columns are
what the interface renders without parsing markdown. The item's own file gets it
too, and is re-indexed -- which is what puts the summary and the tags into search,
so "that video about coffee grind" finds a reel whose transcript never says the
phrase.

The file keeps the two kinds of words apart on purpose:

```markdown
# Pour-over ratios that actually matter

A short reel arguing grind size dominates brew ratio below 1:16...

Tags: coffee, pour-over, grind-size

## Mentioned
- product — Comandante C40: the grinder used
- place — Small Street Espresso: in Bristol

## Transcript
so the thing nobody tells you about pour over is ...

---
_Summary, tags and the list above were written by groq:... from the transcript.
The transcript is what was said._
```

The `## Transcript` heading is also what lets the source text be read back out on
a re-enrich -- without it, enriching twice would summarise the previous summary.

## Media

A captured video is downloaded only to be transcribed, and discarded afterwards
unless `instagram.keep_video` is on: twenty reels a day at fifteen megabytes is
nine gigabytes a year, and the words are the part worth keeping. Thumbnails
(~50 KB) stay. All of it lives under `~/.amethyst/library/media/` rather than beside
the markdown, which is a directory a person browses.

`LibraryService.remove` unlinks all three files. Without that, deleting an item
would leave an orphaned mp4 nothing would ever clean up.

## Finding it again

`LibraryService.search` runs the ordinary `SearchService` with
`source="library"`, so semantic and keyword results are ranked together, then
joins the winning chunks back to their items. The answer is *this item, and the
passage that matched* — not a path under `~/.amethyst`.

When the embedder is unreachable the result is keyword-only, and
`last_search_degraded` says so rather than quietly presenting a floor as a total.

The same index serves:

* the Library page's search box (`GET /api/library?q=`)
* `search_library`, the agent's tool
* chat's global search, which does not know the library exists as a separate
  thing

## The HTTP surface

| Route | Does |
|---|---|
| `GET /api/library` | list, `q` for hybrid search, plus `kind` / `category` / `tag` / `order` / `limit` / `offset`; returns `counts`, `category_counts`, `tag_counts` |
| `POST /api/library` | `url` → `capture_url`, otherwise → `log_manual`. 201, with `already_logged` |
| `GET /api/library/{id}` | one item |
| `PATCH /api/library/{id}` | edit any updatable field |
| `DELETE /api/library/{id}` | row + markdown + thumbnail + media |
| `POST /api/library/{id}/enrich` | summary, tags, mentions — now |
| `POST /api/library/{id}/reindex` | forget unreachable embedders, then re-chunk and re-embed |
| `GET /api/library/{id}/thumbnail`, `/media` | serve what is on disk |
| `POST /api/library/consolidate-tags` | merge near-duplicate tags across the vault |
| `POST /api/library/export-playlist` | search Spotify for each selected item, create a playlist. Needs the Spotify connector signed in |
| `POST /api/share/capture` | the phone, bearer token, URL only |

## The UI

`frontend/src/views/Library.jsx` plus `views/library/`:

* **LibraryToolbar** — the command bar: search, or paste a URL and press Enter
  to capture. Sort order and a "more capture options" trigger sit beside it.
* **LibraryFilterBar** / **LibraryTagRail** — filter by kind, category and tag;
  counts come back from the API already tallied (`counts`,
  `category_counts`, `tag_counts`).
* **LibraryGrid** / **LibraryListView** — the same rows as cards or lines.
* **LibraryDetailModal** — read the item, edit it, re-run enrichment, reindex,
  delete (which also removes the markdown, thumbnail and media).
* **CaptureIntegrationsModal** (`library/SharePanels.jsx`) — three tabs:
  bookmarklet, phone / shortcuts, Instagram relay.
* **ExportPlaylistModal** — selected music items to a Spotify playlist.

Three components in `views/library/` are currently unreferenced:
`LibraryQuickAdd.jsx`, `LibraryActionTile.jsx` and `AskChatModal.jsx`.


## Getting a link in from elsewhere

Repeating the short version of the eight doors above, because it is the part
people look for:

* **at the machine** — paste the link into the command bar on `/library`, drop a
  file on it, write a note, or let the agent save it
* **from the browser** — bookmarklet, or browser bookmark capture
* **from the phone** — share sheet → `POST /api/share/capture`, or through the
  relay if the laptop may be asleep
* **from Instagram** — DM, mention, or comment; the webhook or the relay
* **anything else** — if `fetch_readable` can open it, `capture_url` can file it

**A token does not make a public deployment safe.** Every other `/api` route is
unauthenticated by design (ADR-0001). See [deployment.md](../deployment.md).
