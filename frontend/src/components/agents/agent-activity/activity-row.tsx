"use client";

import type React from "react";
import { Check, Search, Terminal, FileCode, Eye, Globe } from "lucide-react";
import type { AgentActivityItem } from "./types";
import { cn } from "@/lib/utils.js";

export function ActivityRow({ item }: { item: AgentActivityItem }) {
  if (item.type === "step") {
    const isWorking = item.status === "active";
    return (
      <div className="flex items-center gap-2 py-1 text-[12.5px] text-[var(--text)]">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {isWorking ? (
            <span
              className="size-3 rounded-full border-[1.5px] border-[var(--border)] border-t-[var(--accent)]"
              style={{ animation: "spin 700ms linear infinite" }}
            />
          ) : (
            <Check className="size-3.5 text-emerald-500" strokeWidth={2.5} />
          )}
        </span>
        <span className="truncate">{item.label || item.content}</span>
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
          <div className="flex flex-wrap items-center gap-1.5 pl-5">
            {item.results.map((res) => (
              <a
                key={res.id}
                href={res.url || `https://${res.domain}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[var(--surface-2)] text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] border border-[var(--border)] transition-colors"
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

    return (
      <div className="flex items-center gap-2 py-1 text-[12px] font-mono">
        <span className="flex size-4 shrink-0 items-center justify-center text-[var(--text-faint)]">
          <ActionIcon className="size-3.5" />
        </span>
        <span className="font-medium text-[var(--text-dim)] uppercase text-[10.5px] px-1 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
          {item.action}
        </span>
        <span className="truncate text-[var(--text)] max-w-[320px]" title={item.target}>
          {item.target}
        </span>
        {(item.additions !== undefined || item.deletions !== undefined) && (
          <span className="ml-auto flex items-center gap-1 text-[11px] tabular-nums">
            {item.additions !== undefined && (
              <span className="text-emerald-500 font-medium">+{item.additions}</span>
            )}
            {item.deletions !== undefined && item.deletions > 0 && (
              <span className="text-rose-500 font-medium">−{item.deletions}</span>
            )}
          </span>
        )}
      </div>
    );
  }

  // Trace
  return (
    <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--text-dim)]">
      <span className="size-1.5 rounded-full bg-[var(--accent)]" />
      <span className="font-medium text-[var(--text)]">{item.label}</span>
      {item.detail && <span className="font-mono text-[11.5px] truncate">{item.detail}</span>}
    </div>
  );
}

export default ActivityRow;
