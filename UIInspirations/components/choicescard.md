---
title: "Code Block"
description: "A syntax-highlighted code surface with stable streaming updates, line numbers, focused lines, smooth following, and copy feedback."
category: "AI Agents"
publishedAt: "2026-08-02"
updatedAt: "2026-10-18"
documentation: "https://beui.dev/components/agents/code-block"
markdown: "https://beui.dev/components/agents/code-block.md"
license: "MIT"
---

# Code Block

> A syntax-highlighted code surface with stable streaming updates, line numbers, focused lines, smooth following, and copy feedback.

## Install

```bash
npx shadcn@latest add @beui/code-block
```

## Dependencies

- `ai`
- `clsx`
- `lucide-react`
- `motion`
- `react`
- `shiki`
- `tailwind-merge`

## Usage

```tsx
"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CodeBlock } from "@/components/agents/code-block";

const LINES = [
  'import { generateText } from "ai";',
  "",
  "export async function summarize(input: string) {",
  "  const { text } = await generateText({",
  '    model: "openai/gpt-5",',
  `    prompt: \`Summarize this clearly: \${input}\`,`,
  "  });",
  "",
  "  return {",
  "    text,",
  "    generatedAt: new Date().toISOString(),",
  "  };",
  "}",
];

function StreamingCodeBlock() {
  const [visibleLines, setVisibleLines] = useState(1);
  const timer = useRef<number | undefined>(undefined);
  const complete = visibleLines === LINES.length;

  useEffect(() => {
    if (visibleLines >= LINES.length) return;
    timer.current = window.setTimeout(
      () => setVisibleLines((value) => value + 1),
      260,
    );
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [visibleLines]);

  return (
    <CodeBlock
      filename="summarize.ts"
      language="typescript"
      code={LINES.slice(0, visibleLines).join("\n")}
      status={complete ? "complete" : "streaming"}
      highlightLines={[4, 5, 6, 7]}
      maxHeight={224}
    />
  );
}

export function CodeBlockPreview() {
  const [run, setRun] = useState(0);

  return (
    <div className="relative h-[340px] w-full max-w-xl">
      <StreamingCodeBlock key={run} />
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

### CodeBlock

| Prop | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `code` | `string` | — | Yes | — |
| `language` | `"text" \| "bash" \| "diff" \| "json" \| "tsx" \| "typescript"` | `typescript` | No | — |
| `filename` | `ReactNode` | — | No | — |
| `status` | `"complete" \| "streaming"` | `complete` | No | — |
| `showLineNumbers` | `boolean` | `true` | No | — |
| `highlightLines` | `number[]` | `[]` | No | — |
| `maxHeight` | `number` | `280` | No | — |
| `wrap` | `boolean` | `false` | No | — |
| `copyable` | `boolean` | `true` | No | — |
| `onCopy` | `(() => void \| Promise<void>)` | — | No | — |
| `className` | `string` | — | No | — |

## About Code Block

Code Block is a syntax highlighted code viewer for AI chat and agent interfaces in React. It highlights with Shiki, keeps line rows stable while code streams in, follows the newest lines inside a capped height, and switches from a Writing badge to Ready when the code is complete. It supports line numbers, highlighted lines, a filename, wrapping and a copy button with confirmation feedback.

### When to use it

- An AI coding assistant writes a function into the chat and the reader watches it arrive line by line.
- An agent response cites a specific part of a file and needs to highlight those lines.
- A chat app shows a shell command or JSON payload the user can copy in one click.

### Accessibility

While streaming, the container is marked aria-busy and the code viewport becomes a polite log region, and both return to normal when the code is complete. The copy button is labeled "Copy code" and changes to "Copied" after copying, and line numbers cannot be selected, so manual copying takes only code. With reduced motion enabled, the streaming spinner stops and auto following jumps instead of scrolling smoothly.

### FAQ

**How do I show streaming code from an LLM in React?**

Pass the code received so far to the code prop with status set to streaming, then switch status to complete when the response ends. Rows stay in place as lines are added.

**Which languages are highlighted?**

The language prop accepts typescript, tsx, json, bash, diff and text, and defaults to typescript.

**Can I change what copy does?**

Yes. Pass onCopy to replace the default clipboard write, or set copyable to false to hide the button. highlightLines takes line numbers to emphasize.

## React Native

A React Native version ships in beUI Native. The detail JSON has every file to copy.

```bash
npx expo install prism-react-renderer react-native-reanimated react-native-svg react-native-worklets
npm install uniwind tailwindcss
```

- Native detail: https://beui.dev/native/r/code-block
- Try it in Expo Go: exp://u.expo.dev/93a3a95c-6dc2-4adb-b57c-efbecf859f25/--/code-block?runtime-version=exposdk%3A57.0.0&channel-name=production
- GitHub: https://github.com/starc007/beui-native/tree/main/src/components/code-block

## Source

- Registry detail: https://beui.dev/r/code-block
- Raw source: https://beui.dev/r/code-block/raw
- GitHub: https://github.com/starc007/ui-components
