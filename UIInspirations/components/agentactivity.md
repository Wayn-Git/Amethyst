---
title: "Agent Activity"
description: "One adaptive activity stream for reasoning, searches, tool calls, structured execution traces, or a chronological mix."
category: "AI Agents"
publishedAt: "2026-08-01"
updatedAt: "2026-10-18"
documentation: "https://beui.dev/components/agents/agent-activity"
markdown: "https://beui.dev/components/agents/agent-activity.md"
license: "MIT"
---

# Agent Activity

> One adaptive activity stream for reasoning, searches, tool calls, structured execution traces, or a chronological mix.

## Install

```bash
npx shadcn@latest add @beui/agent-activity
```

## Dependencies

- `clsx`
- `lucide-react`
- `motion`
- `react`
- `tailwind-merge`

## Usage

### Streaming Text usage

Streams freeform reasoning text into the capped viewport and keeps the completed log available behind a timed disclosure.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import {
  AgentActivity,
  type AgentActivityItem,
} from "@/components/agents/agent-activity";

const REASONING = [
  "Reading the request and separating the content model from its presentation.",
  "The activity shell can stay consistent while each event supplies its own compact renderer.",
  "Text remains freeform so partial tokens can update without recreating the surrounding timeline.",
  "As each sentence wraps, the measured stream moves upward through a single transform instead of repeatedly jumping the native scroll position.",
  "Older context stays available above the fold while the newest tokens remain crisp at the bottom edge.",
  "Once the run finishes, the viewport switches from automatic following to ordinary user-controlled scrolling.",
  "Opening the completed disclosure returns to the beginning so the reasoning can be read in order.",
  "The capped viewport follows the latest sentence and preserves the full log after completion.",
].join("\n");

const CHARACTERS_PER_SECOND = 90;
const STREAM_SECONDS = REASONING.length / CHARACTERS_PER_SECOND;

function StreamingTextDemo() {
  const reduce = useReducedMotion() ?? false;
  const [stream, setStream] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (reduce) {
      setStream(REASONING);
      setComplete(true);
      return;
    }

    const startedAt = performance.now();
    let frame = 0;
    let completionTimer: number | undefined;

    const streamNextFrame = (now: number) => {
      const cursor = Math.min(
        REASONING.length,
        Math.floor(((now - startedAt) / 1000) * CHARACTERS_PER_SECOND),
      );
      const next = REASONING.slice(0, cursor);
      setStream((current) => (current === next ? current : next));

      if (cursor === REASONING.length) {
        completionTimer = window.setTimeout(() => setComplete(true), 500);
      } else {
        frame = requestAnimationFrame(streamNextFrame);
      }
    };

    frame = requestAnimationFrame(streamNextFrame);
    return () => {
      cancelAnimationFrame(frame);
      if (completionTimer) window.clearTimeout(completionTimer);
    };
  }, [reduce]);

  const items: AgentActivityItem[] = stream
    .split("\n")
    .filter(Boolean)
    .map((content, index) => ({
      id: `reasoning-${index}`,
      type: "text",
      content,
    }));

  return (
    <AgentActivity
      items={items}
      contentType="text"
      status={complete ? "complete" : "working"}
      duration={STREAM_SECONDS}
      defaultOpen={reduce}
      collapseOnComplete={!reduce}
      maxHeight={180}
    />
  );
}

