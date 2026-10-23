# Design Specification: Agent Dynamic Loading State & Tool Approval Component

**Date:** 2026-10-23  
**Status:** Approved for Implementation  
**Target Files:**
- `frontend/src/hooks/useAgentStage.js` (New)
- `frontend/src/components/agents/ToolApprovalCard.jsx` (New)
- `frontend/src/components/agents/claude-activity/ClaudeActivity.jsx` (Refactored)
- `frontend/src/components/TurnTrace.jsx` (Updated)
- `frontend/src/views/Chat.jsx` (Updated)
- `frontend/tests/useAgentStage.test.jsx` (New)

---

## 1. Executive Summary

This specification overhauls the AI agent's active execution and approval UX in Amethyst. It replaces raw tool execution logs and cluttered thoughts during generation with a polished, minimalist status bar inspired by Claude (featuring warm pulsing indicators, dynamic stage-locked synonyms, honest elapsed timers, and progressive disclosure). It also introduces a dedicated, security-scoped **Tool Approval Card** directly inside the chat timeline matching Craftwork/beUI specifications, strictly governed by the **30 Laws of UX** and the design token system in `AGENTS.md`.

---

## 2. The 30 Laws of UX Decision Matrix

Every interactive trigger, disclosure toggle, and action button enforces a **minimum touch/click target of 44px** (`min-h-[44px] min-w-[44px]` with adequate hit padding), meeting WCAG 2.5.5 Level AAA and Fitts's Law.

| # | Law (from lawsofux.com) | Concrete Implementation Decision or N/A |
|---|---|---|
| 1 | **Aesthetic-Usability Effect** | Claude-style pulsing indicator with balanced spacing and design tokens makes the agent feel reliable, responsive, and trustworthy. |
| 2 | **Chunking** | Expanded trace groups execution details into 3 distinct chunks: *Thinking Process*, *Tools Executed*, *Artifacts Created*. |
| 3 | **Cognitive Load** | Hides noisy raw JSON payloads and live bash streams during generation, presenting a clean 44px status pill. |
| 4 | **Doherty Threshold** | State transitions and accordion disclosures respond in `< 180ms`, keeping interactions well below the 400ms threshold. |
| 5 | **Fitts’s Law** | All interactive targets (`ClaudeActivity` bar, "View details", "Allow once", "Always allow", "Deny", retry button) enforce **44px minimum height/width**. |
| 6 | **Flow** | Streamlined status updates do not block or interrupt the reading flow of the incoming assistant reply. |
| 7 | **Goal-Gradient Effect** | As the agent advances from reasoning → tool → writing answer, progressive status messages confirm momentum toward completion. |
| 8 | **Hick’s Law** | Eliminates choice paralysis by collapsing complex tool operations into a single status line; approval card provides 3 distinct, clear choices. |
| 9 | **Jakob’s Law** | Familiar Anthropic Claude interaction pattern (pulsing indicator, status label, timer, `>` chevron) and IDE-standard approval patterns. |
| 10 | **Law of Common Region** | Tool approval card and expanded trace drawers are bound within explicit hairlined borders (`var(--border)`) on distinct surfaces (`var(--surface-2)`). |
| 11 | **Law of Continuity** | Horizontal alignment of indicator glyph, status label, elapsed timer, and chevron guides user scan lines naturally. |
| 12 | **Law of Focal Point** | "Allow once" is the high-contrast primary focal button; "Always allow" is secondary; "Deny" is tertiary ghost text. |
| 13 | **Law of Past Experience** | Users expect terminal commands to be formatted in monospace with dark code insets, and web queries with search icons. |
| 14 | **Law of Proximity** | Approval action buttons sit directly beneath the command and directory details they authorize. |
| 15 | **Law of Similarity** | All executed tool rows share identical typography, badge pills, and monospace styling. |
| 16 | **Law of Uniform Connectedness** | Vertical timeline hairline visually links sequential tool calls in the expanded drawer. |
| 17 | **Mental Model** | Clarifies the mental distinction between internal model reasoning and concrete external tool execution. |
| 18 | **Miller’s Law** | Limits active working memory demands to a single high-level state phrase rather than tracking 20+ tool outputs simultaneously. |
| 19 | **Occam’s Razor** | Strips unnecessary wrappers, redundant badges, and raw error stack dumps from the primary view. |
| 20 | **Pareto Principle** | 80% of user sessions only require the high-level status and final answer; deep trace is tucked behind progressive disclosure. |
| 21 | **Parkinson’s Law** | Timer is hidden for the first 10s to eliminate artificial waiting anxiety, appearing at `10s+` to remain honest. |
| 22 | **Peak-End Rule** | Clean settled transition to green checkmark (`var(--live)`) and summary ("Ran 2 tools · 3.4s") upon turn completion. |
| 23 | **Postel’s Law** | Permissive payload parsing safely handles stringified JSON, raw bash strings, and MCP dictionary outputs without breaking. |
| 24 | **Progressive Disclosure** | 3-tier hierarchy: Tier 1 (44px summary pill) → Tier 2 (expanded activity drawer) → Tier 3 (nested payload code/json viewer). |
| 25 | **Selective Attention** | Prevents peripheral visual flicker by using subtle opacity crossfades (disabled on reduced motion) instead of bouncing text. |
| 26 | **Serial Position Effect** | The initial prompt goal and the final resolved answer are given prominent layout positions. |
| 27 | **Sensory Overload** | Avoids multi-color flashing badges while tools run; only the minimal squircle/dot pulses gently. |
| 28 | **Tesler’s Law** | Preserves backend execution complexity in the accessible drawer rather than stripping observability. |
| 29 | **Von Restorff Effect** | Amber (`var(--confirm)`) is **strictly reserved** for `waiting_approval`, immediately drawing eyes when action is required. |
| 30 | **Zeigarnik Effect** | Gentle pulsing motion signals an active uncompleted task, settling into a static state when finished. |

