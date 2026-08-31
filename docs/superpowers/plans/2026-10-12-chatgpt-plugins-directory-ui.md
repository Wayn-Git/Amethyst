# ChatGPT-Style Plugins & Connectors Complete UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Amethyst's Connectors & Plugins section into a pixel-polished 3-level directory experience inspired by ChatGPT's Plugins directory, tightly integrated with Composio OAuth and local MCP servers.

**Architecture:** Deconstruct the connectors UI into modular view components (`PluginsDirectory`, `CategoryView`, `PluginDetailView`, `PluginCard`, `PluginHeroPreview`, `ComposioAuthModal`) orchestrated by `ConnectorsTab.jsx` with smooth stateful navigation, animated agent preview simulations, context popovers, and real-time Composio status synchronization.

**Tech Stack:** React 19, Framer Motion, Lucide icons, Vanilla CSS tokens (`index.css`, `connectors.css`), Composio REST API (`/api/connectors/*`, `/api/composio/*`).

**Spec:** [docs/superpowers/specs/2026-10-11-composio-plugins-experience-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-11-composio-plugins-experience-design.md)

## Global Constraints

- Must follow Amethyst's design tokens in `AGENTS.md` (`--surface`, `--canvas`, `--border`, `--hairline`, `--accent`, `--live`, `--stop`, `--font-sans`, `--font-mono`). No hardcoded colors.
- Follow Emil Kowalski's animation philosophy (`emil-design-eng`): `:active` scale (`0.97`), origin-aware popovers, enter transitions from `scale(0.95)` with opacity (never `scale(0)`), durations under 200ms.
- Respect `prefers-reduced-motion`.
- All backend Composio and MCP endpoints must function 100% (1-click browser OAuth, app authorization, account disconnect, and status polling).
- Preserve local MCP servers inside a dedicated section at the bottom of the main directory and via quick filter pills.

## Review Focus

- Unauthenticated state: user clicking `+` on an unconfigured app launches Composio browser login modal seamlessly before authorizing the app.
- Multi-account handling: apps with multiple connected accounts show account badges and allow disconnecting individual accounts.
- Fallback resilience: services without custom logos gracefully fall back to Google favicon and monogram, and apps without bespoke preview mocks generate dynamic realistic agent previews.
- Navigation history & back buttons: clicking `< Plugins` returns smoothly to the previous level (Detail -> Category/Directory -> Directory).
- Search synchronization: typing in the directory search input displays instant 2-column search results without lag.

---

### Task 1: Simulated Agent Execution Previews Model & Component (`PluginHeroPreview`)

**Files:**
- Create: `frontend/src/views/capabilities/plugins/PluginHeroPreview.jsx`
- Test: Build verification & component unit tests in `tests/test_plugin_preview_data.py` (or React test)

**Interfaces:**
- Consumes: `card: { slug, label, blurb, category }`
- Produces: `<PluginHeroPreview card={card} />` displaying glowing gradient container, user prompt bubble, execution duration (`Worked for Xs`), and structured recap output.

- [x] **Step 1: Create preview mock registry & dynamic generator**
Define bespoke realistic previews for top apps (Gmail, GitHub, Slack, Notion, Google Drive, Spotify, Supabase, Linear, Tavily, etc.) and an algorithmic template fallback for any custom or new Composio apps.

- [x] **Step 2: Build `PluginHeroPreview.jsx`**
Implement the preview card with gradient background wash (`--accent-soft`), subtle glowing border, user request bubble, execution status line (`Worked for 12 seconds`), and markdown-styled assistant response with decisions, bullet points, and open questions.

- [x] **Step 3: Verify preview rendering**
Verify that `PluginHeroPreview` renders correctly without crashing for known apps and unknown app slugs.

---

### Task 2: Refined App Tile & Context Menu Component (`PluginCard`)

**Files:**
- Create: `frontend/src/views/capabilities/plugins/PluginCard.jsx`
- Styles: `frontend/src/styles/connectors.css`

**Interfaces:**
- Consumes:
  - `card`: toolkit metadata (`slug`, `label`, `blurb`, `category`, `logo`, `noAuth`, `domain`)
  - `status`: connection status (`connected`, `pending`, `accounts`)
  - `onOpenDetail`: callback to navigate to Level 3 detail view
  - `onConnect`: callback to initiate OAuth
  - `onDisconnect`: callback to disconnect service
  - `onChat`: callback to launch chat with prompt
