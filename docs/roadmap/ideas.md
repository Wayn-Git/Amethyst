# Ideas, with what they would actually cost

Wanted but not built. Each entry says what is already true on this machine, so
the next session picks up from the measurement rather than re-deriving it.

Written 2026-08-29. Anything measured here was measured that day.

## Recurring tasks, and a calendar that can be written to

The two most-implied capabilities of "personal OS" that are missing, and they
are one piece of work: a repeating task is a task with a schedule, and the
schedule is only useful if it can reach the calendar.

**Half of it is already readable.** Microsoft Graph exposes `recurrence` on a
`todoTask` and PSOK has never requested it, so the To Do side needs a field
added to the pull rather than a design. The local side does need one: a schema
slot on `tasks`, and a rule for what happens to a missed occurrence — does it
pile up, roll forward, or vanish? That decision is the actual work, and the
answer differs for "water the plants" and "pay the rent".

**Calendar is read-only here.** `list_calendar` and `find_free_slot` exist
(`backend/tools/builtin/tasks.py`); nothing creates an event, so `find_free_slot`
ends with the user booking it by hand. The first-party path is the one Mail now
uses — `backend/mail/gmail.py` refreshes the token the connector stored and calls
Google directly — and the same file would serve Calendar. Blocked only on the
calendar scope being granted at the next Google sign-in.

## Embeddings without Ollama -- taken, 2026-09-05

Measured on this machine and worth recording, because the symptom was silence:
**Ollama is not installed here**, `Embedder()` hard-coded it, and so the vault
index held 13 documents and 37 chunks while every capture logged "embeddings
unavailable". Retrieval is the backbone of documents, bookmarks, library and
memory, so this was the largest broken thing in the project and nothing said so.

What answered, probed 2026-09-05 against the seven providers configured here:

```
cloudflare   @cf/baai/bge-base-en-v1.5    768 dims   works
cloudflare   @cf/baai/bge-m3             1024 dims   works
openrouter   text-embedding-3-small      1536 dims   works, billed per token
nvidia       /embeddings                             HTTP 410, endpoint retired
groq, cerebras, llm7                                 serve no embeddings
```

Cloudflare Workers AI is the pick: a key was already configured and the free
tier covers a personal vault. Note it is a **cloud** embedder, so ADR-0013's
local-first default stands and this is opt-in -- `psok embeddings detect --set`.

Verified end to end: 4 files including a 11-page PDF, 61 chunks embedded, and
"why is the browser history not indexed" returns the right section of this file.

## Browser tabs, history and bookmarks

**Bookmarks and history -- taken, 2026-09-05.** `backend/browser/` reads the
profile; `psok bookmarks` and `/api/browser` drive it; `BrowserRunner` watches
for new bookmarks every five minutes and captures each into the library once,
keyed on the bookmark's guid so a rename or a move is not a second capture.
History is deliberately **not** indexed -- see below -- and is reached by the
`search_history` tool, which refuses until the feature is switched on.

Measured again on 2026-09-05, and the earlier count was wrong in a way worth
recording: `moz_bookmarks` holds 13 **rows**, but only 6 are bookmarks (`type=1`
with an `fk`); the rest are folders and separators. Of those 6, four are the
seed links Firefox creates in its own "Mozilla Firefox" folder, so the profile
holds **2 real bookmarks, 16,924 pages and 25,155 visits**.

Two things that cost time and are now in the code as comments: Firefox stores
times in **microseconds**, and `places.sqlite` must be copied **with its `-wal`**
or the copy opens cleanly and is simply older than the browser.

**The browser is Zen**, a Firefox fork:
`~/.config/zen/aivbe3un.Default (release)/`.

Reading it is cheap and entirely local:

- History and bookmarks are `places.sqlite` — ordinary SQLite, the same shape
  Firefox has used for years. It must be **copied before reading**: the browser
  holds a lock, and PSOK already copies a live database this way for the
  connector checks.
