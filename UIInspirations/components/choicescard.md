---
title: "Approval Card"
description: "A human-in-the-loop decision surface for approvals, single or multiple-choice questions, custom responses, and multi-step review flows."
category: "AI Agents"
publishedAt: "2026-08-01"
updatedAt: "2026-10-18"
documentation: "https://beui.dev/components/agents/approval-card"
markdown: "https://beui.dev/components/agents/approval-card.md"
license: "MIT"
---

# Approval Card

> A human-in-the-loop decision surface for approvals, single or multiple-choice questions, custom responses, and multi-step review flows.

## Install

```bash
npx shadcn@latest add @beui/approval-card
```

## Dependencies

- `clsx`
- `lucide-react`
- `motion`
- `react`
- `tailwind-merge`

## Usage

### Questions usage

Guides the user through single-choice, multiple-choice, and freeform questions before returning the completed response to the agent.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ApprovalCard,
  type ApprovalCardAnswers,
  type ApprovalCardQuestion,
  type ApprovalCardStatus,
} from "@/components/agents/approval-card";

const QUESTIONS: ApprovalCardQuestion[] = [
  {
    id: "scope",
    title: "How focused should the first release be?",
    options: [
      {
        value: "focused",
        label: "A focused starter set",
        description: "Ship a few polished pieces first.",
      },
      {
        value: "broad",
        label: "A broader collection",
        description: "Cover more ground with lighter depth.",
      },
      {
        value: "flagship",
        label: "One flagship experience",
        description: "Pour everything into a single showcase.",
      },
    ],
    allowCustom: true,
    customPlaceholder: "Describe another scope…",
  },
  {
    id: "checks",
    title: "Which checks should block publishing?",
    description: "Select every check the agent must pass before it can continue.",
    multiple: true,
    options: [
      { value: "types", label: "Type safety" },
      { value: "accessibility", label: "Accessibility" },
      { value: "registry", label: "Registry validation" },
    ],
  },
  {
    id: "preserve",
    title: "Anything the agent should preserve?",
    allowCustom: true,
    customPlaceholder: "Add a final constraint…",
  },
];

function QuestionFlow() {
  const [status, setStatus] = useState<ApprovalCardStatus>("pending");
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const submit = (_answers: ApprovalCardAnswers) => {
    setStatus("submitting");
    timer.current = window.setTimeout(() => setStatus("answered"), 750);
  };

  return (
    <ApprovalCard
      questions={QUESTIONS}
      status={status}
      onSubmit={submit}
      result="Three responses sent to the agent."
    />
  );
}

