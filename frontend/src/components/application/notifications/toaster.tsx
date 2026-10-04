import type { ComponentProps } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle, InfoCircle } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/lib/utils/cx";

export type ToasterProps = ComponentProps<typeof SonnerToaster>;

/**
 * UntitledUI Toaster
 *
 * Built on Sonner with official UntitledUI FeaturedIcon indicators,
 * typography, borders, and smooth card-deck stacking.
 */
export const Toaster = ({ className, ...props }: ToasterProps) => {
    return (
        <SonnerToaster
            theme="dark"
            position="bottom-right"
            closeButton
            expand={false}
            visibleToasts={4}
            duration={4200}
            gap={8}
            className={cx("toaster group", className)}
            icons={{
                success: (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 mt-0.5">
                        <CheckCircle className="size-3.5" />
                    </span>
                ),
                error: (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400 mt-0.5">
                        <AlertCircle className="size-3.5" />
                    </span>
                ),
                warning: (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400 mt-0.5">
                        <AlertTriangle className="size-3.5" />
                    </span>
                ),
                info: (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-purple-400 mt-0.5">
                        <InfoCircle className="size-3.5" />
                    </span>
                ),
            }}
            toastOptions={{
                classNames: {
                    toast: cx(
                        "amethyst-toast group/toast relative flex w-full max-w-[360px] items-start gap-3 rounded-xl p-3.5 transition-all duration-200",
                        "bg-[var(--raised,#18191e)] text-[var(--text,#f3f4f6)] font-sans",
                        "border border-[var(--hairline-strong,rgba(255,255,255,0.12))] shadow-2xl shadow-black/60",
                    ),
                    title: "text-[13px] font-semibold text-[var(--text,#ffffff)] leading-snug tracking-[-0.01em]",
                    description: "text-xs text-[var(--text-dim,rgba(255,255,255,0.65))] leading-relaxed mt-0.5 break-words",
                    actionButton: "rounded-md bg-[var(--accent,#7132f5)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer",
                    cancelButton: "rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-[var(--text,#ffffff)] hover:bg-white/15 transition-colors cursor-pointer",
                    closeButton: "amethyst-toast-close",
                },
            }}
            {...props}
        />
    );
};

export default Toaster;
