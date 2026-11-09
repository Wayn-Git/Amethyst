"use client";

import React, {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils.js";
import "./message.css";

interface MessageContextValue {
  from: "user" | "assistant";
  align?: "start" | "end";
}

const MessageContext = createContext<MessageContextValue>({
  from: "assistant",
  align: "start",
});

export const useMessageContext = () => useContext(MessageContext);

export interface MessageGroupProps extends HTMLAttributes<HTMLDivElement> {
  spacing?: "default" | "compact";
  children: ReactNode;
}

export const MessageGroup = forwardRef<HTMLDivElement, MessageGroupProps>(
  ({ spacing = "default", className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "message-group flex flex-col w-full",
          spacing === "compact" ? "gap-2" : "gap-4",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageGroup.displayName = "MessageGroup";

export interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from?: "user" | "assistant";
  align?: "start" | "end";
  children: ReactNode;
}

export const Message = forwardRef<HTMLDivElement, MessageProps>(
  ({ from = "assistant", align, className, children, ...props }, ref) => {
    const resolvedAlign = align || (from === "user" ? "end" : "start");

    return (
      <MessageContext.Provider value={{ from, align: resolvedAlign }}>
        <div
          ref={ref}
          data-from={from}
          className={cn(
            "message-root flex w-full gap-2.5",
            from === "user" ? "msg msg-user justify-end" : "msg msg-assistant justify-start",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </MessageContext.Provider>
    );
  }
);
Message.displayName = "Message";

export interface MessageAvatarProps extends HTMLAttributes<HTMLDivElement> {
  placeholder?: boolean;
  children?: ReactNode;
}

export const MessageAvatar = forwardRef<HTMLDivElement, MessageAvatarProps>(
  ({ placeholder = false, className, children, ...props }, ref) => {
    const { from } = useMessageContext();
    if (placeholder) {
      return <div className="size-7 shrink-0" aria-hidden="true" />;
    }
    return (
      <div
        ref={ref}
        className={cn(
          "message-avatar flex size-7 shrink-0 select-none items-center justify-center rounded-full overflow-hidden text-[12px]",
          from === "user" ? "msg-user-avatar order-last" : "bg-[var(--surface-3)] text-[var(--accent)]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageAvatar.displayName = "MessageAvatar";

export interface MessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const MessageContent = forwardRef<HTMLDivElement, MessageContentProps>(
  ({ className, children, ...props }, ref) => {
    const { from } = useMessageContext();
    return (
      <div
        ref={ref}
        className={cn(
          "message-content flex flex-col min-w-0 max-w-[85%]",
          from === "user" ? "items-end msg-user-content" : "items-start",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageContent.displayName = "MessageContent";

export interface MessageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const MessageHeader = forwardRef<HTMLDivElement, MessageHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "message-header mb-1 flex items-center gap-2 text-[11px] text-[var(--text-faint)]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageHeader.displayName = "MessageHeader";

export interface MessageFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const MessageFooter = forwardRef<HTMLDivElement, MessageFooterProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "message-footer mt-1 flex items-center gap-2 text-[11px] text-[var(--text-faint)]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MessageFooter.displayName = "MessageFooter";
