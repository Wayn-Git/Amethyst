// Amethyst Browser Extension - Options Script

document.addEventListener("DOMContentLoaded", async () => {
  const serverUrlInput = document.getElementById("server-url");
  const deviceTokenInput = document.getElementById("device-token");
  const floatingBtnToggle = document.getElementById("floating-btn-toggle");
  const testBtn = document.getElementById("test-btn");
  const testResult = document.getElementById("test-result");
  const queueCountEl = document.getElementById("queue-count");
  const syncNowBtn = document.getElementById("sync-now-btn");
  const syncResult = document.getElementById("sync-result");
  const saveBtn = document.getElementById("save-settings-btn");
  const saveStatus = document.getElementById("save-status");

  // Load existing settings
  const data = await chrome.storage.local.get([
    "serverUrl",
    "deviceToken",
    "enableFloatingButton",
    "offlineQueue",
  ]);

  serverUrlInput.value = data.serverUrl || "http://127.0.0.1:8000";
  deviceTokenInput.value = data.deviceToken || "";
  floatingBtnToggle.checked = data.enableFloatingButton !== false;

  const queue = data.offlineQueue || [];
  queueCountEl.textContent = String(queue.length);

  // Test Connection
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testResult.className = "test-result";
    testResult.textContent = "Pinging...";

    const inputUrl = serverUrlInput.value.trim();
    const token = deviceTokenInput.value.trim();

    // Check specified URL or candidates
    const candidates = inputUrl
      ? [inputUrl]
      : ["http://127.0.0.1:8000", "http://127.0.0.1:4141"];

    let connected = false;
    let connectedUrl = "";

    for (const raw of candidates) {
      const url = raw.replace(/\/+$/, "");
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${url}/api/ping`, { method: "GET", headers });
        if (res.ok) {
          connected = true;
          connectedUrl = url;
          break;
        }
      } catch {}
    }

    if (connected) {
      serverUrlInput.value = connectedUrl;
      testResult.className = "test-result test-ok";
      testResult.textContent = `Connected successfully (${connectedUrl})!`;
    } else {
      testResult.className = "test-result test-fail";
      testResult.textContent = "Could not reach Amethyst desktop. Is the app running?";
    }
    testBtn.disabled = false;
  });

  // Sync Offline Queue
  syncNowBtn.addEventListener("click", async () => {
    syncNowBtn.disabled = true;
    syncResult.className = "test-result";
    syncResult.textContent = "Syncing queued items...";

    chrome.runtime.sendMessage({ action: "flush-queue" }, (res) => {
      syncNowBtn.disabled = false;
      if (res && res.flushed !== undefined) {
        syncResult.className = "test-result test-ok";
        syncResult.textContent = `Synced ${res.flushed} items. ${res.remaining || 0} remaining.`;
        queueCountEl.textContent = String(res.remaining || 0);
      } else {
        syncResult.className = "test-result test-fail";
        syncResult.textContent = "Failed to sync. Ensure Amethyst is running.";
      }
    });
  });

  // Save Settings
  saveBtn.addEventListener("click", async () => {
    const serverUrl = (serverUrlInput.value.trim() || "http://127.0.0.1:4141").replace(/\/+$/, "");
    const deviceToken = deviceTokenInput.value.trim();
    const enableFloatingButton = floatingBtnToggle.checked;

    await chrome.storage.local.set({
      serverUrl,
      deviceToken,
      enableFloatingButton,
    });

    saveStatus.className = "save-status";
    setTimeout(() => {
      saveStatus.className = "save-status hidden";
    }, 2000);
  });
});
