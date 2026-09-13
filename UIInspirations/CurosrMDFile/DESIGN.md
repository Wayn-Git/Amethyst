# Cursor — Style Reference
> Warm parchment atelier lit by embers

**Theme:** light

Cursor uses a warm parchment editorial language: cream canvas, ink-black text, and a single ember-orange accent that activates links and emphasis rather than filling buttons. Headlines whisper at weight 400 in CursorGothic with progressively tighter tracking as size grows — authority comes from restraint and letter-tightening, never from bold weight. Surfaces stay flat and paper-like with hairline borders and soft warm-gray shadows; corners stay sharp at 4px throughout. EB Garamond appears selectively for editorial subheadings and prose, and berkeleyMono handles code, labels, and metadata, giving the system a typographic personality that feels closer to a literary journal than a SaaS dashboard.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Parchment | `#f7f7f4` | `--color-parchment` | Page background, primary canvas — warm cream that softens contrast and makes ink feel printed rather than digital |
| Bone | `#f2f1ed` | `--color-bone` | Card surfaces and elevated containers — one step darker than canvas, creates paper-on-paper layering without borders |
| Linen | `#e6e5e0` | `--color-linen` | Light neutral action fill for buttons on dark surfaces. |
| Stone | `#cdcdc9` | `--color-stone` | Hairline borders, dividers, subtle separators — warm-tinted 1px rules |
| Mist | `#a1a19f` | `--color-mist` | Tertiary helper text, captions — between muted and secondary |
| Driftwood | `#84847e` | `--color-driftwood` | Secondary body text, table content — quieter than primary ink |
| Ash | `#7a7974` | `--color-ash` | Icon fills, tertiary body text, subdued UI labels — the workhorse muted tone |
| Ink | `#26251e` | `--color-ink` | Primary text, primary action button background, nav text — warm-tinted near-black, never pure #000 |
| Ember | `#f54e00` | `--color-ember` | Orange text accent for links, tags, and emphasized short phrases. Do not promote it to the primary CTA color |
| Amber | `#c08532` | `--color-amber` | Warm action button fill (Build, Continue) and accent icon strokes — earthy companion to ember, used in product UI chrome |
| Forest | `#34785c` | `--color-forest` | Green action color for filled buttons, selected navigation states, and focused conversion moments. Use as a supporting accent, not as a status color |
| Verdant | `#1f8a65` | `--color-verdant` | Green text accent for links, tags, and emphasized short phrases. Use as a supporting accent, not as a status color |
| Crimson | `#cf2d56` | `--color-crimson` | Red text accent for links, tags, and emphasized short phrases. Use as a supporting accent, not as a status color |

## Tokens — Typography

### CursorGothic — Primary typeface for UI, headings, navigation, body, and product surfaces. Weight 400 headlines with progressively tighter letter-spacing (-0.005em at 22px → -0.03em at 72px) is the signature — headlines never bold. Font features ss08, ss09, tnum activate stylistic alternates and tabular numerals. · `--font-cursorgothic`
- **Substitute:** Inter, system-ui, Helvetica Neue
- **Weights:** 400, 500
- **Sizes:** 11px, 13px, 14px, 16px, 22px, 26px, 36px, 72px
- **Line height:** 1.00–1.50
- **Letter spacing:** 0.01em at 14px → -0.005em at 22px → -0.012em at 26px → -0.02em at 36px → -0.03em at 72px
- **OpenType features:** `"ss08", "ss09", "tnum"`
- **Role:** Primary typeface for UI, headings, navigation, body, and product surfaces. Weight 400 headlines with progressively tighter letter-spacing (-0.005em at 22px → -0.03em at 72px) is the signature — headlines never bold. Font features ss08, ss09, tnum activate stylistic alternates and tabular numerals.

### EB Garamond — Editorial serif for select subheadings, prose body, and table data — adds literary texture against the CursorGothic UI shell · `--font-eb-garamond`
- **Substitute:** Iowan Old Style, Palatino Linotype, ui-serif, Georgia
- **Weights:** 400, 500
- **Sizes:** 16px, 17px, 19px
- **Line height:** 1.35–1.50
- **Letter spacing:** normal
- **OpenType features:** `"cswh"`
- **Role:** Editorial serif for select subheadings, prose body, and table data — adds literary texture against the CursorGothic UI shell

