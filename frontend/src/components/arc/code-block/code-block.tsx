"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { CopyButton } from "../copy-button/copy-button";
import styles from "./code-block.module.css";

export interface CodeBlockProps {
  /** Source shown in the block and copied by the action. */
  code: string;
  /** File name displayed in the header. */
  filename?: string;
  /** Used for the header label and lightweight syntax highlighting. */
  language?: string;
  /** Collapse longer sources to this many lines, with a toggle that expands the rest in place. */
  maxLines?: number;
  className?: string;
}

type TokenKind = "comment" | "string" | "number" | "keyword" | "type" | "function" | "property" | "tag" | "punctuation";

const keywordPattern = /^(?:abstract|as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|set|static|switch|throw|try|type|typeof|var|void|while|with|yield|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|def|self|None|True|False|lambda|elif)$/;
const literalPattern = /^(?:true|false|null|undefined|NaN|Infinity)$/;
const typePattern = /^(?:Array|Boolean|Date|Error|Map|Number|Promise|Record|Set|String|ReactNode|HTMLElement|HTMLButtonElement|Event|unknown|never|void|any|boolean|number|string|object|int|float|dict|list|tuple|set|str|bool)$/;
const tokenPattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|<!--[\s\S]*?-->|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b|[-{}[\]\\();,.<>:=+*\/!?|&]/g;

function normaliseLanguage(language: string) {
  return (language || "").toLowerCase().replace(/^\./, "");
}

function tokenKind(value: string, source: string, index: number, language: string): TokenKind | undefined {
  if (value.startsWith("//") || value.startsWith("/*") || value.startsWith("<!--") || (value.startsWith("#") && (language === "py" || language === "python" || language === "bash" || language === "sh"))) return "comment";
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith("`")) {
    return language === "json" && /^\s*:/.test(source.slice(index + value.length)) ? "property" : "string";
  }
  if (/^\d/.test(value)) return "number";
  if (keywordPattern.test(value) || literalPattern.test(value)) return "keyword";
  if (typePattern.test(value)) return "type";
  if (/^[-{}[\]\\();,.<>:=+*\/!?|&]$/.test(value)) return "punctuation";

  const before = source.slice(0, index);
  const after = source.slice(index + value.length);
  if ((language === "tsx" || language === "jsx" || language === "html" || language === "vue") && /<\/?$/.test(before)) return "tag";
  if (/^\s*\(/.test(after) && language !== "json") return "function";
  if ((language === "css" || language === "tsx" || language === "jsx") && /^\s*[:=]/.test(after)) return "property";
  return undefined;
}

function highlight(code: string, language: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (cursor < index) parts.push(code.slice(cursor, index));

    const kind = tokenKind(value, code, index, language);
    parts.push(kind ? <span className={styles[kind]} key={`${index}-${value}`}>{value}</span> : <Fragment key={`${index}-${value}`}>{value}</Fragment>);
    cursor = index + value.length;
  }

  if (cursor < code.length) parts.push(code.slice(cursor));
  return parts;
}

const textEnter = { duration: 0.16, ease: [0.16, 1, 0.3, 1] } as const;
const textExit = { duration: 0.1, ease: [0.2, 0, 0, 1] } as const;

