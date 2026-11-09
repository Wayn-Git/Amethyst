// Amethyst Browser Extension - Background Service Worker

const DEFAULT_SERVERS = [
  "http://127.0.0.1:8000",
  "http://localhost:8000",
  "http://127.0.0.1:4141",
  "http://localhost:4141",
];

/**
 * Probe a candidate server URL with /api/ping
 */
async function probeServer(url, token) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${url}/api/ping`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve working server URL, auto-probing ports if needed
 */
async function resolveServerUrl(preferredUrl, token) {
  const candidates = [preferredUrl, ...DEFAULT_SERVERS].filter(Boolean);
  const seen = new Set();
  for (const raw of candidates) {
    const url = raw.replace(/\/+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    if (await probeServer(url, token)) {
      if (url !== preferredUrl) {
        chrome.storage.local.set({ serverUrl: url });
      }
      return url;
    }
  }
  return (preferredUrl || DEFAULT_SERVERS[0]).replace(/\/+$/, "");
}

/**
 * Get configuration from storage
 */
async function getConfig() {
  const data = await chrome.storage.local.get(["serverUrl", "deviceToken", "enableFloatingButton"]);
  return {
    serverUrl: (data.serverUrl || "").trim().replace(/\/+$/, ""),
    deviceToken: (data.deviceToken || "").trim(),
    enableFloatingButton: data.enableFloatingButton !== false,
  };
}

/**
 * Setup Context Menus on install or update
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Selection quote capture
    chrome.contextMenus.create({
      id: "amethyst-save-selection",
      title: "Save quote to Amethyst",
      contexts: ["selection"],
    });

    // Image capture
    chrome.contextMenus.create({
      id: "amethyst-save-image",
      title: "Save image to Amethyst",
      contexts: ["image"],
    });

    // Link capture
    chrome.contextMenus.create({
      id: "amethyst-save-link",
      title: "Save link to Amethyst",
      contexts: ["link"],
    });

    // Video / media capture
    chrome.contextMenus.create({
      id: "amethyst-save-video",
      title: "Save video to Amethyst",
      contexts: ["video", "audio"],
    });

    // Full page capture
    chrome.contextMenus.create({
      id: "amethyst-save-page",
      title: "Save page to Amethyst",
      contexts: ["page"],
    });
  });

  // Check and flush offline queue on start
  flushOfflineQueue();
});

/**
 * Handle Context Menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let payload = {};

  if (info.menuItemId === "amethyst-save-selection") {
    payload = {
      title: tab?.title ? `Quote: ${tab.title}` : "Quote",
      text: `> ${info.selectionText}\n\nSource: [${tab?.title || info.pageUrl}](${info.pageUrl})`,
      kind: "note",
      notes: `Captured quote from ${info.pageUrl}`,
    };
  } else if (info.menuItemId === "amethyst-save-image") {
    payload = {
      url: info.srcUrl,
      title: tab?.title ? `Image: ${tab.title}` : info.srcUrl,
      kind: "other",
      notes: `Image source: ${info.pageUrl}`,
    };
  } else if (info.menuItemId === "amethyst-save-link") {
    payload = {
      url: info.linkUrl,
      title: info.selectionText || info.linkUrl,
      kind: "article",
      notes: `Referenced from ${info.pageUrl}`,
    };
  } else if (info.menuItemId === "amethyst-save-video") {
    payload = {
      url: info.srcUrl || info.pageUrl,
      title: tab?.title || "Video capture",
      kind: "video",
      notes: `Media source: ${info.pageUrl}`,
    };
  } else if (info.menuItemId === "amethyst-save-page") {
    payload = {
      url: info.pageUrl,
      title: tab?.title || info.pageUrl,
      kind: "article",
    };
  }

  await captureContent(payload, tab?.id);
});

/**
 * Handle Keyboard Shortcuts
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "save-current-page") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      await captureContent({ url: tab.url, title: tab.title || tab.url }, tab.id);
    }
  }
});

/**
 * Handle messages from Content Script and Popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "capture") {
    const tabId = sender.tab ? sender.tab.id : undefined;
    captureContent(message.payload, tabId).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === "check-connection") {
    checkConnection().then(sendResponse);
    return true;
  }

  if (message.action === "flush-queue") {
    flushOfflineQueue().then(sendResponse);
    return true;
  }
});

/**
 * Ping Amethyst backend (auto-discovering port 8000 or 4141)
 */
async function checkConnection() {
  const config = await getConfig();
  const serverUrl = await resolveServerUrl(config.serverUrl, config.deviceToken);
  const ok = await probeServer(serverUrl, config.deviceToken);
  return { connected: ok, serverUrl };
}

/**
 * Send capture payload to Amethyst Library API
 */
async function captureContent(payload, tabId) {
  const config = await getConfig();
  const serverUrl = await resolveServerUrl(config.serverUrl, config.deviceToken);
  const endpoint = `${serverUrl}/api/library`;

  const headers = {
    "Content-Type": "application/json",
  };
  if (config.deviceToken) {
    headers["Authorization"] = `Bearer ${config.deviceToken}`;
    headers["x-amethyst-device-token"] = config.deviceToken;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      flashBadge("OK", "#10B981");
      notifyTab(tabId, {
        status: "success",
        message: "Saved to Amethyst Library",
        title: payload.title || payload.url,
        kind: payload.kind || "page",
        item: data.item,
      });
      // Try flushing any previously queued items
      flushOfflineQueue();
      return { success: true, item: data.item };
    } else {
      const errText = await response.text();
      let msg = "Server error";
      try {
        const j = JSON.parse(errText);
        msg = j.detail || j.message || errText;
      } catch {
        msg = errText;
      }
      flashBadge("ERR", "#EF4444");
      notifyTab(tabId, {
        status: "error",
        message: msg,
        title: "Could not save to Amethyst",
      });
      return { success: false, error: msg };
    }
  } catch (error) {
    console.warn("Failed to reach Amethyst desktop, queueing offline capture:", error);
    await enqueueOffline(payload);
    flashBadge("Q", "#F59E0B");
    notifyTab(tabId, {
      status: "queued",
      message: "Amethyst is offline. Item queued to save later.",
      title: payload.title || payload.url,
      kind: payload.kind || "page",
    });
    return { success: false, queued: true, error: String(error) };
  }
}

/**
 * Notify the content script to display an in-page toast HUD
 */
function notifyTab(tabId, data) {
  if (!tabId) {
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: data.status === "success" ? "Saved to Amethyst" : "Queued in Amethyst",
        message: data.title || data.message,
      });
    }
    return;
  }

  chrome.tabs.sendMessage(tabId, { action: "show-toast", data }).catch(() => {
    // Content script might not be injected (e.g. system tabs), fallback to system notification
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: data.status === "success" ? "Saved to Amethyst" : "Queued in Amethyst",
        message: data.title || data.message,
      });
    }
  });
}

/**
 * Flash temporary badge on the extension icon
 */
function flashBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    // If items remain in queue, show count, otherwise clear
    chrome.storage.local.get(["offlineQueue"], (res) => {
      const q = res.offlineQueue || [];
      if (q.length > 0) {
        chrome.action.setBadgeText({ text: String(q.length) });
        chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
      } else {
        chrome.action.setBadgeText({ text: "" });
      }
    });
  }, 2200);
}

/**
 * Queue item offline
 */
async function enqueueOffline(payload) {
  const { offlineQueue = [] } = await chrome.storage.local.get("offlineQueue");
  offlineQueue.push({ payload, queuedAt: Date.now() });
  await chrome.storage.local.set({ offlineQueue });
}

/**
 * Flush offline items when server is reachable
 */
async function flushOfflineQueue() {
  const { offlineQueue = [] } = await chrome.storage.local.get("offlineQueue");
  if (offlineQueue.length === 0) return { flushed: 0 };

  const conn = await checkConnection();
  if (!conn.connected) return { flushed: 0, pending: offlineQueue.length };

  const config = await getConfig();
  const endpoint = `${conn.serverUrl}/api/library`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (config.deviceToken) {
    headers["Authorization"] = `Bearer ${config.deviceToken}`;
    headers["x-amethyst-device-token"] = config.deviceToken;
  }

  const remaining = [];
  let flushedCount = 0;

  for (const item of offlineQueue) {
    const p = item.payload || {};
    if (p.kind === "quote") {
      p.kind = "note";
      if (!p.text && p.url) p.text = `Captured quote from ${p.url}`;
    }
    if (p.kind === "image") p.kind = "other";
    if (p.kind === "link") p.kind = "article";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(p),
      });
      if (res.ok) {
        flushedCount++;
      } else if (res.status >= 400 && res.status < 500) {
        console.warn("Dropping invalid item returning 4xx from queue:", res.status);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
      break; // Still offline, stop
    }
  }

  await chrome.storage.local.set({ offlineQueue: remaining });
  if (remaining.length > 0) {
    chrome.action.setBadgeText({ text: String(remaining.length) });
    chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }

  return { flushed: flushedCount, remaining: remaining.length };
}