export function ApprovalCardQuestionPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[470px] w-full max-w-lg">
      <QuestionFlow key={run} />
      <button
        type="button"
        onClick={() => setRun((value) => value + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

### Review and Approve usage

Pauses an agent workflow for approval, revision, or rejection and collapses into the recorded decision.

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ApprovalCard,
  type ApprovalCardStatus,
} from "@/components/agents/approval-card";

function ReviewFlow() {
  const [status, setStatus] = useState<ApprovalCardStatus>("pending");
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const finish = (next: ApprovalCardStatus) => {
    setStatus("submitting");
    timer.current = window.setTimeout(() => setStatus(next), 700);
  };

  return (
    <ApprovalCard
      title="Publish the component update?"
      description="The agent has prepared the release and is waiting for your decision."
      status={status}
      onApprove={() => finish("approved")}
      onRequestChanges={() => finish("changes-requested")}
      onReject={() => finish("rejected")}
      result={
        status === "approved"
          ? "Publishing was approved."
          : status === "changes-requested"
            ? "The agent will wait for revision notes."
            : "Publishing was declined."
      }
    >
      <dl className="grid gap-1 text-xs">
        <div className="flex items-center justify-between gap-4 py-1">
          <dt className="text-muted-foreground">Release</dt>
          <dd className="font-mono text-foreground/80">approval-card</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-1">
          <dt className="text-muted-foreground">Checks</dt>
          <dd className="text-foreground/80">4 passed</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-1">
          <dt className="text-muted-foreground">Visibility</dt>
          <dd className="text-foreground/80">Public registry</dd>
        </div>
      </dl>
    </ApprovalCard>
  );
}

export function ApprovalCardReviewPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[360px] w-full max-w-lg">
      <ReviewFlow key={run} />
      <button
        type="button"
        onClick={() => setRun((value) => value + 1)}
        className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3" />
        Replay
      </button>
    </div>
  );
}
```

## API Reference

### ApprovalCard

| Prop | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `title` | `ReactNode` | `Approval required` | No | — |
| `description` | `ReactNode` | — | No | — |
| `questions` | `ApprovalCardQuestion[]` | `[]` | No | — |
| `status` | `"pending" \| "submitting" \| "approved" \| "rejected" \| "changes-requested" \| "answered"` | `pending` | No | — |
| `answers` | `ApprovalCardAnswers` | — | No | — |
| `defaultAnswers` | `ApprovalCardAnswers` | `{}` | No | — |
| `onAnswersChange` | `((answers: ApprovalCardAnswers) => void)` | — | No | — |
| `step` | `number` | — | No | — |
| `defaultStep` | `number` | `0` | No | — |
| `onStepChange` | `((step: number) => void)` | — | No | — |
| `onSubmit` | `((answers: ApprovalCardAnswers) => void)` | — | No | — |
| `onApprove` | `(() => void)` | — | No | — |
| `onReject` | `(() => void)` | — | No | — |
| `onRequestChanges` | `(() => void)` | — | No | — |
| `onDismiss` | `(() => void)` | — | No | — |
| `approveLabel` | `ReactNode` | `Approve` | No | — |
| `submitLabel` | `ReactNode` | `Submit response` | No | — |
| `result` | `ReactNode` | — | No | — |
| `className` | `string` | — | No | — |

## About Approval Card

Approval Card is a human in the loop component for React AI agents. It asks a person to approve, reject or request changes to a proposed action, or to answer questions with single choice, multiple choice or freeform input, including multi-step question flows. Single choices advance to the next question automatically, steps slide between each other with Framer Motion, and once a decision is made the card collapses into a short outcome summary.

### When to use it

- A coding or operations agent needs sign off before deploying, deleting data or sending email.
- An agent is unsure which option the user wants and asks a clarifying question before it continues.
- A setup or planning flow collects a few structured answers in sequence before an agent starts work.

### Accessibility

Single choice questions render as a radio group with radio roles, multiple choice questions as checkboxes, and allowCustom adds a text input. Multi-step flows have labeled Previous question and Next question buttons and a visually hidden "Question 1 of 3" counter. The card is marked aria-busy while submitting, and after a decision the controls are hidden from assistive technology and made inert. With reduced motion enabled, question changes swap without sliding and the loading spinner stops.

### FAQ

**How do I add human in the loop approval to an AI agent in React?**

Render ApprovalCard with a title and description and pass onApprove. Add onReject or onRequestChanges to show those buttons, and set status to approved, rejected or changes-requested once the decision is made.

**How do I ask the user a question with options?**

Pass a questions array. Each question has an id, a title and options, and can set multiple for checkboxes, allowCustom for a freeform field, and autoAdvance false to stop single choices from advancing. onSubmit receives all answers.

**Can I control the answers and step?**

Yes. answers with onAnswersChange and step with onStepChange make it controlled, or use defaultAnswers and defaultStep. The result prop sets the summary shown after completion.

## React Native

A React Native version ships in beUI Native. The detail JSON has every file to copy.

```bash
npx expo install react-native-gesture-handler react-native-reanimated react-native-svg react-native-worklets
npm install uniwind tailwindcss
```

- Native detail: https://beui.dev/native/r/approval-card
- Try it in Expo Go: exp://u.expo.dev/93a3a95c-6dc2-4adb-b57c-efbecf859f25/--/approval-card?runtime-version=exposdk%3A57.0.0&channel-name=production
- GitHub: https://github.com/starc007/beui-native/tree/main/src/components/approval-card

## Source

- Registry detail: https://beui.dev/r/approval-card
- Raw source: https://beui.dev/r/approval-card/raw
- GitHub: https://github.com/starc007/ui-components


