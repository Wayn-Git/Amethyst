import { Button as HouseButton } from '../ui/bento/index.jsx'
"use client";

import React, {
  forwardRef,
  isValidElement,
  cloneElement,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { useMessageContext } from "./message";
import { cn } from "@/lib/utils.js";

export type MessageBubbleVariant =
  | "solid"
  | "soft"
  | "tint"
  | "outline"
  | "ghost"
  | "danger";

export interface MessageBubbleProps extends HTMLAttributes<HTMLDivElement> {
  variant?: MessageBubbleVariant;
  align?: "start" | "end";
  animateIn?: boolean;
  children: ReactNode;
}

const variantStyles: Record<MessageBubbleVariant, string> = {
  solid:
    "bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text)] rounded-[14px]",
  soft:
    "bg-[var(--canvas)] border border-[var(--border)] text-[var(--text)] rounded-[10px]",
  tint:
    "bg-[var(--accent-wash)] border border-[var(--accent-line,var(--border))] text-[var(--text)] rounded-[10px]",
  outline:
    "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-[10px]",
  ghost: "bg-transparent text-[var(--text)]",
  danger:
    "bg-[var(--stop-soft)] border border-[var(--stop-line,var(--border))] text-[var(--stop)] rounded-[10px]",
};

export const MessageBubble = forwardRef<HTMLDivElement, MessageBubbleProps>(
  (
    {
      variant = "soft",
      align,
      animateIn = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const context = useMessageContext();
    const resolvedAlign =
      align || (context.from === "user" ? "end" : "start");

    return (
      <div
        ref={ref}
        data-align={resolvedAlign}
        data-variant={variant}
        className={cn(
          "message-bubble relative min-w-0 transition-all",
          variantStyles[variant],
          resolvedAlign === "end" ? "self-end" : "self-start",
          animateIn && "animate-in fade-in zoom-in-95 duration-200",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageBubble.displayName = "MessageBubble";

export interface MessageBubbleContentProps
  extends HTMLAttributes<HTMLDivElement> {
  render?: ReactElement<any>;
  children?: ReactNode;
}

export const MessageBubbleContent = forwardRef<
  HTMLDivElement,
  MessageBubbleContentProps
>(({ render, className, children, ...props }, ref) => {
  if (render && isValidElement(render)) {
    return cloneElement(render as ReactElement<any>, {
      ref,
      className: cn(
        "message-bubble-content block px-3.5 py-2.5 text-[13.5px] leading-relaxed select-text",
        (render.props as any).className,
        className
      ),
      children: children ?? (render.props as any).children,
      ...props,
    });
  }

  return (
    <div
      ref={ref}
      className={cn(
        "message-bubble-content px-3.5 py-2.5 text-[13.5px] leading-relaxed select-text",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
MessageBubbleContent.displayName = "MessageBubbleContent";

export interface MessageBubbleGroupProps
  extends HTMLAttributes<HTMLDivElement> {
  spacing?: "compact" | "default";
  children: ReactNode;
}

export const MessageBubbleGroup = forwardRef<
  HTMLDivElement,
  MessageBubbleGroupProps
>(({ spacing = "compact", className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "message-bubble-group flex flex-col",
        spacing === "compact" ? "gap-1" : "gap-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
MessageBubbleGroup.displayName = "MessageBubbleGroup";

export interface MessageBubbleCollapsibleProps
  extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsedLines?: number;
  moreLabel?: ReactNode;
  lessLabel?: ReactNode;
  contentClassName?: string;
  triggerClassName?: string;
  children: ReactNode;
}

export function MessageBubbleCollapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  collapsedLines = 4,
  moreLabel = "Show more",
  lessLabel = "Show less",
  contentClassName,
  triggerClassName,
  className,
  children,
  ...props
}: MessageBubbleCollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const toggle = () => {
    const next = !isOpen;
    if (controlledOpen === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <div className={cn("message-bubble-collapsible relative", className)} {...props}>
      <div
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: isOpen ? "unset" : collapsedLines,
          overflow: isOpen ? "visible" : "hidden",
        }}
        className={cn("transition-all duration-200", contentClassName)}
      >
        {children}
      </div>

      <HouseButton
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={cn(
          "mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:opacity-80 active:scale-[0.98] transition-all cursor-pointer",
          triggerClassName
        )}
      >
        <span>{isOpen ? lessLabel : moreLabel}</span>
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </HouseButton>
    </div>
  );
}
