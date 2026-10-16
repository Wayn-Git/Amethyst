# Agent Dynamic Loading State & Tool Approval Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the agent's live working UI with a Claude-style dynamic status pill (stage-locked phrases, 10s+ timer, progressive disclosure) and an inline Craftwork/beUI Tool Approval Card with strictly scoped permissions and 44px touch targets.

**Architecture:** Pure stage state machine (`agentStageCore.js`) driving a custom hook (`useAgentStage.js`), providing inputs to the upgraded 44px `ClaudeActivity` trigger bar and `AgentActivity` drawer. A standalone `ToolApprovalCard` implements the `@UIInspirations/components/newlyadded/approval.md` specification inline within `Chat.jsx`.

**Tech Stack:** React 19, Tailwind CSS, Framer Motion, Lucide icons, Design System Tokens (`AGENTS.md` / `index.css`), Node test runner.

**Spec:** [`docs/superpowers/specs/2026-10-23-agent-loading-and-approval-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-23-agent-loading-and-approval-design.md)

## Global Constraints

- Every interactive button, trigger, and disclosure toggle must have a minimum touch target of 44px (`min-h-[44px] min-w-[44px]`).
- Design system CSS variables only: `var(--accent)`, `var(--coral)`, `var(--live)`, `var(--confirm)`, `var(--stop)`. Zero hardcoded hex colors or hex fallbacks.
- Amber (`var(--confirm)`) is strictly reserved for approvals. Never use amber for generic tool execution or thinking.
- Web tools classified strictly via explicit set `WEB_TOOLS`. `grep` is a generic local tool, not web search.
- "Always allow" must be scoped per tool and subcommand/path prefix. Never grant global wildcard execution for `terminal.run` or `filesystem.write`.
- Synonyms rotate only within the same stage after 3s, cycling every ~3.5s with no consecutive repeats and no pool repetition until exhausted.
- Timer starts displaying strictly at `10s+` and freezes during `waiting_approval`.
- Stall monitor (15s "Still working...", 20s "Provider seems slow") is suspended during `waiting_approval` and `reconnecting`. Active slow tools show `"Still running <tool>"`.

## Review Focus

1. **Tool approval scoping**: Ensure "Always allow" on a terminal command like `bun test` does not approve arbitrary commands like `rm -rf`.
2. **Timer pause accuracy**: Verify that an approval gate waiting on user response for 30s does not add 30s to the agent's execution duration.
3. **Stall false positives**: Verify that an active tool running a test suite for 15s displays `"Still running <tool>"` rather than `"Provider seems slow"`.
4. **Reduced motion compliance**: Verify that status text swaps without transform or opacity transitions when `prefers-reduced-motion: reduce` is enabled.
5. **Trace drawer expansion**: Ensure opening or closing the trace drawer by hand while running does not auto-collapse when the answer starts streaming.

---

### Task 1: Core State Machine & Tested Hook (`agentStageCore.js` & `useAgentStage.js`)

**Files:**
- Create: `frontend/src/hooks/agentStageCore.js`
- Create: `frontend/src/hooks/useAgentStage.js`
- Test: `frontend/tests/agent_stage.mjs`

**Interfaces:**
- Produces: `computeAgentStage(options)`, `StageEngine`, `WEB_TOOLS`, `PHRASE_POOLS`
- Produces: `useAgentStage({ running, status, liveTool, liveReasoning, liveBuffer, lastEventAt, error, onRetry })`

- [ ] **Step 1: Write unit tests in `frontend/tests/agent_stage.mjs`**
  Covering:
  - Initial 3s delay before rotation; 3.5s rotation intervals.
  - Shuffled pool exhaustion with no consecutive identical phrases.
  - Web tool classification (`web_search` -> `searching`, `grep` -> `tool`).
  - Stall detection (15s "Still working...", 20s "Provider seems slow" on silent model).
  - Slow tool execution (displays `"Still running <name>"` when tool duration > 10s).
  - Stall suspension and timer freezing during `waiting_approval` and `reconnecting`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node frontend/tests/agent_stage.mjs`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `agentStageCore.js`**
  Implement the deterministic state engine with stage detection, timer tracking, pause on approval, and shuffled synonym cycling.

- [ ] **Step 4: Implement `useAgentStage.js`**
  Wire `agentStageCore` to React state, intervals, and `window.matchMedia('(prefers-reduced-motion: reduce)')`.

- [ ] **Step 5: Run tests and verify they pass**
  Run: `node frontend/tests/agent_stage.mjs`
  Expected: All tests PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add frontend/src/hooks/agentStageCore.js frontend/src/hooks/useAgentStage.js frontend/tests/agent_stage.mjs
  git commit -m "feat(agent): implement agent stage state machine and useAgentStage hook"
  ```

---

### Task 2: Craftwork/beUI Tool Approval Component (`ToolApprovalCard.jsx`)

**Files:**
- Create: `frontend/src/components/agents/ToolApprovalCard.jsx`
- Create: `frontend/src/components/agents/tool-approval-card.css`
- Test: `frontend/tests/tool_approval.mjs`

**Interfaces:**
- Produces: `ToolApprovalCard({ item, onDecide, disabled })`
- Consumes: `CodeBlock` (`frontend/src/components/agents/code-block.tsx`), `api.decideConfirmation`

- [ ] **Step 1: Write test in `frontend/tests/tool_approval.mjs`**
  Verify scoped permissions generation:
  - `terminal.run` with `bun test tests/a11y.test.tsx` creates scope `{ tool: 'terminal.run', pattern: 'bun test*' }`.
  - `filesystem.write` creates directory scope `{ tool: 'filesystem.write', pathPrefix: '...' }`.
  - Calling decide with `remember=true` attaches scope and does not emit wildcard.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node frontend/tests/tool_approval.mjs`
  Expected: FAIL.

- [ ] **Step 3: Implement `ToolApprovalCard.jsx` and styling**
  - Follow `@UIInspirations/components/newlyadded/approval.md` layout:
    - Shield icon, "Allow this tool to run?", tool name subtitle (`terminal.run`).
    - Amber badge "Approval required" (`var(--confirm)`).
    - Context description.
    - Expandable "View details ⌃" with dark inset preview of command and directory.
    - 44px min-height buttons: `Allow once` (primary), `Always allow` (secondary), `Deny` (ghost).
    - Scope calculation ensuring strict non-global security.

- [ ] **Step 4: Run tests and verify they pass**
  Run: `node frontend/tests/tool_approval.mjs`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/agents/ToolApprovalCard.jsx frontend/src/components/agents/tool-approval-card.css frontend/tests/tool_approval.mjs
  git commit -m "feat(ui): add Craftwork/beUI ToolApprovalCard with security-scoped permissions"
  ```

---

### Task 3: Refactor `ClaudeActivity.jsx` for 44px Touch Target & Dynamic Loading State

**Files:**
- Modify: `frontend/src/components/agents/claude-activity/ClaudeActivity.jsx`
- Modify: `frontend/src/components/agents/claude-activity/claude-activity.css`

**Interfaces:**
- Consumes: `useAgentStage` (`frontend/src/hooks/useAgentStage.js`)
- Produces: `ClaudeActivity` component with:
  - 44px trigger bar
  - Claude-style pulsing warm indicator with design tokens
  - Dynamic phrase label from `useAgentStage`
  - Timer displaying strictly at `10s+`
  - Expandable drawer containing `AgentActivity` trace, thoughts, tool rows, and artifacts

- [ ] **Step 1: Update `ClaudeActivity.jsx` to integrate `useAgentStage`**
  Connect `running`, `status`, `live`, `liveReasoning`, `liveBuffer`, `lastEventAt`, `error` to `useAgentStage`.
  Replace static text derivations with `displayLabel` and `showTimer ? elapsedFormatted : null`.

- [ ] **Step 2: Update `claude-activity.css` to enforce 44px minimum touch targets and token colors**
  - Set `.claude-activity-trigger` `min-height: 44px`.
  - Use `var(--accent)` or `var(--coral)` for pulsing indicator, `var(--confirm)` for approval, `var(--live)` for settled checkmark.
  - Add `@media (prefers-reduced-motion: reduce)` rules for instant text swapping.

- [ ] **Step 3: Verify linting on modified files**
  Run: `npm run lint`
  Expected: No lint errors in `ClaudeActivity.jsx` or related files.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/components/agents/claude-activity/ClaudeActivity.jsx frontend/src/components/agents/claude-activity/claude-activity.css
  git commit -m "refactor(ui): update ClaudeActivity with 44px touch targets and dynamic state stages"
  ```

---

### Task 4: Integrate Inline Tool Approval & Live State in `TurnTrace.jsx` and `Chat.jsx`

**Files:**
- Modify: `frontend/src/components/TurnTrace.jsx`
- Modify: `frontend/src/views/Chat.jsx`

**Interfaces:**
- Consumes: `ToolApprovalCard`
- Consumes: `ClaudeActivity`

- [ ] **Step 1: Wire pending confirmations inline in `Chat.jsx`**
  - When a tool requires approval (`pending.length > 0`), render `ToolApprovalCard` inline directly in the chat message timeline above the composer.
  - Wire actions to `decideConfirmation`.
  - Pause the turn timer while `pending.length > 0`.

- [ ] **Step 2: Update `TurnTrace.jsx` to pass `status` and `lastEventAt` to `ClaudeActivity`**
  Ensure live stream events correctly pass `liveBuffer`, `liveReasoning`, `status`, and `lastEventAt` so `useAgentStage` stays in sync.

- [ ] **Step 3: Test syntax and build**
  Run: `npm run build`
  Expected: Vite build succeeds with 0 errors.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/components/TurnTrace.jsx frontend/src/views/Chat.jsx
  git commit -m "feat(chat): integrate inline ToolApprovalCard and live stage tracking"
  ```

---

### Task 5: End-to-End Verification & Verification Gate

**Files:**
- Run: `node frontend/tests/agent_stage.mjs`
- Run: `node frontend/tests/tool_approval.mjs`
- Run: `npm run build`
- Run: `npm run lint`

- [ ] **Step 1: Execute all unit and component tests**
  Verify that both test suites pass cleanly.

- [ ] **Step 2: Execute build and lint checks**
  Ensure full production build passes with no broken imports or type mismatches.

- [ ] **Step 3: Final check of 30 Laws of UX & 44px targets**
  Inspect CSS rules and DOM footprints to ensure no button has `< 44px` height.

- [ ] **Step 4: Commit final verification markers**
  ```bash
  git commit --allow-empty -m "chore(release): verify agent loading and tool approval UX implementation"
  ```