---

## 3. Prebuilt Component Attribution

No invented or redundant components are created. The architecture maps 1:1 to prebuilt components from `@UIInspirations/components/newlyadded/approval.md` and `@UIInspirations/components/newlyadded/Chatapp Contrains Everything.md`:

| UI Piece | Exact Component Name & Source | Function |
|---|---|---|
| **Chat Shell & Stream Containers** | `ChatApp`, `Message`, `MessageContent`, `MessageBubble` (`Chatapp Contrains Everything.md` / `beui/chat-app`) | Manages the chat layout, assistant message envelopes, and live stream token rendering. |
| **Tool Approval Card** | `ToolApproval` (`approval.md` / `beui/tool-approval`) | Inline confirmation card with shield icon, amber approval badge, collapsible parameter drawer, and 3 scoped action buttons. |
| **Expanded Activity Ledger** | `AgentActivity` & `ActivityRow` (`@/components/agents/agent-activity/` from beUI agent kit) | Expandable accordion displaying structured reasoning, tool calls, and sources. |
| **Code & Command Insets** | `CodeBlock` (`@/components/agents/code-block.tsx`) | Monospace formatted syntax-highlighted display for terminal commands and edited files. |
| **JSON Payload Inspector** | `JsonViewer` (`@/components/arc/json-viewer/json-viewer.tsx`) | Interactive expandable JSON tree for complex arguments and tool responses. |
| **Icon State Transitions** | `ActionSwapIcon` (`@/components/motion/action-swap.tsx`) | Micro-animations for status glyphs and accordion chevron rotation. |
| **Status Pill Bar** | `ClaudeActivity` (backed by `useAgentStage`) | 44px trigger bar featuring pulsing squircle/dots, stage phrases, and 10s+ timer. |

---

## 4. Hook Specification: `useAgentStage`

The `useAgentStage` hook is a headless, tested state machine managing rotation, timings, stall detection, and stage derivation.

### 4.1 Inputs & Options
```ts
interface UseAgentStageOptions {
  running: boolean;
  status: { state?: string } | null;
  liveTool: { name?: string; arguments?: any } | null;
  liveReasoning: string;
  liveBuffer: string;
  lastEventAt: number; // Unix timestamp in ms
  error: Error | string | null;
  onRetry?: () => void;
}
```

### 4.2 Outputs
```ts
interface UseAgentStageResult {
  stage: 'reasoning' | 'searching' | 'tool' | 'writing_answer' | 'waiting_approval' | 'reconnecting' | 'error' | 'idle';
  displayLabel: string;
  elapsedSeconds: number;
  showTimer: boolean; // true strictly when elapsedSeconds >= 10
  isStalled: boolean; // true if silent for >=15s during reasoning/writing
  stallReason: 'slow_model' | 'slow_provider' | null;
  isReducedMotion: boolean;
}
```

### 4.3 Tool Classification (Explicit List, No Substring Grepping)
- **Web Search Tools (Explicit Set)**:
  `web_search`, `search_web`, `fetch_web_page`, `fetch_url`, `browser_navigate`, `browser_click`, `browser_type`, `image_search`.
- **Local Search Tools (`grep`, `find_files`, `code_search`)**: Classified as **generic tools**, never web search.
- **Connector Tools (Gmail, Composio, MCP)**: Classified as **generic tools**.

### 4.4 The 8 Stages & Phrase Pools
- Rotation delay: **3s** before first rotation within a stage.
- Rotation interval: **3.5s** between rotations.
- Pool shuffling: Shuffled once per turn; all phrases are exhausted before repeating. Never repeats the same phrase twice consecutively.
- Swaps text instantly without animation when `prefers-reduced-motion` is active.

```js
const PHRASE_POOLS = {
  reasoning: [
    "Thinking",
    "Working on the big things",
    "Crystallizing",
    "Synthesizing",
    "Analyzing context",
    "Considering approaches",
    "Formulating thoughts",
    "Working through logic",
  ],
  searching: [
    "Searching the web",
    "Looking online",
    "Gathering web results",
    "Querying web sources",
    "Finding online info",
    "Fetching web pages",
    "Checking online resources",
    "Retrieving web results",
  ],
  tool: [
    "Calling tools",
    "Running tool",
    "Executing action",
    "Processing request",
    "Working on task",
    "Handling operation",
    "Running subroutine",
    "Performing action",
  ],
  writing_answer: [
    "Writing response",
    "Composing reply",
    "Drafting response",
    "Formatting answer",
    "Structuring reply",
    "Finalizing response",
  ],
  waiting_approval: ["Waiting for your approval"],
  reconnecting: ["Reconnecting to provider..."],
  error: ["Connection interrupted"],
  idle: ["Thought for a moment"],
};
```

