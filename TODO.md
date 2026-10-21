# Amethyst Next Session TODO & Handover

*Created: October 22, 2026*

This document tracks current state, completed bug fixes, and prioritized tasks to pick up in the next session.

---

## 🚀 What Was Completed Today

1. **Agent Components & Dedicated CSS Stylesheets**:
   - Added dedicated CSS stylesheets adhering to the Amethyst Design System tokens (`--surface-2`, `--border`, `--hairline`, `--accent`, `--live`, `--text-dim`):
     - `frontend/src/components/agents/agent-activity/agent-activity.css`
     - `frontend/src/components/agents/approval-card/approval-card.css`
     - `frontend/src/components/agents/code-block.css`
     - `frontend/src/components/agents/message.css`
   - Cleaned up `map-events.js` and `activity-row.tsx`:
     - Reasoning/thought items are now mapped to thinking trace rows with brain icon and italic summaries instead of raw truncated checkmarks.
     - Extracted tool target subjects cleanly to prevent duplicate tool names (e.g. `GMAIL_FETCH_EMAILS GMAIL_FETCH_EMAILS`).

2. **Side Panel Drag-Resize Fix**:
   - In `frontend/src/components/PanelResizer.jsx`, pointer release was previously calling `setPanelWidth(panelWidth)` with the stale pre-drag width, snapping the panel back to 372px.
   - Added a `latestW` reference updated on pointer moves and persisted on pointer up (`setPanelWidth(latestW.current, { persist: true })`).

3. **Question Card & Timeout Fixes**:
   - In `backend/agent/director.py`, fixed `ask_user` tool timeout fallback so `timeout=0` (indefinite human wait) is respected and does not abort after 15s.
   - In `frontend/src/components/agents/approval-card/index.tsx`, scoped keyboard listeners to `cardRef.current.contains(document.activeElement)` so `Enter` in the composer textarea is never intercepted.
   - In `frontend/src/views/Chat.jsx`, left-aligned `ApprovalCard` (`justify-start`) and bounded to `max-w-2xl` matching the stream layout.

4. **Memory View Refactoring**:
   - Refactored `frontend/src/views/Memory.jsx` and created `frontend/src/views/memory.css` for clean ledger styling.

---

## 📋 Tasks For Tomorrow's Session

### 1. Visual Verification & Appearance Testing
- [ ] **Agent Activity Stream:**
  - Send a prompt that triggers multiple tools (e.g., `Fetch my latest GitHub issues and summarize them`).
  - Verify that the active state displays the shimmering status and elapsed time pill.
  - Verify that finished tools expand/collapse cleanly with distinct action tags (`RUN`, `READ`, `GET`) without duplicate name text.
  - Check the appearance setting in Settings/Appearance to toggle between activity styles (`activity` vs `chips` / `run`).
- [ ] **Multiple-Choice & Approval Cards:**
  - Send a prompt requiring user input (e.g. `Ask me 3 clarifying questions before writing code`).
  - Confirm the card stays left-aligned, active, and does not time out.
  - Test keyboard selection (`[1]`, `[2]`, `[3]`, arrows, `Enter`) and custom write-in text input.
- [ ] **Side Panel Resizer:**
  - Open a thread or artifact that renders into the right side panel.
  - Drag the left edge of `#wb-panel` to resize it wider and release; verify it stays at the chosen width and survives a page reload.

### 2. Memory Tab Check
- [ ] Navigate to `/memory` and verify facts list, version lineage, audit trail, and bulk operations with `memory.css`.

---

## 📂 Key Files Reference
- `frontend/src/components/agents/agent-activity/` (`index.tsx`, `activity-row.tsx`, `agent-activity.css`, `map-events.js`)
- `frontend/src/components/agents/approval-card/` (`index.tsx`, `approval-card.css`, `types.ts`)
- `frontend/src/components/PanelResizer.jsx`
- `frontend/src/views/Chat.jsx`
- `frontend/src/views/Memory.jsx` & `frontend/src/views/memory.css`
- `backend/agent/director.py`
