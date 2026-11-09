import { Button as HouseButton } from '../../ui/bento/index.jsx'
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
import "./agent-activity.css";

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
        "agent-activity-root",
        className
      )}
    >
      {/* Header disclosure button */}
      <HouseButton
        type="button"
        onClick={toggle}
        disabled={isWorking}
        aria-expanded={isOpen}
        className="agent-activity-header"
      >
        <div className="agent-activity-header-left">
          <Sparkles
            className={cn(
              "agent-activity-sparkle",
              isWorking && "is-working"
            )}
          />
          {isWorking ? (
            <span className="agent-activity-title font-medium">
              <TextShimmer duration={1.6}>
                {activeLabel || "Agent is working…"}
              </TextShimmer>
            </span>
          ) : (
            <span className="agent-activity-title">
              {summary}
            </span>
          )}
        </div>

        {!isWorking && (
          <ChevronDown
            className={cn(
              "agent-activity-chevron",
              isOpen && "is-open"
            )}
          />
        )}
      </HouseButton>

      {/* Expandable item stream */}
      <AgentDisclosure open={isOpen}>
        <div
          ref={viewportRef}
          style={{ maxHeight: `${maxHeight}px` }}
          className="agent-activity-viewport"
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
