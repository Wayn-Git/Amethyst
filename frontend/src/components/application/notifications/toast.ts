import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

export interface ToastPayload {
    title?: ReactNode;
    description?: ReactNode;
    message?: string;
    tone?: "ok" | "bad" | "amber" | "info" | "good" | "default";
    action?: {
        label: string;
        onClick: () => void;
    };
    duration?: number;
}

/**
 * Intelligent parser extracting bold headline and supporting text
 */
function parseContent(input: string | ToastPayload): { title: ReactNode; description?: ReactNode } {
    if (typeof input !== "string") {
        if (input.title || input.description) {
            return { title: input.title, description: input.description };
        }
        return parseContent(input.message || "");
    }

    if (input.includes(" — ")) {
        const [title, ...rest] = input.split(" — ");
        return { title: title.trim(), description: rest.join(" — ").trim() };
    }

    if (input.includes(" · ")) {
        const [title, ...rest] = input.split(" · ");
        return { title: title.trim(), description: rest.join(" · ").trim() };
    }

    if (input.includes(": ")) {
        const [title, ...rest] = input.split(": ");
        return { title: title.trim(), description: rest.join(": ").trim() };
    }

    return { title: input };
}

export type ToastTone = "ok" | "bad" | "amber" | "info" | "good" | "default" | "error" | "success" | "warning";

export type ToastOptions = ToastTone | { tone?: ToastTone; type?: string; duration?: number; action?: { label: string; onClick: () => void } };

function showNotification(
    payload: string | ToastPayload,
    toneOrOpts: ToastOptions = "info",
) {
    let effectiveTone: "ok" | "bad" | "amber" | "info" | "good" | "default" = "info";

    if (typeof payload === "object" && payload !== null && payload.tone) {
        const t = payload.tone;
        effectiveTone = t === "error" ? "bad" : t === "success" ? "good" : t === "warning" ? "amber" : t;
    } else if (typeof toneOrOpts === "string") {
        if (toneOrOpts === "error") effectiveTone = "bad";
        else if (toneOrOpts === "success") effectiveTone = "good";
        else if (toneOrOpts === "warning") effectiveTone = "amber";
        else effectiveTone = toneOrOpts as "ok" | "bad" | "amber" | "info" | "good" | "default";
    } else if (typeof toneOrOpts === "object" && toneOrOpts !== null) {
        const raw = toneOrOpts.type || toneOrOpts.tone;
        if (raw === "error") effectiveTone = "bad";
        else if (raw === "success") effectiveTone = "good";
        else if (raw === "warning") effectiveTone = "amber";
        else if (raw) effectiveTone = raw as any;
    }

    const { title, description } = parseContent(payload);
    const action = typeof payload === "object" ? payload.action : (typeof toneOrOpts === "object" ? toneOrOpts.action : undefined);
    const duration = typeof payload === "object" ? payload.duration : (typeof toneOrOpts === "object" ? toneOrOpts.duration : undefined);

    const opts = {
        description,
        action,
        duration,
    };

    switch (effectiveTone) {
        case "ok":
        case "good":
            return sonnerToast.success(title, opts);
        case "bad":
            return sonnerToast.error(title, opts);
        case "amber":
            return sonnerToast.warning(title, opts);
        case "info":
        default:
            return sonnerToast.info(title, opts);
    }
}

interface NotifyFunction {
    (payload: string | ToastPayload, tone?: ToastOptions): string | number;
    show: (payload: string | ToastPayload, tone?: ToastOptions) => string | number;
    success: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) => string | number;
    error: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) => string | number;
    warning: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) => string | number;
    info: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) => string | number;
    dismiss: (id?: string | number) => void;
    custom: typeof sonnerToast.custom;
}

const notifyFn = ((payload: string | ToastPayload, tone: ToastOptions = "info") => {
    return showNotification(payload, tone);
}) as NotifyFunction;

notifyFn.show = showNotification;
notifyFn.success = (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
    sonnerToast.success(title, opts);
notifyFn.error = (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
    sonnerToast.error(title, opts);
notifyFn.warning = (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
    sonnerToast.warning(title, opts);
notifyFn.info = (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
    sonnerToast.info(title, opts);
notifyFn.dismiss = (id?: string | number) => sonnerToast.dismiss(id);
notifyFn.custom = sonnerToast.custom;

export const notify: NotifyFunction = notifyFn;
export default notify;
