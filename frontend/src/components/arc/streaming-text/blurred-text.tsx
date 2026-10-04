"use client";

import { motion } from "motion/react";
import type React from "react";
import { useRef } from "react";

export type BlurredTextProps = {
  text: string;
  className?: string;
  wordClassName?: string;
  blurFrom?: string;
  blurTo?: string;
  duration?: number;
  live?: boolean;
  as?: React.ElementType;
};

export const BlurredText: React.FC<BlurredTextProps> = ({
  text,
  className = "font-satoshi text-sm text-muted-foreground/80 leading-relaxed",
  wordClassName = "",
  blurFrom = "5px",
  blurTo = "0px",
  duration = 0.18,
  live = true,
  as: Tag = "p",
}) => {
  const tokens = typeof text === "string" ? text.split(/(\s+)/) : [];
  const revealedCountRef = useRef(0);

  // If text was cleared or drastically shortened (e.g. reset), reset counter
  if (tokens.length < revealedCountRef.current) {
    revealedCountRef.current = 0;
  }

  // If not live, all tokens are already revealed (no animation on historical/closed steps)
  const prevRevealed = live ? revealedCountRef.current : tokens.length;
  revealedCountRef.current = tokens.length;

  const MotionTag = motion(Tag as unknown as React.ElementType);

  return (
    <MotionTag
      className={className}
      style={{
        display: "inline",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        padding: 0,
      }}
    >
      {tokens.map((token, i) => {
        if (!token) return null;
        const isWhitespace = /^\s+$/.test(token);

        if (isWhitespace) {
          return (
            <span key={i} style={{ whiteSpace: "pre-wrap" }}>
              {token}
            </span>
          );
        }

        const isNew = live && i >= prevRevealed;

        if (!isNew) {
          return (
            <span
              key={i}
              className={wordClassName}
              style={{ display: "inline", whiteSpace: "pre-wrap" }}
            >
              {token}
            </span>
          );
        }

        return (
          <motion.span
            key={i}
            className={wordClassName}
            initial={{ opacity: 0, filter: `blur(${blurFrom})` }}
            animate={{ opacity: 1, filter: `blur(${blurTo})` }}
            transition={{ duration, ease: "easeOut" }}
            style={{ display: "inline-block", whiteSpace: "pre-wrap" }}
          >
            {token}
          </motion.span>
        );
      })}
    </MotionTag>
  );
};

export default BlurredText;

