# Agent Chat Sections & Response Overhaul Design

- **Date**: 2026-10-21
- **Status**: Draft (Approved in Brainstorming)
- **Goal**: Modernize and unify the agentic response experience in Amethyst by integrating beUI's agent component suite (`AgentActivity`, `ApprovalCard`, `CodeBlock`, `MessageBubble`, and streaming response architecture), setting OpenAI-style rich responses as the default, resolving invisible streaming text bugs, and adding an adaptive Activity Stream option in Settings.

---

## 1. Background & Problem Statement

### 1.1 Invisible Streaming Text Bug
In the previous implementation of `BlurredText` (`frontend/src/components/arc/streaming-text/blurred-text.tsx`), the default token style used:
```tsx
className = "font-satoshi text-sm text-muted-foreground/80 leading-relaxed"
```
Because `--muted-foreground` is not defined in Amethyst's `:root` CSS custom properties (the design system strictly defines `--text`, `--text-dim`, `--text-faint`, and `--canvas`), Tailwind's CSS evaluated `hsl(var(--muted-foreground) / 0.8)` to an invalid or transparent color. As a result, streamed tokens were rendered completely invisible to users.

### 1.2 Brittle Reliance on Jev for Rich Answering
Rich OpenAI-style responses (with citations, interactive cards, and structured widgets) were historically gated behind backend Jev presentation classification envelopes (`recipes`, `comparison`, `step_guide`, etc.). If Jev was skipped, failed, or resolved to plaintext, the user received an unenhanced text block. Rich features such as progressive streaming, inline citations, follow-up chips, and message action toolbars must be native to the default assistant response without requiring specialized backend routing envelopes.

### 1.3 Disparate & Outdated Sections
- **Approvals & Choices**: Question answering used `Questions` from `nexus-ui/questions.tsx` while plans used `PlanCard` in `Chat.jsx`. Both lacked consistent keyboard-first workflows, uniform spring animations, and integrated write-in support.
- **Activity Traces**: `TurnTrace.jsx` offered only **Cards** (`AgentRun`) and **Tool Chips** (`ToolChipsTrace`). Users lacked an adaptive, chronological activity stream that tracks reasoning, web searches, and file modifications in one unified disclosure.
- **Code Blocks**: `ArcCodeBlock` in `Markdown.jsx` lacked line numbers, streaming state indicators (`Writing…` -> `Ready`), and clean non-selectable gutter rows.
- **Message Feed**: Message bubbles in `Chat.jsx` were simple un-opinionated divs lacking semantic groupings, avatar slots, visual tone variants, and line-clamped collapsibles for long outputs.

---

## 2. Goals & Non-Goals

### Goals
1. **Default OpenAI-Style Answering**: Ensure 100% of assistant turns natively support smooth progressive token streaming with perfect contrast using Amethyst design tokens (`--text`, `--text-dim`, `--canvas`), inline citation pills, follow-up suggestion chips, and message action toolbars without Jev dependency.
2. **Settings Thinking Trace Option**: Add **Activity Stream** (`AgentActivity` from `agentactivity.md`) alongside **Cards** and **Tool Chips** in Settings → Appearance → *Thinking trace style*, and route `TurnTrace.jsx` accordingly.
3. **Unified Approval & Choices Card**: Implement `ApprovalCard` (`approval-card.md`) to handle both single/multi-choice questions with custom write-in answers (`ask_question`/`ask_user`) and plan review/approval gates (`awaiting_approval`).
4. **Code Block Modernization**: Upgrade `CodeBlock` (`codeblock.md`) with stable streaming line rows, unselectable line numbers, highlighted lines, and copy confirmation.
5. **Message Bubble Surface**: Implement `MessageBubble` (`messagebubble.md`) with `MessageGroup`, `MessageAvatar`, visual tones (`soft`/`solid`), and `MessageBubbleCollapsible` for long responses.

### Non-Goals
- Altering backend tool execution protocols or FastAPI endpoints (frontend will map to existing `/api/chat/answer` and tool execution streams).
- Removing the existing `Cards` or `Tool Chips` thinking trace modes (users retain full freedom of choice in Settings).
- Replacing the core application shell layout or sidebar provider (preserving panel resizers, terminal drawers, and voice mode).

---

## 3. Architecture & Component Hierarchy

