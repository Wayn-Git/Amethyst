# Desktop Onboarding Redesign Specification

**Date:** 2026-11-08  
**Status:** Validated Design  
**Origin Reference:** `docs/UI/mobile/Amethyst Desktop Onboarding.html`  
**Target Surface:** `frontend/src/components/SplashScreenWizard.jsx`, `frontend/src/components/SplashScreenWizard.css`

---

## 1. Overview & Vision

Amethyst's first-run onboarding replaces the previous full-screen wizard and third-party HTTP Shortcuts flow with a floating desktop window with rounded corners, inspired by the high-craft design in `Amethyst Desktop Onboarding.html`.

The window is non-fullscreen: a centered floating stage (`width: min(1280px, 94vw); height: min(800px, 90vh)`) with a deep gradient backdrop (`#2441ff` with radial glow accents), authentic window traffic lights (`#ff5f57`, `#febc2e`, `#28c840`), and an inner split-card (`960×540px`) featuring a perforated ticket divider (`.pf`).

### Core Pillars
1. **Real Data Only**: Absolutely no mock accounts or simulated keys. Direct queries to local Ollama (`localhost:11434`), live API key validation for cloud providers, Composio OAuth for Google Drive, and Contract v2 cert-pinned LAN pairing (`:8443`).
2. **OS-Aware Copy**: Dynamic operating system detection adapts "Everything stays on this Mac" to "Everything stays on this PC" (Windows) or "Everything stays on this computer" (Linux).
3. **Motion & Delight**: Built following Emil Kowalski's animation rules (`better-ui`, `find-animation-opportunities`). First-time onboarding receives the full delight budget: floating ambient satellites, smooth spring-based pane transitions (`stiffness: 340, damping: 28`), responsive hover lifts, and celebratory launch completion.
4. **Wayn Design & Amethyst Branding**: Features the authentic Amethyst gem logo (`AmethystLogo.jsx`), squircle geometry, and unified theme/accent tokens.

---

## 2. Multi-Screen Architecture & Flow

The onboarding sequence consists of a boot splash, welcome hero, and 5 sequential configuration steps:

```
[0. Splash] ──> [Welcome] ──> [1. Profile] ──> [2. AI Engine] ──> [3. Storage] ──> [4. Mobile] ──> [5. Launch]
 Boot health     Hero pitch    Name, handle,    Ollama scan,      Composio key,   Contract v2    Pre-flight check,
 & vault load    & features    theme & accent   free cloud keys   Google Drive    QR & APK DL    open Amethyst
```

### Screen 0: Splash (`Splash`)
- **Visuals**: Centered squircle badge (`104×104px`, `border-radius: 28px`, white background) housing the Amethyst logo (`width: 60px`), sleek loading bar (`132×4px` with indeterminate pulse), status label "Starting local services", monospace subtext "127.0.0.1 · opening vault".
- **Bottom Disclaimer**: "Everything stays on this [Mac/PC/computer] until you connect something."
- **Backend Trigger**: Invokes `api.setupStatus()` or `/api/ping`. Once backend services report healthy, automatically advances to Welcome after 800ms.

### Screen 1: Welcome (`Welcome`)
- **Left Pane (`.lf`, 348px)**:
  - Amethyst logo (`28×28px`).
  - Headline: "Meet Amethyst." (`font-size: 44px`, bold).
  - Subtitle: "Your private workspace for AI, files and everything in between."
  - Primary CTA: "Get started" with directional arrow icon, styled in user's active accent color.
  - Sub-caption: "Setup takes about three minutes".
- **Right Pane (`.rt`, deep midnight `#1a1d3a`)**:
  - Center floating Amethyst app badge (`164×164px`, `border-radius: 44px`, subtle shadow `0 20px 60px rgba(0,0,0,0.4)`).
  - 4 floating satellite chips with slow ambient levitation:
    1. `AI` (sparkle icon, top-left)
    2. `Files` (folder icon, top-right)
    3. `Phone` (mobile icon, bottom-left)
    4. `Apps` (cloud/layers icon, bottom-right)

