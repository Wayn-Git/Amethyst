import { showToast, dismissToast } from "../components/arc/toast-stack/toast-stack";

function parseMessage(message) {
  const text = message.trim().replace(/^\d{3}:\s*/, "");
  const separator = text.includes(" — ") ? " — " : text.includes(" · ") ? " · " : null;
  if (separator) {
    const [title, ...rest] = text.split(separator);
    return { title: title.trim(), description: rest.join(separator).trim() };
  }
  const dot = text.indexOf(". ");
  if (dot > 8 && dot < text.length - 2) {
    return { title: text.slice(0, dot).trim(), description: text.slice(dot + 2).trim() };
  }
  if (text.includes(": ")) {
    const [title, ...rest] = text.split(": ");
    return { title: title.trim(), description: rest.join(": ").trim() };
  }
  return { title: text };
}

function mapTone(tone = "info") {
  const val = String(tone).toLowerCase();
  if (["ok", "good", "success"].includes(val)) return "success";
  if (["bad", "error", "danger"].includes(val)) return "error";
  if (["amber", "warn", "warning"].includes(val)) return "warning";
  if (val === "loading") return "loading";
  return "info";
}

export function showBoardUINotification(payload, tone = "info") {
  if (typeof payload === "string") {
    return showToast(payload, tone);
  }
  const content = payload.title || payload.description
    ? payload
    : parseMessage(payload.message || "");

  const action = payload.action && typeof payload.action === "object" && payload.action.label
    ? {
        label: payload.action.label,
        onClick: (id) => payload.action.onClick?.(id),
      }
    : payload.actions && payload.actions[0]
    ? {
        label: payload.actions[0].label,
        onClick: (id) => payload.actions[0].onClick?.(id),
      }
    : undefined;

  return showToast({
    id: payload.id,
    title: content.title || "",
    description: content.description,
    type: mapTone(payload.type || payload.tone || payload.status || tone),
    action,
    duration: payload.duration ?? payload.autoDismissDuration,
  });
}

export function useBoardUINotifications() {
  return {
    notifications: [],
    dismissNotification: dismissToast,
  };
}