- Produces: 2-column app row with icon, title, description, and action button (`+` or `...` menu popover).

- [x] **Step 1: Implement `PluginCard` component**
Render squircle app icon, title, blurb, and right-aligned action:
- If connected: render `...` trigger button that opens origin-anchored popover with `Chat`, `Manage`, `Uninstall` (red icon/text).
- If pending: spinning loader with "Pending...".
- If noAuth / included: subtle "Included" status chip.
- If not connected: clean circular/rounded `+` button.
- Clicking card body navigates to App Detail view.

- [x] **Step 2: Add Emil Kowalski micro-interactions in CSS**
Add `:active { transform: scale(0.97) }` on buttons, smooth row hover highlight, and origin-aware popover animation.

- [x] **Step 3: Verify popover and action triggers**
Verify outside click dismisses the `...` popover, clicking `Chat` triggers chat callback, clicking `Manage` triggers detail view, and clicking `Uninstall` prompts confirmation.

---

### Task 3: Level 3 App Detail View (`PluginDetailView`)

**Files:**
- Create: `frontend/src/views/capabilities/plugins/PluginDetailView.jsx`
- Styles: `frontend/src/styles/connectors.css`

**Interfaces:**
- Consumes:
  - `card`: full card metadata
  - `status`: connection status & accounts list
  - `onBack`: navigation back callback
  - `onConnect`: OAuth trigger
  - `onDisconnectAccount`: disconnect specific account
  - `onDisconnectService`: disconnect service
  - `onOpenComposioAuth`: open Composio login modal
- Produces: Full ChatGPT-style detail page with back link, header, primary action, hero preview card, description, information table, and legal disclosure.

- [x] **Step 1: Implement `PluginDetailView.jsx`**
Build the centered column layout:
1. Top bar: `< Plugins` back button.
2. Header: App icon, Title, Subtitle, and Primary Action Button (`Connect`, `Connected`, or `Included`).
3. Accounts section: If connected with multiple accounts, list accounts with aliases and individual disconnect buttons.
4. Hero preview: `<PluginHeroPreview card={card} />`.
5. Description text paragraph.
6. Information table: Capabilities, Developer, Category, Website link, Version, Privacy Policy link, Terms of Service link.
7. Legal & privacy notice at bottom.

- [x] **Step 2: Style detail view according to `minimalist-ui` & `AGENTS.md`**
Ensure clean hairlines, crisp typography hierarchy, proper text scaling (`calc(... * var(--text-scale))`), and responsive margins.

---

### Task 4: Level 2 Category View (`CategoryView`)

**Files:**
- Create: `frontend/src/views/capabilities/plugins/CategoryView.jsx`
- Styles: `frontend/src/styles/connectors.css`

**Interfaces:**
- Consumes:
  - `category`: category name (e.g., "Developer Tools", "Communication", "Productivity")
  - `cards`: all cards belonging to this category
  - `statusMap`: connection statuses
  - `onBack`: navigation back to directory
  - `onOpenDetail`: open card detail
  - `onConnect`, `onDisconnect`, `onChat`
- Produces: Category page with `< Plugins` back button, category title & description, category search input, and 2-column grid of all category apps.

- [x] **Step 1: Implement `CategoryView.jsx`**
Render top back button, category title and contextual subtitle, search input (`Search [category] plugins`), and filtered 2-column grid utilizing `PluginCard`.

- [x] **Step 2: Add category search filter**
Filter cards in real-time by search input across label, slug, and blurb.

---

### Task 5: Level 1 Main Directory View (`PluginsDirectory`)

**Files:**
- Create: `frontend/src/views/capabilities/plugins/PluginsDirectory.jsx`
- Styles: `frontend/src/styles/connectors.css`

**Interfaces:**
- Consumes:
  - `cards`: all marketplace cards
  - `statusMap`: connection statuses
  - `searchQuery`: global search text
  - `setSearchQuery`: search update callback
  - `onOpenDetail`: open card detail
  - `onOpenCategory`: open category drilldown
  - `onOpenAuthModal`: open Composio / custom connector modal
  - `onConnect`, `onDisconnect`, `onChat`
  - `newOpen`, `setNewOpen` for MCP servers
