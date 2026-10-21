import type { ReactNode } from "react";

export type AgentActivityType = "step" | "text" | "search" | "tool" | "trace";
export type AgentActivityStatus = "working" | "complete";

export interface AgentSearchResult {
  id: string;
  title: string;
  domain: string;
  url?: string;
  icon?: ReactNode;
}

export interface AgentActivityItem {
  id: string;
  type: AgentActivityType;
  status?: "active" | "complete" | "error";
  // Step / Text
  label?: string;
  content?: string;
  meta?: string;
  // Search
  query?: string;
  results?: AgentSearchResult[];
  moreCount?: number;
  // Tool
  action?: "read" | "edit" | "run" | "tool" | string;
  target?: string;
  additions?: number;
  deletions?: number;
  // Trace
  kind?: "thinking" | "message" | "write" | "run" | "read" | string;
  detail?: string;
}

export interface AgentActivityProps {
  /** Chronological activity entries. Append or update items as events stream. */
  items: AgentActivityItem[];
  /** Expected activity kind before first streamed item arrives. */
  contentType?: AgentActivityType | "mixed";
  /** Current run phase. Active runs stay expanded. */
  status?: AgentActivityStatus;
  /** Elapsed run time in seconds. */
  duration?: number;
  /** Controlled expanded state used after run completes. */
  open?: boolean;
  /** Initial expanded state after completion. Default false. */
  defaultOpen?: boolean;
  /** Called when disclosure opens/closes. */
  onOpenChange?: (open: boolean) => void;
  /** Collapse disclosure when status changes from working to complete. Default true. */
  collapseOnComplete?: boolean;
  /** Optional label while running. */
  activeLabel?: ReactNode;
  /** Optional summary when complete. Derived from items by default. */
  summary?: ReactNode;
  /** Maximum visible height before smooth scrolling begins. Default 220. */
  maxHeight?: number;
  className?: string;
}
