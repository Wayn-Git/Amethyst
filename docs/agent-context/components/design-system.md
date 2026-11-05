# Design System

The visual and motion contracts shared by the shell, views and dashboard:
colour tokens, themes, typography, spacing, radii, elevation, controls and
reduced-motion behaviour.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [FRONTEND.md](../FRONTEND.md), [components/shared.md](shared.md),
[components/widget-system.md](widget-system.md),
[`../../ui-design-system.md`](../../ui-design-system.md).

## Two token families

The application currently carries two related but distinct systems. Know which
one a surface uses before changing a value.

| Family | Tokens | Owner | Used by |
|---|---|---|---|
| Shell / Kraken | `--k-*`, `--canvas*`, `--text*`, `--accent*`, `--r-*`, `--space-*`, `--shadow-*`, `--ease-*` | `frontend/src/index.css` | App shell, chat, views, legacy surfaces |
| Bento / dashboard | `--tile-*`, `--ui-*` | `frontend/src/components/ui/bento/system.css`, `frontend/src/styles/ui-system.css` | Today grid, bento primitives, Home widgets |

`frontend/src/globals.css` is the Tailwind v4 and shadcn bridge. It imports
Tailwind theme/utilities, maps shadcn semantic variables and declares the
`.dark` variant. Most product surfaces are still hand-written CSS in
`index.css`; Tailwind utilities are not the primary styling method.

Do not “unify” the two token sets in a cosmetic change. The bento tiles depend
on their own canvas, tone and radius values, and the shell depends on the
Kraken neutrals.

## Colour and themes

`frontend/src/store.jsx` owns theme selection.

```js
THEMES = ['system', 'graphite', 'ink', 'nocturne', 'nvidia',
          'paper', 'sand', 'claude', 'cursor']
DARK_THEMES = ['graphite', 'ink', 'nocturne', 'nvidia']
LIGHT_THEMES = ['paper', 'sand', 'claude', 'cursor']
```

`applyTheme()` resolves `system` through `prefers-color-scheme`, then writes:

- `data-theme` — the resolved palette name;
- `data-theme-mode` — `dark` or `light`;
- `class="dark dark-mode"` or `class="light"`;
- `style.color-scheme`;
- the `<meta name="theme-color">` content.

The stylesheet owns the colours. JavaScript only selects the palette. This is
why a theme change must not rewrite component colours directly.

Shell semantic roles in `index.css`:

| Token | Meaning |
|---|---|
| `--canvas`, `--canvas-deep` | Card ground and page ground |
| `--raised`, `--surface*` | Raised and inset surfaces |
| `--text`, `--text-dim`, `--text-faint` | Three text weights |
| `--accent`, `--accent-hover`, `--accent-line` | Brand action and selection |
| `--ember` | Brand-coloured text; diverges from fill in dark |
| `--live`, `--confirm`, `--stop` | Running/success, caution, destructive |
| `--hairline`, `--hairline-strong` | Dividers and borders |
| `--focus-ring`, `--focus` | Keyboard focus |
| `--glass`, `--scrim` | Overlays |

Purple is the brand and primary-action colour. Green, amber and coral are
status colours; purple is never a status. Dark themes lift the accent because
`#7132f5` is a light-ground colour and reads too dark on near-black.

Bento tones are separate: `light`, `dark` and `accent`, selected per tile with
`data-tone`. Each tone supplies `--tile-bg`, `--tile-fg` and `--tile-muted`.
`widgetTone()` in `frontend/src/dashboard/layout.js` assigns tones by widget id.

## Typography

Shell tokens declare Satoshi, Plus Jakarta Sans and Inter as the UI stack, with
Geist Mono for code. Only Geist and Geist Mono are bundled through
`frontend/src/styles/fonts.css`. Dashboard CSS separately bundles Space Grotesk,
Inter and JetBrains Mono from `frontend/public/fonts/` and maps them to
`--ui-display`, `--ui-font` and `--ui-mono`.

