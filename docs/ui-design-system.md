# Amethyst bento foundation — session 1

This is the current design target; it supersedes earlier shell styling notes and the visual values in home-ui-brief.md. Implementation lives in `frontend/src/components/ui/bento/`. Home adopts the foundation in session 2; individual widget content remains under review. Wrap future surfaces in `bento-foundation` and import the shared primitives. `/dev/ui` is a development-only route, loaded outside the app store so sample controls never call connectors or write user data. All showcase numbers are explicitly labelled samples.

## Composition

Soft neutral canvas, rounded rectangular tiles, flat light/dark/lavender color blocks. One primary value or visual per tile. Titles sit at the top; large values occupy the center or bottom; supporting metadata is quiet. No decorative imagery, gradients, glow, glass, emoji, or charts without numeric input. Circular badges are 40 px with 20 px icons. SplitTile divides two paired items with a subtle vertical rule. Chip is a small pill. Only light tiles cast a soft shadow.

## Tokens

Fonts: bundled Space Grotesk for titles and numerals, Inter for body and controls, JetBrains Mono for labels and timestamps. `--tile-title`: 600 16px/22px; `--tile-number`: 600 56px/1, tracking -.04em; body: 400 14px/20px; label: 400 11px/16px. Numerals reduce to 40 px below a 240 px content container. Existing control type is 500 13px/20px. Spacing scale: 4, 8, 12, 16, 24, 32 px (`--tile-space-1/2/3/4/6/8`). Tile radius 24 px, control radius 8 px, chip/segmented radius 999 px. Tile padding 24 px, 16 px below 390 px container width. Equal grid gutters 16 px. Light shadow: `0 4px 16px rgb(25 23 31 / .06)`; dark/accent shadow: none.

Paper is the baseline. All palettes have three tones with shared readable foregrounds. Nine selectable modes means eight named palettes plus System; System follows Paper for light OS mode and Graphite for dark OS mode. Existing app theme colors outside the foundation are unchanged.

| Mode | Canvas | Light | Dark | Accent |
|---|---|---|---|---|
| Paper | #f1f0f3 | #ffffff | #211e29 | #ded2fa |
| Graphite | #17151c | #eeeaf4 | #27232e | #c9b4ef |
| Ink | #08080b | #f5f3f9 | #1b1921 | #d7c1ff |
| Nocturne | #111326 | #eef0fa | #23263e | #c9c2ff |
| Nvidia | #111214 | #eff0f3 | #242429 | #d0bbf4 |
| Sand | #eae6e2 | #fffcf8 | #302832 | #dfcdef |
| Claude | #efebe4 | #fffdf8 | #302a32 | #e2cfee |
| Cursor | #eeede7 | #fffffb | #29282e | #d9d0f3 |
| System | OS resolved | OS resolved | OS resolved | OS resolved |

Light foreground/muted: #19171f / #655f70. Dark: #faf8ff / #c0b8cd. Accent: #2c164e / #624881. Primary action: #7132d6, hover #5b25b1, white text, including Nvidia. Tones use `--tile-light/dark/accent`, corresponding `-text/-muted` variables, and tile-local `--tile-bg/fg/muted`. Dividers mix currentColor 12–15% with transparent; badges/chips mix 9%. Chart tracks use currentColor at .12 opacity. Semantic error colors still use existing theme status tokens with text labels.

## Grid contract

BentoGrid owns an inline-size container and a twelve-column dense CSS grid. Equal width tracks use minmax(0,1fr); dense placement backfills available holes without adding empty filler tiles. DOM order remains reading and keyboard order; callers should keep important controls in logical order. A final incomplete row is allowed. Rows are minimum 160 px (152 px below viewport 1440), growing for real content rather than clipping or adding internal scrollbars.

| Available container width | S | M | L | wide | tall |
|---|---|---|---|---|---|
| 1440+ | 3×1 | 6×2 | 6×3 | 6×1 | 3×3 |
| 1024–1439 | 4×1 | 6×2 | 6×3 | 8×1 | 4×3 |
| 768–1023 | 6×1 | 6×2 | 12×3 | 12×1 | 6×3 |
| 390–767 | 12×1 | 12×1 | 12×1 | 12×1 | 12×1 |
| below 390 | 12×1 | 12×1 | 12×1 | 12×1 | 12×1 |