- Produces: Complete main directory view with:
  - Top header: "Plugins" title & subtitle, search bar, `+` button.
  - "Installed >" horizontal row of squircle app icons.
  - "Popular" 2-column section with bottom category bridge link (*"See Notion, Sales, and more"*).
  - "New & Noteworthy" 2-column section with bottom category bridge link (*"See Developer Tools, and more"*).
  - Instant 2-column search results when searching.
  - "Local & MCP Servers" embedded section at bottom with quick filter toggle.

- [x] **Step 1: Implement "Installed >" icon strip**
Extract all connected cards, render squircle icons with hover tooltips, and click handler to open the respective detail page.

- [x] **Step 2: Implement curated sections (Popular & New & Noteworthy)**
Curate top popular apps (Gmail, Google Drive, Supabase, Health, GitHub, Outlook Email, Slack, Notion) and new/noteworthy apps (Adobe, tldraw, Canva, Figma, Shopify, Linear). Render 2-column grids with `PluginCard`.
Add the bottom bridge links with overlapping mini icons and category navigation.

- [x] **Step 3: Implement instant search view**
When search query has length > 0, hide static sections and show a responsive 2-column grid of matching apps.

- [x] **Step 4: Integrate Local MCP Servers panel**
Render `McpServersPanel` in a dedicated section at the bottom, accessible directly or via the filter pills.

---

### Task 6: Connectors Orchestrator & View State Controller (`ConnectorsTab.jsx`)

**Files:**
- Modify: `frontend/src/views/capabilities/ConnectorsTab.jsx`
- Styles: `frontend/src/styles/connectors.css`

**Interfaces:**
- Consumes: props from `Capabilities.jsx` (`query`, `setQuery`, `newOpen`, `setNewOpen`)
- State:
  - `viewMode`: `'directory' | 'category' | 'detail'`
  - `activeCategory`: category string or null
  - `activeCardSlug`: card slug string or null
  - Connection & catalog state (`cards`, `status`, `configured`, polling timers)
- Produces: Seamless switching between Directory, Category, and Detail views with Framer Motion transitions and Composio OAuth lifecycle management.

- [x] **Step 1: Refactor `ConnectorsTab.jsx` to manage view hierarchy**
Manage state for active view:
- If `viewMode === 'detail'`: render `<PluginDetailView>` with active card.
- If `viewMode === 'category'`: render `<CategoryView>` with active category.
- If `viewMode === 'directory'`: render `<PluginsDirectory>`.
Wire `< Plugins` back buttons to transition back cleanly.

- [x] **Step 2: Wire Chat trigger to `openChatWithPrompt`**
When `onChat(card)` is triggered, invoke `openChatWithPrompt(\`Use ${card.label} to \`)` from `useApp()`.

- [x] **Step 3: Connect 1-Click Composio OAuth flow and app polling**
Ensure `startBrowserLogin()`, `connect(slug)`, and `disconnectAccount()` work cleanly and update state instantly.

---

### Task 7: CSS & Design System Polishing (`connectors.css`)

**Files:**
- Modify: `frontend/src/styles/connectors.css`

- [x] **Step 1: Add typography, colors, and layout classes**
Define classes matching ChatGPT's design with Amethyst tokens:
- Squircle icon styles (`border-radius: 10px`, crisp overflow, subtle border).
- App card row (`display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; transition: background 140ms ease`).
- Hero preview card glowing backdrop (`radial-gradient` + smooth rounded container).
- Metadata info table (`border-top: 1px solid var(--hairline)`, key-value rows).
- Floating context menu (`box-shadow`, `border-radius: 12px`, transform origin).

- [x] **Step 2: Verify light and dark mode palettes**
Check across `graphite`, `ink`, `paper`, and `sand` themes to guarantee crisp contrast and legible typography.

---

### Task 8: Verification & End-to-End Testing

**Files:**
- Run frontend build: `npm run build` in `frontend`
- Run backend tests: `pytest tests/test_composio_api.py tests/test_composio_service.py`
- Browser validation: Verify navigation flow (Directory -> Category -> Detail -> Back), search, connect trigger, context menu, and MCP servers.

- [x] **Step 1: Run frontend build**
Verify no JSX or bundling syntax errors.

- [x] **Step 2: Verify Composio API tests**
Run pytest suite to verify no regressions in backend contracts.

- [x] **Step 3: Visual and functional verification in browser**
Test interactions in the running application at port 8001.
