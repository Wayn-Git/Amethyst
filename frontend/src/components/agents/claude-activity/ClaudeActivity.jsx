"use client";

import { useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  Brain,
  Terminal,
  Search,
  FileCode,
  FileText,
  Globe,
  Folder,
  Download,
  AlertCircle,
  Check,
} from "lucide-react";
import { CodeBlock } from "../code-block";
import { JsonViewer } from "../../arc/json-viewer/json-viewer";
import { cn } from "@/lib/utils.js";
import { useAgentStage } from "../../../hooks/useAgentStage.js";
import "./claude-activity.css";

function safeArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function tail(path) {
  if (!path || typeof path !== "string") return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getToolCategory(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("search") || n.includes("grep") || n.includes("find")) {
    return {
      type: "search",
      label: "Search",
      badgeClass: "claude-tool-badge-search",
      Icon: Search,
    };
  }
  if (n.includes("shell") || n.includes("bash") || n.includes("term") || n.includes("command") || n.includes("exec")) {
    return {
      type: "bash",
      label: "Bash",
      badgeClass: "claude-tool-badge-bash",
      Icon: Terminal,
    };
  }
  if (n.includes("edit") || n.includes("write") || n.includes("patch") || n.includes("replace")) {
    return {
      type: "edit",
      label: "Edit",
      badgeClass: "claude-tool-badge-edit",
      Icon: FileCode,
    };
  }
  if (n.includes("read") || n.includes("view") || n.includes("cat") || n.includes("file")) {
    return {
      type: "read",
      label: "Read",
      badgeClass: "claude-tool-badge-read",
      Icon: FileText,
    };
  }
  if (n.includes("browser") || n.includes("fetch") || n.includes("url") || n.includes("web") || n.includes("crawl")) {
    return {
      type: "search",
      label: "Fetch",
      badgeClass: "claude-tool-badge-search",
      Icon: Globe,
    };
  }
  if (n.includes("list") || n.includes("folder") || n.includes("dir")) {
    return {
      type: "read",
      label: "List",
      badgeClass: "claude-tool-badge-read",
      Icon: Folder,
    };
  }
  return {
    type: "other",
    label: "Tool",
    badgeClass: "claude-tool-badge-other",
    Icon: Terminal,
  };
}

function getToolTarget(name, args = {}) {
  const parsed = safeArgs(args);
  const n = String(name || "").toLowerCase();
  if (n.includes("search") || n.includes("grep")) {
    const q = parsed.query || parsed.Query || parsed.pattern || parsed.q || "";
    return q ? `"${q}"` : "";
  }
  if (n.includes("bash") || n.includes("shell") || n.includes("command")) {
    return parsed.command || parsed.CommandLine || parsed.cmd || "";
  }
  const filePath = parsed.path || parsed.file_path || parsed.AbsolutePath || parsed.TargetFile || parsed.DirectoryPath || "";
  if (filePath) return tail(filePath);
  if (parsed.url) return parsed.url;
  return "";
}