| Token | Size / line height | Use |
|---|---|---|
| `--text-caption` | 12.5px / 1.51 | Metadata, labels |
| `--text-input` | 15.5px / 1.5 | Inputs |
| `--text-body` | 16px / 1.62 | Body |
| `--text-subheading` | 20px / 1.28 | Section heading |
| `--text-heading` | 25px / 1.22 | Page heading |
| `--text-display` | 42px / 1.16 | Hero display |

Every size multiplies by `--text-scale`. `applyAppearanceSettings()` sets that
from the user's UI font size (`uiFontSize / 14`). Do not hardcode a replacement
scale in a component.

### 1:1 Figma Composite Type Scale (`styles/typography.css`)

Product components and UI primitives utilize composite typography classes (13 style families × 4 weights: Regular 400, Medium 500, Semibold 600, Bold 700) set in Inter, defined in `frontend/src/styles/typography.css` and registered under `theme.text` in `frontend/src/utils/cx.ts` and `frontend/src/lib/utils/cx.ts`:

- `text-large-title-{weight}`: 64px / 80px (Hero numerals, marketing headings)
- `text-display-1-{weight}`: 56px / 72px (Full-page hero headings)
- `text-display-2-{weight}`: 48px / 64px (Large section heroes)
- `text-display-3-{weight}`: 40px / 54px (Prominent stats, page heroes)
- `text-display-4-{weight}`: 32px / 44px (Page titles, largest inside app shell)
- `text-title-1-{weight}`: 24px / 34px (Card headline figures)
- `text-title-2-{weight}`: 20px / 26px (Section headings inside panels/modals)
- `text-title-3-{weight}`: 18px / 26px (Sub-section headings, month titles)
- `text-headline-{weight}`: 16px / 22px (Emphasized body, leads, button lg/xl)
- `text-body-{weight}`: 14px / 20px (Default UI text, table cells, buttons xs/sm/md)
- `text-body-2-{weight}`: 13px / 18px (Dense contexts, secondary descriptions)
- `text-caption-1-{weight}`: 12px / 16px · tracking 0.15px (Axis labels, timestamps)
- `text-caption-2-{weight}`: 11px / 15px · tracking 0.2px (Badges, smallest fine print)

Color is applied separately with semantic text tokens (e.g., `text-text-primary`, `text-text-secondary`, `text-text-tertiary`).

Display tracking is negative (`--track-display: -0.03em`); body tracking is
slightly negative. The bento system uses its own `--tile-title`,
`--tile-number`, `--tile-body` and `--tile-label` shorthands.

## Spacing, radius and elevation

Shell spacing is a 4px base exposed as `--space-3xs` through `--space-5xl`
(4–52px). Bento spacing is `--tile-space-1/2/3/4/6/8` (4, 8, 12, 16, 24, 32px).
The two scales agree at the low end; do not assume they are aliases.

Radii differ by family:

- Shell: links 4px, cards 6px, large 10px, extra-large 14px, capsules 9999px.
- Bento: tiles 24px, controls 8–12px, chips and segmented controls 9999px.

Elevation is intentionally quiet. Shell cards use a hairline plus a very soft
shadow; `--lift` is reserved for menus, modals and toasts that float above the
page. Bento light tiles use `--tile-shadow`; dark and accent tiles use no
shadow.

## Motion

Two motion layers exist.

`frontend/src/motion.js` exports Framer Motion and GSAP tokens:

- easings: `EASE_PREMIUM`, `EASE_ACCELERATE`, `EASE_DECELERATE`;
- springs: `SPRING_TACTILE`, `SPRING_SMOOTH`;
- durations: 160ms fast, 240ms base, 360ms smooth;
- variants: page, stagger, popover, modal, drawer;
- helpers: `useViewEntrance`, button and chip press props.

`index.css` adds CSS easings and durations (`--ease-out`, `--ease-drawer`,
`--press` 120ms, `--pop` 160ms, `--menu` 180ms, `--modal` 240ms). Bento adds
`--tile-fast` 150ms, `--tile-motion` 200ms and `--tile-slow` 250ms.

Rules that hold across both layers:

- animate `transform` and `opacity`; do not animate layout properties;
- transitions over keyframes when an interaction can be re-triggered mid-flight;
- no entrance animation on controls used many times per minute;
- respect reduced motion.

