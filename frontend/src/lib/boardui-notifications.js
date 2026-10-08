import { useState, useEffect, useCallback } from "react";

export const NOTIFICATION_VARIANTS = {
  information: {
    status: "information",
    title: "New version available",
    description: "Refresh to start using the latest dashboard updates.",
    autoDismissDuration: 3500,
  },
  success: {
    status: "success",
    title: "Changes saved",
    description: "Your workspace settings have been updated.",
    autoDismissDuration: 3500,
  },
  error: {
    status: "error",
    title: "Upload failed",
    description: "Check the file size and try again.",
    autoDismissDuration: 4000,
  },
  avatar: {
    avatar: {
      src: "/icon.png",
      alt: "Livia Saris",
      presence: "busy",
    },
    title: "Livia Saris",
    timestamp: "just now",
    description: "Mentioned you in the launch checklist.",
    autoDismissDuration: 4000,
  },
  actions: {
    status: "information",
    title: "Backup ready",
    description: "Your latest workspace backup is ready to download.",
    actions: [
      { label: "Not now", variant: "secondary" },
      { label: "Download", variant: "primary" },
    ],
    autoDismissDuration: 5000,
  },
};

const listeners = new Set();

export function showBoardUINotification(variantOrProps) {
  const item =
    typeof variantOrProps === "string"
      ? {
          id: crypto.randomUUID(),
          ...(NOTIFICATION_VARIANTS[variantOrProps] || {
            title: variantOrProps,
            status: "neutral",
            autoDismissDuration: 3500,
          }),
        }
      : {
          id: variantOrProps.id || crypto.randomUUID(),
          autoDismissDuration: 3500,
          ...variantOrProps,
        };

  listeners.forEach((fn) => fn(item));
  return item.id;
}

export function useBoardUINotifications() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const handler = (item) => {
      setNotifications((prev) => [...prev, item]);
    };
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, []);

  const dismiss = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const show = useCallback((variantOrProps) => {
    return showBoardUINotification(variantOrProps);
  }, []);

  return { notifications, showNotification: show, dismissNotification: dismiss };
}
