# Specification: Library True Bento & Unified Command Deck Redesign

**Date:** 2026-10-21  
**Status:** In Review  
**Branch:** `cleanup/remove-modes-and-dead-code`

---

## 1. Intent & Scope

The Amethyst Library section requires a comprehensive redesign to solve thumbnail letterboxing/cropping, cramped card internals, fragmented multi-tier top controls, and adherence to the project's design system:
1. **The Inside (Card Interior & Media Fitting):**
   - Media containers must fit flush edge-to-edge without artificial letterboxing borders or random cropping.
   - Respect native media aspect ratios (tall 9:16 for Reels/Shorts, 16:9 for landscape videos, 1:1 for square posts, distinct editorial treatment for notes).
   - Generous interior spacing (`padding: 20px 22px 18px 22px`) with clear, consistent hierarchy between titles, subtitles/summaries, and metadata to eliminate congestion.
2. **The Outside (Unified Command Deck & Bento Grid):**
   - Consolidate fragmented search and filter bars into a single, cohesive, animation-packed **Unified Command Deck**.
   - Embed animated Framer Motion format tabs directly into the deck alongside the quick-capture omnibar, categorized filter dropdown, view switcher, and primary action.
   - Restore the dynamic **Bento Grid** layout with rhythmic 2-row vertical spans for reels, wide spans for hero saves, and responsive column breakpoints.
3. **Strict Geometric Rule:** Zero pill-sized elements (`border-radius: 9999px` / `rounded-full`). All elements adhere to Kraken tokens: 4px (`--radius-sm`), 6px (`--radius-cards`), 10px (`--radius-lg`), and 14px (`--radius-xl`).
4. **Prebuilt Component Integration:** Leverage Base UI (`@base-ui/react`) and existing Amethyst UI components (`components/ui/`).

---

## 2. Detailed Architecture & Design

### 2.1 The Inside: True Bento Card Anatomy

Each library card represents a saved knowledge resource (video, article, post, code, note, book). The card is structured into two clean regions: **Flush Media Hero** (when media exists) and **Spacious Editorial Body**.

#### A. Flush Media Hero (`.lib-card-media-wrap`)
- **No Borders or Margins:** The media container sits flush at the top with the card's 6px outer radius.
- **Aspect Ratio Fidelity:**
  - **Reels & Shorts (`.lib-card--portrait`):** `aspect-ratio: 9 / 16`, max-height 380px, `object-fit: cover`. Displays the center frosted play button and top-left platform badge. Spans 2 rows in the bento grid.
  - **Videos (`.lib-card--landscape`):** `aspect-ratio: 16 / 9`, min-height 175px, max-height 215px, `object-fit: cover`. Shows duration overlay badge (`04:15`) in bottom-right with 4px radius.
  - **Posts & Carousels (`.lib-card--square`):** `aspect-ratio: 1 / 1`, min-height 200px, max-height 240px, `object-fit: cover`. Shows slide count badge (e.g., `1/5`) in top-right.
  - **Standard Resources (`.lib-card--standard`):** `aspect-ratio: 16 / 10`, min-height 170px, max-height 210px, `object-fit: cover`.
  - **Notes (`.lib-card--note`):** No media hero. The full card height is an editorial notepad with a distinct surface tint and top monospace header.
- **Subtle Scrim:** Linear gradient overlay (`linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 60%)`) to ensure micro-badges remain legible on bright thumbnails.

#### B. Card Body Hierarchy & Spacing (`.lib-card-body`)
- **Spacing:** `padding: 20px 22px 18px 22px` with a 12px vertical gap between blocks.
- **Layer 1: Source & Platform Strip:**
  - Left: 14px platform icon / favicon + author handle (`@handle` or domain name) with medium font weight (12px).
  - Right: Quick action icons revealed subtly on hover (open original link, trigger AI synthesis, delete) with 4px radii.
- **Layer 2: Title (`.lib-card-title`):**
  - Font size: 16px (`--text-body-lg`), line-height: 1.35, font weight: 600 (`--font-display`).
  - Max 2-line clamp with clean ellipsis. Clickable link to original source.
- **Layer 3: Subtitle & AI Summary (`.lib-card-summary`):**
  - Font size: 13.5px (`--text-input`), line-height: 1.55, color: `var(--text-dim)`.
  - Display clean, readable summary text (max 3-line clamp) without converting markdown bullets to cluttered dot-separated text.
- **Layer 4: Tags Row (`.lib-card-tags-row`):**
  - Crisp rectangular badges with 4px border-radius, `#` hash symbol, 11px font size, and max 3 tags before a `+N` badge.
