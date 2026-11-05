import { useCallback, useEffect, useState } from "react";

const listeners = new Set();

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

export function showBoardUINotification(payload, tone = "info") {
  const content = typeof payload === "string"
    ? parseMessage(payload)
    : payload.title || payload.description
      ? payload
      : parseMessage(payload.message || "");
  const item = {
    id: payload.id || crypto.randomUUID(),
    ...content,
    status: payload.status,
    type: payload.type || payload.tone || tone,
    action: payload.action,
    actions: payload.actions,
    autoDismissDuration: payload.duration ?? payload.autoDismissDuration ?? 3500,
  };

  listeners.forEach((fn) => fn(item));
  return item.id;
}

export function useBoardUINotifications() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const handler = (item) => {
      setNotifications((prev) => [...prev.filter((n) => n.id !== item.id), item]);
    };
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, []);

  const dismiss = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { notifications, dismissNotification: dismiss };
}