### Screen 2: Step 1 of 5 — Profile (`Profile`)
- **Left Pane**: Step tracker "Step 1 of 5 · Profile", Title "Make it yours", Description "Tell Amethyst who you are and how it should look. Changes apply right away.", Navigation buttons ("Back", "Continue").
- **Right Pane**:
  - **Identity Header**: Large monogram / avatar badge (`76×76px`, `border-radius: 22px`, auto-initials) + Display Name input + Full Name input.
  - **Handle Row**: `@handle` input field.
  - **Theme Grid**: 9 themes in 2 rows (`System`, `Graphite`, `Ink`, `Nocturne`, `NVIDIA`, `Paper`, `Sand`, `Claude`, `Cursor`). Each card has a mini representation of header bars and text lines. Active theme gets a crisp white outline ring (`box-shadow: 0 0 0 2px #fff`).
  - **Accent Swatches**: 5 circular color swatches (`Amethyst #7132f5`, `Cobalt #2563eb`, `Emerald #10b981`, `Coral #f43f5e`, `Amber #f59e0b`).
  - Selecting theme or accent immediately updates `document.documentElement` attributes.

### Screen 3: Step 2 of 5 — AI Engine (`AiEngine`)
- **Left Pane**: Step tracker "Step 2 of 5 · AI engine", Title "Choose your AI engine", Description "Run a model on this [Mac/PC/computer], or connect a free cloud provider. You can add more later.", "Skip for now" link.
- **Right Pane**:
  - **Local Model Group ("On this [Mac/PC/computer]")**:
    - Ollama card: Status tag ("Found on this Mac" or "Offline"), port badge `localhost:11434/v1`.
    - Pill row with detected Ollama models (e.g. `llama3.2:3b`, `qwen2.5:7b`).
    - Benefit pill: "Private · No API cost · Works offline".
  - **Free Cloud Providers Group**:
    - Clipboard-aware API key input with instant "Paste" accelerator button.
    - Provider rows:
      - Groq (`llama-3.3-70b-versatile`)
      - Google Gemini (`gemini-2.0-flash`)
      - Kilo Code (`kilo-auto/free`)
      - OpenRouter (`free` models)
    - Verification: Clicking a provider tests credentials via `api.verifyProvider()`, shows live latency tag.

### Screen 4: Step 3 of 5 — Storage & Knowledge (`Storage`)
- **Left Pane**: Step tracker "Step 3 of 5 · Storage", Title "Knowledge & storage", Description "Connect the places your work lives. Composio and Google Drive are required to continue; toolkits are optional."
- **Right Pane**:
  - **Required Group**:
    - **Composio**: API key input with link to "Get a free key ↗".
    - **Google Drive**: OAuth initiation via Composio. Displays connected account email and verified root folder: `My Drive / Amethyst /`.
    - Descriptive note: "Library items and your phone's drop-box live in this folder. We create it if it's missing."
  - **Optional Toolkits Grid (3 columns)**:
    - Interactive toggle cards for: `Gmail`, `Google Calendar`, `Slack`, `GitHub`, `Linear`, `Notion`.
    - Checkbox indicator with subtle glow on active states.

### Screen 5: Step 4 of 5 — Mobile Companion (`Mobile`)
- **Left Pane**: Step tracker "Step 4 of 5 · Mobile", Title "Bring Amethyst to your phone", Description "Send things to your library from anywhere. Optional, and you can do it later.", "Pair later from Settings" button.
- **Right Pane**:
  - **Segmented Tabs**: `Scan to pair` vs `Download app`.
  - **Scan to Pair Tab**:
    - Renders real Contract v2 pairing QR code (160-bit secret, AES-256 cert-pinned payload over LAN port 8443).
    - 3-step numbered guide:
      1. Open Amethyst on your phone
      2. Tap Pair with desktop
      3. Point camera at this code
    - Security & Status Badges:
      - `LAN :8443 · AES-256 · cert-pinned`
      - Pulsing live badge: `Listening for your phone…` (uses SSE listener for `pairing_request`).
  - **Download App Tab**:
    - QR code linking directly to `/install` APK or release download.
    - Direct download button for `.apk`.
  - **Footer Security Guarantee**: Lock icon + "Pairing happens over your local network. Nothing goes through a server."

### Screen 6: Step 5 of 5 — Launchpad (`Launch`)
- **Left Pane**: Step tracker "Step 5 of 5 · Launch", Title "You're all set, {Name}.", Description "Amethyst is ready. Everything stays on this [Mac/PC/computer] until you connect something.", Primary CTA "Open Amethyst" with accent fill.
- **Right Pane**:
  - "Your setup" summary card with verified green checkmark badges:
    - **Profile**: `{Name} · @{handle}`
    - **AI engine**: `{Active Provider} · {Model name}`
    - **Storage**: `Composio · Google Drive` (or `Local Vault`)
    - **Apps**: `{Active toolkits comma-separated}`
    - **Mobile**: `{Phone Name Paired}` or `Pair later from Settings`
  - Sub-caption: "You can change any of this later in Settings."