### berkeleyMono — Monospace for code blocks, CLI snippets, metadata tags, file paths, and developer-facing labels — the technical voice · `--font-berkeleymono`
- **Substitute:** ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas
- **Weights:** 400, 500
- **Sizes:** 12px, 13px
- **Line height:** 1.43–1.67
- **Role:** Monospace for code blocks, CLI snippets, metadata tags, file paths, and developer-facing labels — the technical voice

### system-ui — Secondary system text for small meta labels and supplementary UI where a custom font is overkill · `--font-system-ui`
- **Substitute:** system-ui, -apple-system, Helvetica Neue
- **Weights:** 400, 500, 600, 700
- **Sizes:** 11px, 12px, 13px
- **Line height:** 1.25–1.55
- **Letter spacing:** 0.004em
- **OpenType features:** `"case"`
- **Role:** Secondary system text for small meta labels and supplementary UI where a custom font is overkill

### Lato — Lato — detected in extracted data but not described by AI · `--font-lato`
- **Weights:** 400, 600
- **Sizes:** 10px, 12px, 14px, 16px
- **Line height:** 1.1, 1.27, 1.33, 1.5
- **Letter spacing:** 0.004
- **Role:** Lato — detected in extracted data but not described by AI

### -apple-system — -apple-system — detected in extracted data but not described by AI · `--font-apple-system`
- **Weights:** 400
- **Sizes:** 16px
- **Line height:** 1.5
- **Role:** -apple-system — detected in extracted data but not described by AI

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| eyebrow | 12px | 1.63 | — | `--text-eyebrow` |
| body-sm | 14px | 1.5 | 0.14px | `--text-body-sm` |
| heading-sm | 22px | 1.3 | -0.11px | `--text-heading-sm` |
| heading | 26px | 1.25 | -0.312px | `--text-heading` |
| heading-lg | 36px | 1.2 | -0.72px | `--text-heading-lg` |
| display | 72px | 1.1 | -2.16px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** compact

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 48 | 48px | `--spacing-48` |
| 56 | 56px | `--spacing-56` |
| 64 | 64px | `--spacing-64` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 4px |
| tiles | 4px |
| inputs | 4px |
| modals | 8px |
| buttons | 4px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| xl | `rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1)...` | `--shadow-xl` |
| subtle | `rgb(235, 234, 229) 0px 0px 0px 2px` | `--shadow-subtle` |
| xl-2 | `rgba(0, 0, 0, 0.25) 0px 25px 50px -12px, rgba(0, 0, 0, 0....` | `--shadow-xl-2` |
| subtle-2 | `oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1...` | `--shadow-subtle-2` |

### Layout

- **Page max-width:** 1300px
- **Section gap:** 64-96px
- **Card padding:** 24px
- **Element gap:** 8px

## Components

### Primary Filled Button (Download)
**Role:** Hero CTA, top-bar Download

Background #26251 (Ink), text #f7f7f4 (Parchment), 4px radius, padding 0.78em 1.35em 0.8em, CursorGothic 14px weight 400. This is the highest-contrast action on the page — the dark pill against cream canvas. No gradient, no border. Transition: color/background 150ms cubic-bezier(0.4, 0, 0.2, 1).

### Secondary Filled Button
**Role:** Secondary CTA (Request a demo, Continue)

Background #e6e5e0 (Linen), text #26251 (Ink), 4px radius, padding 0.78em 1.35em 0.8em, CursorGothic 14px weight 400. Arrow glyph (→) in same color as label. Lighter visual weight than primary; pairs next to it in the hero.

### Ghost Text Button
**Role:** Inline actions, nav items, skip links

Background transparent, text #26251 with 60% opacity, no border, no padding (or 6px square padding for icon variants), 4px radius. Underline on hover. CursorGothic 13–14px weight 400.

### Amber Action Button
**Role:** In-product action (Build, Continue)

Background #c08532 (Amber), text light cream, 4px radius. Used inside macOS window mockups and CLI/agent UI where warm chromatic punctuation is needed. Compact padding 6px 12px.

### Forest Action Button
**Role:** Success / PR actions (View PR)

Background #34785c (Forest), text #f7f7f4, 1px border in same green, 4px radius. Solid filled variant for review/merge confirmations in product mockups.

### Default Product Card
**Role:** Container for screenshots, feature blocks, logo strip

