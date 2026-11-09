import { useState, useEffect, useRef, type FC, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle,
    Trash01,
    XClose,
    MessageSquare01,
    Link01,
} from "@untitledui/icons";
import { cx } from "@/lib/utils/cx";

export type ConfirmationTone = "danger" | "warning" | "default" | "success";

export interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: ReactNode;
    subject?: ReactNode;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmationTone;
    icon?: FC<{ className?: string; size?: number }> | ReactNode;
    isLoading?: boolean;
    children?: ReactNode;
    className?: string;
}

interface ToneConfig {
    icon: FC<{ className?: string }>;
    accentLine: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
    badgeGlow: string;
    confirmBg: string;
    confirmBorder: string;
    confirmTextColor: string;
    confirmShadow: string;
    kbdColor: string;
}

const toneMap: Record<ConfirmationTone, ToneConfig> = {
    danger: {
        icon: Trash01,
        accentLine: "linear-gradient(90deg, transparent, #ef4444 50%, transparent)",
        badgeBg: "rgba(239, 68, 68, 0.12)",
        badgeBorder: "1px solid rgba(239, 68, 68, 0.28)",
        badgeText: "#f87171",
        badgeGlow: "0 0 24px rgba(239, 68, 68, 0.2)",
        confirmBg: "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)",
        confirmBorder: "1px solid rgba(248, 113, 113, 0.4)",
        confirmTextColor: "#ffffff",
        confirmShadow: "0 8px 24px -4px rgba(239, 68, 68, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3)",
        kbdColor: "rgba(255, 255, 255, 0.75)",
    },
    warning: {
        icon: AlertTriangle,
        accentLine: "linear-gradient(90deg, transparent, #f59e0b 50%, transparent)",
        badgeBg: "rgba(245, 158, 11, 0.12)",
        badgeBorder: "1px solid rgba(245, 158, 11, 0.28)",
        badgeText: "#fbbf24",
        badgeGlow: "0 0 24px rgba(245, 158, 11, 0.2)",
        confirmBg: "linear-gradient(180deg, #f59e0b 0%, #d97706 100%)",
        confirmBorder: "1px solid rgba(251, 191, 36, 0.4)",
        confirmTextColor: "#09090b",
        confirmShadow: "0 8px 24px -4px rgba(245, 158, 11, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3)",
        kbdColor: "rgba(0, 0, 0, 0.6)",
    },
    default: {
        icon: AlertCircle,
        accentLine: "linear-gradient(90deg, transparent, #7132f5 50%, transparent)",
        badgeBg: "rgba(113, 50, 245, 0.14)",
        badgeBorder: "1px solid rgba(113, 50, 245, 0.32)",
        badgeText: "#a78bfa",
        badgeGlow: "0 0 24px rgba(113, 50, 245, 0.22)",
        confirmBg: "linear-gradient(180deg, #855bfb 0%, #7132f5 100%)",
        confirmBorder: "1px solid rgba(133, 91, 251, 0.45)",
        confirmTextColor: "#ffffff",
        confirmShadow: "0 8px 24px -4px rgba(113, 50, 245, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3)",
        kbdColor: "rgba(255, 255, 255, 0.75)",
    },
    success: {
        icon: CheckCircle,
        accentLine: "linear-gradient(90deg, transparent, #10b981 50%, transparent)",
        badgeBg: "rgba(16, 185, 129, 0.12)",
        badgeBorder: "1px solid rgba(16, 185, 129, 0.28)",
        badgeText: "#34d399",
        badgeGlow: "0 0 24px rgba(16, 185, 129, 0.2)",
        confirmBg: "linear-gradient(180deg, #10b981 0%, #059669 100%)",
        confirmBorder: "1px solid rgba(52, 211, 153, 0.4)",
        confirmTextColor: "#ffffff",
        confirmShadow: "0 8px 24px -4px rgba(16, 185, 129, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3)",
        kbdColor: "rgba(255, 255, 255, 0.75)",
    },
};

/**
 * Intelligent parser that extracts actions and item subjects from strings
 * such as: `Delete "https://bunkr.cr/f/..."?` into clean headings and a dedicated chip.
 */
