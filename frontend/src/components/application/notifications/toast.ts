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

    if (input.length > 50) {
        return { title: "", description: input };
    }

    return { title: input };
}

export const notify = {
    show: (payload: string | ToastPayload, tone: "ok" | "bad" | "amber" | "info" | "good" | "default" = "info") => {
        const effectiveTone = typeof payload === "object" ? payload.tone || tone : tone;
        const { title, description } = parseContent(payload);
        const action = typeof payload === "object" ? payload.action : undefined;
        const duration = typeof payload === "object" ? payload.duration : undefined;

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
    },
    success: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
        sonnerToast.success(title, opts),
    error: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
        sonnerToast.error(title, opts),
    warning: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
        sonnerToast.warning(title, opts),
    info: (title: ReactNode, opts?: { description?: ReactNode; action?: { label: string; onClick: () => void } }) =>
        sonnerToast.info(title, opts),
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
    custom: sonnerToast.custom,
};

export default notify;
