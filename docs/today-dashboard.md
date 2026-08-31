# Today dashboard

Today is the default desktop landing page. Explicit routes still work and Chat stays mounted so navigation does not interrupt a running turn. The existing phone shell remains remote-first; its “desktop” option exposes the responsive workbench.

## Design constraints

The surface is a daily dashboard, with focused list and triage interactions. The repository has no `.agents/DESIGN.md`; existing AGENTS.md and index.css theme tokens remain authoritative.

[design-pipeline]
0. laws-of-ux → Pareto: attention, agenda and tasks precede discovery; Common Region: distinct attention, agenda and discovery sections; Similarity: a consistent row/control language; Von Restorff: one filled primary action; Fitts: at least 44×44 CSS px controls, 8px gaps; Doherty: immediate action feedback, independent source loading, optimistic task/triage updates with rollback.

Five attention filters: Tracked, Your turn, Waiting, Inbox, Later & done. Pinned items sort first, then due follow-ups, then oldest activity. Snoozed and completed items remain recoverable. Unread email is a review candidate, not proof that a reply is owed. Discovery is below the working lists and has no autoplay or endless feed.

## Implemented

- Live local clock; explicit city selection; Open-Meteo weather with a 30-minute local cache and stale-reading indicator.
- Persistent tracking records with source, source link, priority, reply state, observed activity time, follow-up date, snooze and completion. Stable source/external identifiers prevent duplicates.
- Gmail inbox review using the existing native Gmail service. Opening Inbox reads a local snapshot immediately, refreshes in the background with a 12-second ceiling, and polls for completion. Automatic refresh has a five-minute cache. Failures retain the last successful snapshot and display an error.
- Existing task API for creating and completing tasks. Failed completion restores the task.
- Next 14 days of locally recorded calendar events.
- Recent library saves without the old “today only” cutoff.
- Agent tools `list_today_items`, `track_today_item`, `update_today_item` for evidence-based summaries, project backlog and video suggestions. Writes use the existing medium-risk permission gate. Dashboard buttons prepare a prompt in Chat; they do not send it automatically.
- Local personal-conversation import: WhatsApp text exports and Instagram conversation JSON. Saves the last three excerpts and their activity timestamp, not the full export. The user chooses the reply state. Reimporting the same source/title updates the same record. Distinct conversations should use distinct titles. Exports over 2 MB or unsupported formats produce an actionable error. WhatsApp date order is explicit; timestamps use the browser's selected timezone.
- Independent loading, retained stale data on refresh failure, visible source limitations, keyboard-operable native controls, responsive light/dark layouts using existing tokens.

## What is not live yet

This implementation does **not** claim that personal messages, GitHub projects, Google Calendar, or YouTube viewing history are continuously synchronized. The project/video buttons let the existing agent use its authorized connections and save the result. The calendar panel reads the existing local calendar repository. Tracking a thread does not subscribe to new replies.

The Inbox panel uses Amethyst's existing native Gmail credentials; a Composio-only Gmail connection is available to the agent, but does not automatically populate this native inbox endpoint. Personal WhatsApp and Instagram data currently enter through explicit local imports. Discord requires a connection that actually exposes the needed channels/messages; no personal-account bot or token scraping was added.

Composio documents [WhatsApp Business-only access](https://docs.composio.dev/toolkits/whatsapp) and [Instagram Business/Creator-only access](https://docs.composio.dev/toolkits/instagram). Its [toolkit documentation](https://docs.composio.dev/docs/toolkits) distinguishes enabling a toolkit from having an authenticated, authorized connected account. YouTube's [API revision history](https://developers.google.com/youtube/data/revision_history) documents removal of watch-history access. Suggestions therefore use saved videos or history explicitly supplied by the user, with their rationale recorded.

## Local and cloud boundaries

No new package, paid service, subscription, or hosted deployment was introduced. Tracking and provider snapshots live in the existing SQLite database. Weather is an optional external read to [Open-Meteo](https://open-meteo.com/en/docs); city search and coordinates are sent only after location selection. Conversation imports do not invoke an LLM or external service. Agent-assisted review uses whichever model and connections the user already configured, with their existing usage costs.

Cloudflare is unnecessary for rendering the local dashboard quickly. A future relay can receive verified provider webhooks while the computer is offline, queue minimal event envelopes, and let the local process fetch/reconcile full records. Keep provider tokens and private source content local where possible; add deduplication, expiry, bounded queues, backoff, source freshness and explicit account scoping. Do not tunnel the shell-capable Amethyst API to the public internet. Cloudflare's [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) includes a free tier with limits; optional cloud components should fail closed at their free allowance rather than require billing. No relay was deployed in this change.

## Verification

- `npm --prefix frontend run build`
- `.venv/bin/python -m pytest tests/test_today_dashboard.py -q`
- `node frontend/tests/today.mjs`
- Targeted Ruff and Oxlint checks on new modules/components.
- With Vite running on port 5177: `PW_TEST_SCREENSHOT_NO_FONTS_READY=1 node frontend/tests/today-browser.mjs`

Backend tests use an isolated Amethyst home and mocked providers. Browser tests use fixture data, never connected accounts, and cover landing behavior, independent sources, weather selection, tracking, import, snooze/restore, rollback, source errors, mobile overflow and minimum button targets. Screenshots are fixture previews, not the user's inbox. The production build retains the application's existing large-chunk and Remote dynamic-import warnings.

Restart the Amethyst backend to register the new routes/tools and bootstrap the additive SQLite tables; reload the frontend after the build. Unrelated in-progress automation and other repository changes were left intact.