`REDUCED_MOTION` in `motion.js` is read once at module load. CSS has blanket
`prefers-reduced-motion` blocks in `index.css`, `globals.css`, `system.css` and
the dashboard styles. A component that reads the media query directly must add
its own listener if it needs live changes.

## Controls and primitives

| Layer | Source | Notes |
|---|---|---|
| House button | `frontend/src/components/ui/AppButton.jsx` | `.btn` + `.ui-button`; variants, sizes, loading, busy |
| Bento controls | `frontend/src/components/ui/bento/index.jsx` | Button, Select, Input, Checkbox, Switch, Segmented, Menu, Tooltip, Kbd |
| Base UI | `@base-ui/react` | Dialog, menu, tooltip, radio-group, checkbox |
| shadcn/Radix | `frontend/src/components/ui/*.tsx` | Used by newer composite surfaces |
| Icons | `frontend/src/components/Icon.jsx`, `lucide-react` | Named SVG set is the house default |

Bento primitives also include `BentoGrid`, `Tile`, `TileHeader`, `Stat`, `Chip`,
`Row`, `IconBadge`, `Initials`, `SplitTile`, `Skeleton`, `EmptyState`,
`ConnectTile`, `ErrorState`, `Toast`, `Ring`, `Gauge`, `Sparkline` and
`SegmentedBar`.

Numeric primitives must not coerce missing data to zero. `Ring`, `Gauge`,
`Sparkline` and `SegmentedBar` render an explicit empty state for invalid input.
`Skeleton` is static and labelled; it does not shimmer.

## Accessibility

- Interactive controls need a visible label or an accessible name.
- Icon-only buttons use `aria-label`; see `IconButton`.
- `Skeleton` uses `role="status"`; errors use `role="alert"`.
- Focus-visible uses a 2px accent outline with offset. Do not remove it.
- Home overrides many controls to a 44px minimum target in
  `frontend/src/dashboard/home-bento.css`; the shared button default is 36px.
- `Segmented` uses Base UI radio-group semantics and arrow-key navigation.
- `prefers-reduced-motion` disables the shell, bento and dashboard motion
  blocks. New animation must add the same guard.

## Modification guide

| Change | Touch |
|---|---|
| Add or change a palette | `index.css` theme blocks, `THEMES`/`DARK_THEMES`/`LIGHT_THEMES` in `store.jsx` |
| Change shell colour roles | semantic block in `index.css` |
| Change bento tile colours or radius | `components/ui/bento/system.css` |
| Change control sizing | `styles/ui-system.css`, `components/ui/AppButton.jsx` |
| Change type scale | `index.css` type tokens; verify `--text-scale` consumers |
| Add a motion variant | `motion.js`; add a CSS reduced-motion guard if used in CSS |
| Add a shared primitive | `components/ui/bento/index.jsx` or `components/ui/` |
| Change dashboard grid spans | `components/ui/bento/system.css`, `dashboard/home-bento.css` |

Before changing a token, search for direct hex values in the surface you are
touching. Some older views still hardcode colours instead of using semantic
tokens.

## Known issues

- Two token families overlap. Shell cards are 6px; bento tiles are 24px. This is
  visible when a bento surface sits beside a legacy card.
- `index.css` names Satoshi first, but no Satoshi `@font-face` is bundled. The
  effective fallback is Plus Jakarta Sans, Inter or the system UI font unless
  the user has Satoshi installed.
- `globals.css` names `OpenAI Sans`, which is not bundled either. Treat font
  names in token declarations as intent, not proof of delivery.
- `REDUCED_MOTION` is a module-load constant, so changing the OS preference
  while the app is open is not reflected by JavaScript variants until reload.
- `docs/ui-design-system.md` describes the bento foundation and predates some
  shell token changes. The CSS files are authoritative.

## Related

- [FRONTEND.md](../FRONTEND.md) — shell and styling entry points
- [components/shared.md](shared.md) — shell components
- [components/widget-system.md](widget-system.md) — dashboard composition
- [sections/today.md](../sections/today.md) — Home surface
- [`../../ui-design-system.md`](../../ui-design-system.md) — bento design notes

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
