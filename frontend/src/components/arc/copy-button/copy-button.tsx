"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./copy-button.module.css";

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  onCopy?: () => void;
  focusable?: boolean;
}

export function CopyButton({
  value,
  label = "Copy",
  className,
  onCopy,
  focusable = true,
}: CopyButtonProps) {
  const [copied, setCopied] = useState<"idle" | "done" | "error">("idle");
  const timeoutRef = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied("done");
      onCopy?.();
    } catch {
      setCopied("error");
    }
    timeoutRef.current = window.setTimeout(() => setCopied("idle"), 1500);
  };

  const glyph =
    copied === "done" ? (
      <Check size={14} strokeWidth={2} aria-hidden="true" />
    ) : copied === "error" ? (
      <X size={14} strokeWidth={2} aria-hidden="true" />
    ) : (
      <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
    );

  return (
    <button
      type="button"
      tabIndex={focusable ? 0 : -1}
      className={[styles.button, className].filter(Boolean).join(" ")}
      data-state={copied}
      aria-label={copied === "done" ? "Copied" : copied === "error" ? "Copy failed" : label}
      title={label}
      onClick={handleCopy}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={copied}
          className={styles.glyph}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, filter: `blur(${motionTokens.blur?.subtle ?? 2}px)` }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, filter: `blur(${motionTokens.blur?.subtle ?? 2}px)` }}
          transition={{ duration: motionTokens.duration?.instant ?? 0.12 }}
        >
          {glyph}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export default CopyButton;
