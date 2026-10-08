import type { FC, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, InfoCircle } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Button } from "@/components/base/buttons/button";
import {
    Dialog,
    Modal,
    ModalBody,
    ModalContent,
    ModalDescription,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    ModalTitle,
} from "./modal";
import { cx } from "@/lib/utils/cx";

export type ConfirmationTone = "danger" | "warning" | "default" | "success";

export interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: ReactNode;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmationTone;
    icon?: FC<{ className?: string }> | ReactNode;
    layout?: "stacked" | "horizontal";
    isLoading?: boolean;
    children?: ReactNode;
    className?: string;
}

const toneMap = {
    danger: { color: "error" as const, icon: AlertCircle, confirmColor: "primary-destructive" as const },
    warning: { color: "warning" as const, icon: AlertTriangle, confirmColor: "primary" as const },
    default: { color: "brand" as const, icon: InfoCircle, confirmColor: "primary" as const },
    success: { color: "success" as const, icon: CheckCircle, confirmColor: "primary" as const },
};

/**
 * UntitledUI Confirmation Modal
 *
 * Implements the official stacked left-aligned and horizontal modal patterns
 * with FeaturedIcon, clear typography, and action buttons.
 */
export const ConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone = "default",
    icon: CustomIcon,
    layout = "stacked",
    isLoading = false,
    children,
    className,
}: ConfirmationModalProps) => {
    const config = toneMap[tone] || toneMap.default;
    const IconToRender = CustomIcon || config.icon;

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Modal className={cx("max-w-md", className)}>
                <Dialog role="alertdialog" aria-label={typeof title === "string" ? title : "Confirmation"}>
                    <ModalContent className="p-6">
                        {/* Header: FeaturedIcon + CloseButton */}
                        <div className="flex items-start justify-between gap-4">
                            <FeaturedIcon
                                size="lg"
                                color={config.color}
                                theme="light"
                                icon={IconToRender}
                                className="shadow-xs"
                            />
                            <Modal.CloseButton onClick={onClose} size="sm" />
                        </div>

                        {/* Title & Description */}
                        <ModalHeader className="mt-4 p-0 pr-0" hideCloseButton>
                            <ModalTitle className="text-lg font-semibold text-fg-primary">
                                {title}
                            </ModalTitle>
                            {description && (
                                <ModalDescription className="mt-1 text-sm text-fg-tertiary">
                                    {description}
                                </ModalDescription>
                            )}
                        </ModalHeader>

                        {/* Optional Custom Body / Inputs */}
                        {children && <ModalBody className="my-3">{children}</ModalBody>}

                        {/* Action Buttons */}
                        <ModalFooter className="mt-6 pt-0">
                            <Button
                                size="md"
                                color="secondary"
                                onClick={onClose}
                                className="w-full sm:w-auto"
                            >
                                {cancelLabel}
                            </Button>
                            <Button
                                size="md"
                                color={tone === "danger" ? "primary-destructive" : config.confirmColor || "primary"}
                                onClick={onConfirm}
                                isLoading={isLoading}
                                className="w-full sm:w-auto"
                            >
                                {confirmLabel}
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};

export default ConfirmationModal;