### 4.5 Stall Monitor, Inactivity, and Timer Pausing
1. **Silent Model Stall (`reasoning` or `writing_answer`)**:
   - `lastEventAt` inactivity `> 15s`: Displays `"Still working..."`.
   - `lastEventAt` inactivity `> 20s`: Displays `"Provider seems slow"`.
2. **Active Tool Execution Stall**:
   - When `liveTool` is active for `> 10s`, displays `"Still running " + toolName` rather than generic stall messages.
3. **Suspension & Pausing during `waiting_approval`**:
   - Stall monitor is **suspended** completely.
   - Turn timer is **paused** and does not tick while awaiting user decision.
   - Settled execution time excludes human approval wait time.
4. **Suspension during `reconnecting`**:
   - Stall monitor is suspended while transport retries are underway.

---

## 5. Tool Approval Component: `ToolApprovalCard`

### 5.1 Visual Structure (`beui/tool-approval`)
- **Card Container**: Bounded card using `var(--surface-2)` background, `var(--border)` hairline, and `var(--radius-lg)` (10px).
- **Header**:
  - Left: Shield icon (`ShieldAlert`) inside a circular pill (`var(--surface-3)`).
  - Center:
    - Title: *"Allow this tool to run?"* (`font-semibold text-text text-[15px]`).
    - Subtitle: Tool identifier, e.g. `terminal.run` (`font-mono text-text-dim text-[12.5px]`).
  - Right: Amber pill badge: *"Approval required"* (`color: var(--confirm); background: var(--confirm-soft); border: 1px solid var(--confirm-line); border-radius: var(--radius-tags)`).
- **Description**: Plain language description of the requested tool action.
- **Collapsible Parameter Details ("View details ⌃")**:
  - 44px hit-target toggle button.
  - Inset box (`var(--surface-3)` with `var(--border)`).
  - Monospace command line displayed in `CodeBlock`, working directory chips, or parameter tree in `JsonViewer`.
- **Actions Bar (44px Minimum Touch Targets)**:
  - **"Allow once"**: Primary capsule button (`bg-text text-canvas hover:opacity-90 font-medium rounded-buttons min-h-[44px] px-5`).
  - **"Always allow"**: Secondary subtle dark capsule (`bg-surface-3 text-text border border-border hover:bg-surface-2 font-medium rounded-buttons min-h-[44px] px-5`).
  - **"Deny"**: Ghost text button (`text-text-dim hover:text-stop font-medium min-h-[44px] px-4`).

### 5.2 Scoped Revocation Security Architecture
- **No Global Wildcards**:
  - `terminal.run` standing approval is scoped strictly to the specific executable and subcommand prefix (e.g. `bun test*`, `pytest*`). It never globally approves all bash commands.
  - `filesystem.write` standing approval is scoped strictly to the project subdirectory (e.g. `frontend/src/*`).
- **Revocation**:
  - Every standing approval creates a registered entry stored in SQLite via `api.decideConfirmation(id, { allow: true, remember: true, scope })`.
  - The card displays a subtle disclosure: *"Can be revoked anytime in Settings → Standing Approvals"*.
  - Users can revoke standing permissions with a single click in Settings.

---

## 6. Color Tokens (Strict Token Compliance)

No arbitrary hex values or hex fallbacks are permitted. Styles strictly consume tokens defined in `frontend/src/index.css`:
- **Live Agent Indicator**: `var(--accent)` (primary) or `var(--coral)` (reasoning).
- **Approval State**: `var(--confirm)` (amber tone). **Amber is strictly reserved for approvals**.
- **Settled / Success**: `var(--live)`.
- **Error / Aborted**: `var(--stop)`.
- **Borders & Grounds**: `var(--hairline)`, `var(--canvas)`, `var(--surface-2)`, `var(--surface-3)`.

---

## 7. Automated Testing Plan

A dedicated Vitest test suite (`frontend/tests/useAgentStage.test.jsx`) validates the state machine using fake timers (`vi.useFakeTimers()`):
1. **Initial Delay**: Verify that phrases do not rotate for the first 3s of a stage.
2. **Rotation Interval**: Verify that phrases rotate every 3.5s after the initial 3s.
3. **No-Repeat Shuffling**: Verify that all phrases in a pool are exhausted before repetition, and no consecutive duplicate phrases occur.
4. **Stall Thresholds**:
   - Inactive for 15s during reasoning → displays `"Still working..."`.
   - Inactive for 20s during reasoning → displays `"Provider seems slow"`.
5. **Tool Execution Display**: Tool running for > 10s → displays `"Still running <tool>"`.
6. **Suspension & Pausing**:
   - `waiting_approval` halts stall detection and pauses the turn timer.
   - `reconnecting` halts stall detection.