```
frontend/src/
├── components/
│   ├── agents/
│   │   ├── agent-activity/
│   │   │   ├── index.tsx               # Adaptive activity stream (agentactivity.md)
│   │   │   ├── activity-row.tsx        # Individual search, step, tool, and trace rows
│   │   │   └── types.ts                # AgentActivityItem, status, and props
│   │   ├── approval-card/
│   │   │   ├── index.tsx               # Choices & approval human-in-the-loop card (approval-card.md)
│   │   │   └── types.ts                # ApprovalCardQuestion, options, status
│   │   ├── code-block.tsx              # Syntax-highlighted code surface with line numbers (codeblock.md)
│   │   ├── message-bubble.tsx          # Message bubbles, tones, groups, collapsible (messagebubble.md)
│   │   ├── message.tsx                 # Message, MessageAvatar, MessageHeader, MessageFooter
│   │   └── streaming-response.tsx      # Smooth token streaming, citations & follow-ups
│   ├── ResponseArtifactBox.jsx         # Enhanced assistant response container
│   ├── TurnTrace.jsx                   # Router for Cards vs Tool Chips vs Activity Stream
│   └── markdown/
│       └── Markdown.jsx                # Uses upgraded CodeBlock
├── views/
│   ├── Chat.jsx                        # Renders MessageGroup, Message, ApprovalCard
│   └── Settings.jsx                    # Adds 'Activity Stream' to Thinking trace style
└── store.jsx                           # thinkingStyle state ('cards' | 'chips' | 'activity')
```

---

## 4. Detailed Component Specifications

### 4.1 Component: Default OpenAI-Style Streaming & Response (`StreamingResponse.tsx` & `ResponseArtifactBox.jsx`)

#### Token Contract & Visibility Fix
Tokens will strictly use CSS custom properties from `AGENTS.md` and `frontend/src/index.css`:
- Text primary: `var(--text)`
- Text secondary / dim: `var(--text-dim)`
- Text faint / captions: `var(--text-faint)`
- Background: `var(--canvas)`
- Borders / hairlines: `var(--border)`
- Accent: `var(--accent)`

#### Live Streaming Behavior
- When `live === true` (turn is actively generating):
  - Tokens stream in progressively with a brief fade/blur transition:
    ```tsx
    initial={{ opacity: 0, filter: "blur(4px)" }}
    animate={{ opacity: 1, filter: "blur(0px)" }}
    transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
    ```
  - When `prefers-reduced-motion: reduce` is enabled, the transition is skipped entirely (`duration: 0`), rendering tokens directly.
- As sentences and blocks complete, they seamlessly resolve to full Markdown AST nodes without unmounting or cursor jumping.
- At the bottom of the response, extracted follow-up prompt chips and inline citation pills (with domain icons) render cleanly.

---

### 4.2 Component: Adaptive Activity Stream (`AgentActivity`)

#### Spec & Features
- Sits inside `TurnTrace.jsx`.
- When `thinkingStyle === 'activity'`:
  - Active Phase: Renders a shimmering header (`"Thinking…"`, `"Searching the web…"`, `"Running tools…"`) and a gliding viewport with a capped height (`maxHeight: 220px`).
  - Item Renderers:
    - **`step`**: Reasoning checkpoints with animated spinners transitioning to muted checks.
    - **`search`**: Search query row accompanied by favicon domain pills and overflow badge (e.g. `+3 more`).
    - **`tool`**: Monospace action badges (`read`, `edit`, `run`), targets, and git line change counts (`+42` in green, `-8` in red).
    - **`trace`**: Structured ledger items for thinking, subagent spawns, and verification.
  - Complete Phase: Automatically folds into a derived summary button:
    - e.g. `"Thought for 4s"`, `"Ran 3 tools"`, `"Searched the web"`.
    - Clicking the summary smoothly toggles the disclosure open/closed with spring animation.

#### Settings Toggle
In `Settings.jsx` (under *Appearance → Thinking trace style*):
```jsx
<div className="set-seg-ctrl">
  <button
    type="button"
    className={`set-seg-btn${(thinkingStyle || 'cards') === 'cards' ? ' is-active' : ''}`}
    onClick={() => setThinkingStyle?.('cards')}
  >
    Cards
  </button>
  <button
    type="button"
    className={`set-seg-btn${thinkingStyle === 'chips' ? ' is-active' : ''}`}
    onClick={() => setThinkingStyle?.('chips')}
  >
    Tool Chips
  </button>
  <button
    type="button"
    className={`set-seg-btn${thinkingStyle === 'activity' ? ' is-active' : ''}`}
    onClick={() => setThinkingStyle?.('activity')}
  >
    Activity Stream
  </button>
</div>
```

---

### 4.3 Component: Unified Approval & Choice Cards (`ApprovalCard`)

#### 1. Questions / Choice Mode (`ask_question` / `ask_user`)
- Props: `questions: ApprovalCardQuestion[]`, `status: ApprovalCardStatus`, `onSubmit: (answers) => void`, `onDismiss?: () => void`.
- Options:
  - Single choice: Auto-advancing radio cards with check indicators.
  - Multiple choice: Checkboxes with multi-select support.
  - Custom write-in: Built-in text field (`allowCustom: true`) for open-ended user feedback.
  - Navigation: Previous/Next buttons with question counter (`"1 of 3"`), Skip button, and Submit response.
  - Keyboard Navigation: Number keys (1, 2, 3...) toggle options, arrows navigate, Enter submits or advances.
