---
title: "Chat App"
description: "A complete agent conversation workspace composing navigation, messages, streaming, planning, approvals, tools, code, diffs, generated media, sources, and prompt input."
category: "AI Agents"
publishedAt: "2026-08-02"
updatedAt: "2026-10-18"
documentation: "https://beui.dev/components/agents/chat-app"
markdown: "https://beui.dev/components/agents/chat-app.md"
license: "MIT"
---

# Chat App

> A complete agent conversation workspace composing navigation, messages, streaming, planning, approvals, tools, code, diffs, generated media, sources, and prompt input.

## Install

```bash
npx shadcn@latest add @beui/chat-app
```

## Dependencies

- `clsx`
- `lucide-react`
- `motion`
- `react`
- `react-dom`
- `shiki`
- `tailwind-merge`

## Usage

```tsx
"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatAppExample } from "@/components/previews/agents/chat-app-usage";
import { ActionSwapIcon } from "@/components/motion/action-swap";
import { cn } from "@/lib/utils";

export function ChatAppPreview() {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const container = containerRef.current;
    if (!container) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const isolated: Array<{
      element: HTMLElement;
      inert: boolean;
      ariaHidden: string | null;
    }> = [];
    let branch: HTMLElement = container;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        isolated.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute("aria-hidden"),
        });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      }
      if (parent === document.body) break;
      branch = parent;
    }

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.inert && element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        container.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() =>
      toggleRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      for (const { element, inert, ariaHidden } of isolated) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      requestAnimationFrame(() =>
        toggleRef.current?.focus({ preventScroll: true }),
      );
    };
  }, [expanded]);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal={expanded || undefined}
      aria-label="Chat app preview"
      tabIndex={expanded ? -1 : undefined}
      className={cn(
        "relative w-full bg-background px-0 py-2 sm:p-3",
        expanded &&
          "fixed inset-0 z-[100] h-dvh overscroll-contain p-3 sm:p-4",
      )}
    >
      <button
        ref={toggleRef}
        type="button"
        onClick={toggleExpanded}
        aria-label={expanded ? "Exit expanded preview" : "Expand preview"}
        title={expanded ? "Exit expanded preview" : "Expand preview"}
        className="absolute top-5 right-24 z-50 grid size-10 place-items-center rounded-full border border-border/80 bg-background/90 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ActionSwapIcon
          value={expanded ? "minimize" : "maximize"}
          animation="blur"
        >
          {expanded ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </ActionSwapIcon>
      </button>
      <ChatAppExample className={expanded ? "h-full" : undefined} />
    </div>
  );
}
```

## API Reference

### ChatApp

| Prop | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `sidebarWidth` | `string` | `17rem` | No | Docked sidebar width as a CSS length. Default `17rem`. |
| `collapseSidebarBelow` | `number` | `600` | No | Shell width in px under which the sidebar folds off-canvas. Ignored while `open` is controlled — the consumer owns the state then. |
| `open` | `boolean` | — | No | — |
| `defaultOpen` | `boolean` | — | No | — |
| `onOpenChange` | `((open: boolean) => void)` | — | No | — |
| `openMobile` | `boolean` | — | No | — |
| `defaultOpenMobile` | `boolean` | — | No | — |
| `onOpenMobileChange` | `((open: boolean) => void)` | — | No | — |
| `style` | `SidebarProviderStyle` | — | No | — |
| `className` | `string` | — | No | — |

## About Chat App

Chat App is a complete AI agent chat workspace for React. ChatApp is the shell: it wraps the Animated Sidebar provider, sets the sidebar width, and folds the sidebar off-canvas when its own box gets too narrow for two panes. Its usage example composes the rest of the beUI agent kit around it, including the AI Sidebar, message scroller, messages, streaming responses, agent activity, todo plans, approvals, tool results, code blocks, file diffs, generated images and the prompt input. Everything is built with Framer Motion and Tailwind CSS.

### When to use it

- You are starting an AI chat product and want a working layout with navigation, conversation and composer already in place.
- A coding agent dashboard needs tool calls, approvals and file diffs shown inside one conversation.
- A chat panel embedded in a larger page or split view should hide its sidebar when the panel is narrow, not only on phones.

### Accessibility

ChatApp inherits the Animated Sidebar's behavior: Cmd+B or Ctrl+B toggles the sidebar, and on phone-sized viewports the sidebar opens as a modal dialog that closes with Escape. Each composed part keeps its own semantics, such as the AI Sidebar's keyboard tree, live regions in streaming responses and tool output, and labelled disclosures. With reduced motion enabled, the sidebar uses reduced transitions and each composed part follows its own reduced-motion rules.

### FAQ

**How do I build a full AI chat interface in React?**

Install chat-app with the shadcn CLI, which brings the agent components it uses along with a usage example. Wrap your AnimatedSidebar and AnimatedSidebarInset in ChatApp, then place messages, responses and the prompt input inside the inset.

**Can I control when the sidebar collapses?**

Yes. collapseSidebarBelow sets the shell width in pixels under which the sidebar folds away (600 by default), and sidebarWidth sets its docked width (17rem by default). Passing open with onOpenChange makes the state fully yours and turns the automatic fitting off.

**Does it work with Next.js?**

Yes. The components are client components that render in the Next.js App Router. They take plain props such as status and children, so you can drive them from any streaming backend.

## Source

- Registry detail: https://beui.dev/r/chat-app
- Raw source: https://beui.dev/r/chat-app/raw
- GitHub: https://github.com/starc007/ui-components
