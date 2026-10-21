# Agent Chat Sections & Response Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate beUI's agent component suite (`AgentActivity`, `ApprovalCard`, `CodeBlock`, `MessageBubble`, and streaming response architecture) into Amethyst, make OpenAI-style rich responses the default without Jev reliance, fix the invisible streaming text bug, and add an adaptive Activity Stream option in Settings.

**Architecture:** A modular agent component architecture under `frontend/src/components/agents/` powered by Amethyst design tokens (`--text`, `--canvas`, `--accent`). Assistant responses natively stream with smooth token transitions, inline citations, and follow-up chips. `TurnTrace.jsx` routes between Cards, Tool Chips, and the new `AgentActivity` stream based on Settings preferences. `Chat.jsx` unifies question choices and plan approvals into `ApprovalCard`, and messages into `MessageBubble`.

**Tech Stack:** React 18, Motion (`motion/react`), Tailwind CSS with Vanilla CSS custom properties, Lucide icons, Vite.

**Spec:** [`docs/superpowers/specs/2026-10-21-agent-chat-sections-overhaul-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-21-agent-chat-sections-overhaul-design.md)

## Global Constraints

- Never use undefined CSS variables like `--muted-foreground`. Strictly use Amethyst's native `:root` design tokens from `index.css`: `--text`, `--text-dim`, `--text-faint`, `--canvas`, `--surface`, `--accent`, `--border`, `--hairline`.
- Adhere to typography rules in `AGENTS.md`: `--font-sans` for human-readable content, `--font-mono` for machine-reported data (code, diffs, commands). Never hardcode px font sizes; use calc tokens or theme scale.
- Motion durations must stay under 280ms (`--press: 120ms`, `--menu: 180ms`) and obey `prefers-reduced-motion: reduce`.
- Backward compatibility: Existing `cards` (`AgentRun`) and `chips` (`ToolChipsTrace`) must continue working alongside the new `activity` (`AgentActivity`) style.
- No regression to existing chat features: SelectionActionMenu, ResponseEditor, Pinning, Sources panel, Docx export, and Terminal drawer must remain functional.

## Review Focus

1. **Invisible streaming tokens**: Test with both light (`paper`, `sand`) and dark (`graphite`, `ink`, `nocturne`) themes to guarantee text has high contrast and is 100% visible from token 0.
2. **Jev failure/bypass**: Normal responses with no widget envelope must still display inline citations, follow-up chips, and smooth streaming.
3. **Empty / corrupt question payload**: `ApprovalCard` in questions mode must gracefully handle missing options or malformed question lists without crashing.
4. **Tool call event stream mapping**: `AgentActivity` must properly handle mixed events (searches, bash commands, file diffs with zero deletions, reasoning thoughts) without dropping items.
5. **Code block copy**: Manual dragging across lines must copy only code without line numbers, and the copy button must provide instant visual feedback.

---

### Task 1: Foundational Motion & Shimmer Primitives

**Files:**
- Create: `frontend/src/lib/ease.ts`
- Create: `frontend/src/lib/text-shimmer.ts`
- Create: `frontend/src/components/motion/text-shimmer.tsx`
- Create: `frontend/src/components/agents/agent-disclosure.tsx`
- Test: `frontend/tests/motion-primitives.test.mjs`

**Interfaces:**
- Produces:
  - `EASE_OUT`, `SPRING_PRESS`, `SPRING_PANEL`, `SPRING_LAYOUT` from `frontend/src/lib/ease.ts`
  - `TextShimmer` from `frontend/src/components/motion/text-shimmer.tsx`
  - `AgentDisclosure` from `frontend/src/components/agents/agent-disclosure.tsx`

- [ ] **Step 1: Write the test for motion primitives and shimmer exports**

```javascript
// frontend/tests/motion-primitives.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { EASE_OUT, SPRING_PRESS } from '../src/lib/ease.ts'
import { textShimmerStyle } from '../src/lib/text-shimmer.ts'

test('motion ease tokens define valid cubic-bezier arrays', () => {
  assert.equal(EASE_OUT.length, 4)
  assert.equal(SPRING_PRESS.type, 'spring')
})

test('textShimmerStyle generates correct animation css duration', () => {
  const style = textShimmerStyle(2.0)
  assert.match(style.animation, /2s linear infinite/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/motion-primitives.test.mjs`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `frontend/src/lib/ease.ts`, `text-shimmer.ts`, `text-shimmer.tsx`, and `agent-disclosure.tsx`**

Implement standard easing arrays and spring configurations compatible with `motion/react`. Ensure `text-shimmer.ts` uses `var(--text-dim)` and `var(--text)` gradients rather than undefined `--muted-foreground`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/motion-primitives.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ease.ts frontend/src/lib/text-shimmer.ts frontend/src/components/motion/text-shimmer.tsx frontend/src/components/agents/agent-disclosure.tsx frontend/tests/motion-primitives.test.mjs
git commit -m "feat(ui): add foundational motion and shimmer primitives with amethyst design tokens"
```

---

### Task 2: Default OpenAI-Style Streaming & Token Visibility Fix

**Files:**
- Modify: `frontend/src/components/arc/streaming-text/blurred-text.tsx`
- Create: `frontend/src/components/agents/streaming-response.tsx`
- Modify: `frontend/src/components/ResponseArtifactBox.jsx`
- Test: `frontend/tests/streaming-response.test.mjs`

**Interfaces:**
- Consumes: `EASE_OUT` from `frontend/src/lib/ease.ts`, `BlurredText` from `frontend/src/components/arc/streaming-text/blurred-text.tsx`
- Produces: `StreamingResponse` component taking `{ text, status, live, sources, followUps, onFollowUp, children }`

- [ ] **Step 1: Write test verifying token styling and contrast fix**

```javascript
// frontend/tests/streaming-response.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('blurred-text does not reference undefined muted-foreground', () => {
  const file = readFileSync(join(process.cwd(), 'frontend/src/components/arc/streaming-text/blurred-text.tsx'), 'utf8')
  assert.equal(file.includes('text-muted-foreground'), false, 'Must not use undefined text-muted-foreground')
  assert.ok(file.includes('var(--text') || file.includes('text-dim') || file.includes('inherit'), 'Must use Amethyst tokens')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/streaming-response.test.mjs`
Expected: FAIL (assertion fails because `blurred-text.tsx` currently has `text-muted-foreground`)

- [ ] **Step 3: Update `blurred-text.tsx` and create `streaming-response.tsx`**

- In `blurred-text.tsx`: Replace `font-satoshi text-sm text-muted-foreground/80 leading-relaxed` with semantic Amethyst tokens: `text-[15.5px] leading-[1.6] text-[var(--text)]`. Ensure token animation transitions from `opacity: 0, filter: "blur(4px)"` to `opacity: 1, filter: "blur(0px)"` using `duration: 0.12`.
- In `streaming-response.tsx`: Create the complete OpenAI-style streaming wrapper that hosts streaming text, inline citation pills with domain icons, and follow-up suggestion chips.
- In `ResponseArtifactBox.jsx`: When `item.live` is true or text is streaming, render `StreamingResponse` as the default assistant body without requiring any Jev envelope.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/streaming-response.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/arc/streaming-text/blurred-text.tsx frontend/src/components/agents/streaming-response.tsx frontend/src/components/ResponseArtifactBox.jsx frontend/tests/streaming-response.test.mjs
git commit -m "fix(ui): eliminate invisible streaming tokens and make openai-style answering default"
```

---

### Task 3: Modern Syntax-Highlighted CodeBlock Component

**Files:**
- Create: `frontend/src/components/agents/code-block.tsx`
- Modify: `frontend/src/components/markdown/Markdown.jsx`
- Test: `frontend/tests/code-block.test.mjs`

**Interfaces:**
- Produces: `CodeBlock` component taking `{ code, language, filename, status, showLineNumbers, highlightLines, copyable }`
- Consumes: Amethyst theme colors, `CopyButton` feedback

- [ ] **Step 1: Write test for CodeBlock interface and line number separation**

```javascript
// frontend/tests/code-block.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('code-block component exists and contains line numbering and status indicators', () => {
  const code = readFileSync(join(process.cwd(), 'frontend/src/components/agents/code-block.tsx'), 'utf8')
  assert.ok(code.includes('showLineNumbers'))
  assert.ok(code.includes('highlightLines'))
  assert.ok(code.includes('Writing…') || code.includes('streaming'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/code-block.test.mjs`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Implement `frontend/src/components/agents/code-block.tsx` and integrate in `Markdown.jsx`**

- Implement `CodeBlock` with:
  - Separate line numbers column with `user-select: none` so line dragging never copies numbers.
  - Streaming state badge: shimmering `"Writing…"` indicator when `status === 'streaming'`, transitioning to `"Ready"` or language tag on complete.
  - Line highlight support via `highlightLines: number[]`.
  - Copy button with checkmark feedback.
  - `var(--font-mono)` typography.
- In `Markdown.jsx`: Replace `ArcCodeBlock` with `CodeBlock`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/code-block.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/agents/code-block.tsx frontend/src/components/markdown/Markdown.jsx frontend/tests/code-block.test.mjs
git commit -m "feat(ui): add beUI-standard code-block with line numbers and streaming states"
```

---

### Task 4: Adaptive Activity Stream Component (`AgentActivity`) & Settings

**Files:**
- Create: `frontend/src/components/agents/agent-activity/types.ts`
- Create: `frontend/src/components/agents/agent-activity/activity-row.tsx`
- Create: `frontend/src/components/agents/agent-activity/index.tsx`
- Modify: `frontend/src/store.jsx`
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/components/TurnTrace.jsx`
- Test: `frontend/tests/agent-activity.test.mjs`

**Interfaces:**
- Produces: `AgentActivity` component taking `{ items, contentType, status, duration, maxHeight, defaultOpen }`
- Consumes: Amethyst `thinkingStyle` preference in `store.jsx`

- [ ] **Step 1: Write test for turn events mapping to AgentActivityItem**

```javascript
// frontend/tests/agent-activity.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapEventsToActivityItems } from '../src/components/agents/agent-activity/map-events.js'

test('mapEventsToActivityItems maps searches, tools, and reasoning properly', () => {
  const events = [
    { type: 'thought', text: 'Analyzing requirements' },
    { type: 'tool', call: { name: 'search_web', arguments: { query: 'react performance' } } },
    { type: 'tool', call: { name: 'edit_file', arguments: { TargetFile: 'App.tsx' } } },
  ]
  const items = mapEventsToActivityItems(events)
  assert.equal(items.length, 3)
  assert.equal(items[0].type, 'step')
  assert.equal(items[1].type, 'search')
  assert.equal(items[2].type, 'tool')
  assert.equal(items[2].target, 'App.tsx')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/agent-activity.test.mjs`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `map-events.js`, `activity-row.tsx`, `index.tsx`, and wire Settings & TurnTrace**

- Create `map-events.js` to convert Amethyst's tool events, reasoning strings, and live states into typed `AgentActivityItem[]`.
- Create `activity-row.tsx` and `index.tsx` supporting:
  - Shimmering status line while working.
  - Gliding capped height viewport (`maxHeight: 220px`).
  - Search rows with favicon chips and query text.
  - Tool rows with monospace targets and addition/deletion diff stats.
  - Collapsed summary on complete (`"Thought for 4s"`, `"Ran 3 tools"`).
- In `store.jsx`: Allow `thinkingStyle` to accept `'cards' | 'chips' | 'activity'`.
- In `Settings.jsx`: Add `"Activity Stream"` button to the *Thinking trace style* segmented control.
- In `TurnTrace.jsx`: Render `<AgentActivity ... />` when `thinkingStyle === 'activity'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/agent-activity.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/agents/agent-activity/ frontend/src/store.jsx frontend/src/views/Settings.jsx frontend/src/components/TurnTrace.jsx frontend/tests/agent-activity.test.mjs
git commit -m "feat(ui): add adaptive agent activity stream and settings appearance option"
```

---

### Task 5: Unified Human-in-the-Loop `ApprovalCard`

**Files:**
- Create: `frontend/src/components/agents/approval-card/types.ts`
- Create: `frontend/src/components/agents/approval-card/index.tsx`
- Modify: `frontend/src/views/Chat.jsx`
- Test: `frontend/tests/approval-card.test.mjs`

**Interfaces:**
- Produces: `ApprovalCard` component supporting `{ questions, onSubmit, onDismiss }` and `{ title, description, steps, onApprove, onRequestChanges, onReject }`
- Replaces: Legacy `QuestionCard` and `PlanCard`

- [ ] **Step 1: Write test for ApprovalCard questions and approval payload generation**

```javascript
// frontend/tests/approval-card.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatQuestionSubmission } from '../src/components/agents/approval-card/format-submission.js'

test('formatQuestionSubmission correctly formats answers array for api', () => {
  const answers = {
    'q-0': { value: 'opt-1', label: 'Use TypeScript' },
    'q-1': ['auth', 'billing'],
    'q-2': 'Custom user preference'
  }
  const result = formatQuestionSubmission(answers)
  assert.deepEqual(result, ['Use TypeScript', 'auth, billing', 'Custom user preference'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/approval-card.test.mjs`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `ApprovalCard` and integrate in `Chat.jsx`**

- Build `ApprovalCard` with:
  - Single-choice radio cards with smooth selection.
  - Multiple-choice checkboxes with badge styling.
  - Custom freeform text write-in option (`allowCustom`).
  - Carousel pagination for multi-question flows with Skip and Submit buttons.
  - Keyboard navigation (keys 1-9 to pick, Enter to submit/advance).
  - Plan review flow: step list, "Approve and run", "Request changes", "Discard".
  - Settled state: compact summary card showing recorded decision.
- In `Chat.jsx`:
  - Replace `QuestionCard` with `ApprovalCard` in questions mode.
  - Replace `PlanCard` with `ApprovalCard` in review mode.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/approval-card.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/agents/approval-card/ frontend/src/views/Chat.jsx frontend/tests/approval-card.test.mjs
git commit -m "feat(ui): unify question choices and plan approvals with beUI ApprovalCard"
```

---

### Task 6: Message Bubble Surface & Conversational Grouping

**Files:**
- Create: `frontend/src/components/agents/message.tsx`
- Create: `frontend/src/components/agents/message-bubble.tsx`
- Modify: `frontend/src/views/Chat.jsx`
- Test: `frontend/tests/message-bubble.test.mjs`

**Interfaces:**
- Produces:
  - `MessageGroup`, `Message`, `MessageAvatar`, `MessageHeader`, `MessageFooter`
  - `MessageBubble`, `MessageBubbleContent`, `MessageBubbleCollapsible`
- Replaces: Raw `.msg.msg-user` and `.msg.msg-assistant` divs in `Chat.jsx`

- [ ] **Step 1: Write test for MessageBubble variants and collapsible clamping**

```javascript
// frontend/tests/message-bubble.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('message-bubble exports expected tone variants and collapsible components', () => {
  const code = readFileSync(join(process.cwd(), 'frontend/src/components/agents/message-bubble.tsx'), 'utf8')
  assert.ok(code.includes('MessageBubbleCollapsible'))
  assert.ok(code.includes('variant') && code.includes('soft') && code.includes('solid'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/message-bubble.test.mjs`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Implement `message.tsx`, `message-bubble.tsx`, and integrate into `Chat.jsx`**

- Implement `MessageGroup` for conversational stacking with default or compact spacing.
- Implement `Message` with avatar slot (`Blobatar` for user, `BrandMark` for assistant) and sender header.
- Implement `MessageBubble`:
  - `variant="solid"` for user turn with subtle pop-in animation.
  - `variant="soft"` for assistant turn with canvas background and hairline border.
- Implement `MessageBubbleCollapsible` for auto-clamping very long assistant responses (over 20 lines) behind a smooth *"Show more"* / *"Show less"* toggle.
- Integrate into `Chat.jsx` `Msg` component.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/message-bubble.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/agents/message.tsx frontend/src/components/agents/message-bubble.tsx frontend/src/views/Chat.jsx frontend/tests/message-bubble.test.mjs
git commit -m "feat(ui): implement beUI MessageBubble and conversational grouping in chat feed"
```

---

### Task 7: Full Suite Verification & Polishing

**Files:**
- Test all components across existing suites:
  - `npm run test:widgets`
  - `npm run test:renderers`
  - `npx oxlint`
  - `.venv/bin/pytest tests/test_agent_overhaul_regression.py`

- [ ] **Step 1: Run frontend test suites**

Run: `npm run test:widgets && npm run test:renderers`
Expected: All widget parsing and rendering tests pass.

- [ ] **Step 2: Run linter on frontend source**

Run: `npx oxlint`
Expected: Clean pass with 0 errors.

- [ ] **Step 3: Run backend regression tests**

Run: `.venv/bin/pytest tests/test_agent_overhaul_regression.py -v`
Expected: All regression scenarios pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(ui): verify full agent chat overhaul suite passes without regressions"
```
