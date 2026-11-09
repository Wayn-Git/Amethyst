# Amethyst Browser Extension: Library Integration

Capture anything from the web directly into your Amethyst Library with zero friction.

## Features

- **Text Selection Quotes**: Highlight any text on a page to reveal a floating "Save to Amethyst" chip (or right-click to save).
- **Context Menu Integration**: Right-click on selections, images, links, videos, or full pages to save directly.
- **One-Click Toolbar Popup**: Quick save with optional kind selection (`Article`, `Paper`, `Video`, `Recipe`, `Note`) and custom notes.
- **In-Page Transient HUD Toast**: Non-intrusive notification confirms captures without breaking your flow.
- **Offline Queue**: Saves locally in browser storage if Amethyst is closed, and automatically syncs when Amethyst starts.
- **Cross-Browser Manifest V3**: Native support for Chrome, Brave, Edge, and Firefox.

---

## Installation & Setup

### Google Chrome, Brave, and Microsoft Edge

1. Open extension manager:
   - Chrome / Brave: navigate to `chrome://extensions`
   - Edge: navigate to `edge://extensions`
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (or "Load unpacked extension").
4. Select the `extension/` folder in this repository.

### Mozilla Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `extension/manifest.json` from the `extension/` folder.

---

## Configuration

Click the Amethyst icon in the browser toolbar, then click **Settings** (or right-click icon -> Options):

- **Amethyst Server URL**: Defaults to `http://127.0.0.1:4141`.
- **Device Token**: Leave empty for local loopback trust, or provide a paired token if accessing remote instances.
- **Floating Button**: Toggle the floating highlight chip on/off based on your preference.
- **Offline Queue**: View queued items and manually trigger a sync.

---

## Integration Details

- **Target Endpoint**: `POST /api/library` on Amethyst desktop backend.
- **Automatic Enrichment**: Captured items are saved to `~/.amethyst/library/`, summarized, chunked, and indexed in SQLite vector/FTS search automatically.
