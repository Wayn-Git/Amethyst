## Overview

Mobbin is a reference library of real product interfaces, and its own interface is engineered to get out of the way. The system is strictly monochrome: near-black ink (`{colors.ink}` — #141414) on a pure white canvas (`{colors.canvas}`), with structure carried by a ladder of barely-perceptible neutral tints rather than by shadows or color. The thousands of app screenshots, icon tiles, and brand logos the site exists to show are the only saturated elements on any page — the chrome frames them the way a gallery wall frames paintings.

The geometry does the brand work that color refuses to do. Every interactive element is a stadium pill (`{rounded.full}`): the floating navigation bar, every button, the segmented billing toggle, the overlay badges. Containers sit at a calm `{rounded.md}` (24px), media tiles at `{rounded.sm}` (16px), and app icons render as iOS-style squircles at 30% corner radius. Type is set in Saans at deliberately non-standard variable weights — a chunky 652 for every heading, a bookish 456 for text, an airy 300 for hero subtitles — which gives the monochrome pages a strong typographic voice without a single decorative flourish.

One color is allowed to interrupt: an electric blue accent (`{colors.accent}` — #0066ff), used exclusively for commercial signals — the "Popular" plan badge and the yearly-savings callout on pricing. Its scarcity is the point; when blue appears, it is asking for a decision.

**Key Characteristics:**
- Gallery-white monochrome palette — `{colors.ink}` on `{colors.canvas}`, zero brand chroma outside the single `{colors.accent}` blue
- Stadium-pill interaction language: nav bar, buttons, toggles, and badges all at `{rounded.full}`
- Shadow-free elevation — hierarchy built from a neutral tint ladder (`{colors.canvas-soft}`, `{colors.field}`, `{colors.hairline}`) and 1px hairlines
- Saans at signature variable weights: 652 headings with tight 1.0–1.13 line-height, 456 body, 300 light subtitles
- iOS-style squircle icon tiles (30% radius) as a recurring visual motif across library counters and brand marquees
- Content supplies the color: app screenshots, brand icons, and grayscale curator portraits carry all visual richness
- Full-bleed near-black `{colors.ink}` footer with rounded top corners closes every page in polarity inversion

## Colors

Source pages: home, pricing, awards, signup.

### Brand & Accent
- **Ink Black** (`{colors.primary}` — #141414): The brand color. Fills every primary CTA pill, the footer band, and all display typography. Mobbin's identity is this near-black, softened just off pure black to sit comfortably next to photography.
- **Electric Blue** (`{colors.accent}` — #0066ff): The only chromatic accent in the system. Reserved for commercial emphasis — the "Popular" pricing badge and savings callouts. Never used decoratively, never used for CTAs.

### Surface
- **Canvas** (`{colors.canvas}` — #ffffff): Default page and card background across all pages.
- **Soft Canvas** (`{colors.canvas-soft}` — #f3f3f3): The workhorse tint — a 6% ink wash over white. Fills the floating nav pill, the featured pricing card, FAQ accordion rows, soft utility pills, segmented-control tracks, and the highlighted comparison-table column.
- **Field** (`{colors.field}` — #f0f0f0): An 8% ink wash used as the fill for form inputs, giving fields presence without borders.
- **Soft Hairline** (`{colors.hairline-soft}` — #f0f0f0): 1px card outlines — the faintest possible edge, used on white-on-white cards (pricing, testimonials).
- **Hairline** (`{colors.hairline}` — #e0e0e0): The stronger 16% control border, used on outlined pill buttons and interactive chrome.

### Text
- **Ink** (`{colors.ink}` — #141414): Headings, body copy, and nav links.
- **Soft Ink** (`{colors.ink-soft}` — #262626): Slightly lifted dark used for secondary lockups and the awards wordmark.
- **Muted** (`{colors.text-muted}` — #707070): Secondary copy — supporting paragraphs, plan descriptions, vote counts, underlined inline links.
- **Faint** (`{colors.text-faint}` — #adadad): Tertiary text — placeholders, de-emphasized footer links, fine print.

### Semantic
- The system ships no dedicated success/warning/error palette on its marketing surfaces; state communication stays within the monochrome ladder, with `{colors.accent}` as the sole positive-emphasis signal.

## Typography

### Font Family

**Saans** — a contemporary neo-grotesque used exclusively, across every page and every role. It is loaded as a variable font, and the brand's voice comes from where it sits on the weight axis: headings render at an unusual 652 (heavier than semibold, lighter than bold), running text at 456 (a hair over regular), and hero subtitles at a genuinely light 300. Fallback stack: system sans (`-apple-system, "Helvetica Neue", Arial, sans-serif`).

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display}` | 80px | 652 | 1.0 | 0 | Homepage hero statements and library counters |
| `{typography.heading-1}` | 56px | 652 | 1.0 | 0 | Page heroes ("Design like a Pro.", "The votes are in.") |
| `{typography.heading-2}` | 44px | 652 | 1.13 | 0 | Section headings on content pages |
| `{typography.heading-3}` | 32px | 652 | 1.13 | 0 | Card-level headlines, award winner names, auth headings |
| `{typography.heading-4}` | 24px | 652 | 1.25 | 0 | Sub-section headings, plan names |
| `{typography.title}` | 20px | 600 | 1.3 | 0 | Feature titles, emphasized rows |
| `{typography.body-lg}` | 20px | 300 | 1.38 | 0 | Hero subtitles and lead paragraphs — the light counterpoint to 652 headings |
| `{typography.body}` | 16px | 456 | 1.38 | 0 | Default body copy, testimonial quotes |
| `{typography.body-sm}` | 14px | 456 | 1.43 | 0 | Supporting copy, plan feature lists, legal text |
| `{typography.link}` | 16px | 600 | 1.38 | 0 | Nav links and button labels |
| `{typography.label}` | 12px | 600 | 1.33 | 0 | Badge and pill labels |
| `{typography.caption}` | 12px | 456 | 1.33 | 0 | Captions, metadata, form fine print |

### Principles

- **Weight contrast is the drama.** Pairing 652 headings against 300 light subtitles at the same scale step (e.g. 80px display over 20px light lead) creates hierarchy without color or ornament.
- **Tight leading up top.** Display and heading-1 sit at line-height 1.0; headings never breathe more than 1.25. Body text opens up to 1.38–1.43.
- **Zero letter-spacing everywhere.** The grotesque is trusted at its natural fit; no tracking adjustments at any size.
- **Sentence case with terminal periods.** Headlines read as declarative sentences: "Discover real-world design inspiration." — the period is part of the voice.

### Note on Font Substitutes

Saans is a commercial typeface. The closest widely-available substitutes are **Inter** (variable, supports the 300/450/650 weight positions via its variable axis) or **Hanken Grotesk**. When substituting, map weight 652 → 650 (or 700 at static weights), 456 → 450 (or 500), and keep line-heights as specified — Saans has a compact x-height, so substitutes may need line-height reduced by ~0.05.

## Layout

### Spacing System
- **Base unit**: 8px, with 4px half-steps for fine rhythm
- **Tokens**: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 80px · `{spacing.section-lg}` 120px
- Buttons are fixed-height pills padded horizontally at `{spacing.md}`; inputs pad `{spacing.sm} {spacing.md}`
- Universal rhythm constants: 28px and 80px vertical steps recur on every page; 120px separates major homepage acts

### Grid & Container
- Content rides a centered column: single-column centered lockups for heroes and award winners, a 2-up card grid for pricing plans, 3-up for portrait tiles, and a 4-column masonry for testimonials.
- The floating nav pill is detached from the viewport edge and horizontally centered, rather than a full-width bar — the page canvas visibly wraps around it.
- Marquee strips (brand logos, app screenshots) run full-bleed beyond the content column.

### Whitespace Philosophy

Whitespace is the primary grouping device. Sections are separated by `{spacing.section}` to `{spacing.section-lg}` of empty canvas with no divider rules; within cards, generous `{spacing.lg}` padding keeps content off the hairline edges. The homepage alternates dense collage moments (icon clouds, screenshot grids) with near-empty typographic interludes — compression and release.

### Responsive Strategy

#### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| 2xl | 1536px | Max content width engaged; marquees widen |
| xl | 1280px | Default desktop grid |
| lg | 1024px | Comparison table condenses; testimonial masonry drops to 3 columns |
| md | 840px / 768px | Pricing cards stack to 1-up; portrait grid drops to 2-up; nav links collapse |
| sm | 719px / 640px | Single-column layouts; display type scales down from 80px |
| xs | 600px | Minimum layout; auth split-panel drops its screenshot marquee |

#### Touch Targets
- Pill buttons and nav CTAs are fixed-height stadium shapes comfortably above the 44px minimum; form inputs pad to a similar height via `{spacing.sm} {spacing.md}`.
- The segmented billing toggle presents each option as a full pill target, not a small radio dot.

#### Collapsing Strategy
- The floating `nav-pill` persists on scroll and across breakpoints, tightening to logomark + CTA on narrow screens.
- Multi-column grids (pricing 2-up, portraits 3-up, testimonials 4-up) collapse column-by-column rather than reflowing horizontally.
- The signup page's two-panel split (form left, angled screenshot marquee right) drops the marquee panel entirely on narrow viewports, keeping the centered form column.

#### Image Behavior
- App screenshots and device mockups keep fixed aspect ratios and `{rounded.md}` corners at all sizes.
- Marquee strips overflow the viewport intentionally and animate horizontally; they crop rather than scale.
- Curator portraits stay square-ish tiles, lazily loaded, always grayscale.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | Flat on `{colors.canvas}` | Default — most of every page |
| 1 | `{colors.canvas-soft}` fill, no border | Nav pill, featured pricing card, FAQ rows, soft pills |
| 2 | 1px `{colors.hairline-soft}` outline on white | Pricing and testimonial cards |
| 3 | 1px inset ring | Comparison-table highlight column edge |
| Inverse | `{colors.ink}` fill, `{colors.on-primary}` text | Footer band, primary CTAs |

The system is essentially shadow-free: no drop shadows appear on any card, button, or nav element. Elevation is communicated by *fill difference* (white vs. 6–8% ink tints) and by hairlines, which keeps every surface print-flat and lets the screenshot content supply all depth cues. The one soft-shadow exception is the active segment of the segmented control, which lifts off its `{colors.canvas-soft}` track as a white pill.

### Decorative Depth
- **Glass monoliths** — the awards hero renders tall trophy pillars in a white-to-gray vertical gradient, reading as frosted glass against the `{colors.canvas-soft}` band; the page's only atmospheric gradient.
- **Photography as depth** — floating app-icon squircles, angled screenshot collages (signup's rotated marquee panel), and device mockups create parallax-like layering on a flat canvas.
- **Polarity inversion** — the `{colors.ink}` footer with `{rounded.md}` top corners acts as a heavy baseboard, giving each page a physical end-stop.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed media strips and marquee images |
| `{rounded.sm}` | 16px | Inputs, video tiles, testimonial cards, FAQ rows |
| `{rounded.md}` | 24px | Content cards, device mockups, portrait tiles, footer top corners |
| `{rounded.full}` | 9999px | Every pill: nav, buttons, badges, toggles |

### Photography Geometry
- App screenshots render inside device-shaped frames at `{rounded.md}`.
- App icons use the signature 30% squircle radius (`app-icon-squircle`) — the iOS icon silhouette — at every size from 32px chips to 96px hero tiles.
- Curator portraits are near-square tiles at `{rounded.md}`, always black-and-white, with name captions overlaid in `{colors.on-primary}` on a `badge-overlay` scrim near the lower edge.
- Avatars in testimonial cards are small circles (`{rounded.full}`) with a tiny company logo badge overlapping the bottom-right corner.

## Components

### Buttons

**`button-primary`** — "Join for free", "Get started", "Continue", "View winners"
- Fill `{colors.primary}`, label `{colors.on-primary}` in `{typography.link}`, shape `{rounded.full}`, padding `0px {spacing.md}` on a fixed-height pill
- The single CTA style everywhere: nav, pricing cards, auth form, awards hero

**`button-outline`** — "Continue with Google", secondary "Get started"
- Fill `{colors.canvas}`, label `{colors.ink}`, 1px `{colors.hairline}` border, shape `{rounded.full}`
- The de-emphasized twin of the primary pill; used when two actions sit side by side or for third-party auth

**`button-pill-soft`** — "Explore ↗", "Mobbin ↗", "Read more"
- Fill `{colors.canvas-soft}`, label `{colors.ink}`, shape `{rounded.full}`
- Tertiary utility pill for outbound and in-page links; no border, relies on its tint fill

### Cards & Containers

**`pricing-card`** — default plan tier (Team)
- `{colors.canvas}` fill, 1px `{colors.hairline-soft}` outline, `{rounded.md}` corners
- Plan name in `{typography.heading-4}`, price figure large with stacked `{typography.caption}` qualifiers, feature list rows in `{typography.body-sm}` with `{colors.text-muted}` icons

**`pricing-card-featured`** — highlighted plan tier (Pro)
- `{colors.canvas-soft}` fill, borderless, `{rounded.md}` corners — emphasis by tint, not by outline or polarity flip
- Carries the `badge-popular` chip beside the plan name and a full-width `button-primary` CTA, while the default tier gets `button-outline`

**`testimonial-card`** — user quote tile
- `{colors.canvas}` fill, 1px `{colors.hairline-soft}` outline, `{rounded.sm}` corners
- Circular avatar with overlapping company mini-badge, name in `{typography.link}`, company in `{colors.text-muted}` `{typography.body-sm}`, quote in `{typography.body}`
- Laid out as a 4-column masonry of varying heights

**`faq-row`** — accordion item
- Full-width `{colors.canvas-soft}` bar, `{rounded.sm}` corners, question in `{typography.body}` with a trailing chevron; rows stack with `{spacing.sm}` gaps

**`portrait-tile`** — curator/juror grid cell
- Grayscale photograph at `{rounded.md}`, name + role caption overlaid at bottom center in `{colors.on-primary}`
- The strict black-and-white treatment keeps the people grid inside the monochrome system

### Inputs & Forms

**`text-input`**
- `{colors.field}` fill, no border, `{colors.ink}` text with `{colors.text-faint}` placeholder, `{rounded.sm}` corners, padding `{spacing.sm} {spacing.md}`

**`text-input-focused`**
- Same chrome plus a 2px `{colors.ink}` ring — focus is signaled in ink, consistent with the monochrome system

### Navigation

**`nav-pill`** — Top Nav (Desktop)
- A floating, horizontally-centered stadium bar in `{colors.canvas-soft}`: logomark + wordmark left, text links ("Pricing", "Awards", "Log in") in `{typography.link}` right, capped by a `button-primary` CTA
- Detaches from the page edge with visible canvas above it; persists as a sticky element on scroll

**Top Nav (Mobile)**
- The pill tightens to logomark + CTA; links collapse behind the pill

**Sub-nav (Awards)**
- Minimal corner marks instead of a bar: logomark + section name top-left, a `button-pill-soft` "Mobbin ↗" return link top-right

### Signature Components

**`app-icon-squircle`** — the recurring 30%-radius icon tile; floats in loose clouds around library counters, lines up in "Other nominees" rows, and anchors `brand-chip` entries

**`brand-chip`** — marquee lockup of squircle icon + brand name in `{typography.heading-3}` ink; scrolls horizontally in full-bleed strips of recognizable products

**`badge-popular`** — compact `{colors.accent}` chip with `{colors.on-primary}` label marking the featured pricing tier; the only blue element on the page

**`badge-overlay`** — translucent gray pill (rgba(115, 115, 115, 0.56)) with `{colors.on-primary}` `{typography.label}` text, laid over photography and screenshots (category tags, portrait captions)

**`segmented-control`** + **`segmented-control-active`** — billing-period toggle: a `{colors.canvas-soft}` stadium track holding two pill options; the active option is a `{colors.canvas}` white pill, the inactive label sits in `{colors.text-muted}`

**`award-lockup`** — centered winner presentation: laurel-flanked category eyebrow in `{colors.text-muted}`, winner name in `{typography.heading-3}`, description in `{colors.text-muted}` `{typography.body}`, vote share in `{typography.body-sm}`, closed by a `button-pill-soft` "Explore ↗"

**`compare-table`** — the pricing comparison grid: feature rows divided by 1px `{colors.canvas-soft}` rules, the recommended plan's column washed in `{colors.canvas-soft}` with an inset ring edge

**`footer`** — full-width `{colors.ink}` band with `{rounded.md}` top corners: white wordmark at display scale, tagline in `{colors.text-faint}`, two columns of `{colors.text-faint}` links that read in `{colors.on-primary}` for emphasis rows

### Examples (illustrative)

> Kit-mirror demonstration surfaces. Each `ex-*` entry references brand-native primitives via token syntax so downstream consumers re-skin the same 10 surfaces consistently; none carries invented literal values.

**`ex-pricing-tier`** — Default Pricing tier card. Re-uses feature-card chrome with brand canvas-soft surface.
- Properties: `backgroundColor`, `textColor`, `borderColor`, `rounded`, `padding`

**`ex-pricing-tier-featured`** — Featured/highlighted tier — polarity-flipped surface (dark fill + light text in light mode, light fill + dark text in dark mode).
- Properties: `backgroundColor`, `textColor`, `rounded`, `padding`

**`ex-product-selector`** — What's Included summary card — re-purposed for SaaS / B2B verticals (NOT a literal product gallery).
- Properties: `backgroundColor`, `rounded`, `padding`

**`ex-cart-drawer`** — Subscription summary — re-purposed for SaaS / B2B (line items per add-on, not literal cart).
- Properties: `backgroundColor`, `rounded`, `padding`, `item-divider`

**`ex-app-shell-row`** — Sidebar nav row inside the App Shell example. Active state uses brand primary as the indicator.
- Properties: `backgroundColor`, `activeIndicator`, `rounded`, `padding`

**`ex-data-table-cell`** — Default data-table th + td chrome. Header uses mono-caps eyebrow typography; body uses body-sm.
- Properties: `headerBackground`, `headerTypography`, `bodyTypography`, `cellPadding`, `rowBorder`

**`ex-auth-form-card`** — Sign-in / sign-up card. Re-uses feature-card chrome with text-input primitives inside.
- Properties: `backgroundColor`, `rounded`, `padding`

**`ex-modal-card`** — Modal dialog surface — same chrome as feature-card with elevated shadow.
- Properties: `backgroundColor`, `rounded`, `padding`

**`ex-empty-state-card`** — Empty-state illustration frame.
- Properties: `backgroundColor`, `rounded`, `padding`, `captionTypography`

**`ex-toast`** — Toast notification surface — feature-card shape + medium shadow.
- Properties: `backgroundColor`, `rounded`, `padding`, `typography`


## Do's and Don'ts

### Do
- Keep the canvas `{colors.canvas}` white and let imported content (screenshots, icons, logos) supply all saturation.
- Use `{rounded.full}` for every interactive element — a rectangular button does not exist in this system.
- Build emphasis with the tint ladder: `{colors.canvas-soft}` fill for featured surfaces, `{colors.hairline-soft}` outlines for resting cards.
- Reserve `{colors.accent}` for commercial signals (featured badges, savings callouts) — one or two blue elements per page at most.
- Set every heading in Saans 652 with line-height 1.0–1.13 and end headline sentences with a period.
- Pair heavy 652 headings with 300-weight `{typography.body-lg}` subtitles for hierarchy without color.
- Render app icons as 30% squircles and portraits in grayscale to keep third-party imagery inside the system.
- Close pages with the inverse `{colors.ink}` footer, rounded at the top.

### Don't
- Don't add drop shadows — elevation is fills and hairlines only.
- Don't use `{colors.accent}` for CTAs; primary actions are always `{colors.primary}` ink pills.
- Don't introduce additional accent hues, gradients on UI chrome, or colored section bands.
- Don't outline the featured pricing tier — feature it with the `{colors.canvas-soft}` fill and `badge-popular` instead.
- Don't apply letter-spacing or all-caps styling; the type system runs at natural tracking in sentence case.
- Don't put borders on form fields at rest — inputs are `{colors.field}` tint fills; the border appears only as the 2px ink focus ring.
- Don't let full-color photography of people into the curator/juror grids; portraits are strictly black-and-white.
- Don't square off pill geometry at small sizes — badges, chips, and toggles stay stadium-shaped.
