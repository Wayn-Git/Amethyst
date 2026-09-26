import type { ComponentPropsWithRef, ReactNode, RefAttributes } from "react";
import type {
    DialogProps as AriaDialogProps,
    HeadingProps as AriaHeadingProps,
    ModalOverlayProps as AriaModalOverlayProps,
} from "react-aria-components";
import {
    Dialog as AriaDialog,
    DialogTrigger as AriaDialogTrigger,
    Heading as AriaHeading,
    Modal as AriaModal,
    ModalOverlay as AriaModalOverlay,
} from "react-aria-components";
import { CloseButton } from "@/components/base/buttons/close-button";
import { cx } from "@/lib/utils/cx";

export const DialogTrigger = AriaDialogTrigger;

export interface ModalOverlayProps extends AriaModalOverlayProps, RefAttributes<HTMLDivElement> {}

export const ModalOverlay = (props: ModalOverlayProps) => {
    return (
        <AriaModalOverlay
            {...props}
            className={(state) =>
                cx(
                    "fixed inset-0 z-50 flex min-h-dvh w-full items-end justify-center bg-overlay/70 px-4 outline-hidden backdrop-blur-[6px] sm:items-center sm:justify-center sm:px-8",
                    // Vertical padding
                    "pt-(--modal-pt) pb-(--modal-pb) [--modal-pb:clamp(16px,8vh,64px)] [--modal-pt:16px] sm:[--modal-pb:32px] sm:[--modal-pt:32px]",
                    // Animations
                    state.isEntering && "duration-300 ease-out animate-in fade-in",
                    state.isExiting && "duration-200 ease-in animate-out fade-out",
                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        />
    );
};
ModalOverlay.displayName = "ModalOverlay";

export interface ModalProps extends AriaModalOverlayProps, RefAttributes<HTMLDivElement> {}

export const BaseModal = (props: ModalProps) => (
    <AriaModal
        {...props}
        className={(state) =>
            cx(
                "w-full max-w-lg rounded-2xl bg-primary align-middle shadow-2xl ring-1 ring-secondary outline-hidden max-sm:overflow-y-auto sm:rounded-2xl",
                // Max height based on parent's vertical padding
                "max-h-[calc(var(--visual-viewport-height)-var(--modal-pt)-var(--modal-pb))]",
                // Animations
                state.isEntering && "duration-300 ease-out animate-in zoom-in-95",
                state.isExiting && "duration-200 ease-in animate-out zoom-out-95",
                typeof props.className === "function" ? props.className(state) : props.className,
            )
        }
    />
);
BaseModal.displayName = "Modal";

export interface DialogProps extends AriaDialogProps, RefAttributes<HTMLElement> {}

export const Dialog = (props: DialogProps) => (
    <AriaDialog
        {...props}
        className={cx("relative flex size-full flex-col overflow-y-auto outline-hidden", props.className)}
    />
);
Dialog.displayName = "Dialog";

export interface ModalContentProps extends ComponentPropsWithRef<"div"> {}

export const ModalContent = ({ className, ...props }: ModalContentProps) => (
    <div {...props} className={cx("relative flex size-full flex-col p-6 sm:p-6", className)} />
);
ModalContent.displayName = "ModalContent";

export interface ModalHeaderProps extends ComponentPropsWithRef<"div"> {
    onClose?: () => void;
    hideCloseButton?: boolean;
}

export const ModalHeader = ({ className, children, onClose, hideCloseButton, ...props }: ModalHeaderProps) => (
    <div {...props} className={cx("relative flex flex-col gap-1 pr-8", className)}>
        {children}
        {!hideCloseButton && (
            <CloseButton
                size="sm"
                onClick={onClose}
                className="absolute top-0 right-0 text-fg-quaternary hover:text-fg-primary"
            />
        )}
    </div>
);
ModalHeader.displayName = "ModalHeader";

export interface ModalTitleProps extends AriaHeadingProps, RefAttributes<HTMLHeadingElement> {}

export const ModalTitle = ({ className, ...props }: ModalTitleProps) => (
    <AriaHeading
        slot="title"
        level={2}
        {...props}
        className={cx("text-lg font-semibold tracking-tight text-fg-primary", className)}
    />
);
ModalTitle.displayName = "ModalTitle";

export interface ModalDescriptionProps extends ComponentPropsWithRef<"p"> {}

export const ModalDescription = ({ className, ...props }: ModalDescriptionProps) => (
    <p {...props} className={cx("text-sm text-fg-tertiary leading-relaxed", className)} />
);
ModalDescription.displayName = "ModalDescription";

export interface ModalBodyProps extends ComponentPropsWithRef<"div"> {}

export const ModalBody = ({ className, ...props }: ModalBodyProps) => (
    <div {...props} className={cx("my-4 flex-1 overflow-y-auto text-sm text-fg-secondary", className)} />
);
ModalBody.displayName = "ModalBody";

export interface ModalFooterProps extends ComponentPropsWithRef<"div"> {}

export const ModalFooter = ({ className, ...props }: ModalFooterProps) => (
    <div
        {...props}
        className={cx(
            "mt-6 flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-end sm:gap-3",
            className,
        )}
    />
);
ModalFooter.displayName = "ModalFooter";

// Compound Modal
export const Modal = Object.assign(BaseModal, {
    Overlay: ModalOverlay,
    Dialog,
    Trigger: DialogTrigger,
    Content: ModalContent,
    Header: ModalHeader,
    Body: ModalBody,
    Footer: ModalFooter,
    Title: ModalTitle,
    Description: ModalDescription,
    CloseButton,
});

export default Modal;