Background #f2f1ed (Bone), 4px radius, 1px border color-mix(in oklab, #26251 5%, transparent), soft elevation: 28px 70px / 14px 32px double-layer warm shadow. Padding 24px internal. No drop shadow on flat list variants.

### Logo Trust Tile
**Role:** Customer logos in social-proof row

Background #e6e5e0 (Linen), fully rounded (pill shape via flex/aspect-square), 4px visual feel, logo rendered in #26251 at 60% opacity. 16px internal padding. Arranged in a single horizontal row at section width.

### Window Mockup Frame
**Role:** macOS product screenshot container

Outer card at #f2f1ed with 4px radius and hairline border + soft elevation. Inner window chrome: three traffic-light dots (gray), centered title in 13px system-ui, tab strip with active state underline. File tabs use berkeleyMono 12px. No hard drop shadow on the window itself — the surrounding card provides elevation.

### Navigation Bar
**Role:** Top site header

Transparent background, 52px height, 24px horizontal padding, logo + wordmark left at 14px weight 500 CursorGothic, nav links center at 14px CursorGothic weight 400, right cluster: text Sign in, ghost Contact sales, filled Download pill. No sticky shadow.

### Terminal Input Field
**Role:** CLI command bar, curl/install snippets

Background transparent or #f2f1ed, 1px solid border in color-mix(#26251 10%, transparent), 4px radius, 10px 12px padding, text in berkeleyMono 12px, caret in #26251e. Prompt character ($ or >) in #7a7974.

### Footer Link Column
**Role:** Footer sitemap groups

Column heading in CursorGothic 14px weight 500 #26251, link list below in 13px weight 400 #7a7974, 8px row gap. No background card — sits directly on canvas.

### Mono Metadata Tag
**Role:** Status labels, file names, model names

Background transparent, text in berkeleyMono 12px #7a7974, no border, no radius. Used inline with body text to mark file types, timestamps, and developer metadata.

### Selection Highlight
**Role:** Text selection

Background #8BC4F8 — the only cool tone in the system, reserved exclusively for browser text selection to avoid competing with the warm palette.

## Do's and Don'ts