- Open tabs live in `sessionstore-backups/recovery.jsonlz4` — JSON behind
  Mozilla's `mozlz4` framing, which is lz4 with a magic header.

**Why history is searched and not indexed.** Sixteen thousand pages is hours of
embedding and a large index for material that is mostly noise, and the question
people actually ask of their history -- "what was that site about X" -- is
answered by a substring against a title. Bookmarking is the act of saying a page
mattered, so that is the half worth capturing, fetching and summarising.

**Controlling those tabs is the hard half.** Zen is Firefox, so there is no
CDP; closing a tab or moving one between folders needs Firefox's remote agent
or a WebExtension talking to PSOK. Reading first is the honest order: a page
that can list and search everything you have looked at is most of the value,
and it needs no protocol at all.

**Browserbase is not the answer.** Its repository is archived and marked "no
longer maintained", the browser runs in their cloud, and it is paid. PSOK
already drives a local browser two ways — Playwright (24 tools) and
chrome-devtools (29) — and those two cost 2,977 tokens of schema on every round
trip between them. The want here is *your* browser and its real history, which
neither a cloud browser nor a fresh automated one has.

## Reading Reddit, X and the rest without an account

Wanted as "free knowledge access, like Grok". **Built 2026-09-05** as
`backend/web/social.py` plus `read_social` / `search_social`, and the shape is
the point: PSOK **routes to readers that already hold a session** -- `rdt-cli`
for Reddit, `twitter-cli` for X -- rather than writing a client. Writing one
means owning an arms race against an anti-bot team and losing it quietly some
Tuesday. Each site is on an allowlist the user sets (`psok social allow reddit`)
because those readers act as the signed-in user, and credentials go into the
subprocess environment, never argv, because `/proc` is world-readable.

Agent-Reach was evaluated for this and is the right *reference*, not the right
dependency: by its own README it "handles tool selection, installation, health
checks, and routing rather than implementing the actual data retrieval itself",
and "the agent calls upstream tools directly; there's no wrapper layer". Its
`doctor` on this machine reports **4/15 channels** available, with Reddit and X
both in the locked eight. So it does not remove the hard part -- it names the
same CLIs this routes to, which is why the route table below matches its
guides.

Pages that are a JavaScript bundle now fall back to `r.jina.ai`
(`backend/web/jina.py`), only after the ordinary fetch has already returned
nothing, and switchable with `psok social renderer off` because the URL leaves
the machine. Measured: excalidraw.com goes from 0 characters to a real page with
a title. obscura -- a Rust headless browser with a real V8, ~70MB, Apache 2.0 --
is the local end state and is an install; this is what works with neither.

The measurement that shaped all of it, and does not need re-deriving:

**Reddit's unauthenticated `.json` endpoint is not dependable.** Appending
`/.json` to a permalink does return the post and its comments -- note the slash
*before* the suffix, since `slug.json` is answered with 403 and an HTML error
page while `slug/.json` is answered with JSON. But Reddit's edge blocks the
calling IP after roughly a dozen requests and then returns 403 to every user
agent, including a real browser's. It is not a User-Agent check: an honest
`linux:psok:v0.1 (personal use)`, a plain name, curl and Firefox were all
refused once the IP was blocked. `api.reddit.com/comments/<id>` is a second
front door and is blocked with it.

Agent-Reach's own Reddit module, written independently, reaches the same
conclusion: "there is NO zero-config path... the official API closed
self-service registration in 2025-11 (manual approval, individual scripts
rarely granted)."

So a bookmarked Reddit post is logged with its title, URL, folder and date and
no body text, until `rdt-cli` is installed and signed in -- at which point
`read_social` opens it properly.

## Instagram reels into a knowledge base, and on to cinejoy

The most valuable-sounding one and the one with a blocker that is not PSOK's.