function SwapText({ value, reduced }: { value: string; reduced: boolean }) {
  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={value}
        className={styles.swapText}
        initial={reduced ? false : { opacity: 0, y: "0.3em", filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.3em", filter: "blur(2px)", transition: textExit }}
        transition={reduced ? { duration: 0 } : textEnter}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}

function FileName({ name, reduced }: { name: string; reduced: boolean }) {
  const sizer = useRef<HTMLSpanElement>(null);
  const rest = useRef(0);
  const width = useMotionValue<number | "auto">("auto");

  useEffect(() => {
    const node = sizer.current;
    if (!node) return;
    const observer = new ResizeObserver(() => { rest.current = node.offsetWidth; });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const moving = width.get(), to = sizer.current?.offsetWidth ?? 0;
    const from = typeof moving === "number" ? moving : rest.current;
    rest.current = to;
    if (reduced || !from || !to || Math.abs(from - to) < 1) { width.jump("auto"); return; }
    width.jump(from);
    const controls = animate(width, to, {
      type: "spring",
      stiffness: 300,
      damping: 30,
      onComplete: () => width.jump("auto"),
    });
    return () => controls.stop();
  }, [name, reduced, width]);

  return (
    <motion.span className={`${styles.swap} ${styles.filename}`} style={{ width }}>
      <span ref={sizer} className={styles.sizer} aria-hidden="true">{name}</span>
      <span className={styles.swapStack} aria-hidden="true"><SwapText value={name} reduced={reduced} /></span>
      <span className={styles.srOnly}>{name}</span>
    </motion.span>
  );
}

export function CodeBlock({ code = "", filename, language = "tsx", maxLines, className }: CodeBlockProps) {
  const displayLanguage = normaliseLanguage(language);
  const reduced = useReducedMotion() ?? false;
  const preId = useId();
  const lineCount = (code || "").split("\n").length;
  const collapsible = maxLines != null && maxLines > 0 && lineCount > maxLines;
  const [expanded, setExpanded] = useState(false);
  const open = !collapsible || expanded;
  const preRef = useRef<HTMLPreElement>(null);
  const measured = useRef<{ full: number; collapsed: number } | null>(null);
  const height = useMotionValue<number | string>(open ? "auto" : "var(--code-collapsed)");
  const target = useRef({ open, reduced });
  const settleRef = useRef<(instant: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    const settle = (instant: boolean) => {
      const sizes = measured.current;
      if (!sizes) return;
      const next = target.current.open ? sizes.full : sizes.collapsed;
      if (instant || target.current.reduced || typeof height.get() !== "number") height.jump(next);
      else animate(height, next, { type: "spring", stiffness: 300, damping: 30 });
    };
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(pre);
      const full = pre.offsetHeight;
      const collapsed = maxLines
        ? Math.min(full, Math.round(maxLines * (parseFloat(style.lineHeight) || 22) + (parseFloat(style.paddingTop) || 16) + (parseFloat(style.paddingBottom) || 16)))
        : full;
      const first = !measured.current;
      measured.current = { full, collapsed };
      settle(first);
    });
    observer.observe(pre);
    settleRef.current = settle;
    return () => observer.disconnect();
  }, [height, maxLines]);

  useLayoutEffect(() => {
    target.current = { open, reduced };
    settleRef.current(false);
  }, [open, reduced]);

  const expandLabels = [`Show all ${lineCount} lines`, "Show fewer lines"];

  return (
    <section
      className={[styles.block, className].filter(Boolean).join(" ")}
      aria-label={filename ? `${filename} source code` : `${displayLanguage} source code`}
      style={maxLines ? ({ "--code-lines": maxLines } as CSSProperties) : undefined}
    >
      <header className={styles.header}>
        <div className={styles.file}>
          <FileCode2 size={15} strokeWidth={1.75} aria-hidden="true" />
          <FileName name={filename ?? (displayLanguage ? displayLanguage.toUpperCase() : "Source code")} reduced={reduced} />
          {displayLanguage && <span className={styles.language}>{displayLanguage}</span>}
        </div>
        <CopyButton value={code} label="Copy code" />
      </header>
      <motion.div className={styles.viewport} style={{ height }}>
        <pre ref={preRef} id={preId} className={styles.pre} tabIndex={0} aria-label="Selectable source code">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.code
              key={code}
              className={styles.code}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: textExit }}
              transition={reduced ? { duration: 0 } : textEnter}
            >
              {highlight(code, displayLanguage)}
            </motion.code>
          </AnimatePresence>
        </pre>
      </motion.div>
      {collapsible && (
        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={preId}
          onClick={() => setExpanded(value => !value)}
        >
          <span className={styles.swap} aria-hidden="true">
            {expandLabels.map(text => (
              <span key={text} className={styles.reserve}>{text}</span>
            ))}
            <span className={styles.swapStack}>
              <SwapText value={expandLabels[expanded ? 1 : 0]} reduced={reduced} />
            </span>
          </span>
          <span className={styles.srOnly}>{expandLabels[expanded ? 1 : 0]}</span>
          <motion.span
            className={styles.chevron}
            aria-hidden="true"
            initial={false}
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 35 }}
          >
            <ChevronDown size={14} strokeWidth={1.75} />
          </motion.span>
        </button>
      )}
    </section>
  );
}

export default CodeBlock;
