"use client";

import type React from "react";
import { Check, Search, Terminal, FileCode, Eye, Globe, Brain } from "lucide-react";
import type { AgentActivityItem } from "./types";
import { cn } from "@/lib/utils.js";

export function ActivityRow({ item }: { item: AgentActivityItem }) {
  if (item.type === "step") {
    const isWorking = item.status === "active";
    return (
      <div className="activity-row">
        <span className="activity-row-icon-wrap">
          {isWorking ? (
            <span className="activity-spinner" />
          ) : (
            <Check className="size-3.5 text-[var(--live)]" strokeWidth={2.5} />
          )}
        </span>
        <span className="truncate font-medium">{item.label || item.content}</span>
        {item.meta && (
          <span className="ml-auto font-mono text-[11px] text-[var(--text-faint)]">
            {item.meta}
          </span>
        )}
      </div>
    );
  }

  if (item.type === "search") {
    return (
      <div className="flex flex-col gap-1 py-1 text-[12px]">
        <div className="flex items-center gap-2 text-[var(--text-dim)]">
          <Search className="size-3.5 shrink-0 text-[var(--text-faint)]" />
          <span className="font-medium text-[var(--text)]">{item.query}</span>
        </div>
        {item.results && item.results.length > 0 && (
          <div className="activity-search-chips">
            {item.results.map((res) => (
              <a
                key={res.id}
                href={res.url || `https://${res.domain}`}
                target="_blank"
                rel="noreferrer"
                className="activity-domain-chip"
              >
                <Globe className="size-2.5 opacity-60" />
                <span>{res.domain}</span>
              </a>
            ))}
            {item.moreCount && (
              <span className="text-[11px] text-[var(--text-faint)]">
                +{item.moreCount} more
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (item.type === "tool") {
    const action = (item.action || "tool").toLowerCase();
    let ActionIcon = Terminal;
    if (action.includes("edit") || action.includes("write")) ActionIcon = FileCode;
    else if (action.includes("read") || action.includes("view")) ActionIcon = Eye;
    else if (action.includes("search") || action.includes("find")) ActionIcon = Search;

    const hasDistinctTarget = item.target && item.target.toLowerCase() !== action;

    return (
      <div className="activity-row">
        <span className="activity-row-icon-wrap">
          <ActionIcon className="size-3.5" />
        </span>
        <span className="activity-row-action-pill">
          {item.action}
        </span>
        {hasDistinctTarget && (
          <span className="activity-row-target" title={item.target}>
            {item.target}
          </span>
        )}
        {(item.additions !== undefined || item.deletions !== undefined) && (
          <span className="activity-row-diff">
            {item.additions !== undefined && (
              <span className="activity-diff-add">+{item.additions}</span>
            )}
            {item.deletions !== undefined && item.deletions > 0 && (
              <span className="activity-diff-del">−{item.deletions}</span>
            )}
          </span>
        )}
      </div>
    );
  }

  // Thought / Reasoning
  if (item.type === "trace" && (item.kind === "thinking" || item.kind === "thought")) {
    return (
      <div className="activity-row-thought" title={item.content || item.detail}>
        <Brain className="size-3.5 shrink-0 text-[var(--accent)] mt-0.5" />
        <div className="flex flex-col min-w-0">
          <span className="activity-row-thought-label">Thinking</span>
          <span className="activity-row-thought-body">{item.detail || item.content}</span>
        </div>
      </div>
    );
  }

  // Generic Trace
  return (
    <div className="activity-row">
      <span className="size-1.5 rounded-full bg-[var(--accent)] ml-1 mr-0.5" />
      <span className="font-medium text-[var(--text)]">{item.label}</span>
      {item.detail && <span className="font-mono text-[11.5px] text-[var(--text-dim)] truncate">{item.detail}</span>}
    </div>
  );
}

export default ActivityRow;
