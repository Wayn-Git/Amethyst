import type { FC, ReactNode, Ref } from "react";
import { isValidElement } from "react";
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, XClose } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/lib/utils/cx";
import { isReactComponent } from "@/lib/utils/is-react-component";

export type NotificationType = "success" | "error" | "warning" | "info" | "brand";
export type NotificationTone = "ok" | "bad" | "amber" | "info" | "good";

export interface NotificationProps {
    ref?: Ref<HTMLDivElement>;
    id?: string;
    title?: ReactNode;
    description?: ReactNode;
    type?: NotificationType;
    tone?: NotificationTone;
    icon?: FC<{ className?: string }> | ReactNode;
    onClose?: () => void;
    action?: {
        label: string;
        onClick: () => void;
    } | ReactNode;
    dismissible?: boolean;
    className?: string;
    children?: ReactNode;
}

const typeMap: Record<NotificationTone | NotificationType, { color: "success" | "error" | "warning" | "brand"; icon: FC<{ className?: string }> }> = {
    success: { color: "success", icon: CheckCircle },
    good: { color: "success", icon: CheckCircle },
    ok: { color: "success", icon: CheckCircle },
    error: { color: "error", icon: AlertCircle },
    bad: { color: "error", icon: AlertCircle },
    warning: { color: "warning", icon: AlertTriangle },
    amber: { color: "warning", icon: AlertTriangle },
    info: { color: "brand", icon: InfoCircle },
    brand: { color: "brand", icon: InfoCircle },
};

/**
 * UntitledUI Notification Component
 *
 * Modern, accessible notification card featuring UntitledUI's FeaturedIcon,
 * clean typography hierarchy, actions, and dismiss controls.
 */
export const Notification = ({
    title,
    description,
    type,
    tone = "info",
    icon: CustomIcon,
    onClose,
    action,
    dismissible = true,
    className,
    children,
    ...props
}: NotificationProps) => {
    const config = typeMap[type || tone] || typeMap.info;
    const IconToRender = CustomIcon || config.icon;

    return (
        <div
            {...props}
            role="alert"
            className={cx(
                "untitledui-notification group relative flex w-full max-w-md items-start gap-3.5 rounded-2xl p-4 transition-all duration-200",
                "bg-[var(--surface-2,#1a1b1f)]/95 text-[var(--text,#ffffff)] backdrop-blur-xl",
                "border border-[var(--hairline-strong,rgba(255,255,255,0.1))] shadow-2xl shadow-black/30",
                className,
            )}
        >
            {/* Featured Status Icon */}
            <div className="shrink-0 pt-0.5">
                {isReactComponent(IconToRender) || isValidElement(IconToRender) ? (
                    <FeaturedIcon
                        size="md"
                        color={config.color}
                        theme="light"
                        icon={IconToRender}
                        className="shadow-sm"
                    />
                ) : null}
            </div>

            {/* Notification Content Area */}
            <div className="flex-1 min-w-0 pt-0.5">
                {title && (
                    <h5 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text,#ffffff)] leading-snug">
                        {title}
                    </h5>
                )}

                {(description || children) && (
                    <div className="text-[13px] text-[var(--text-secondary,rgba(255,255,255,0.7))] leading-relaxed mt-0.5 break-words">
                        {description || children}
                    </div>
                )}

                {/* Optional Action Button */}
                {action && (
                    <div className="mt-2.5 flex items-center gap-3">
                        {isValidElement(action) ? (
                            action
                        ) : typeof action === "object" && "label" in action ? (
                            <button
                                type="button"
                                onClick={action.onClick}
                                className="text-[13px] font-semibold text-[var(--accent,#873FFF)] hover:underline focus:outline-none"
                            >
                                {action.label}
                            </button>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Dismiss Close Button */}
            {dismissible && onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Dismiss notification"
                    className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-[var(--text-dim,rgba(255,255,255,0.45))] hover:text-[var(--text,#ffffff)] hover:bg-[var(--surface-hover,rgba(255,255,255,0.06))] transition-colors"
                >
                    <XClose className="size-4" />
                </button>
            )}
        </div>
    );
};

export default Notification;
