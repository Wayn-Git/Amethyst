import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp } from "@untitledui/icons";
import { Notification, type NotificationTone, type NotificationType } from "./notification";
import { cx } from "@/lib/utils/cx";

export interface NotificationItem {
    id: string;
    title: ReactNode;
    description?: ReactNode;
    tone?: NotificationTone;
    type?: NotificationType;
    action?: {
        label: string;
        onClick: () => void;
    };
    onClose?: () => void;
    dismissible?: boolean;
}

export interface NotificationStackProps {
    items: NotificationItem[];
    className?: string;
    maxVisible?: number;
}

/**
 * NotificationStack
 *
 * Modern animated notification deck utilizing Framer Motion layout transitions
 * and card-deck stacking. Prevents layout jumps, handles multiple overlapping
 * alerts gracefully, and preserves responsive spacing consistent with the Kraken design system.
 */
export const NotificationStack = ({
    items,
    className,
}: NotificationStackProps) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!items || items.length === 0) {
        return null;
    }

    const hasMultiple = items.length > 1;
    const activeItems = isExpanded || !hasMultiple ? items : [items[0]];

    return (
        <div className={cx("w-full flex flex-col items-stretch", className)}>
            {/* Header pill when multiple alerts are queued */}
            {hasMultiple && (
                <div className="w-full flex items-center justify-between mb-2 px-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--raised,#1a1b20)] border border-[var(--hairline-strong,rgba(255,255,255,0.12))] text-[11px] font-medium text-[var(--text-dim,rgba(255,255,255,0.6))] shadow-sm">
                        <span className="size-1.5 rounded-full bg-[var(--confirm,#f59e0b)] animate-pulse" />
                        <span>{items.length} notifications</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsExpanded((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--text-dim,rgba(255,255,255,0.6))] hover:text-[var(--text,#ffffff)] hover:bg-white/5 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                    >
                        <span>{isExpanded ? "Collapse deck" : `View all (${items.length})`}</span>
                        {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </button>
                </div>
            )}

            {/* Notification Deck Container */}
            <div className="relative w-full flex flex-col gap-2">
                <AnimatePresence initial={false} mode="popLayout">
                    {activeItems.map((item) => (
                        <motion.div
                            key={item.id}
                            layout
                            initial={{ opacity: 0, y: -10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.16, ease: "easeOut" } }}
                            transition={{
                                type: "spring",
                                stiffness: 420,
                                damping: 32,
                                mass: 0.8,
                            }}
                            className="w-full relative z-10"
                        >
                            <Notification
                                tone={item.tone}
                                type={item.type}
                                title={item.title}
                                description={item.description}
                                action={item.action}
                                onClose={item.onClose}
                                dismissible={item.dismissible}
                                className="w-full"
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default NotificationStack;