export function AgentActivityTextPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[330px] w-full max-w-lg">
      <StreamingTextDemo key={run} />
      <button
        type="button"
        onClick={() => setRun((current) => current + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

### Reasoning Steps usage

Shows completed, active, and pending reasoning steps with optional trailing metadata.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AgentActivity } from "@/components/agents/agent-activity";

const STEPS = [
  { id: "brief", label: "Reading the product brief" },
  { id: "patterns", label: "Mapping the interaction patterns" },
  {
    id: "states",
    label: "Connecting the loading and completion states",
    meta: "3 states",
  },
  { id: "verify", label: "Verifying the final behavior" },
];

function StepsDemo() {
  const reduce = useReducedMotion() ?? false;
  const [visible, setVisible] = useState(reduce ? STEPS.length : 1);
  const [settled, setSettled] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (reduce) {
      setVisible(STEPS.length);
      setSettled(true);
      setComplete(true);
      return;
    }

    const stepTimers = STEPS.slice(1).map((_, index) =>
      window.setTimeout(() => setVisible(index + 2), 850 + index * 800),
    );
    const settleTimer = window.setTimeout(() => setSettled(true), 3300);
    const completeTimer = window.setTimeout(() => setComplete(true), 4200);
    return () => {
      stepTimers.forEach(window.clearTimeout);
      window.clearTimeout(settleTimer);
      window.clearTimeout(completeTimer);
    };
  }, [reduce]);

  return (
    <AgentActivity
      status={complete ? "complete" : "working"}
      contentType="step"
      duration={4.2}
      defaultOpen={reduce}
      collapseOnComplete={!reduce}
      maxHeight={220}
      items={STEPS.slice(0, visible).map((step, index) => ({
        ...step,
        type: "step" as const,
        status:
          settled || index < visible - 1
            ? ("complete" as const)
            : ("active" as const),
      }))}
    />
  );
}

export function AgentActivityStepsPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[330px] w-full max-w-lg">
      <StepsDemo key={run} />
      <button
        type="button"
        onClick={() => setRun((current) => current + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

### Web Search usage

Presents a search query, progressively rendered result rows, and an overflow count.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import {
  AgentActivity,
  type AgentSearchResult,
} from "@/components/agents/agent-activity";

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="currentColor"
    >
      <path d="M21.35 12.23c0-.65-.06-1.28-.17-1.89H12v3.79h5.25a4.5 4.5 0 0 1-1.95 2.87v2.46h3.16c1.85-1.71 2.89-4.22 2.89-7.23Z" />
      <path d="M12 21.75c2.64 0 4.86-.87 6.46-2.29L15.3 17c-.87.58-1.98.92-3.3.92a5.7 5.7 0 0 1-5.35-3.93H3.39v2.54A9.75 9.75 0 0 0 12 21.75Z" />
      <path d="M6.65 13.99A5.85 5.85 0 0 1 6.34 12c0-.69.12-1.36.31-1.99V7.47H3.39A9.76 9.76 0 0 0 2.25 12c0 1.63.39 3.18 1.14 4.53l3.26-2.54Z" />
      <path d="M12 6.08c1.44 0 2.73.49 3.75 1.47l2.78-2.78A9.34 9.34 0 0 0 12 2.25a9.75 9.75 0 0 0-8.61 5.22l3.26 2.54A5.7 5.7 0 0 1 12 6.08Z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="currentColor"
    >
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0 1 12 6.82c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

function WikipediaMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="currentColor"
    >
      <path d="M1.5 4h6v1.2H6l4.08 10.73 1.26-3.12L8.45 5.2H7.2V4h6v1.2h-1.47l1.66 4.57 1.82-4.57H13.8V4h4.9v1.2h-1.45l-3.19 7.92 1.08 2.81L19.48 5.2H18V4h4.5v1.2h-1.42L15.25 20h-1.2l-1.91-4.86L10.18 20H8.92L3.25 5.2H1.5V4Z" />
    </svg>
  );
}

function VercelMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="currentColor"
    >
      <path d="m12 3 10 18H2L12 3Z" />
    </svg>
  );
}

const SEARCH_RESULTS: AgentSearchResult[] = [
  {
    id: "google",
    title: "Google for Developers",
    domain: "developers.google.com",
    icon: <GoogleMark />,
  },
  {
    id: "github",
    title: "GitHub",
    domain: "github.com",
    icon: <GitHubMark />,
  },
  {
    id: "wikipedia",
    title: "Wikipedia",
    domain: "wikipedia.org",
    icon: <WikipediaMark />,
  },
  {
    id: "vercel",
    title: "Vercel Docs",
    domain: "vercel.com/docs",
    icon: <VercelMark />,
  },
];