- **Layer 5: Card Footer (`.lib-card-footer`):**
  - Left: Monospace publication / saved date (11px, `var(--text-faint)`) + duration or reading time.
  - Right: Star rating badge (`5★ Essential` or `4★ High Impact`) with 4px corners and subtle tint.

---

### 2.2 The Outside: Single Unified Command Deck & Layout Grid

#### A. Unified Command Deck (`frontend/src/views/library/LibraryToolbar.jsx`)
Instead of stacked independent bars, the command deck unites search, navigation, filtering, and capture into one seamless row:
1. **Brand & Live Sync:**
   - "Library" title with a live sync indicator (green status dot + syncing count when indexing).
2. **Integrated Omnibar & Quick-Capture:**
   - Centered search input supporting instant full-text filtering.
   - When a URL is pasted, dynamically switches to "Capture" mode with an inline `Save (↵)` action.
   - Keyboard shortcut hint (`Ctrl+/` or `⌘/`) and instant clear button (`X`).
3. **Embedded Format Tabs:**
   - Framer Motion sliding indicator (`layoutId="libCommandFormatTab"`) under active format: `All`, `Videos`, `Posts`, `Notes`, `Code`, `Reading`.
4. **Filter Popover Dropdown:**
   - Single filter button displaying active filter count badge.
   - Opens a structured popover with categorized filters: Rating (5★, 4★+), Platforms (YouTube, Instagram, Spotify, etc.), Categories, and Top Tags.
5. **Deck Controls & Primary Action:**
   - Segmented layout switcher (Grid vs List) with 6px radius.
   - Sort dropdown (Newest, Oldest, Rating).
   - Primary `+ Add` button (`Ctrl+K`) with crisp 6px radius.

#### B. Dynamic Bento Grid (`frontend/src/views/library/LibraryGrid.jsx`)
Restores intelligent bento grid layout calculations:
- `getBentoItemConfig(item, index, totalInGroup)`:
  - Vertical items (Reels/Shorts/TikTok) with thumbnails: `col-span-1 sm:row-span-2`, variant `portrait`.
  - First horizontal item in 4+ item groups or 5-star items: `col-span-1 sm:col-span-2 sm:row-span-1`, variant `wide`.
  - Photo carousels: `col-span-1`, variant `square`.
  - Notes: `col-span-1`, variant `note`.
  - Standard items: `col-span-1`, variant `standard` or `landscape`.
- Grid container: `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))` with 22px gap, scaling dynamically on larger screens.

---

### 2.3 Strict Design Tokens & Non-Pill Geometry

| Component | Target Border Radius | Token Mapping |
| :--- | :--- | :--- |
| **Card Outer Frame** | `6px` | `--radius-cards` / `--r-md` |
| **Media Containers** | `6px` top corners, `0` bottom | Top card edge flush |
| **Tags & Micro-Badges** | `4px` | `--radius-links` / `--radius-sm` |
| **Buttons & Input Bars** | `6px` | `--radius-cards` |
| **Filter Popover & Menus** | `10px` | `--radius-lg` / `--r-xl` |
| **Segmented Switcher** | `6px` frame, `4px` buttons | `--radius-cards` / `--radius-sm` |
| **Status Dots** | `50%` (strictly for 7px dots) | Semantic live indicators only |

---

## 3. Implementation Plan & File Touchpoints

1. **`frontend/src/views/library/LibraryCard.jsx`**:
   - Re-implement aspect-ratio media hero rendering (`portrait`, `landscape`, `square`, `wide`, `note`).
   - Re-introduce video play button overlay and platform glass badge on thumbnails.
   - Clean up summary rendering (preserve natural line breaks/sentences, eliminate ugly `formatInlineMarkdown` dot-chaining).
   - Expand interior padding and vertical spacing.
2. **`frontend/src/views/library/LibraryGrid.jsx`**:
   - Restore true bento layout calculation for tall 2-row vertical reels and wide feature items.
3. **`frontend/src/views/library/LibraryToolbar.jsx`**:
   - Rebuild into the Single Unified Command Deck combining Brand, Omnibar, Embedded Format Tabs, Filter Dropdown, and Actions into one cohesive bar.
4. **`frontend/src/views/library/LibraryFilterBar.jsx`**:
   - Streamline into a sleek active-filter indicator strip and lightweight popover provider.
5. **`frontend/src/views/library/library.css`**:
   - Restore aspect-ratio media classes (`.lib-card--portrait`, `.lib-card--landscape`, `.lib-card--square`, `.lib-card--wide`, `.lib-card--note`).
   - Remove rigid 190px height overrides.
   - Apply generous 20px body padding, clean typography clamp styles, and zero pills.
6. **Verification & Testing**:
   - Run `npm run test:library` (unit tests).
   - Run `npm run build` (production Vite bundling).
   - Validate live rendering at `http://localhost:8001/library`.
