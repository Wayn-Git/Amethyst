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
            position="bottom-right"
            closeButton
            expand={false}
            visibleToasts={5}
            duration={4600}
            gap={12}
            className={cx("toaster group", className)}
            icons={{
                success: (
                    <FeaturedIcon
                        size="sm"
                        color="success"
                        theme="light"
                        icon={CheckCircle}
                        className="shrink-0"
                    />
                ),
                error: (
                    <FeaturedIcon
                        size="sm"
                        color="error"
                        theme="light"
                        icon={AlertCircle}
                        className="shrink-0"
                    />
                ),
                warning: (
                    <FeaturedIcon
                        size="sm"
                        color="warning"
                        theme="light"
                        icon={AlertTriangle}
                        className="shrink-0"
                    />
                ),
                info: (
                    <FeaturedIcon
                        size="sm"
                        color="brand"
                        theme="light"
                        icon={InfoCircle}
                        className="shrink-0"
                    />
                ),
            }}
            toastOptions={{
                classNames: {
                    toast: cx(
                        "group toast flex items-start gap-3.5 rounded-2xl p-4 shadow-xl transition-all",
                        "group-[.toaster]:bg-primary group-[.toaster]:text-primary group-[.toaster]:border group-[.toaster]:border-secondary",
                        "font-sans text-sm",
                    ),
                    title: "text-sm font-semibold text-primary leading-tight",
                    description: "text-sm text-tertiary leading-normal mt-0.5 break-words",
                    actionButton: "rounded-lg bg-brand-solid px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-brand-solid_hover",
                    cancelButton: "rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary_hover",
                    closeButton: "border-0 bg-transparent text-fg-quaternary hover:text-primary hover:bg-primary_hover p-1 rounded-md transition-colors",
                },
            }}
            {...props}
        />
    );
};

export default Toaster;