- Wiring: On submit, maps to `api.answer(conversationId, answersList)`.
- Settled State: Collapses into an immutable summary card with a green checkmark and recorded selections.

#### 2. Plan & Action Approval Mode (`awaiting_approval`)
- Props: `title: string`, `description: string`, `steps: Step[]`, `onApprove: () => void`, `onRequestChanges: () => void`, `onReject: () => void`.
- Controls:
  - `"Approve and run"` (Primary button with `var(--accent)`)
  - `"Request changes"` (Ghost button opening revision input)
  - `"Discard"` (Destructive button)
- Settled State: Collapses into `"Approved. Carrying out plan."` or `"Discarded."`.

---

### 4.4 Component: Code Block (`CodeBlock`)

Replaces `ArcCodeBlock` in `Markdown.jsx`:
- **Line Numbers**: Separate gutter column with unselectable line numbers (`select-none`), ensuring code copies cleanly without line numbers.
- **Streaming State Indicator**:
  - While code is arriving (`status="streaming"`): displays a shimmering `"Writing…"` pill in the header.
  - When finished (`status="complete"`): transitions to `"Ready"` or language label.
- **Highlighted Lines**: Supports `highlightLines={[4, 5, 6]}` for focused citations.
- **Copy Feedback**: Action button with SVG icon swap and tooltip confirmation (`"Copied!"`).
- **Typography & Font**: `var(--font-mono)` with tracking and syntax token colors tailored to Amethyst dark and light modes.

---

### 4.5 Component: Message Bubbles (`MessageBubble`)

Replaces raw message blocks in `Chat.jsx`:
- **Structure**:
  ```tsx
  <MessageGroup spacing="default">
    <Message from="user">
      <MessageAvatar><Blobatar ... /></MessageAvatar>
      <MessageContent>
        <MessageHeader><span>You</span><span>{time}</span></MessageHeader>
        <MessageBubble variant="solid" animateIn>
          <MessageBubbleContent>{item.text}</MessageBubbleContent>
        </MessageBubble>
        <MessageFooter>{/* Copy, Edit, Pin */}</MessageFooter>
      </MessageContent>
    </Message>

    <Message from="assistant">
      <MessageAvatar><BrandMark ... /></MessageAvatar>
      <MessageContent>
        <MessageHeader><span>Assistant</span><span>{time}</span></MessageHeader>
        <MessageBubble variant="soft">
          <MessageBubbleContent>
            <MessageBubbleCollapsible collapsedLines={20}>
              <ResponseArtifactBox ... />
            </MessageBubbleCollapsible>
          </MessageBubbleContent>
        </MessageBubble>
        <MessageFooter>{/* Response actions toolbar */}</MessageFooter>
      </MessageContent>
    </Message>
  </MessageGroup>
  ```
- **Tones**: `variant="solid"` for user, `variant="soft"` with canvas background and hairline border for assistant.
- **Collapsible Support**: Long responses over 20 lines (or 600px height) provide a smooth *"Show more"* disclosure button.

---

## 5. Verification & Testing Plan

### Automated Verification
1. **Linter & Typecheck**:
   - Run `npx oxlint` to ensure no lint violations in new React components.
   - Run `npm run test:widgets` and `npm run test:renderers` to verify widget pipeline compatibility.
2. **Backend Regression Suite**:
   - Run `.venv/bin/pytest tests/test_agent_overhaul_regression.py tests/test_stop_and_streaming.py` to ensure tool call responses and stream formats remain unaffected.

### Manual Verification Flows
1. **Streaming Text Visibility**:
   - Send a prompt in Chat. Verify words stream in with visible, crisp typography across both light (`paper`, `sand`) and dark (`graphite`, `ink`, `nocturne`) themes.
   - Verify inline citation pills open sources correctly.
2. **Activity Stream in Settings**:
   - Open Settings → Appearance → Thinking trace style. Switch between **Cards**, **Tool Chips**, and **Activity Stream**.
   - Trigger a tool-assisted query (e.g. web search or file search). Verify `AgentActivity` displays shimmering active rows, glides to new events, and collapses to a summary upon turn completion.
3. **ApprovalCard Interaction**:
   - Trigger an `ask_question` tool event. Verify single/multi-choice radio/checkbox cards, custom text entry, and keyboard shortcuts (1-9, Enter).
   - Trigger a plan generation turn. Verify plan review cards with "Approve and run" and "Discard" actions.
4. **Code Block & Message Bubbles**:
   - Prompt the assistant to output code. Verify line numbers, "Writing…" streaming indicator, and copy button feedback.
   - Inspect user and assistant bubbles for avatars, headers, and collapsible toggles on long content.