function SearchDemo() {
  const reduce = useReducedMotion() ?? false;
  const [visible, setVisible] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (reduce) {
      setVisible(SEARCH_RESULTS.length);
      setComplete(true);
      return;
    }

    const resultTimers = SEARCH_RESULTS.map((_, index) =>
      window.setTimeout(() => setVisible(index + 1), 650 + index * 650),
    );
    const completeTimer = window.setTimeout(() => setComplete(true), 3900);
    return () => {
      resultTimers.forEach(window.clearTimeout);
      window.clearTimeout(completeTimer);
    };
  }, [reduce]);

  return (
    <AgentActivity
      status={complete ? "complete" : "working"}
      contentType="search"
      defaultOpen={reduce}
      collapseOnComplete={!reduce}
      maxHeight={220}
      items={[
        {
          id: "search",
          type: "search",
          query: "accessible animation patterns for React",
          results: SEARCH_RESULTS.slice(0, visible),
          moreCount: visible === SEARCH_RESULTS.length ? 7 : undefined,
        },
      ]}
    />
  );
}

export function AgentActivitySearchPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[330px] w-full max-w-lg">
      <SearchDemo key={run} />
      <button
        type="button"
        onClick={() => setRun((current) => current + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

### Tool Calls usage

Summarizes read, edit, and run events with monospace targets and optional line-change counts.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import {
  AgentActivity,
  type AgentActivityItem,
} from "@/components/agents/agent-activity";

const TOOLS: AgentActivityItem[] = [
  {
    id: "read",
    type: "tool",
    action: "read",
    target: "campaign-notes.md",
  },
  {
    id: "edit",
    type: "tool",
    action: "edit",
    target: "launch-plan.ts",
    additions: 42,
    deletions: 8,
  },
  {
    id: "run",
    type: "tool",
    action: "run",
    target: "bun test launch",
  },
];

function ToolsDemo() {
  const reduce = useReducedMotion() ?? false;
  const [visible, setVisible] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (reduce) {
      setVisible(TOOLS.length);
      setComplete(true);
      return;
    }

    const toolTimers = TOOLS.map((_, index) =>
      window.setTimeout(() => setVisible(index + 1), 550 + index * 850),
    );
    const completeTimer = window.setTimeout(() => setComplete(true), 3600);
    return () => {
      toolTimers.forEach(window.clearTimeout);
      window.clearTimeout(completeTimer);
    };
  }, [reduce]);

  return (
    <AgentActivity
      status={complete ? "complete" : "working"}
      contentType="tool"
      defaultOpen={reduce}
      collapseOnComplete={!reduce}
      maxHeight={220}
      items={TOOLS.slice(0, visible)}
    />
  );
}