Reading DMs — which is what "send a reel to my account" means — needs an
Instagram **Professional** account, a Meta app, and permission review before
the messaging endpoints answer at all. That is a process with a queue in it,
not an afternoon.

**Scope the half that is not blocked first.** "A link goes in, a tagged note
comes out, and a film goes to cinejoy" is a pipeline PSOK can already almost
build: fetch the page, extract what it is, classify it, write it to the vault,
and post the subset that are films. Prove that with links pasted into a
conversation, and the Meta side becomes a different way to feed a thing that
already works rather than the thing itself.

## WhatsApp

**2Chat** is the only realistic route today: official MCP, 11 tools, a regular
number linked by QR. It is a **paid relay** — messages pass through their
infrastructure, and sending counts against the plan's quota. That is the trade,
and it is worth stating plainly rather than discovering later.

The local alternatives all still want `better-sqlite3`, which does not build on
this box's **Node 26**. Worth rechecking when it ships support, because a local
bridge changes the trade entirely.

## What is worth taking from Khoj

Read at `/home/wayne/Documents/GitHub/khoj`.

**Its ingestion -- taken, 2026-09-05.** `src/khoj/processor/content/` handles
org-mode, PDF, DOCX, Notion and GitHub. PSOK's vault used to read markdown and
plain text only, so everything in a PDF on this machine was invisible to
retrieval -- the difference between "notes I wrote" and "a second brain".

`backend/documents/` now closes it for PDF, DOCX, XLSX and PPTX. The shape worth
remembering: every extractor emits **markdown**, so `chunk_markdown` needed no
change and a search hit reads `report.pdf > Page 12` without a schema column or
a new field on `SearchHit`. `view_file` extracts by extension rather than a
second read tool existing, `create_document` and `edit_document` write and edit
in place, and a scanned PDF is a named refusal naming tesseract rather than an
empty index entry. Notion and GitHub are still open, and both are connector work
rather than file-format work.

**Its operator, no.** `processor/operator/` gives Khoj a computer by running a
container with its own desktop: Docker, an Anthropic key, Claude-only. PSOK's
posture is local-first with Bubblewrap, it has no Anthropic key, and a second
sandbox model beside the one that already works is a lot of machinery for a
capability nobody has asked to use yet.

## The lever nobody has pulled

Restated because it is still the largest single win and it costs nothing to
take: **178 tools, 11,582 tokens of schema on every round trip**, against Groq's
free tier of 8,000 tokens per minute. The turn cannot fit, so it falls back to
the slower provider.

```
github           44 tools   3,007 tokens
chrome-devtools  29         1,771
linkedin         19         1,456
playwright       24         1,206
                            -----
                            7,440
```

Switching those four off leaves 62 tools at 4,142 tokens, which fits Groq
comfortably. **Tool profiles** — named sets of connectors, per conversation —
are the feature that makes the choice stick rather than being a settings chore
nobody repeats. `CapabilityService` already scopes connectors per conversation;
what is missing is the naming and the picker.

---

# Harvested from scratch files, 2026-09-06

These were loose notes at the repository root (`toolstoadd.txt`, `features/`,
`.bugs/`). The files are gone; what was worth keeping is here, so the next
session finds it in the one place ideas live rather than in a filename.

## The provider fallback does not survive token exhaustion

Recorded as a screenshot filename, which is not a place a bug can be found:

> GROQ, when it runs out of tokens, should automatically move to NVIDIA or any
> other model by default. Currently it switches models every prompt when it runs
> out of tokens, and the changed model is not reflected in the bottom bar.

Two distinct faults in one sentence. The first is that exhaustion is treated as
a per-turn failure rather than a state — each prompt re-tries the exhausted
provider, fails, and re-picks, so the choice never settles. The second is that
the interface reports the model that was *asked for* rather than the one that
*answered*, so a fallback is invisible at exactly the moment it matters.