function ToolItem({ item, onOpenArtifact }) {
  const [open, setOpen] = useState(false);
  const args = safeArgs(item.arguments);
  const cat = getToolCategory(item.name);
  const target = getToolTarget(item.name, args);
  const isErr = item.isError || item.status === "error";

  const metric = useMemo(() => {
    if (isErr) return "error";
    if (item.content) {
      if (typeof item.content === "string") {
        const lines = item.content.split("\n").filter(Boolean).length;
        if (lines > 0) return `${lines} lines`;
      } else if (Array.isArray(item.content)) {
        return `${item.content.length} results`;
      }
    }
    if (item.durationMs) {
      return item.durationMs >= 1000
        ? `${(item.durationMs / 1000).toFixed(1)}s`
        : `${item.durationMs}ms`;
    }
    return null;
  }, [item, isErr]);

  const hasPayload = Boolean(item.content || Object.keys(args).length > 0);

  return (
    <div className={cn("claude-tool-item", open && "is-open")}>
      <button
        type="button"
        disabled={!hasPayload}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="claude-tool-item-trigger"
      >
        <div className="claude-tool-item-left">
          <span className={cn("claude-tool-icon-pill", cat.badgeClass)}>
            <cat.Icon size={13} />
          </span>
          <span className="claude-tool-name">{cat.label}</span>
          {target && <span className="claude-tool-target">{target}</span>}
        </div>

        <div className="claude-tool-item-right">
          {metric && <span className="claude-tool-metric">{metric}</span>}
          {isErr ? (
            <AlertCircle size={13} style={{ color: "var(--stop)" }} />
          ) : (
            <Check size={13} style={{ color: "var(--live)" }} />
          )}
          {hasPayload && (
            <ChevronRight
              size={13}
              className={cn("claude-tool-chevron", open && "is-open")}
            />
          )}
        </div>
      </button>

      {open && hasPayload && (
        <div className="claude-tool-payload">
          {cat.type === "bash" && args.command ? (
            <div className="flex flex-col gap-2">
              <CodeBlock code={args.command} language="bash" filename="Command" />
              {typeof item.content === "string" && (
                <CodeBlock code={item.content} language="text" filename="Output" />
              )}
            </div>
          ) : cat.type === "edit" || cat.type === "read" ? (
            <CodeBlock
              code={typeof item.content === "string" ? item.content : JSON.stringify(item.content || args, null, 2)}
              language="text"
              filename={target || "Payload"}
            />
          ) : typeof item.content === "object" && item.content !== null ? (
            <JsonViewer data={item.content} rootName={item.name} defaultExpandDepth={2} />
          ) : (
            <pre className="text-[12.5px] font-mono text-[var(--text-dim)] whitespace-pre-wrap m-0">
              {typeof item.content === "string" ? item.content : JSON.stringify(args, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export const ClaudeActivity = memo(function ClaudeActivity({
  events = [],
  live = null,
  liveReasoning = "",
  liveBuffer = "",
  reasoning = "",
  running = false,
  status = null,
  lastEventAt = 0,
  ms = 0,
  defaultOpen = false,
  onOpenArtifact,
  className,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const {
    stage,
    displayLabel,
    elapsedSeconds,
    showTimer,
    isReducedMotion,
  } = useAgentStage({
    running,
    status,
    liveTool: live,
    liveReasoning,
    liveBuffer,
    lastEventAt,
  });

  // Extract structured parts from events and reasoning props
  const { tools, reasoningText, artifacts } = useMemo(() => {
    const tList = [];
    const thoughtList = [];
    const artList = [];

    for (const ev of events || []) {
      if (ev.type === "thought" && ev.text) {
        thoughtList.push(ev.text);
      } else if (ev.type === "tool" || ev.call) {
        const call = ev.call || ev;
        if (call.name === "ask_user" || call.name === "ask_question") continue;
        if (call.name === "create_artifact") {
          artList.push(call);
        }
        tList.push(call);
      }
    }

    if (live && live.name !== "ask_user" && live.name !== "ask_question") {
      tList.push(live);
    }

    const textPieces = [];
    if (thoughtList.length > 0) textPieces.push(thoughtList.join("\n\n"));
    if (reasoning) textPieces.push(reasoning);
    if (liveReasoning) textPieces.push(liveReasoning);

    const mergedReasoning = textPieces.join("\n\n").trim();

    return {
      tools: tList,
      reasoningText: mergedReasoning,
      artifacts: artList,
    };
  }, [events, live, liveReasoning, reasoning]);

  // Derive label: active dynamic phrase while running; settled summary when finished
  const label = useMemo(() => {
    if (running) {
      return displayLabel;
    }

    // Settled summary
    const toolCount = tools.length;
    const durSec = ms ? (ms / 1000).toFixed(1) : elapsedSeconds > 0 ? `${elapsedSeconds}s` : "";
    const durStr = durSec ? (typeof durSec === 'number' || !String(durSec).endsWith('s') ? `${durSec}s` : durSec) : "";

    const hasSearch = tools.some((t) => {
      const n = String(t.name || "").toLowerCase();
      return n.includes("search") || n.includes("fetch");
    });

    if (toolCount > 0 && reasoningText) {
      return durStr
        ? `Thought for ${durStr} · ${toolCount} tool${toolCount === 1 ? "" : "s"} executed`
        : `${toolCount} tool${toolCount === 1 ? "" : "s"} executed`;
    }
    if (hasSearch && toolCount === 1) {
      return durStr ? `Searched the web · ${durStr}` : "Searched the web";
    }
    if (toolCount > 0) {
      return durStr
        ? `Ran ${toolCount} tool${toolCount === 1 ? "" : "s"} · ${durStr}`
        : `Ran ${toolCount} tool${toolCount === 1 ? "" : "s"}`;
    }
    if (durStr) {
      return `Thought for ${durStr}`;
    }
    return "Thought for a moment";
  }, [running, displayLabel, tools, reasoningText, ms, elapsedSeconds]);

  // Duration badge strictly shown when showTimer is true (elapsed >= 10s)
  const durationBadge = useMemo(() => {
    if (running && showTimer && elapsedSeconds >= 10) {
      const m = Math.floor(elapsedSeconds / 60);
      const s = elapsedSeconds % 60;
      return m > 0 ? `${m}:${s < 10 ? "0" : ""}${s}` : `${s}s`;
    }
    return null;
  }, [running, showTimer, elapsedSeconds]);

  // If completely empty and not running, render nothing
  if (!running && tools.length === 0 && !reasoningText && artifacts.length === 0) {
    return null;
  }

  const isApprovalStage = stage === "waiting_approval";
  const isErrorStage = stage === "error";

  return (
    <div className={cn("claude-activity-root", className)}>
      {/* ──────────────────────────────────────────────────────────
          44px Minimum Touch Target Trigger Bar (Fitts's Law compliant)
          Squircle indicators, crisp token borders, generous click target
          ────────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className={cn(
          "claude-activity-trigger",
          isOpen && "is-open",
          running && "is-running",
          isApprovalStage && "is-approval",
          isErrorStage && "is-error"
        )}
        title={isOpen ? "Click to collapse" : "Click to inspect activity & reasoning"}
      >
        {/* Squircle Activity Indicator */}
        <div className="claude-indicator-wrap" aria-hidden="true">
          {running ? (
            <div className="claude-dash-loader">
              <span className="claude-dash is-pulse-1" />
              <span className="claude-dash is-pulse-2" />
            </div>
          ) : (
            <span className="claude-dash-settled">
              <Check size={11} strokeWidth={2.5} />
            </span>
          )}
        </div>

        {/* Action / State Label */}
        <span className="claude-activity-label">{label}</span>

        {/* Live / elapsed duration chip (appears at 10s+) */}
        {durationBadge && (
          <span className="claude-activity-duration">{durationBadge}</span>
        )}

        {/* Disclosure Chevron */}
        <ChevronRight
          size={14}
          className={cn("claude-activity-chevron", isOpen && "is-open")}
        />
      </button>

      {/* ──────────────────────────────────────────────────────────
          The Expanded Accordion: Full Structured Activity Ledger
          ────────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className="claude-activity-panel"
            initial={isReducedMotion ? false : { opacity: 0, height: 0 }}
            animate={isReducedMotion ? false : { opacity: 1, height: "auto" }}
            exit={isReducedMotion ? false : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            {/* Thinking / Reasoning Block */}
            {reasoningText && (
              <div className="claude-reasoning-block">
                <div className="claude-section-head">
                  <Brain size={13} style={{ color: "var(--coral)" }} />
                  <span>Thinking process</span>
                </div>
                <div className="claude-reasoning-prose">
                  {reasoningText}
                </div>
              </div>
            )}

            {/* Tools Executed Block */}
            {tools.length > 0 && (
              <div className="claude-tools-block">
                <div className="claude-section-head">
                  <Terminal size={13} />
                  <span>Tools executed ({tools.length})</span>
                </div>
                <div className="claude-tools-list">
                  {tools.map((t, idx) => (
                    <ToolItem
                      key={t.id || `tool-${idx}`}
                      item={t}
                      onOpenArtifact={onOpenArtifact}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Created Artifacts Block */}
            {artifacts.length > 0 && (
              <div className="claude-artifacts-block">
                <div className="claude-section-head">
                  <FileCode size={13} style={{ color: "var(--accent)" }} />
                  <span>Artifacts created</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {artifacts.map((art, idx) => {
                    const parsedArgs = safeArgs(art.arguments);
                    const name = parsedArgs.title || tail(parsedArgs.path) || "document";
                    return (
                      <div
                        key={idx}
                        className="claude-artifact-pill"
                        onClick={() => onOpenArtifact?.(parsedArgs.path, parsedArgs)}
                      >
                        <span className="font-medium">{name}</span>
                        <Download size={13} className="text-[var(--text-faint)]" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default ClaudeActivity;