### Do
- Use 4px border-radius on every button, card, input, and tile — 4px appears 137× in the data and defines the sharp-but-not-angular feel
- Set all headlines at weight 400 in CursorGothic; never use 600+ for display sizes — the whisper-weight with tight tracking IS the signature
- Apply progressively tighter letter-spacing as type grows: 0.01em at 14px → -0.005em at 22px → -0.012em at 26px → -0.02em at 36px → -0.03em at 72px
- Use #f7f7f4 Parchment as canvas and #f2f1ed Bone as card surface; layer with 1px borders in color-mix(#26251 5–10%, transparent) before reaching for shadows
- Use #f54e00 Ember only on inline text links and emphasis — never as a button background, large surface, or icon fill
- Reach for EB Garamond serif on editorial subheadings and prose blocks; keep it away from UI labels and navigation
- Use berkeleyMono 12px for all code, file paths, CLI commands, and developer-facing metadata
- Pair the dark filled button (#26251 on #f7f7f4) with a light secondary (#e6e5e0) in the same action group — never stack two filled buttons of the same weight

### Don't
- Do not use pure white (#ffffff) or pure black (#000000) — the system is built on warm cream and warm ink; pure neutrals break the parchment feel
- Do not apply weight 600 or 700 to headings — the signature is weight 400 headlines; bold kills the editorial restraint
- Do not use pill shapes (radius ≥ 999px) on buttons or cards — 4px is the workhorse; pill rounding breaks the paper-cut geometry
- Do not introduce gradients, glows, or color washes — the system is flat and editorial; depth comes only from hairline borders and soft warm-gray shadows
- Do not tint shadows blue or cool — shadows must stay warm rgba(0,0,0,0.14) over cream to feel like paper, not glass
- Do not apply the Ember orange (#f54e00) to backgrounds or large fills — it is text-only punctuation, not a surface color
- Do not use the system-ui font for headings or prominent text — reserve it for micro labels where custom fonts add noise
- Do not stack more than two button styles in a single action group — one filled dark + one filled light, or one filled + one ghost, never three filled

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Canvas | `#f7f7f4` | Page background |
| 2 | Card | `#f2f1ed` | Default card surface, product mockup background |
| 3 | Elevated | `#e6e5e0` | Secondary buttons, logo tiles, higher-elevation cards |
| 4 | Outline | `#cdcdc9` | Hairline borders on elevated surfaces |

## Elevation

- **Product mockup card:** `rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263 -0.002 0.012 / 0.1) 0px 0px 0px 1px`
- **Flyout / popover:** `0 0 1rem #00000005, 0 0 0.5rem #00000002`
- **Window inset top border:** `0 -1px 0 0 var(--color-theme-border-02) inset`

## Imagery

Product screenshots dominate — large macOS window mockups showing the Cursor IDE in action: file tabs, diff views, agent plans, terminal panels, Slack/chat integrations. Each window mockup sits inside a #f2f1ed card frame with soft warm elevation. A muted landscape photograph (mountains/desert horizon) bleeds behind the hero section, adding warmth without competing with the UI. Customer logos (Stripe, OpenAI, Linear, Datadog, NVIDIA, Figma, Ramp, Adobe) appear as monochrome wordmarks inside pill-shaped Linen tiles. No people photography, no illustrations, no abstract decorative graphics — the product UI and brand wordmarks carry all visual weight. Icons throughout are thin-stroke monoline glyphs filled in #7a7974 Ash, never chromatic.

## Layout

Max-width 1300px centered, 24px outer padding. Top nav: 52px tall transparent header with logo + wordmark left, 4 nav links center, Sign in / Contact / Download right-aligned cluster. Hero: left-aligned headline + dual CTA stack with text descending from top-left, then a full-width product mockup card spanning below. Trust strip: single horizontal row of 8 logo tiles in a single line at section width. Feature sections alternate left-text + right-screenshot in two-column layout, each 50/50, with 64–96px vertical rhythm between sections. All feature screenshots are window mockups with identical macOS chrome. Footer: four-column link grid with brand mark left. Sections separated by generous breathing room rather than dividers — the cream canvas itself provides separation.

## Agent Prompt Guide

**Quick Color Reference**
- text: #26251e
- background: #f7f7f4
- card surface: #f2f1ed
- border: #cdcdc9
- accent (links/emphasis): #f54e00
- primary action: #26251e (filled action)

**Example Component Prompts**

1. *Hero headline block*: CursorGothic 72px weight 400, color #26251e, letter-spacing -2.16px, line-height 1.1, set on #f7f7f4 canvas with 80px top padding.

2. Create a Primary Action Button: #26251e background, #ffffff text, 9999px radius, compact pill padding. Use this filled treatment for the main CTA.

3. *Product mockup card*: background #f2f1ed, 4px radius, 1px solid border color-mix(in oklab, #26251e 5%, transparent), box-shadow 0 28px 70px rgba(0,0,0,0.14) + 0 14px 32px rgba(0,0,0,0.1), 24px internal padding, containing a macOS window frame with three gray dots and a centered title.

4. *Feature section (text + screenshot)*: two-column grid, left column 40% width with heading-sm at 22px weight 400 tracking -0.11em and body at 16px weight 400 #26251e; right column 60% width with a product mockup card identical to prompt 3.

5. *Inline accent link*: body text 16px CursorGothic #26251e with an inline link in #f54e00, no underline at rest, underline on hover, transition 150ms cubic-bezier(0.4, 0, 0.2, 1).

6. *Terminal command snippet*: monospace block at #f2f1ed background, 4px radius, 1px border, padding 10px 12px, text in berkeleyMono 12px #26251e, prompt glyph ($) in #7a7974.

## Similar Brands

- **Linear** — Same monochrome cream-on-ink palette, 4px sharp corners, weight 400 whisper-headlines, and warm-gray shadows — Linear and Cursor share the editorial-paper aesthetic over flashy gradients
- **Vercel** — Light-theme monochrome base with a single chromatic accent color and compact 4px-based spacing; both treat the page canvas as warm off-white rather than pure white
- **Stripe** — Document-style typography hierarchy with tight tracking on display sizes, warm gradient-free surfaces, and small chromatic accents used sparingly for links and emphasis
- **Arc Browser** — Warm cream and soft-shadow product showcase cards with hairline borders, giving window mockups a paper-elevated feel rather than glass-elevated
- **Notion** — Restrained nearly-monochrome palette with one warm accent, compact density, and editorial serif touches appearing selectively against a geometric sans-serif body

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-parchment: #f7f7f4;
  --color-bone: #f2f1ed;
  --color-linen: #e6e5e0;
  --color-stone: #cdcdc9;
  --color-mist: #a1a19f;
  --color-driftwood: #84847e;
  --color-ash: #7a7974;
  --color-ink: #26251e;
  --color-ember: #f54e00;
  --color-amber: #c08532;
  --color-forest: #34785c;
  --color-verdant: #1f8a65;
  --color-crimson: #cf2d56;

  /* Typography — Font Families */
  --font-cursorgothic: 'CursorGothic', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-eb-garamond: 'EB Garamond', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-berkeleymono: 'berkeleyMono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-system-ui: 'system-ui', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-lato: 'Lato', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-apple-system: '-apple-system', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-eyebrow: 12px;
  --leading-eyebrow: 1.63;
  --text-body-sm: 14px;
  --leading-body-sm: 1.5;
  --tracking-body-sm: 0.14px;
  --text-heading-sm: 22px;
  --leading-heading-sm: 1.3;
  --tracking-heading-sm: -0.11px;
  --text-heading: 26px;
  --leading-heading: 1.25;
  --tracking-heading: -0.312px;
  --text-heading-lg: 36px;
  --leading-heading-lg: 1.2;
  --tracking-heading-lg: -0.72px;
  --text-display: 72px;
  --leading-display: 1.1;
  --tracking-display: -2.16px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-64: 64px;

  /* Layout */
  --page-max-width: 1300px;
  --section-gap: 64-96px;
  --card-padding: 24px;
  --element-gap: 8px;

  /* Border Radius */
  --radius-sm: 1.5px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Named Radii */
  --radius-cards: 4px;
  --radius-tiles: 4px;
  --radius-inputs: 4px;
  --radius-modals: 8px;
  --radius-buttons: 4px;

  /* Shadows */
  --shadow-xl: rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px;
  --shadow-subtle: rgb(235, 234, 229) 0px 0px 0px 2px;
  --shadow-xl-2: rgba(0, 0, 0, 0.25) 0px 25px 50px -12px, rgba(0, 0, 0, 0.15) 0px 12px 24px -8px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 0.5px;
  --shadow-subtle-2: oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.28) 0px 18px 36px -18px;

  /* Surfaces */
  --surface-canvas: #f7f7f4;
  --surface-card: #f2f1ed;
  --surface-elevated: #e6e5e0;
  --surface-outline: #cdcdc9;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-parchment: #f7f7f4;
  --color-bone: #f2f1ed;
  --color-linen: #e6e5e0;
  --color-stone: #cdcdc9;
  --color-mist: #a1a19f;
  --color-driftwood: #84847e;
  --color-ash: #7a7974;
  --color-ink: #26251e;
  --color-ember: #f54e00;
  --color-amber: #c08532;
  --color-forest: #34785c;
  --color-verdant: #1f8a65;
  --color-crimson: #cf2d56;

  /* Typography */
  --font-cursorgothic: 'CursorGothic', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-eb-garamond: 'EB Garamond', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-berkeleymono: 'berkeleyMono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-system-ui: 'system-ui', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-lato: 'Lato', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-apple-system: '-apple-system', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-eyebrow: 12px;
  --leading-eyebrow: 1.63;
  --text-body-sm: 14px;
  --leading-body-sm: 1.5;
  --tracking-body-sm: 0.14px;
  --text-heading-sm: 22px;
  --leading-heading-sm: 1.3;
  --tracking-heading-sm: -0.11px;
  --text-heading: 26px;
  --leading-heading: 1.25;
  --tracking-heading: -0.312px;
  --text-heading-lg: 36px;
  --leading-heading-lg: 1.2;
  --tracking-heading-lg: -0.72px;
  --text-display: 72px;
  --leading-display: 1.1;
  --tracking-display: -2.16px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-64: 64px;

  /* Border Radius */
  --radius-sm: 1.5px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Shadows */
  --shadow-xl: rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px;
  --shadow-subtle: rgb(235, 234, 229) 0px 0px 0px 2px;
  --shadow-xl-2: rgba(0, 0, 0, 0.25) 0px 25px 50px -12px, rgba(0, 0, 0, 0.15) 0px 12px 24px -8px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 0.5px;
  --shadow-subtle-2: oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.28) 0px 18px 36px -18px;
}
```