export function AgentActivityToolsPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[330px] w-full max-w-lg">
      <ToolsDemo key={run} />
      <button
        type="button"
        onClick={() => setRun((current) => current + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

### Mixed Activity usage

Streams reasoning, search, and tool events in one chronological run while the viewport smoothly follows new work.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import {
  AgentActivity,
  type AgentActivityItem,
} from "@/components/agents/agent-activity";

const ACTIVE_BRIEF: AgentActivityItem = {
  id: "brief",
  type: "step",
  label: "Reading the launch brief",
  status: "active",
};

const COMPLETE_BRIEF: AgentActivityItem = {
  ...ACTIVE_BRIEF,
  status: "complete",
};

const PENDING_SEARCH: AgentActivityItem = {
  id: "search",
  type: "search",
  query: "independent coffee roasters in Portland",
  results: [],
};

const COMPLETE_SEARCH: AgentActivityItem = {
  ...PENDING_SEARCH,
  results: [
    { id: "heart", title: "Heart Coffee", domain: "heartroasters.com" },
    {
      id: "coava",
      title: "Coava Coffee",
      domain: "coavacoffee.com",
    },
    {
      id: "upper-left",
      title: "Upper Left Roasters",
      domain: "upperleftroasters.com",
    },
  ],
  moreCount: 5,
};

const READ_TOOL: AgentActivityItem = {
  id: "read",
  type: "tool",
  action: "read",
  target: "campaign-notes.md",
};

const ACTIVITY_FRAMES: AgentActivityItem[][] = [
  [ACTIVE_BRIEF],
  [COMPLETE_BRIEF, PENDING_SEARCH],
  [COMPLETE_BRIEF, COMPLETE_SEARCH],
  [COMPLETE_BRIEF, COMPLETE_SEARCH, READ_TOOL],
  [
    COMPLETE_BRIEF,
    COMPLETE_SEARCH,
    READ_TOOL,
    {
      id: "edit",
      type: "tool",
      action: "edit",
      target: "launch-plan.ts",
      additions: 42,
      deletions: 8,
    },
    { id: "run", type: "tool", action: "run", target: "bun test launch" },
    {
      id: "verify",
      type: "step",
      label: "Checking the final campaign plan",
      status: "complete",
    },
  ],
];

function ActivityDemo() {
  const reduce = useReducedMotion() ?? false;
  const [frame, setFrame] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (reduce) {
      setFrame(ACTIVITY_FRAMES.length - 1);
      setComplete(true);
      return;
    }

    const timers = ACTIVITY_FRAMES.slice(1).map((_, index) =>
      window.setTimeout(() => setFrame(index + 1), 850 + index * 1050),
    );
    const finalFrameAt = 850 + (ACTIVITY_FRAMES.length - 2) * 1050;
    const completeTimer = window.setTimeout(
      () => setComplete(true),
      finalFrameAt + 900,
    );
    return () => {
      timers.forEach(window.clearTimeout);
      window.clearTimeout(completeTimer);
    };
  }, [reduce]);

  return (
    <AgentActivity
      items={ACTIVITY_FRAMES[frame]}
      status={complete ? "complete" : "working"}
      duration={5.1}
      defaultOpen={reduce}
      collapseOnComplete={!reduce}
      maxHeight={220}
    />
  );
}

