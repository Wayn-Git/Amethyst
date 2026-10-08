"use client";

import { useState, useEffect, useMemo, useRef, type FC, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { 
  Terminal, 
  FileText, 
  FileCode, 
  Search, 
  Brain, 
  Check, 
  AlertCircle, 
  Clock, 
  ChevronDown, 
  ChevronRight,
  ShieldAlert,
  Loader2,
  Sparkles,
  Calendar,
  Globe,
  Folder,
  Sliders
} from "lucide-react";
import { CodeBlock } from "../code-block/code-block";
import { JsonViewer } from "../json-viewer/json-viewer";
import { BlurredText } from "../streaming-text/blurred-text";
import ParallelJobCard from "../../ParallelJobCard.jsx";
import SubagentCard from "../../SubagentCard.jsx";
import styles from "./agent-run.module.css";

export interface AgentRunToolCall {
  name: string;
  arguments?: any;
  content?: any;
  isError?: boolean;
  status?: string;
  durationMs?: number;
}

export interface AgentRunStep {
  id: string | number;
  title?: string;
  subject?: string;
  thought?: string;
  status: "running" | "done" | "error" | "waiting_approval";
  tool?: AgentRunToolCall;
  durationMs?: number;
  gate?: {
    reason?: string;
    onApprove?: () => void;
    onReject?: () => void;
  };
}

export interface AgentRunProps {
  steps?: AgentRunStep[];
  events?: any[];
  running?: boolean;
  live?: any;
  reasoning?: string;
  ms?: number;
  defaultOpen?: boolean;
  onOpenArtifact?: (path: string, item: any) => void;
  className?: string;
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

function parseArgs(raw: any) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function getToolIcon(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("shell") || n.includes("bash") || n.includes("term") || n.includes("exec")) {
    return Terminal;
  }
  if (n.includes("edit") || n.includes("write") || n.includes("patch")) {
    return FileCode;
  }
  if (n.includes("calendar") || n.includes("schedule") || n.includes("event") || n.includes("slot") || n.includes("upcoming")) {
    return Calendar;
  }
  if (n.includes("view") || n.includes("read") || n.includes("file")) {
    return FileText;
  }
  if (n.includes("search") || n.includes("grep") || n.includes("find")) {
    return Search;
  }
  if (n.includes("fetch") || n.includes("url") || n.includes("web") || n.includes("crawl") || n.includes("browser")) {
    return Globe;
  }
  if (n.includes("list") || n.includes("folder") || n.includes("dir")) {
    return Folder;
  }
  if (n.includes("thought") || n.includes("think") || n.includes("reason")) {
    return Brain;
  }
  if (n.includes("manage") || n.includes("config") || n.includes("setting")) {
    return Sliders;
  }
  return Sparkles;
}

interface ToolCategoryMeta {
  color: string;
  bg: string;
  border: string;
}

function getToolCategoryMeta(name: string): ToolCategoryMeta {
  const n = (name || "").toLowerCase();
  if (n.includes("calendar") || n.includes("schedule") || n.includes("event") || n.includes("upcoming") || n.includes("slot")) {
    return {
      color: "var(--confirm, #f59e0b)",
      bg: "color-mix(in srgb, var(--confirm) 12%, transparent)",
      border: "color-mix(in srgb, var(--confirm) 28%, transparent)",
    };
  }
  if (n.includes("folder") || n.includes("dir") || n.includes("list_files") || n.includes("list_dir") || n.includes("list task") || n.includes("list_task")) {
    return {
      color: "#38bdf8",
      bg: "rgba(56, 189, 248, 0.12)",
      border: "rgba(56, 189, 248, 0.28)",
    };
  }
  if (n.includes("shell") || n.includes("bash") || n.includes("term") || n.includes("exec") || n.includes("command")) {
    return {
      color: "var(--live, #10b981)",
      bg: "var(--live-soft, rgba(16, 185, 129, 0.12))",
      border: "var(--live-line, rgba(16, 185, 129, 0.28))",
    };
  }
  if (n.includes("search") || n.includes("grep") || n.includes("find")) {
    return {
      color: "#818cf8",
      bg: "rgba(129, 140, 248, 0.12)",
      border: "rgba(129, 140, 248, 0.28)",
    };
  }
  if (n.includes("fetch") || n.includes("url") || n.includes("web") || n.includes("crawl") || n.includes("browser") || n.includes("globe")) {
    return {
      color: "#2dd4bf",
      bg: "rgba(45, 212, 191, 0.12)",
      border: "rgba(45, 212, 191, 0.28)",
    };
  }
  if (n.includes("edit") || n.includes("write") || n.includes("patch") || n.includes("doc")) {
    return {
      color: "#fb923c",
      bg: "rgba(251, 146, 60, 0.12)",
      border: "rgba(251, 146, 60, 0.28)",
    };
  }
  if (n.includes("task") || n.includes("subagent") || n.includes("spark")) {
    return {
      color: "var(--accent, #7132f5)",
      bg: "var(--accent-soft, rgba(113, 50, 245, 0.12))",
      border: "var(--accent-line, rgba(113, 50, 245, 0.28))",
    };
  }
  return {
    color: "var(--text-dim, #94a3b8)",
    bg: "rgba(var(--tint) / 0.05)",
    border: "var(--hairline, rgba(255, 255, 255, 0.08))",
  };
}

function getToolLabel(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("shell") || n.includes("bash") || n.includes("term")) return "Terminal";
  if (n.includes("write")) return "Write File";
  if (n.includes("edit")) return "Edit File";
  if (n.includes("view") || n.includes("read")) return "Read File";
  if (n.includes("search") || n.includes("grep")) return "Search Files";
  if (n.includes("fetch") || n.includes("url")) return "Fetch Page";
  if (n.includes("list_files") || n.includes("list_dir")) return "List Files";
  return name ? name.split(/[_-\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "Tool";
}

function getToolSubject(args: any) {
  if (!args || typeof args !== "object") return "";
  return (
    args.command ||
    args.CommandLine ||
    args.path ||
    args.file_path ||
    args.AbsolutePath ||
    args.TargetFile ||
    args.query ||
    args.pattern ||
    args.url ||
    ""
  );
}

function StepDetails({ step }: { step: AgentRunStep }) {
  const tool = step.tool;
  if (!tool) {
    return null;
  }

  const args = parseArgs(tool.arguments);
  const name = (tool.name || "").toLowerCase();

  // 0. Parallel jobs & Subagents
  if (name === "dispatch_parallel_jobs" || name === "collect_jobs") {
    return (
      <div className={styles.stepDetails}>
        <ParallelJobCard call={tool} running={step.status === "running"} />
      </div>
    );
  }

  if (name === "task") {
    return (
      <div className={styles.stepDetails}>
        <SubagentCard call={tool} running={step.status === "running"} />
      </div>
    );
  }

  // 1. Shell commands -> CodeBlock
  if (name.includes("shell") || name.includes("bash") || name.includes("term") || name.includes("exec")) {
    const cmd = args.command || args.CommandLine || "";
    const output = typeof tool.content === "string" ? tool.content : "";
    return (
      <div className={styles.stepDetails}>
        {cmd && <CodeBlock code={cmd} language="bash" filename="Command" maxLines={8} />}
        {output && <CodeBlock code={output} language="text" filename="Output" maxLines={16} />}
      </div>
    );
  }

  // 2. File view / edit / write -> CodeBlock
  if (name.includes("file") || name.includes("edit") || name.includes("write") || name.includes("view")) {
    const filePath = args.path || args.file_path || args.AbsolutePath || args.TargetFile || "";
    const filename = filePath ? filePath.split("/").pop() : "file";
    const ext = filename?.split(".").pop() || "text";
    const fileContent =
      typeof tool.content === "string"
        ? tool.content
        : args.content || args.ReplacementContent || args.new_string || "";
    if (fileContent) {
      return (
        <div className={styles.stepDetails}>
          <CodeBlock code={fileContent} language={ext} filename={filename} maxLines={16} />
        </div>
      );
    }
  }

  // 3. JSON content or structured args -> JsonViewer
  let jsonObj = null;
  const content = tool.content ?? tool.arguments;
  if (typeof content === "object" && content !== null) {
    jsonObj = content;
  } else if (typeof content === "string") {
    const trimmed = content.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        jsonObj = JSON.parse(trimmed);
      } catch {
        jsonObj = null;
      }
    }
  }

  if (jsonObj) {
    return (
      <div className={styles.stepDetails}>
        <JsonViewer data={jsonObj} rootName={tool.name || "payload"} maxHeight={260} defaultExpandDepth={2} />
      </div>
    );
  }

  // 4. Fallback text
  const textStr = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return (
    <div className={styles.stepDetails}>
      <pre className="trace-json">{textStr}</pre>
    </div>
  );
}

