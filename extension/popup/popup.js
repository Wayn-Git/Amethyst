// Amethyst Browser Extension - Popup Script

document.addEventListener("DOMContentLoaded", async () => {
  const pageTitleEl = document.getElementById("page-title");
  const pageUrlEl = document.getElementById("page-url");
  const kindSelect = document.getElementById("capture-kind");
  const noteInput = document.getElementById("capture-note");
  const saveBtn = document.getElementById("save-btn");
  const saveBtnText = document.getElementById("save-btn-text");
  const feedbackMsg = document.getElementById("feedback-msg");
  const connStatus = document.getElementById("connection-status");
  const statusText = document.getElementById("status-text");
  const openLibLink = document.getElementById("open-library-link");
  const openOptionsLink = document.getElementById("open-options-link");

  let currentTab = null;

  // 1. Get current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    if (tab) {
      pageTitleEl.textContent = tab.title || "Untitled Tab";
      pageUrlEl.textContent = tab.url || "";
    }
  } catch (err) {
    pageTitleEl.textContent = "Unable to read active tab";
    pageUrlEl.textContent = "";
  }

  // 2. Check connection to Amethyst backend
  checkBackend();

  async function checkBackend() {
    connStatus.className = "status-indicator status-checking";
    statusText.textContent = "Checking...";

    chrome.runtime.sendMessage({ action: "check-connection" }, (res) => {
      if (res && res.connected) {
        connStatus.className = "status-indicator status-online";
        try {
          const port = res.serverUrl ? new URL(res.serverUrl).port : "";
          statusText.textContent = port ? `Connected (:${port})` : "Connected";
        } catch {
          statusText.textContent = "Connected";
        }
      } else {
        connStatus.className = "status-indicator status-offline";
        statusText.textContent = "App Offline";
      }
    });
  }

  // 3. Handle Save button click
  saveBtn.addEventListener("click", async () => {
    if (!currentTab || !currentTab.url) return;

    saveBtn.disabled = true;
    saveBtnText.textContent = "Saving...";
    feedbackMsg.className = "feedback-msg hidden";

    const payload = {
      url: currentTab.url,
      title: currentTab.title || currentTab.url,
      kind: kindSelect.value || undefined,
      notes: noteInput.value.trim() || undefined,
    };

    chrome.runtime.sendMessage({ action: "capture", payload }, (res) => {
      saveBtn.disabled = false;
      saveBtnText.textContent = "Save to Library";

      if (res && res.success) {
        feedbackMsg.textContent = "Saved to Library!";
        feedbackMsg.className = "feedback-msg feedback-ok";
        setTimeout(() => window.close(), 1200);
      } else if (res && res.queued) {
        feedbackMsg.textContent = "Amethyst offline. Queued to save later.";
        feedbackMsg.className = "feedback-msg feedback-warn";
      } else {
        feedbackMsg.textContent = "Failed to save: " + (res?.error || "Unknown error");
        feedbackMsg.className = "feedback-msg feedback-warn";
      }
    });
  });

  // 4. Open Library link
  openLibLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const data = await chrome.storage.local.get(["serverUrl"]);
    const serverUrl = data.serverUrl || "http://127.0.0.1:4141";
    // Check if web app is at port 5173 or 4141
    chrome.tabs.create({ url: `${serverUrl}/library` });
  });

  // 5. Open Options link
  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
    }
  });
});