Related: this is the same free-tier ceiling the tool-schema section above is
about. 8,000 tokens per minute against 11,582 tokens of schema means the
fallback fires constantly, so its behaviour is not an edge case here.

## Documents the agent cannot read or write

Written before `backend/documents/` existed, and now mostly answered — PDF,
Word, Excel and PowerPoint extraction all landed. Kept because the note asked
for *write* as well as read, and authoring is thinner than extraction.

## Reading the sites that refuse to be read

Three tools were nominated for scraping and browser control:
[ScrapeGraphAI](https://github.com/ScrapeGraphAI/Scrapegraph-ai),
[Obscura](https://github.com/h4ckf0r0day/obscura), and
[Agent-Reach](https://github.com/Panniantong/Agent-Reach). The problem they
address is real and unsolved: X, LinkedIn and Instagram all serve a login wall
to an ordinary fetch. PSOK's current answer is a per-site reader
(`backend/web/social.py`) that shells out to a CLI holding the user's cookies,
which works and is honest about acting as the signed-in user. A general scraper
would be a different bet — broader reach, and no clear story about whose
session it is using.

## Phone and laptop as one machine

Clipboard sync, remote control, and "keep working with the laptop closed". The
last of these is the only part that has been built: the Cloudflare Worker in
`relay/` queues shares and Instagram deliveries while the machine is away, and
the laptop drains the queue when it wakes. The note's own framing is the right
constraint on the rest — *not everything belongs in the cloud, only the things
that must keep running while you are not there.*

## savetolist, which is where the Instagram feature came from

The original brief was [savetolist.com](https://savetolist.com): save a reel by
sending it to an account, get it back organised. That is now
`docs/architecture/instagram.md`, and the relay is what makes it work without a
server of one's own.

## The five projects this repository is an answer to

From a video transcript kept in `features/transcribe.txt`. Recorded because it
is the clearest statement of what PSOK set out to be, and four of the five are
built: a life dashboard with a morning briefing (`Today`, `backend/journal/`), a
second brain over your own files (`backend/retrieval/`), a daily and weekly
review agent (`backend/journal/`), a brand kit (`backend/brand.py`), and a life
library of everything read and watched (`backend/library/`).

Worth keeping as a measuring stick: the ambition was *query anything you have
ever consumed and get an answer straight away*, which is a retrieval quality
bar, not a feature list.

## Harvested from NEXT-SESSION.md, 6 September 2026

The session file is gone; these are the parts that are still owed and not
recorded anywhere else.

**Google Calendar is not mirrored into `calendar_events`.** The calendar the
agent writes is a table; Google Calendar is MCP tools. The two never meet, so
Today's schedule is empty on a machine whose events all live in Google — the
single biggest gap in Today being useful. Closing it means a pull that runs on
the same loop the journal already has, not a connector tool the agent has to
remember to call.

**`calendar_events` uses a `T` separator while `tasks` uses a space**, and both
are compared by SQLite as strings. `backend/journal/signals.py` respects the
difference, and both writers document it, but a proper
`_normalise_calendar_timestamps` migration is still owed — every new consumer
has to know a trap that a migration would delete.

**Long-audio chunking for transcription is explicitly out of scope for v1.**
Anything over ~15 minutes is refused with a stated reason rather than
truncated. Chunked transcription with per-chunk timestamps is the honest fix
when it comes up for real.

**The Instagram token lasts 60 days and refreshes only while still valid.**
The runner handles the refresh at 14 days remaining, and the relay's cron does
it while the laptop is closed; once lapsed there is no automatic recovery,
only a re-paste by hand. A lapse is a setup event, not a bug.

**A model can vanish from a tier without leaving the catalogue.**
`nvidia/nemotron-3-ultra-550b-a55b` was listed by `/v1/models` and 404'd on
`chat/completions` for the rest of its life. The default was switched and 130
conversations repointed by hand; nothing in code notices a listing that lies.
A health probe that fires one real completion per tier, occasionally, would
notice for us.
