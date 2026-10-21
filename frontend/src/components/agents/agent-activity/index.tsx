"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { AgentActivityProps } from "./types";
import { ActivityRow } from "./activity-row";
import { AgentDisclosure } from "../agent-disclosure";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { cn } from "@/lib/utils.js";

function deriveSummary(items: AgentActivityProps["items"], duration?: number): string {
  const toolCount = items.filter((it) => it.type === "tool").length;
  const searchCount = items.filter((it) => it.type === "search").length;

  if (toolCount > 0) {
    return `Ran ${toolCount} tool${toolCount === 1 ? "" : "s"}${
      duration ? ` in ${Math.round(duration)}s` : ""
    }`;
  }
  if (searchCount > 0) {
    return `Searched the web${duration ? ` (${Math.round(duration)}s)` : ""}`;
  }
  if (duration && duration > 0) {
    return `Thought for ${Math.max(1, Math.round(duration))}s`;
  }
  return "Activity completed";
}

export function AgentActivity({
  items = [],
  status = "working",
  duration = 0,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  collapseOnComplete = true,
  activeLabel,
  summary: customSummary,
  maxHeight = 220,
  className,
}: AgentActivityProps) {
  const isWorking = status === "working";
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const wasWorkingRef = useRef(isWorking);
  const viewportRef = useRef<HTMLDivElement>(null);

  // When run completes, collapse if collapseOnComplete is enabled
  useEffect(() => {
    if (wasWorkingRef.current && !isWorking && collapseOnComplete) {
      setInternalOpen(false);
      onOpenChange?.(false);
    }
    wasWorkingRef.current = isWorking;
  }, [isWorking, collapseOnComplete, onOpenChange]);

  const isOpen = controlledOpen !== undefined ? controlledOpen : isWorking || internalOpen;

  const toggle = useCallback(() => {
    if (isWorking) return; // stays expanded while working
    const next = !isOpen;
    setInternalOpen(next);
    onOpenChange?.(next);
  }, [isWorking, isOpen, onOpenChange]);

  // Smooth scroll viewport to latest item during active work
  useEffect(() => {
    if (isWorking && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [items.length, isWorking]);

  const summary = useMemo(() => {
    return customSummary || deriveSummary(items, duration);
  }, [customSummary, items, duration]);

  if (!items || items.length === 0) return null;

  return (
    <div
      className={cn(
        "agent-activity-root my-2 w-full max-w-2xl rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden text-[var(--text)] transition-all duration-200",
        className
      )}
    >
      {/* Header disclosure button */}
      <button
        type="button"
        onClick={toggle}
        disabled={isWorking}
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition-colors select-none",
          !isWorking && "hover:bg-[var(--surface-3)] cursor-pointer"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles
            className={cn(
              "size-3.5 shrink-0 text-[var(--accent)]",
              isWorking && "animate-pulse"
            )}
          />
          {isWorking ? (
            <span className="font-medium">
              <TextShimmer duration={1.6}>
                {activeLabel || "Agent is working…"}
              </TextShimmer>
            </span>
          ) : (
            <span className="font-medium text-[var(--text-dim)] hover:text-[var(--text)]">
              {summary}
            </span>
          )}
        </div>

        {!isWorking && (
          <ChevronDown
            className={cn(
              "size-3.5 text-[var(--text-faint)] transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        )}
      </button>

      {/* Expandable item stream */}
      <AgentDisclosure open={isOpen}>
        <div
          ref={viewportRef}
          style={{ maxHeight: `${maxHeight}px` }}
          className="overflow-y-auto px-3 pb-2.5 pt-0.5 border-t border-[var(--border)] flex flex-col gap-0.5"
        >
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      </AgentDisclosure>
    </div>
  );
}

export default AgentActivity;