function parseTitleAndSubject(title: ReactNode, explicitSubject?: ReactNode) {
    if (explicitSubject) {
        const isUrl = typeof explicitSubject === "string" && /https?:\/\//i.test(explicitSubject);
        return { heading: title, subject: explicitSubject, isUrl };
    }

    if (typeof title !== "string") {
        return { heading: title, subject: null, isUrl: false };
    }

    const trimmed = title.trim();

    // Match patterns: Delete "something" list? or Delete "something"?
    const matchDelete = trimmed.match(/^Delete\s+["“](.+?)["”](?:\s+([a-zA-Z0-9_\-\s]+?))?\??$/i);
    if (matchDelete) {
        const raw = matchDelete[1].trim();
        const noun = matchDelete[2]?.trim();
        const isUrl = /https?:\/\//i.test(raw);
        const heading = noun ? `Delete ${noun}?` : (isUrl ? "Delete conversation?" : "Delete item?");
        return { heading, subject: raw, isUrl };
    }

    // Match generic patterns: Remove "something" provider? or Clear "something"?
    const matchGeneric = trimmed.match(/^(.+?)\s+["“](.+?)["”](?:\s+([a-zA-Z0-9_\-\s]+?))?\??$/i);
    if (matchGeneric) {
        const action = matchGeneric[1].trim();
        const raw = matchGeneric[2].trim();
        const noun = matchGeneric[3]?.trim();
        const heading = noun ? `${action} ${noun}?` : `${action}?`;
        return { heading, subject: raw, isUrl: /https?:\/\//i.test(raw) };
    }

    return { heading: title, subject: null, isUrl: false };
}

/**
 * Wayn Design System Confirmation Modal
 *
 * Implements 12px squircle geometry, obsidian canvas depth, glowing accent lines,
 * keyboard accessibility (Esc/Enter), and intelligent item entity presentation.
 */
export const ConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    subject: explicitSubject,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone = "default",
    icon: CustomIcon,
    isLoading = false,
    children,
    className,
}: ConfirmationModalProps) => {
    const config = toneMap[tone] || toneMap.default;
    const confirmBtnRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    const parsed = parseTitleAndSubject(title, explicitSubject);
    const targetSubject = parsed.subject;

    // Focus confirm button and handle keyboard navigation (Esc / Enter)
    useEffect(() => {
        if (!isOpen) return;

        // Auto-focus confirm action button on open
        const timer = setTimeout(() => {
            confirmBtnRef.current?.focus();
        }, 50);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (!isLoading) onClose();
            } else if (e.key === "Enter") {
                const target = e.target as HTMLElement | null;
                // Don't trigger if user is typing in a textarea or input inside custom body
                if (target?.tagName === "TEXTAREA" || (target?.tagName === "INPUT" && target !== confirmBtnRef.current)) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (!isLoading) onConfirm();
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            clearTimeout(timer);
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [isOpen, isLoading, onClose, onConfirm]);

    const renderIcon = () => {
        if (CustomIcon) {
            if (typeof CustomIcon === "function") {
                const Comp = CustomIcon;
                return <Comp className="size-5" />;
            }
            return CustomIcon;
        }
        const IconComponent = config.icon;
        return <IconComponent className="size-5" />;
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[100] flex min-h-dvh w-full items-center justify-center p-4 sm:p-6"
                    style={{
                        background: "rgba(0, 0, 0, 0.72)",
                        backdropFilter: "blur(14px)",
                        WebkitBackdropFilter: "blur(14px)",
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isLoading) onClose();
                    }}
                >
                    <motion.div
                        ref={dialogRef}
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="confirm-modal-title"
                        aria-describedby="confirm-modal-desc"
                        tabIndex={-1}
                        className={cx(
                            "relative w-full max-w-[440px] overflow-hidden",
                            className
                        )}
                        style={{
                            background: "var(--canvas, #0e131f)",
                            color: "var(--text, #ffffff)",
                            border: "1px solid var(--hairline-strong, rgba(255, 255, 255, 0.12))",
                            borderRadius: "20px",
                            boxShadow: "0 28px 72px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)",
                            padding: "24px",
                        }}
                        initial={{ opacity: 0, scale: 0.94, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 8 }}
                        transition={{ type: "spring", stiffness: 440, damping: 32 }}
                    >
                        {/* Architectural Accent Glow along top edge */}
                        <div
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                right: 0,
                                height: "2px",
                                background: config.accentLine,
                                opacity: 0.9,
                            }}
                        />

                        {/* Top Header: 12px Squircle FeaturedIcon + 12px Squircle Close Button */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: "16px",
                            }}
                        >
                            <div
                                style={{
                                    width: "44px",
                                    height: "44px",
                                    borderRadius: "12px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: config.badgeBg,
                                    border: config.badgeBorder,
                                    color: config.badgeText,
                                    boxShadow: config.badgeGlow,
                                    flexShrink: 0,
                                }}
                            >
                                {renderIcon()}
                            </div>

                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isLoading}
                                aria-label="Close dialog"
                                style={{
                                    width: "32px",
                                    height: "32px",
                                    borderRadius: "12px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "rgba(255, 255, 255, 0.04)",
                                    border: "1px solid rgba(255, 255, 255, 0.08)",
                                    color: "var(--text-dim, #94a3b8)",
                                    cursor: "pointer",
                                    transition: "all 120ms ease",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                                    e.currentTarget.style.color = "var(--text, #ffffff)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                                    e.currentTarget.style.color = "var(--text-dim, #94a3b8)";
                                }}
                            >
                                <XClose className="size-4" />
                            </button>
                        </div>

                        {/* Content Section: Action Heading + Subject Badge + Description */}
                        <div style={{ marginTop: "16px" }}>
                            <h2
                                id="confirm-modal-title"
                                style={{
                                    margin: 0,
                                    fontSize: "17px",
                                    fontWeight: 600,
                                    letterSpacing: "-0.015em",
                                    color: "var(--text, #ffffff)",
                                    lineHeight: 1.35,
                                }}
                            >
                                {parsed.heading}
                            </h2>

                            {/* Formatted Target Entity Badge for clean presentation of URLs & conversation titles */}
                            {targetSubject && (
                                <div
                                    style={{
                                        marginTop: "10px",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 12px",
                                        borderRadius: "12px",
                                        background: "rgba(0, 0, 0, 0.45)",
                                        border: "1px solid rgba(255, 255, 255, 0.08)",
                                        overflow: "hidden",
                                        maxWidth: "100%",
                                    }}
                                >
                                    {parsed.isUrl ? (
                                        <Link01 className="size-3.5 shrink-0 text-zinc-400" />
                                    ) : (
                                        <MessageSquare01 className="size-3.5 shrink-0 text-zinc-400" />
                                    )}
                                    <span
                                        style={{
                                            fontFamily: "var(--font-mono, monospace)",
                                            fontSize: "12px",
                                            color: "var(--text, #e2e8f0)",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            userSelect: "all",
                                        }}
                                        title={typeof targetSubject === "string" ? targetSubject : undefined}
                                    >
                                        {targetSubject}
                                    </span>
                                </div>
                            )}

                            {description && (
                                <p
                                    id="confirm-modal-desc"
                                    style={{
                                        margin: "10px 0 0 0",
                                        fontSize: "13.5px",
                                        color: "var(--text-dim, #94a3b8)",
                                        lineHeight: 1.55,
                                    }}
                                >
                                    {description}
                                </p>
                            )}
                        </div>

                        {/* Optional custom child inputs / content */}
                        {children && <div style={{ marginTop: "16px" }}>{children}</div>}

                        {/* Footer Action Buttons with 12px Squircle Geometry & Keyboard Shortcuts */}
                        <div
                            style={{
                                marginTop: "24px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                gap: "10px",
                            }}
                        >
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isLoading}
                                style={{
                                    height: "38px",
                                    padding: "0 16px",
                                    borderRadius: "12px",
                                    background: "rgba(255, 255, 255, 0.05)",
                                    border: "1px solid rgba(255, 255, 255, 0.08)",
                                    color: "var(--text, #cbd5e1)",
                                    fontFamily: "var(--font-mono, monospace)",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    cursor: "pointer",
                                    transition: "all 120ms ease",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.09)";
                                    e.currentTarget.style.color = "#ffffff";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                                    e.currentTarget.style.color = "var(--text, #cbd5e1)";
                                }}
                            >
                                <span>{cancelLabel}</span>
                                <kbd
                                    style={{
                                        fontSize: "9px",
                                        padding: "2px 5px",
                                        borderRadius: "4px",
                                        background: "rgba(0, 0, 0, 0.35)",
                                        border: "1px solid rgba(255, 255, 255, 0.08)",
                                        color: "var(--text-dim, #64748b)",
                                    }}
                                >
                                    Esc
                                </kbd>
                            </button>

                            <button
                                type="button"
                                ref={confirmBtnRef}
                                onClick={onConfirm}
                                disabled={isLoading}
                                style={{
                                    height: "38px",
                                    padding: "0 18px",
                                    borderRadius: "12px",
                                    background: config.confirmBg,
                                    border: config.confirmBorder,
                                    color: config.confirmTextColor,
                                    boxShadow: config.confirmShadow,
                                    fontFamily: "var(--font-mono, monospace)",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    cursor: "pointer",
                                    transition: "all 120ms ease",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.filter = "brightness(1.08)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.filter = "none";
                                }}
                            >
                                <span>{confirmLabel}</span>
                                <kbd
                                    style={{
                                        fontSize: "9px",
                                        padding: "2px 5px",
                                        borderRadius: "4px",
                                        background: "rgba(0, 0, 0, 0.25)",
                                        border: "1px solid rgba(255, 255, 255, 0.15)",
                                        color: config.kbdColor,
                                    }}
                                >
                                    ↵ Enter
                                </kbd>
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default ConfirmationModal;
