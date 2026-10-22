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
import "./code-block.css";

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
    let tokenClass = "";
    if (kind === "comment") tokenClass = "code-token-comment";
    else if (kind === "string") tokenClass = "code-token-string";
    else if (kind === "keyword") tokenClass = "code-token-keyword";
    else if (kind === "type") tokenClass = "code-token-type";
    else if (kind === "function") tokenClass = "code-token-function";
    else if (kind === "number") tokenClass = "code-token-number";
    else if (kind === "property") tokenClass = "code-token-property";
    else if (kind === "punctuation") tokenClass = "code-token-punctuation";

    parts.push(
      tokenClass ? (
        <span key={`${index}-${value}`} className={tokenClass}>
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
        "agent-code-block-root",
        className
      )}
    >
      {/* Header bar */}
      <div className="agent-code-block-header">
        <div className="agent-code-block-fileinfo">
          {filename ? (
            <span className="agent-code-block-filename" title={String(filename)}>
              {filename}
            </span>
          ) : (
            <span className="agent-code-block-lang">
              {language}
            </span>
          )}

          {isStreaming ? (
            <span className="agent-code-block-streaming-pill">
              <span className="agent-code-block-pulse-dot" />
              <TextShimmer duration={1.6}>Writing…</TextShimmer>
            </span>
          ) : (
            <span className="agent-code-block-line-count">
              {lines.length} lines
            </span>
          )}
        </div>

        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className={cn("agent-code-block-copy-btn", copied && "is-copied")}
            title="Copy code"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span>Copied!</span>
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
          "agent-code-block-content",
          wrap && "is-wrapped"
        )}
        style={{
          maxHeight: maxHeight ? `${maxHeight}px` : undefined,
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
                  "agent-code-block-line",
                  isHighlighted && "is-highlighted"
                )}
              >
                {showLineNumbers && (
                  <span
                    aria-hidden="true"
                    className="agent-code-block-line-number"
                  >
                    {lineNum}
                  </span>
                )}
                <span className="agent-code-block-line-text">
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
