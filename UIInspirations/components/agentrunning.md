# Agent run

> A live AI agent run: steps stream in, tool calls expand, a diff waits for approval, and it all folds into a result.

- Type: Block
- Page: https://uiarc.dev/components/blocks/agent-run
- Markdown: https://uiarc.dev/components/blocks/agent-run/markdown

- Access: Arc Pro
- Registry id: `agent-run`
- Source file: `registry/blocks/agent-run/agent-run.tsx`
- Built from: Animated counter, Motion
- Keywords: react ai agent ui, agent run timeline, coding agent interface, human in the loop approval, ai task progress, tool call timeline

Use this to show an AI agent working on a task with approval steps. Replace the scripted run in agent-run-data.ts with events from your agent runtime.

## When to use

- Showing an AI agent working through a task with a human approval step, such as a coding agent.
- Runs where each step should stream into a timeline and a diff waits for approval before writing.

## When not to use

- Use text-stream for plain streamed text.
- Use ai-composer for the prompt input.
- Use timeline for a static list of events.

## Installation

Agent run is part of Arc Pro. The live preview is public; the source and install command need Pro.

### CLI with a Pro token

1. Create a token in your account and set it in the environment (or `.env.local`). Never commit it.

```bash
export ARC_PRO_TOKEN=arc_pro_...
```

2. Add the Pro registry to `components.json`:

```json
{
  "registries": {
    "@uiarc": "https://uiarc.dev/r/{name}.json",
    "@uiarc-pro": {
      "url": "https://uiarc.dev/r/pro/{name}.json",
      "headers": {
        "Authorization": "Bearer ${ARC_PRO_TOKEN}"
      }
    }
  }
}
```

3. Install:

```bash
npx shadcn@latest add @uiarc-pro/agent-run
```

### Manual

Signed-in Pro members can copy the source from the Manual tab on the docs page.

- Plans: https://uiarc.dev/pricing
- Create a Pro token: https://uiarc.dev/account#pro-access
- Setup guide: https://uiarc.dev/docs/ai#pro-access

## Usage

```tsx
import { AgentRun } from "@/components/arc/blocks/agent-run/agent-run";

export default function AgentTaskPage() {
  return (
    <main>
      <AgentRun />
    </main>
  );
}
```

## API reference

### AgentRun

A live view of an AI agent working through a task. Steps stream into a timeline and expand in place, a diff waits for approval before any write, and the run folds into a result with a pull request action. Takes no props; the request, steps, timing, approval gate and result are a scripted run in agent-run-data.ts, and opening the pull request is simulated.

No props.

## Accessibility

- Each step header is a disclosure button with aria-expanded and aria-controls pointing at a labelled details region.
- A polite live region announces the current step, the approval wait, pauses and the final result.
- After Approve, Reject or Retry, focus moves back to the gated step's header; Restart focuses the pause button.

## Motion

- The run starts the first time the block scrolls into view, and the clock holds while the tab is hidden.
- Steps stream in with heights that follow content on a smooth spring, and the active step title shimmers.
- Reduced motion makes height and panel changes instant.

## Responsive behavior

- Below a 480px viewport the frame padding and prompt size shrink and hit text hides.
- Step details expand in place with a ResizeObserver tracking their height.

## Performance

- The run clock uses one setInterval that holds while the tab is hidden.
- Steps are not virtualized; very long runs should collapse finished steps.

## Notes for AI

- Use to show an AI agent working on a task with a human approval step, such as a coding agent or workflow runner.
- Replace STEPS, TIMING, GATE, REQUEST and RESULT in agent-run-data.ts with events streamed from your agent runtime.
- Wire Approve, Reject and Open pull request to real actions; nothing is executed in the preview.

## Related

- [AI composer](https://uiarc.dev/components/blocks/ai-composer/markdown): A focused assistant thread where messages lift out of the composer and replies stream in.
- [Code block](https://uiarc.dev/components/code-block/markdown): Present code with legible hierarchy and copy access.
- [Timeline](https://uiarc.dev/components/timeline/markdown): Follow what happened, newest first, grouped by day.
- [Animated counter](https://uiarc.dev/components/animated-counter/markdown): Give changing totals a clear sense of movement.

## Guidance for AI tools

Blocks are complete, self-contained screens with sample data. Replace the sample data and connect the callbacks described above. Follow the declared prop types and do not invent props. Keep keyboard access, reduced motion support, and both light and dark themes intact when adapting it.

Full library index: https://uiarc.dev/llms.txt
