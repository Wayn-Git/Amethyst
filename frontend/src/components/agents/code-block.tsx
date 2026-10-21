"use client";

import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/api.js";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { cn } from "@/lib/utils.js";

export type CodeBlockLanguage =
  | "text"
  | "bash"
  | "sh"
  | "diff"
  | "json"
  | "tsx"
  | "jsx"
  | "typescript"
  | "javascript"
  | "python"
  | "py"
  | "css"
  | "html"
  | "sql"
  | string;

export interface CodeBlockProps {
  code: string;
  language?: CodeBlockLanguage;
  filename?: ReactNode;
  status?: "complete" | "streaming";
  showLineNumbers?: boolean;
  highlightLines?: number[];
  maxHeight?: number;
  wrap?: boolean;
  copyable?: boolean;
  onCopy?: () => void | Promise<void>;
  className?: string;
}

type TokenKind =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "property"
  | "punctuation";

const keywordPattern =
  /^(?:abstract|as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|set|static|switch|throw|try|type|typeof|var|void|while|with|yield|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|def|self|None|True|False|lambda|elif)$/;
const literalPattern = /^(?:true|false|null|undefined|NaN|Infinity)$/;
const typePattern =
  /^(?:Array|Boolean|Date|Error|Map|Number|Promise|Record|Set|String|ReactNode|HTMLElement|HTMLButtonElement|Event|unknown|never|void|any|boolean|number|string|object|int|float|dict|list|tuple|set|str|bool)$/;
const tokenPattern =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|<!--[\s\S]*?-->|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b|[-{}[\]\\();,.<>:=+*\/!?|&]/g;

function tokenKind(
  value: string,
  source: string,
  index: number,
  language: string
): TokenKind | undefined {
  if (
    value.startsWith("//") ||
    value.startsWith("/*") ||
    value.startsWith("<!--") ||
    (value.startsWith("#") &&
      (language === "py" ||
        language === "python" ||
        language === "bash" ||
        language === "sh"))
  )
    return "comment";
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith("`")) {
    return language === "json" &&
      /^\s*:/.test(source.slice(index + value.length))
      ? "property"
      : "string";
  }
  if (/^\d/.test(value)) return "number";
  if (keywordPattern.test(value) || literalPattern.test(value)) return "keyword";
  if (typePattern.test(value)) return "type";
  if (/^[-{}[\]\\();,.<>:=+*\/!?|&]$/.test(value)) return "punctuation";

  const after = source.slice(index + value.length);
  if (/^\s*\(/.test(after) && language !== "json") return "function";
  if (
    (language === "css" || language === "tsx" || language === "jsx") &&
    /^\s*[:=]/.test(after)
  )
    return "property";
  return undefined;
}

function highlightLine(line: string, language: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (cursor < index) parts.push(line.slice(cursor, index));

    const kind = tokenKind(value, line, index, language);
    let colorClass = "";
    if (kind === "comment") colorClass = "text-[var(--text-faint)] italic";
    else if (kind === "string") colorClass = "text-emerald-400 dark:text-emerald-400";
    else if (kind === "keyword") colorClass = "text-purple-400 dark:text-purple-400 font-medium";
    else if (kind === "type" || kind === "function") colorClass = "text-blue-400 dark:text-blue-400";
    else if (kind === "number") colorClass = "text-amber-400 dark:text-amber-400";
    else if (kind === "property") colorClass = "text-sky-300 dark:text-sky-300";

    parts.push(
      colorClass ? (
        <span key={`${index}-${value}`} className={colorClass}>
          {value}
        </span>
      ) : (
        value
      )
    );
    cursor = index + value.length;
  }

  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts.length > 0 ? parts : [" "];
}

export function CodeBlock({
  code = "",
  language = "typescript",
  filename,
  status = "complete",
  showLineNumbers = true,
  highlightLines = [],
  maxHeight,
  wrap = false,
  copyable = true,
  onCopy,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isStreaming = status === "streaming";

  const lines = useMemo(() => {
    return (code || "").split("\n");
  }, [code]);

  const handleCopy = useCallback(async () => {
    if (onCopy) {
      await onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      return;
    }
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }, [code, onCopy]);

  return (
    <div
      className={cn(
        "code-block-root relative my-3 flex flex-col rounded-[8px] border border-[var(--border)] overflow-hidden bg-[var(--canvas-deep,var(--canvas))]",
        className
      )}
      style={{
        boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
      }}
    >
      {/* Header bar */}
      <div className="code-block-header flex h-9 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px]">
        <div className="flex items-center gap-2 min-w-0">
          {filename ? (
            <span className="font-mono text-[12px] font-medium text-[var(--text)] truncate">
              {filename}
            </span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
              {language}
            </span>
          )}

          {isStreaming ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[10.5px] text-[var(--accent)] font-medium">
              <span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <TextShimmer duration={1.6}>Writing…</TextShimmer>
            </span>
          ) : (
            <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
              {lines.length} lines
            </span>
          )}
        </div>

        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] text-[var(--text-dim)]
              hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors duration-120"
            title="Copy code"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span className="text-emerald-500 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Code viewport with line numbers */}
      <div
        className={cn(
          "code-block-viewport overflow-x-auto p-3 font-mono text-[13px] leading-[1.6]",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        )}
        style={{
          maxHeight: maxHeight ? `${maxHeight}px` : undefined,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <div className="flex flex-col min-w-full">
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isHighlighted = highlightLines.includes(lineNum);

            return (
              <div
                key={idx}
                className={cn(
                  "flex items-baseline min-h-[21px] px-1 rounded-[3px]",
                  isHighlighted && "bg-[var(--accent-wash,rgba(113,50,245,0.08))]"
                )}
              >
                {showLineNumbers && (
                  <span
                    aria-hidden="true"
                    className="w-8 shrink-0 select-none pr-3 text-right text-[11px] text-[var(--text-faint)] tabular-nums opacity-60"
                  >
                    {lineNum}
                  </span>
                )}
                <span className="flex-1 text-[var(--text)] select-text">
                  {highlightLine(line, language)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CodeBlock;
