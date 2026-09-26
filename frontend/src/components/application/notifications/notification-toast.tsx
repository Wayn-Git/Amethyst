import type { FC, ReactNode } from "react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Notification, NotificationTone, NotificationType } from "./notification";

export interface ToastItem {
    id: string;
    message?: string;
    title?: ReactNode;
    description?: ReactNode;
    tone?: NotificationTone;
    type?: NotificationType;
    duration?: number;
    action?: {
        label: string;
        onClick: () => void;
    } | ReactNode;
    icon?: FC<{ className?: string }> | ReactNode;
}

export interface NotificationToastContainerProps {
    toasts: ToastItem[];
    onDismiss?: (id: string) => void;
}

/**
 * Intelligent message parser for UntitledUI Notification format.
 * Automatically extracts concise titles and supporting descriptions from
 * convention strings like "Title — Detail" or "Title: Detail" or "Title · Detail".
 */
function parseToastContent(toast: ToastItem): { title?: ReactNode; description?: ReactNode } {
    if (toast.title || toast.description) {
        return { title: toast.title, description: toast.description };
    }

    const raw = toast.message || "";
    if (!raw) return {};

    // Pattern 1: Title — Description
    if (raw.includes(" — ")) {
        const [title, ...rest] = raw.split(" — ");
        return { title: title.trim(), description: rest.join(" — ").trim() };
    }

    // Pattern 2: Title · Description
    if (raw.includes(" · ")) {
        const [title, ...rest] = raw.split(" · ");
        return { title: title.trim(), description: rest.join(" · ").trim() };
    }

    // Pattern 3: Prefix: Description (e.g. "Error: Something went wrong")
    if (raw.includes(": ")) {
        const [title, ...rest] = raw.split(": ");
        return { title: title.trim(), description: rest.join(": ").trim() };
    }

    // For longer strings (> 45 chars), display as description without bold header
    if (raw.length > 45) {
        return { description: raw };
    }

    // Short confirmation messages (e.g. "Task added", "Changes saved") display cleanly as title
    return { title: raw };
}

/**
 * Single animated Toast item wrapping UntitledUI Notification
 */
export const NotificationToast = ({
    toast,
    onDismiss,
}: {
    toast: ToastItem;
    onDismiss?: (id: string) => void;
}) => {
    const { title, description } = parseToastContent(toast);
    const duration = toast.duration ?? 4600;
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        if (!duration || duration <= 0) return;
        const start = performance.now();
        const timer = setInterval(() => {
            const elapsed = performance.now() - start;
            const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
            setProgress(remaining);
            if (remaining <= 0) clearInterval(timer);
        }, 50);

        return () => clearInterval(timer);
    }, [duration]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.94, transition: { duration: 0.16, ease: "easeIn" } }}
            transition={{ type: "spring", damping: 26, stiffness: 360 }}
            className="pointer-events-auto relative w-full overflow-hidden rounded-2xl"
        >
            <Notification
                id={toast.id}
                title={title}
                description={description}
                type={toast.type}
                tone={toast.tone}
                icon={toast.icon}
                action={toast.action}
                onClose={() => onDismiss?.(toast.id)}
            />

            {/* Subtle Duration Progress Line */}
            {duration > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5 overflow-hidden">
                    <div
                        className="h-full bg-[var(--accent,#873FFF)] opacity-60 transition-[width] duration-75 ease-linear"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
        </motion.div>
    );
};

/**
 * Toast Stack Container matching UntitledUI placement & floating viewport rules
 */
export const NotificationToastContainer = ({
    toasts,
    onDismiss,
}: NotificationToastContainerProps) => {
    return (
        <div
            className="untitledui-toast-viewport fixed bottom-5 right-5 z-[100] flex w-full max-w-[400px] flex-col gap-2.5 pointer-events-none sm:bottom-6 sm:right-6"
            role="status"
            aria-live="polite"
        >
            <AnimatePresence mode="popLayout">
                {toasts.map((toast) => (
                    <NotificationToast
                        key={toast.id}
                        toast={toast}
                        onDismiss={onDismiss}
                    />
                ))}
            </AnimatePresence>
        </div>
    );
};

export default NotificationToastContainer;