- **Completion Effect**:
  - Clicking "Open Amethyst" calls `api.completeSetup()`, sets `onboardingDone: true`, fires confetti cannon, and smoothly unmounts into the Today dashboard.

---

## 3. Component Details & CSS Tokens

### Window Geometry & Container
```css
.amethyst-onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(10, 15, 30, 0.7);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.amethyst-onboarding-window {
  width: min(1280px, 94vw);
  height: min(800px, 90vh);
  border-radius: 20px;
  position: relative;
  overflow: hidden;
  color: #fff;
  background: radial-gradient(60% 70% at 85% 10%, #5f8cff 0, transparent 70%),
              radial-gradient(60% 70% at 10% 95%, #1328d6 0, transparent 70%),
              #2441ff;
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.amethyst-onboarding-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(960px, calc(100% - 48px));
  height: min(540px, calc(100% - 64px));
  border-radius: 20px;
  overflow: hidden;
  display: flex;
  box-shadow: 0 30px 80px #0a1260aa;
}

.amethyst-perforated-edge {
  width: 12px;
  background: radial-gradient(circle at 100% 50%, #1a1d3a 0 5px, #222226 5.5px) 0 0/12px 14px repeat-y;
  flex: none;
}
```

### OS Detection Utility
```javascript
export function getClientOS() {
  if (typeof window === 'undefined') return 'Mac'
  const ua = window.navigator.userAgent.toLowerCase()
  if (ua.includes('mac') || ua.includes('darwin')) return 'Mac'
  if (ua.includes('win')) return 'PC'
  if (ua.includes('linux')) return 'Linux machine'
  return 'computer'
}
```

---

## 4. Animation Opportunities & Rules (Emil Kowalski Rubric)

1. **Window Entrance**: Staggered zoom-in with spring physics (`scale: 0.96 -> 1, opacity: 0 -> 1, duration: 240ms, ease: [0.16, 1, 0.3, 1]`).
2. **Step Transitions**: Mode `"wait"` AnimatePresence. Exiting pane slides out `-16px` with blur (`4px`) over `150ms`. Entering pane slides in from `16px` over `220ms`.
3. **Satellites Float**: Subtle CSS sinusoidal bob (`transform: translateY(-6px) -> translateY(6px)`) staggered with different durations (3.2s, 4.1s, 3.7s, 4.5s).
4. **Button Scale on Press**: Active buttons scale to `0.96` over `120ms`.
5. **Listening Pulse**: Glowing green/blue radar ring around `:8443` pairing chip.
6. **Reduced Motion**: Full fallback to plain opacity fades (`duration: 150ms`) when `useReducedMotion()` is active.

---

## 5. Backend Wiring & Data Contracts

| Step | Endpoint / Method | Purpose |
|---|---|---|
| Splash | `api.setupStatus()` | Probes server health, Ollama status, app settings |
| Profile | `api.updateUserProfile(profile)` | Saves name, handle, avatar shape in SQLite |
| Profile | `store.setTheme(id)`, `store.setAccent(hex)` | Instant UI theme sync |
| AI Engine | `api.detectModels()` | Scans local Ollama at `localhost:11434` |
| AI Engine | `api.verifyProvider(slug, key)` | Validates API key and computes roundtrip latency |
| Storage | `api.updateLibraryCloudStorage()` | Connects Composio Google Drive root |
| Mobile | `api.startPairingV2()` | Inits Contract v2 LAN pairing session, returns QR payload |
| Mobile | SSE `pairing_request` | Receives instant notification when phone scans code |
| Launch | `api.completeSetup()` | Writes `onboarding_completed: true` to SQLite `app_settings` |

---

## 6. Implementation Strategy

1. Replace `frontend/src/components/SplashScreenWizard.jsx` with the modernized multi-step component structured to match `Amethyst Desktop Onboarding.html`.
2. Replace `frontend/src/components/SplashScreenWizard.css` with the verified styling, ticket perforation `.pf`, typography, and responsive variables.
3. Update unit and E2E test suites in `frontend/tests/` to verify all 5 steps pass without legacy Cloudflare or HTTP Shortcuts references.