export const AgentRun: FC<AgentRunProps> = ({
  steps: propSteps,
  events,
  running = false,
  live,
  reasoning,
  ms = 0,
  defaultOpen,
  className,
}) => {
  const reducedMotion = useReducedMotion();
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const isOpen = manualOpen === null ? (defaultOpen !== undefined ? defaultOpen : Boolean(running || live)) : manualOpen;
  
  // Track open state per step
  const [openSteps, setOpenSteps] = useState<Record<string | number, boolean>>({});

  // Clock timer: increments while running and holds when document is hidden
  const [seconds, setSeconds] = useState(ms ? Math.round(ms / 1000) : 0);
  const isHiddenRef = useRef(false);

  useEffect(() => {
    if (!running) {
      if (ms) setSeconds(Math.round(ms / 1000));
      return;
    }

    const onVisibilityChange = () => {
      isHiddenRef.current = document.visibilityState === "hidden";
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const interval = setInterval(() => {
      if (!isHiddenRef.current) {
        setSeconds((s) => s + 1);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [running, ms]);

  // Transform raw events to steps if steps prop not directly provided
  const steps = useMemo<AgentRunStep[]>(() => {
    if (propSteps && propSteps.length > 0) return propSteps;
    if (!events || events.length === 0) {
      if (live && live.name !== "ask_user" && live.name !== "ask_question") {
        return [
          {
            id: "live-0",
            title: getToolLabel(live.name),
            subject: getToolSubject(parseArgs(live.arguments)),
            status: "running",
            tool: {
              name: live.name,
              arguments: live.arguments,
              status: "running",
            },
          },
        ];
      }
      return [];
    }

    const out: AgentRunStep[] = [];
    let currentThought: string | undefined = undefined;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === "thought") {
        currentThought = ev.text;
        // If next event is not a tool, add as a thought step
        const next = events[i + 1];
        if (!next || next.type === "thought") {
          out.push({
            id: `thought-${i}`,
            title: "Reasoning",
            thought: ev.text,
            status: "done",
          });
          currentThought = undefined;
        }
        continue;
      }

      const call = ev.call || ev;
      if (call.name === "ask_user" || call.name === "ask_question") {
        continue;
      }
      const isErr = call.status === "error" || call.isError;
      const args = parseArgs(call.arguments);
      const subject = getToolSubject(args);

      out.push({
        id: `step-${i}-${call.name || "tool"}`,
        title: getToolLabel(call.name),
        subject,
        thought: currentThought,
        status: isErr ? "error" : "done",
        durationMs: call.durationMs ?? call.duration_ms,
        tool: {
          name: call.name,
          arguments: args,
          content: call.content,
          isError: isErr,
          status: call.status,
          durationMs: call.durationMs,
        },
      });
      currentThought = undefined;
    }

    if (live && live.name !== "ask_user" && live.name !== "ask_question") {
      out.push({
        id: "live-step",
        title: getToolLabel(live.name),
        subject: getToolSubject(parseArgs(live.arguments)),
        status: "running",
        tool: {
          name: live.name,
          arguments: live.arguments,
          status: "running",
        },
      });
    }

    return out;
  }, [propSteps, events, live]);

  // Compute summary stats
  const stats = useMemo(() => {
    const totalSteps = steps.length;
    let commands = 0;
    let files = 0;
    let edits = 0;

    for (const s of steps) {
      const name = (s.tool?.name || s.title || "").toLowerCase();
      if (name.includes("shell") || name.includes("bash") || name.includes("term")) commands++;
      else if (name.includes("write") || name.includes("create")) files++;
      else if (name.includes("edit") || name.includes("patch")) edits++;
    }

    const parts = [];
    if (totalSteps > 0) parts.push(`${totalSteps} step${totalSteps > 1 ? "s" : ""}`);
    if (commands > 0) parts.push(`${commands} command${commands > 1 ? "s" : ""}`);
    if (files > 0) parts.push(`${files} written`);
    if (edits > 0) parts.push(`${edits} edited`);
    return parts.join(" · ");
  }, [steps]);

  // Compute duration display when finished
  const durationText = useMemo(() => {
    if (running) return "";
    const totalMs = ms || steps.reduce((acc, s) => acc + (s.durationMs || 0), 0);
    if (totalMs > 0) {
      if (totalMs >= 1000) {
        const secs = totalMs / 1000;
        return secs >= 10 ? `${Math.round(secs)}s` : `${secs.toFixed(1)}s`;
      }
      return `${totalMs}ms`;
    }
    if (seconds > 0) {
      return `${seconds}s`;
    }
    return "";
  }, [running, ms, steps, seconds]);

  // Only render AgentRun if there are tool steps, or if live/running
  const hasToolSteps = steps.some((s) => Boolean(s.tool));
  if (!hasToolSteps && !running && !live && !reasoning) {
    return null;
  }

  const toggleStep = (id: string | number) => {
    setOpenSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div
      className={`${styles.agentRun} ${className || ""}`}
      data-running={running ? "true" : "false"}
      data-open={isOpen ? "true" : "false"}
    >
      {/* Header Summary / Disclosure Row - exact Arc summary */}
      <button
        type="button"
        className={`${styles.summary} ${isOpen ? styles.isOpen : ""}`}
        onClick={() => setManualOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className={styles.status} data-phase={running ? "running" : "done"}>
          {running && <Loader2 size={13} className={styles.spin} style={{ color: "var(--accent, #7132f5)" }} />}
          <span className={styles.summaryTitle}>{running ? "Working" : "Worked"}</span>
        </span>
        {stats && (
          <>
            <span className={styles.muted}>·</span>
            <span className={styles.summaryStats}>{stats}</span>
          </>
        )}
        {running ? (
          <>
            <span className={styles.muted}>·</span>
            <span className={styles.clockCounter}>{formatClock(seconds)}</span>
          </>
        ) : durationText ? (
          <>
            <span className={styles.muted}>·</span>
            <span className={styles.summaryDuration}>{durationText}</span>
          </>
        ) : null}
        <ChevronDown
          size={14}
          className={`${styles.summaryChevron} ${isOpen ? styles.open : ""}`}
        />
      </button>

      {/* Timeline of Steps */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className={styles.timelineContainer}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 32 }}
          >
            <ol aria-label="Steps" className={styles.timeline}>
              {steps.map((step, idx) => {
                const IconComponent = getToolIcon(step.tool?.name || step.title || "");
                const meta = getToolCategoryMeta(step.tool?.name || step.title || "");
                const isStepOpen = openSteps[step.id] ?? (step.status === "running" || idx === steps.length - 1);
                const isLive = step.status === "running";
                const isLast = idx === steps.length - 1;

                return (
                  <li
                    key={step.id}
                    className={styles.step}
                    data-status={isLive ? "active" : step.status}
                  >
                    {/* Vertical Rail: circular node + connecting track */}
                    <div className={styles.rail} aria-hidden="true">
                      <span
                        className={styles.node}
                        style={
                          isLive || step.status === "error"
                            ? undefined
                            : { color: meta.color, background: meta.bg, borderColor: meta.border }
                        }
                      >
                        {isLive ? (
                          <Loader2 size={13} className={styles.spin} />
                        ) : step.status === "error" ? (
                          <AlertCircle size={13} style={{ color: "var(--danger, #ef4444)" }} />
                        ) : (
                          <IconComponent size={13} strokeWidth={2} />
                        )}
                      </span>
                      {!isLast && <span className={styles.track} />}
                    </div>

                    {/* Step Main Body */}
                    <div className={styles.stepMain}>
                      <button
                        type="button"
                        className={styles.stepHead}
                        onClick={() => toggleStep(step.id)}
                        aria-expanded={isStepOpen}
                      >
                        <span className={styles.stepTitleBlock}>
                          <span className={styles.stepTitle}>{step.title}</span>
                          {step.subject && (
                            <code className={styles.stepSubject} title={step.subject}>
                              {step.subject.length > 70 ? `${step.subject.slice(0, 70)}…` : step.subject}
                            </code>
                          )}
                          {!isStepOpen && step.thought && (
                            <span className={styles.stepSnippet} title={step.thought}>
                              {step.thought.split("\n")[0]}
                            </span>
                          )}
                        </span>

                        {step.durationMs ? (
                          <span className={styles.stepMeta}>
                            {step.durationMs > 1000
                              ? `${(step.durationMs / 1000).toFixed(1)}s`
                              : `${step.durationMs}ms`}
                          </span>
                        ) : null}

                        <ChevronDown
                          size={14}
                          className={`${styles.stepChevron} ${isStepOpen ? styles.open : ""}`}
                        />
                      </button>

                      {/* Step Expanded Details */}
                      <AnimatePresence initial={false}>
                        {isStepOpen && (
                          <motion.div
                            className={styles.details}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={reducedMotion ? { duration: 0 } : { duration: 0.18 }}
                          >
                            {/* If thought exists, render it with BlurredText */}
                            {step.thought && (
                              <p className={styles.thought}>
                                <BlurredText text={step.thought} live={isLive} />
                              </p>
                            )}

                            {/* Approval Gate */}
                            {step.gate && (
                              <div className={styles.approvalGateCard}>
                                <div className={styles.approvalGateHeader}>
                                  <ShieldAlert size={15} />
                                  <span>Approval required before executing</span>
                                </div>
                                {step.gate.reason && <p style={{ margin: 0, fontSize: 12 }}>{step.gate.reason}</p>}
                                <div className={styles.approvalGateActions}>
                                  <button type="button" className={styles.btnApprove} onClick={step.gate.onApprove}>
                                    <Check size={12} /> Approve
                                  </button>
                                  <button type="button" className={styles.btnReject} onClick={step.gate.onReject}>
                                    Decline
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Tool Payload (CodeBlock / JsonViewer) */}
                            <StepDetails step={step} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentRun;
