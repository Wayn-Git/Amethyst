# Amethyst Mobile — Implementation Specification & Agent Handover

This document specifies the mobile interface implementation for Amethyst, reverse-engineered from `docs/UI/mobile/Amethyst Mobile — Design Flow.pdf` and the corresponding design reference files in `docs/UI/mobile/extracted/`.

**Current Status:** Phase 1 complete. Core shell, Today dashboard, Add Widgets catalog, Tasks screen, Quick Capture modal, and Settings implemented and wired to live backend endpoints.

---

## 1. Visual & Design Token System

All screens share a cohesive visual identity characterized by warm oyster stone backgrounds, rounded bento cards, high-contrast dark surfaces, and Amethyst's signature acid-lime accent.

### Color Tokens
- **Background / Canvas**: `#ECEAE6` (`var(--mobile-bg)`) — warm oyster/stone light gray.
- **Card Surface**: `#F6F4F1` (`var(--mobile-card)`) — clean off-white card base.
- **Card Raised / Pills**: `#F9F8F6` (`var(--mobile-card-raised)`) — dock and subtle elevated surfaces.
- **Dark Surface**: `#111113` (`var(--mobile-dark)`) — headers, high-contrast bento blocks, primary buttons.
- **Acid Lime Accent**: `#D6F23E` (`var(--mobile-lime)`) — active indicators, primary CTAs, progress highlights.
- **Text Primary**: `#141414` (`var(--mobile-text)`).
- **Text Secondary / Muted**: `#6E6A64` / `#7D7871` / `#A9A6A0`.
- **Borders & Dividers**: `#E4E0DA` / `#DAD6CF`.
- **Status Alert / Orange**: `#D9541E` / `#F6D5C6`.

### Typography
- **Display Headings & Numbers**: `Bricolage Grotesque`, system-ui, sans-serif (`.dsp`, `.h`).
- **Body & Controls**: `Instrument Sans`, `Inter`, system-ui, sans-serif (`.body`).
- **Terminal & Code**: `JetBrains Mono`, monospace (`.mono`).

### Shape & Geometry
- **Card Radius**: `24px` to `28px` (`border-radius: 24px`).
- **Control & Pill Radius**: `999px` (`border-radius: 9999px`).
- **Dock**: Floating bottom pill, `height: 60px`, `border-radius: 9999px`, `box-shadow: 0 8px 24px rgba(30,25,20,0.12), 0 1px 2px rgba(30,25,20,0.06)`.
- **FAB**: Floating circular action button, `width: 60px; height: 60px; border-radius: 50%`, `box-shadow: 0 8px 24px rgba(30,25,20,0.2)`.

---

## 2. 14 Screens Inventory & Backend Bindings

| # | Screen Name | Reference File | React Component | Backend Endpoint(s) | Status |
|---|---|---|---|---|---|
| 1 | Pair your PC | `Pair your PC-html/Main.dc.html` | `frontend/src/views/Pair.jsx` | `POST /api/pair/claim`, `GET /api/pair/claim` | **Done** |
| 2 | Today (Home) | `Today-html/Today.dc.html` | `frontend/src/mobile/views/MobileToday.jsx` | `GET /api/user/profile`, `GET /api/today/*`, `GET /api/tasks`, `GET /api/remote/status`, `GET /api/calendar` | **Done** |
| 3 | Today (Scrolled) | `Today, scrolled-html/Today2.dc.html` | Included in `MobileToday.jsx` | `GET /api/jobs`, `GET /api/mail/threads?q=is:unread`, `GET /api/library?limit=1`, `GET /api/remote/media` | **Done** |
| 4 | Add widgets | `Add widgets-html/Gallery.dc.html` | `frontend/src/mobile/views/AddWidgetsModal.jsx` | `GET /api/dashboard/widgets`, `POST /api/dashboard/layout` | **Done** |
| 5 | Agent sessions | `Agent sessions-html/Sessions.dc.html` | `frontend/src/mobile/views/MobileAgentSessions.jsx` | `GET /api/conversations`, `POST /api/conversations`, `GET /api/jobs` | **Done** |
| 6 | Agent chat | `Agent chat-html/Agent.dc.html` | `frontend/src/mobile/views/MobileAgentChat.jsx` | `GET /api/conversations/{id}/messages`, `POST /api/conversations/{id}/turn`, `POST /api/remote/actions/{id}/decision` | **Done** |
| 7 | Library | `Library-html/Library.dc.html` | `frontend/src/mobile/views/MobileLibrary.jsx` | `GET /api/library`, `GET /api/library/lists` | **Done** |
| 8 | Ask Library | `Ask Library-html/AskLibrary.dc.html` | `frontend/src/mobile/views/MobileAskLibrary.jsx` | `POST /api/library/ask`, `GET /api/library?q=...` | **Done** |
| 9 | Library item | `Library item-html/LibraryItem.dc.html` | `frontend/src/mobile/views/MobileLibraryItem.jsx` | `GET /api/library/{id}`, `GET /api/library/{id}/media` | **Done** |
| 10 | Tasks | `Tasks-html/Tasks.dc.html` | `frontend/src/mobile/views/MobileTasks.jsx` | `GET /api/tasks`, `PATCH /api/tasks/{id}`, `POST /api/tasks` | **Done** |
| 11 | PC remote | `PC remote-html/PC.dc.html` | `frontend/src/mobile/views/MobilePC.jsx` | `GET /api/remote/status`, `GET /api/remote/screenshot`, `POST /api/remote/power/*` | **Done** |
| 12 | Terminal | `Terminal-html/Terminal.dc.html` | `frontend/src/mobile/views/MobileTerminal.jsx` | `POST /api/remote/command`, `WS /api/remote/ws` | **Done** |
| 13 | Send to Amethyst | `Send to Amethyst-html/Share.dc.html` | `frontend/src/mobile/modals/MobileQuickCapture.jsx` | `POST /api/mobile/captures`, `POST /api/library`, `POST /api/tasks` | **Done** |
| 14 | Settings | `Settings-html/Settings.dc.html` | `frontend/src/mobile/views/MobileSettings.jsx` | `GET /api/settings`, `GET /api/preferences`, `GET /api/devices` | **Done** |