Spans are columns × rows. Container breakpoints account for app navigation and embedded surfaces, not just the viewport. Each Tile establishes a separate `tile` container for its contents. Home uses this grid with four compact glance tiles once the content container reaches 1024 px, so the opening row packs on desktop with app navigation present. Existing weather/music manifest size `m` is presented as a compact glance tile; stored sizes stay valid. The untouched legacy Morning layout gains L tiles for the brief and Today; custom layouts retain their order and sizes. Manifest and Position now accept `wide` and `tall`; no existing widget advertises these sizes yet, so layout validation continues to enforce each manifest's allowed sizes.

## Primitives and ownership

Exports: BentoGrid; Tile(tone,size); TileHeader(title); Stat(value,label,unit); Ring(value,max,label); Gauge(value,max,label); Sparkline(values,label); SegmentedBar(value,max,label,segments); Chip; Row(trailing); IconBadge(label); Initials(name); SplitTile; Skeleton; EmptyState(message,action); ConnectTile(source,onConnect); ErrorState(message,onRetry); Toast(children,action).

Ring and gauge clamp geometry to 0–max while their accessible labels preserve the supplied reading. Invalid/missing values and nonpositive max render explicit empty states. Sparkline supports constant, negative and single-value series; invalid series render no graph. SegmentedBar uses a bounded 1–50 segment count (default 10). Numeric visuals accept numbers only; never coerce missing data to zero. Consumers must supply meaningful labels. Skeleton is static and labelled; refresh never fabricates numbers. Toast is a status announcement; use the existing Sonner host for application-level timed notifications.

## Controls

Reuse AppButton, NativeSelect, Base UI Input/Checkbox/Menu/Tooltip, existing Switch and Kbd. Foundation exports Button, IconButton(label), Input, Select, Checkbox, Switch, Segmented, Menu, Tooltip, Kbd. Segmented uses Base UI radio-group semantics, roving focus and arrow keys. All controls require visible labels or accessible names. Native inputs/selects retain native keyboard behavior. Menus retain Escape and focus restoration. Tooltip content is supplemental, never the only accessible name. Kbd and tooltip content are display-only; they do not have fake loading/pressed states.

Button variants: primary, secondary, ghost, destructive. Heights: small 28, medium 36, large 44 px; icon 36 px square. Loading disables actions and exposes aria-busy; inputs/selects/checks/switches/segments/menu triggers also support loading and disabled. Disabled opacity .45. Hover strengthens the border; primary fills violet-hover; press translates 1 px. Focus-visible is a 2 px accent outline with 2 px offset. Checked and selected states use accent fill. Errors use aria-invalid and a meaningful accompanying label supplied by the caller. Native Select options remain OS-rendered.

Motion tokens: fast 150 ms, normal 200 ms, slow 250 ms; easing cubic-bezier(.2,.8,.2,1). Controls transition color and transform. No automatic data-refresh layout animation. No springs in the foundation; reserve springs for future drag interactions only. Reduced motion sets all foundation durations to 0 ms. No skeleton shimmer.

## Enforcement and proof

Existing `amethyst-ui/no-raw-controls` Oxlint warning covers JSX button/input/select/textarea outside primitive directories. Shared bento primitives live under the existing exemption. `node frontend/tests/ui-control-lint.mjs` verifies all four warnings. `frontend/tests/bento-foundation.mjs` checks nine modes across six widths, overflow, radius/gutters, real keyboard interactions, disabled/loading and reduced motion. No screenshots are required; `/dev/ui` permits direct inspection. Hardware frame timing is not established by these tests.

## Home structure — session 2

Home separates layout controls from memoized widget content. Reordering keeps peer slots and widget content stable; transforms animate placement with reduced-motion support. Resize selects manifest-supported sizes and never persists free-form geometry. The settings/catalog context lives beside the grid so layout saves do not propagate into tile consumers. Compact Connect tiles occupy one row. Chrome appears on hover/focus (always on touch), with freshness in mono and stale shown as a small dot/label. Tiles grow for content without internal scrolling. System controls live in the modal Home settings drawer. Paper composition and all palettes reuse the foundation tokens; no backend, source contracts or navigation changes.
