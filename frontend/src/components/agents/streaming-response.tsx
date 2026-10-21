"use client";

import type React from "react";
import { type ReactNode, useMemo } from "react";
import { BlurredText } from "../arc/streaming-text/blurred-text";
import { cn } from "@/lib/utils.js";

export interface StreamingResponseProps {
  /** Text content to stream or display */
  text?: string;
  /** Direct children if composing rich AST or markdown */
  children?: ReactNode;
  /** Run state: "streaming" | "complete" */
  status?: "streaming" | "complete";
  /** Whether the turn is actively streaming new tokens */
  live?: boolean;
  /** Cited sources to display */
  sources?: Array<{
    name?: string;
    domain: string;
    url?: string;
    href?: string;
  }>;
  /** Follow up prompt suggestions */
  followUps?: string[];
  /** Callback when a follow-up chip is clicked */
  onFollowUp?: (prompt: string) => void;
  /** Additional styling */
  className?: string;
  /** Hide built-in follow ups or actions */
  showActions?: boolean;
}

export function StreamingResponse({
  text = "",
  children,
  status = "complete",
  live = false,
  sources = [],
  followUps = [],
  onFollowUp,
  className,
}: StreamingResponseProps) {
  const isLive = live || status === "streaming";

  const cleanSources = useMemo(() => {
    return (sources || []).filter((s) => s && s.domain);
  }, [sources]);

  return (
    <div
      className={cn(
        "streaming-response flex flex-col gap-2 w-full text-[var(--text)]",
        className
      )}
      style={{
        fontFamily: "var(--font-sans, inherit)",
        lineHeight: "1.6",
      }}
    >
      {/* Primary content: Children or BlurredText / plaintext */}
      <div className="streaming-response-body leading-relaxed text-[15.5px]">
        {children ? (
          children
        ) : isLive ? (
          <BlurredText text={text} live={true} />
        ) : (
          <div className="whitespace-pre-wrap">{text}</div>
        )}
      </div>

      {/* Cited sources pills if present */}
      {cleanSources.length > 0 && !isLive && (
        <div className="streaming-response-sources flex flex-wrap items-center gap-1.5 pt-1">
          {cleanSources.map((source, i) => (
            <a
              key={source.url || source.href || i}
              href={source.url || source.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-[11px] font-mono
                bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]
                border border-[var(--border)] transition-colors duration-150"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`}
                alt=""
                className="size-3 rounded-full shrink-0"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
              <span className="truncate max-w-[120px]">{source.name || source.domain}</span>
            </a>
          ))}
        </div>
      )}

      {/* Follow-up suggestions */}
      {followUps.length > 0 && !isLive && (
        <div className="streaming-response-followups flex flex-col gap-1 pt-2 border-t border-[var(--border)] mt-1">
          <span className="text-[11.5px] font-medium text-[var(--text-faint)]">
            Suggested follow-ups
          </span>
          <div className="flex flex-wrap gap-1.5">
            {followUps.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onFollowUp?.(prompt)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[12px]
                  bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]
                  border border-[var(--border)] transition-colors duration-150 text-left"
              >
                <span>{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default StreamingResponse;