---

## 3. 30 Laws of UX Audit & Fixes

1. **Fitts's Law**:
   - All interactive touch targets (dock items, list items, checkboxes, buttons) are sized at `>= 44×44px` (many at `48px`).
   - Squeezed demo buttons widened to fill appropriate horizontal flex slots.
2. **Hick's Law**:
   - Simplified bottom navigation dock: 5 clean destinations + 1 floating action button for quick creation.
   - Categorized settings sections (General, Connections, Security) preventing overwhelming scrolling.
3. **Jakob's Law**:
   - Traditional top-left back chevron on all subviews.
   - Standard bottom-dock navigation expected on iOS and Android.
4. **Doherty Threshold**:
   - Optimistic state updates on task checkbox toggle (checkbox toggles immediately while network syncs in background).
   - Fast fallback to local replica cache when offline or in poor connectivity.
5. **Goal-Gradient & Zeigarnik Effect**:
   - Task completion card displays visual progress ("2 left today · 3 of 5 done") with acid-lime progress bar.
   - Active agent jobs display clear step counters ("Step 3 of 5", "Step 1 of 4") so user understands remaining duration.
6. **Aesthetic-Usability Effect**:
   - High-contrast visual hierarchy, refined fonts (`Bricolage Grotesque`), generous radii (24-28px), and Amethyst acid lime accenting (`#D6F23E`).
7. **Error Prevention**:
   - Destructive PC commands (Shutdown, Sleep) require explicit confirmation dialogs before execution.
   - Action approval drafts on PC or phone require explicit "Allow" / "Deny" confirmations.

---

## 4. Multi-Agent Phased Roadmap
 
### Status: All 14 Screens Implemented & Integrated
- **Shell & Navigation**: `Companion.jsx` with floating bottom 5-tab dock (`Today`, `Agent`, `Library`, `Tasks`, `PC`) and 60px round FAB (`+`).
- **Screen 1 (Pair your PC)**: `Pair.jsx` with `#D6F23E` lime background and atomic orbit graphic.
- **Screen 2 & 3 (Today)**: `MobileToday.jsx` with greeting, approval card, quick glance carousel, focus timeline, agent heatmap, active jobs, and media player.
- **Screen 4 (Add Widgets)**: `AddWidgetsModal.jsx` catalog sheet.
- **Screen 5 (Agent Sessions)**: `MobileAgentSessions.jsx` with active job progress and session filters.
- **Screen 6 (Agent Chat)**: `MobileAgentChat.jsx` with tool badges, draft note cards, and remote PC action approval card.
- **Screen 7 (Library)**: `MobileLibrary.jsx` with content chips, bento tiles, and collections carousel.
- **Screen 8 (Ask Library)**: `MobileAskLibrary.jsx` with cited AI answer card and keyword snippets.
- **Screen 9 (Library Item)**: `MobileLibraryItem.jsx` with scrubber media player, segmented tabs, and "Ask agent about this" action.
- **Screen 10 (Tasks)**: `MobileTasks.jsx` with 7-day strip, goal progress bar, and optimistic checkboxes.
- **Screen 11 (PC Remote)**: `MobilePC.jsx` with live screen preview stream, 3-column telemetry card, and 6-tile action grid.
- **Screen 12 (Terminal)**: `MobileTerminal.jsx` with monospace prompt, quick commands, and input stream.
- **Screen 13 (Send to Amethyst)**: `MobileQuickCapture.jsx` concentric graphic sheet and destination picker.
- **Screen 14 (Settings)**: `MobileSettings.jsx` grouped preferences, Face ID toggle, and diagnostics modal.
- **Verification**: `npm --prefix frontend run test:mobile` (8/8 passed) and `npm --prefix frontend run build` (built cleanly).