export function AgentActivityMixedPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[330px] w-full max-w-xl">
      <ActivityDemo key={run} />
      <button
        type="button"
        onClick={() => setRun((current) => current + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

### Agent Trace usage

Streams messages and structured actions into a compact execution ledger, then summarizes the completed run by tool-call and message counts.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import {
  AgentActivity,
  type AgentActivityItem,
} from "@/components/agents/agent-activity";

const TRACE_ITEMS: AgentActivityItem[] = [
  {
    id: "plan",
    type: "trace",
    kind: "thinking",
    label: "Thinking",
    detail: "Mapping the interaction flow…",
  },
  {
    id: "decision",
    type: "trace",
    kind: "message",
    label: "Decision",
    detail: "Use one compact disclosure",
  },
  {
    id: "write",
    type: "trace",
    kind: "write",
    label: "Draft component",
    detail: "components/agents/run-log.tsx",
  },
  {
    id: "verify",
    type: "trace",
    kind: "run",
    label: "Validate types",
    detail: "bun run typecheck",
  },
  {
    id: "inspect",
    type: "trace",
    kind: "read",
    label: "Inspect preview",
    detail: "activity-preview.png",
  },
];

function AgentTraceDemo() {
  const reduce = useReducedMotion() ?? false;
  const [visible, setVisible] = useState(reduce ? TRACE_ITEMS.length : 0);
  const [complete, setComplete] = useState(reduce);

  useEffect(() => {
    if (reduce) return;

    const timers = TRACE_ITEMS.map((_, index) =>
      window.setTimeout(() => setVisible(index + 1), 250 + index * 650),
    );
    timers.push(
      window.setTimeout(
        () => setComplete(true),
        250 + TRACE_ITEMS.length * 650,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [reduce]);

  return (
    <AgentActivity
      items={TRACE_ITEMS.slice(0, visible)}
      contentType="trace"
      status={complete ? "complete" : "working"}
      activeLabel="Running the agent trace…"
      defaultOpen={reduce}
      collapseOnComplete={!reduce}
      maxHeight={190}
    />
  );
}

export function AgentTracePreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[300px] w-full max-w-xl">
      <AgentTraceDemo key={run} />
      <button
        type="button"
        onClick={() => setRun((value) => value + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

## API Reference

### AgentActivity

| Prop | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `items` | `AgentActivityItem[]` | — | Yes | Chronological activity entries. Append or update items as events stream. |
| `contentType` | `"step" \| "text" \| "search" \| "tool" \| "trace" \| "mixed"` | — | No | Expected activity kind before the first streamed item arrives. |
| `status` | `"working" \| "complete"` | `working` | No | Current run phase. Active runs always stay expanded. |
| `duration` | `number` | `0` | No | Elapsed run time, in seconds. Used by the step-only summary. |
| `open` | `boolean` | — | No | Controlled expanded state used after the run completes. |
| `defaultOpen` | `boolean` | `false` | No | Initial expanded state used after the run completes. |
| `onOpenChange` | `((open: boolean) => void)` | — | No | Called when the completed activity disclosure changes state. |
| `collapseOnComplete` | `boolean` | `true` | No | Collapse the disclosure when status changes from working to complete. |
| `activeLabel` | `ReactNode` | — | No | Optional label shown while the run is active. |
| `summary` | `ReactNode` | — | No | Optional completed summary. Derived from the item types by default. |
| `renderWorkingStatus` | `((context: { label: ReactNode; duration: number; }) => ReactNode)` | — | No | Optional renderer for the contents of the active status row. |
| `renderCompletedStatus` | `((context: { summary: ReactNode; duration: number; }) => ReactNode)` | — | No | Optional renderer for the contents before the built-in disclosure chevron. |
| `maxHeight` | `number` | `208` | No | Maximum visible activity height before the stream begins gliding. |
| `className` | `string` | — | No | — |
| `contentClassName` | `string` | — | No | — |

## About Agent Activity

Agent Activity is a React disclosure that shows what an AI agent is doing while it works: reasoning steps, plain text, web searches with results, tool calls with addition and deletion counts, and structured execution traces, alone or mixed in order. While the run is active it shows a shimmering status line above a capped viewport that glides to the newest entry. When the run completes it collapses to a derived summary such as "Thought for 12s", "Searched the web" or "Ran 3 tools" that can be reopened. It is built with Framer Motion and Tailwind CSS.

### When to use it

- A reasoning model streams its thinking steps and the chat should show progress without a wall of text.
- A research agent searches the web and readers want to see the queries and pages it visited.
- A coding agent reads, edits and runs files, and each turn should end with a compact summary of the tools it ran.

### Accessibility

While working, the header has the status role, so the active label is announced; once complete it becomes a button with aria-expanded and aria-controls that opens a labelled region. Entries render as a list with listitem roles, the root sets aria-busy during the run, and collapsed content is hidden and inert. With reduced motion enabled, the shimmer stops, entries appear without sliding, the stream jumps to the newest entry instead of gliding, and the disclosure opens instantly.

### FAQ

**How do I show AI agent reasoning steps in React?**

Pass AgentActivity an items array where each entry has an id and a type of "step", "text", "search", "tool" or "trace". Append items as events stream, set status to "working" and then "complete", and pass duration in seconds for the "Thought for" summary.

**Can I change the status and summary text?**

Yes. activeLabel replaces the working label and summary replaces the derived completed summary. For full control, renderWorkingStatus and renderCompletedStatus render the contents of each header yourself.

**Can the activity stay open after the run finishes?**

Set collapseOnComplete to false, or control the completed state with open and onOpenChange (or defaultOpen). The activity always stays expanded while working, and maxHeight sets how tall the viewport grows before the stream starts gliding.

## React Native

A React Native version ships in beUI Native. The detail JSON has every file to copy.

```bash
npx expo install react-native-reanimated react-native-svg react-native-worklets
npm install uniwind tailwindcss
```

- Native detail: https://beui.dev/native/r/agent-activity
- Try it in Expo Go: exp://u.expo.dev/93a3a95c-6dc2-4adb-b57c-efbecf859f25/--/agent-activity?runtime-version=exposdk%3A57.0.0&channel-name=production
- GitHub: https://github.com/starc007/beui-native/tree/main/src/components/agent-activity

## Source

- Registry detail: https://beui.dev/r/agent-activity
- Raw source: https://beui.dev/r/agent-activity/raw
- GitHub: https://github.com/starc007/ui-components
