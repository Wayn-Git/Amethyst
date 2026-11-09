// Amethyst Browser Extension - Content Script

(() => {
  let activeChip = null;
  let activeToast = null;
  let toastTimer = null;
  let isFloatingEnabled = true;

  // Load user preference for floating button
  chrome.storage.local.get(["enableFloatingButton"], (res) => {
    isFloatingEnabled = res.enableFloatingButton !== false;
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enableFloatingButton) {
      isFloatingEnabled = changes.enableFloatingButton.newValue !== false;
      if (!isFloatingEnabled) removeChip();
    }
  });

  // SVG Amethyst Icon markup
  const AMETHYST_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" class="amethyst-chip-icon" xmlns="http://www.w3.org/2000/svg">
      <polygon points="12,2 21,12 12,22 3,12" fill="#8B5CF6"/>
      <polygon points="12,2 3,12 12,12" fill="#A78BFA"/>
      <polygon points="3,12 12,22 12,12" fill="#6D28D9"/>
      <polygon points="21,12 12,22 12,12" fill="#5B21B6"/>
      <polygon points="12,2 8,7 6,12 12,12" fill="#C4B5FD" fill-opacity="0.8"/>
    </svg>
  `;

  const AMETHYST_HUD_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" class="amethyst-hud-icon" xmlns="http://www.w3.org/2000/svg">
      <polygon points="12,2 21,12 12,22 3,12" fill="#8B5CF6"/>
      <polygon points="12,2 3,12 12,12" fill="#A78BFA"/>
      <polygon points="3,12 12,22 12,12" fill="#6D28D9"/>
      <polygon points="21,12 12,22 12,12" fill="#5B21B6"/>
      <polygon points="12,2 8,7 6,12 12,12" fill="#C4B5FD" fill-opacity="0.8"/>
    </svg>
  `;

  /**
   * Listen for text selection on page
   */
  document.addEventListener("mouseup", (e) => {
    if (!isFloatingEnabled) return;
    if (activeChip && activeChip.contains(e.target)) return;

    // Small delay to allow selection range to stabilize
    setTimeout(handleSelectionChange, 20);
  });

  document.addEventListener("mousedown", (e) => {
    if (activeChip && !activeChip.contains(e.target)) {
      removeChip();
    }
  });

  window.addEventListener("scroll", () => {
    if (activeChip) removeChip();
  }, { passive: true });

  /**
   * Check selection and show chip if eligible
   */
  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      removeChip();
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 10) {
      removeChip();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      removeChip();
      return;
    }

    showChip(rect, text);
  }

  /**
   * Render floating Amethyst action chip above or below selection
   */
  function showChip(rect, selectedText) {
    removeChip();

    const chip = document.createElement("div");
    chip.className = "amethyst-highlight-chip";
    chip.innerHTML = `${AMETHYST_ICON_SVG}<span>Save to Amethyst</span>`;

    // Position above selection if space permits, else below
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let top = scrollY + rect.top - 36;
    if (rect.top < 44) {
      top = scrollY + rect.bottom + 8;
    }
    const left = Math.max(10, Math.min(window.innerWidth - 170, scrollX + rect.left + (rect.width / 2) - 65));

    chip.style.top = `${top}px`;
    chip.style.left = `${left}px`;

    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      const pageMetadata = extractPageMetadata();
      chrome.runtime.sendMessage({
        action: "capture",
        payload: {
          title: pageMetadata.title ? `Quote: ${pageMetadata.title}` : "Quote",
          text: `> ${selectedText}\n\nSource: [${pageMetadata.title || window.location.href}](${window.location.href})`,
          kind: "note",
          notes: `Selection from ${pageMetadata.siteName || window.location.hostname}`,
        },
      });

      removeChip();
    });

    document.body.appendChild(chip);
    activeChip = chip;
  }

  function removeChip() {
    if (activeChip) {
      activeChip.remove();
      activeChip = null;
    }
  }

  /**
   * Extract basic OpenGraph and meta tags from page
   */
  function extractPageMetadata() {
    const getMeta = (prop) => {
      const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
      return el ? el.getAttribute("content") : null;
    };

    return {
      title: getMeta("og:title") || getMeta("twitter:title") || document.title,
      description: getMeta("og:description") || getMeta("description"),
      image: getMeta("og:image") || getMeta("twitter:image"),
      siteName: getMeta("og:site_name"),
      author: getMeta("author") || getMeta("article:author"),
    };
  }

  /**
   * Show in-page transient HUD Toast
   */
  function showToast(data) {
    if (activeToast) {
      clearTimeout(toastTimer);
      activeToast.remove();
      activeToast = null;
    }

    const toast = document.createElement("div");
    toast.className = "amethyst-hud-toast";

    const badgeText = data.kind ? data.kind.toUpperCase() : "ITEM";
    const statusText = data.status === "success" ? "Saved to Amethyst" : "Queued in Amethyst";

    toast.innerHTML = `
      ${AMETHYST_HUD_ICON_SVG}
      <div class="amethyst-hud-body">
        <div class="amethyst-hud-status">
          <span>${statusText}</span>
          <span class="amethyst-hud-badge">${badgeText}</span>
        </div>
        <div class="amethyst-hud-title">${escapeHtml(data.title || data.message || "Page captured")}</div>
      </div>
    `;

    toast.addEventListener("click", () => {
      closeToast(toast);
    });

    document.body.appendChild(toast);
    activeToast = toast;

    toastTimer = setTimeout(() => {
      closeToast(toast);
    }, 2800);
  }

  function closeToast(toast) {
    if (!toast) return;
    toast.classList.add("amethyst-toast-closing");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (activeToast === toast) activeToast = null;
    }, 200);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Listen for messages from background script
   */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "show-toast") {
      showToast(msg.data);
      sendResponse({ received: true });
    } else if (msg.action === "get-metadata") {
      sendResponse(extractPageMetadata());
    }
  });
})();
