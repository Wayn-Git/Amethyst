"use client";

import type { ComponentType, CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { Children, isValidElement, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { RiAlertFill, RiCheckboxCircleFill, RiInformationFill, RiNotification3Fill } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar, type AvatarProps } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import "./notification.css";

export type NotificationStatus = "neutral" | "information" | "success" | "error";
export type NotificationType = "success" | "error" | "warning" | "info" | "brand";
export type NotificationTone = "ok" | "bad" | "amber" | "info" | "good";
export type NotificationPosition = "top-start" | "top-end" | "bottom-start" | "bottom-end" | "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
export type NotificationAvatar = Omit<AvatarProps, "size"> & { presence?: "online" | "busy" | "offline" };
export type NotificationImage = { src: string; alt?: string };
export type NotificationAction = { label: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger" };

export interface NotificationProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"> {
  title?: ReactNode; description?: ReactNode; timestamp?: ReactNode; status?: NotificationStatus;
  tone?: NotificationTone; type?: NotificationType; icon?: IconComponent | ReactNode;
  avatar?: NotificationAvatar; image?: NotificationImage; actions?: NotificationAction[];
  action?: { label: string; onClick: () => void; variant?: NotificationAction["variant"] } | ReactNode;
  dismissible?: boolean; closeLabel?: string; onDismiss?: () => void; onClose?: () => void;
  autoDismissDuration?: number; introDelay?: number; ref?: Ref<HTMLDivElement>; children?: ReactNode;
}
export interface NotificationViewportProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"> { children?: ReactNode; position?: NotificationPosition; placement?: Extract<NotificationPosition, "bottom-left" | "bottom-right">; }

const STATUS_ICON: Record<NotificationStatus, IconComponent> = { neutral: RiNotification3Fill, information: RiInformationFill, success: RiCheckboxCircleFill, error: RiAlertFill };
function normalizeStatus(status?: NotificationStatus, tone?: NotificationTone, type?: NotificationType): NotificationStatus {
  if (status) return status;
  const value = (tone || type || "").toLowerCase();
  if (["ok", "good", "success"].includes(value)) return "success";
  if (["bad", "error"].includes(value)) return "error";
  return ["amber", "warning", "info", "brand"].includes(value) ? "information" : "neutral";
}
function NotificationAvatarVisual({ presence, className, ...avatar }: NotificationAvatar) {
  return <span className="amethyst-notification__avatar"><Avatar {...avatar} size="lg" className={className} />{presence && <span aria-hidden className={`amethyst-notification__presence amethyst-notification__presence--${presence}`} />}</span>;
}

export function Notification({ title, description, timestamp, status: rawStatus, tone, type, icon, avatar, image, actions: rawActions, action, dismissible = true, closeLabel = "Dismiss notification", onDismiss, onClose, autoDismissDuration, introDelay = 0, className, ref, role, children, style, ...props }: NotificationProps) {
  const [dismissed, setDismissed] = useState(false);
  const status = normalizeStatus(rawStatus, tone, type);
  const actions = rawActions?.length ? rawActions : action && typeof action === "object" && "label" in action ? [action] : undefined;
  const IconComponent = typeof icon === "function" ? icon : STATUS_ICON[status];
  useEffect(() => {
    if (!autoDismissDuration || autoDismissDuration <= 0) return;
    const timer = window.setTimeout(() => setDismissed(true), autoDismissDuration + introDelay * 1000);
    return () => window.clearTimeout(timer);
  }, [autoDismissDuration, introDelay]);
  const durationStyle = autoDismissDuration ? ({ "--notification-duration": `${autoDismissDuration}ms`, "--notification-delay": `${introDelay}s` } as CSSProperties) : undefined;
  return <AnimatePresence onExitComplete={() => { onDismiss?.(); onClose?.(); }}>{!dismissed && <motion.div ref={ref} role={role ?? (status === "error" ? "alert" : "status")} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, delay: introDelay, ease: "easeOut" } }} exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16, ease: "easeOut" } }} className={["amethyst-notification", `amethyst-notification--${status}`, image && "amethyst-notification--image", className].filter(Boolean).join(" ")} {...props} style={{ ...durationStyle, ...style }}>
    {image ? <img className="amethyst-notification__image" src={image.src} alt={image.alt ?? ""} /> : avatar ? <NotificationAvatarVisual {...avatar} /> : <span className="amethyst-notification__icon">{isValidElement(icon) ? icon : <IconComponent aria-hidden />}</span>}
    <div className="amethyst-notification__content"><div className="amethyst-notification__header">{title && <p className="amethyst-notification__title">{title}</p>}{timestamp && <span className="amethyst-notification__timestamp">{timestamp}</span>}</div>{(description || children) && <div className="amethyst-notification__description">{description || children}</div>}{actions?.length ? <div className="amethyst-notification__actions">{actions.map((item, index) => <Button key={index} size="xs" color="tertiary" className={`amethyst-notification__action amethyst-notification__action--${item.variant ?? (index ? "primary" : "secondary")}`} onPress={item.onClick}>{item.label}</Button>)}</div> : isValidElement(action) && <div className="amethyst-notification__actions">{action}</div>}</div>
    {dismissible && <CloseButton size="xs" label={closeLabel} aria-label={closeLabel} slot={null} className="amethyst-notification__close" onPress={() => setDismissed(true)} />}{autoDismissDuration && autoDismissDuration > 0 && <span className="amethyst-notification__progress" aria-hidden />}
  </motion.div>}</AnimatePresence>;
}

const subscribeToHydration = () => () => {};
export function NotificationViewport({ children, position, placement, className, "aria-label": ariaLabel = "Notifications", ...props }: NotificationViewportProps) {
  const mounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  if (!mounted || typeof document === "undefined") return null;
  const resolvedPosition = position ?? placement ?? "bottom-end";
  return createPortal(<motion.div layoutRoot aria-label={ariaLabel} data-position={resolvedPosition} className={["amethyst-notification-viewport", className].filter(Boolean).join(" ")} {...props}><AnimatePresence initial={false} mode="popLayout">{Children.toArray(children).map((child, index) => <motion.div layout key={isValidElement(child) && child.key !== null ? child.key : index} className="amethyst-notification-viewport__item" transition={{ layout: { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } }}>{child}</motion.div>)}</AnimatePresence></motion.div>, document.body);
}
