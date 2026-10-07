# Design System

Where the design system actually lives, and the tokens it is made of.

**Read this before styling anything.** The authoritative sources, in order:

1. `frontend/src/index.css` — the brief in the file header, then the `:root`
   token blocks. If this document and that file disagree, that file is right.
2. `docs/interface.md` — the *why* behind the look: instrument panel, one brand
   colour, state is a word, nothing under the composer.
3. `UIInspirations/DESIGN-kraken.md` — the source design the system was drawn
   from. `index.css` names it explicitly and its scale is mirrored as `--k-*`.

> An earlier version of this file described a Montserrat/pill-card/seed-capsule
> hero with hexes (`#F5F6F4`, `#181F2F`, `#D5F278`) and a `1.15s` opening
> animation. **None of that exists in this codebase** — no Montserrat import, no
> matching hex, no `rounded-[22px]`, no seed capsule. It described a design that
> was never shipped here. Removed rather than left to mislead.

---

## 1. Typography

Two families, split by *who is speaking*: sans for what a person reads, mono for
what the machine reports.

| Role | Token | Resolves to |
| :--- | :--- | :--- |
| **Display / body / UI** | `--font-display`, `--font-body`, `--font-sans` | all alias `--font-openai-sans`: `'OpenAI Sans', 'Inter', system-ui, …` |
| **Machine-reported** | `--font-mono` | `'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |

Faces actually loaded, from `frontend/index.html` and
`frontend/src/styles/fonts.css`:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet" />
```

Geist and Geist Mono are also self-hosted as variable `woff2` in
`frontend/public/fonts/` (`@font-face`, `font-display: swap`). `'OpenAI Sans'`
has no `@font-face` and no loader — it falls through to **Inter**. Treat Inter as
the face you are actually designing against; do not add a third family to close
a gap that is a fallback, not a missing font.

**Weights:** `--font-weight-regular: 400`, `--font-weight-medium: 500`,
`--font-weight-semibold: 600`. Use 600 only for the largest headings.

**Tracking** (recorded in the `--font-openai-sans` comment in `index.css`):
`-0.03em` at display sizes, `+0.011em` at 28px, `-0.01em` at 22px and below.
Enable `calt` and `liga`.

---

## 2. Type scale

Every size is `calc(<px> * var(--text-scale, 1))`, so Settings → text size moves
the whole interface. Never hard-code a `px` font size.

| Token | Size | Line height | Tracking |
| :--- | :--- | :--- | :--- |
| `--text-caption` | 12.5px | 1.51 | -0.13px |
| `--text-input` | 15.5px | 1.5 | -0.16px |
| `--text-body` | 16px | 1.62 | -0.16px |
| `--text-body-lg` | 16.25px | 1.6 | -0.16px |
| `--text-subheading` | 20px | 1.28 | -0.22px |
| `--text-heading` | 25px | 1.22 | +0.25px |
| `--text-display` | 42px | 1.16 | -1.2px |

The Tailwind-facing ladder sits alongside it — `--text-3xs` (11) `2xs` (12)
`xs` `sm` (14) `md` (15) `lg` `xl` `2xl` `3xl` `4xl` (36) `5xl` — all scaled.

**Semantic text colours:** `--text` (primary), `--text-dim` (secondary),
`--text-faint` (tertiary/muted). Each theme re-points these three; components
read them and never a raw hex.

---

## 3. Colour

Three layers. Never mix them.

**Raw Kraken scale** — `--k-*`, defined once at the top of `index.css`'s `:root`
and referenced by nothing outside this file's token blocks:

| Token | Value | Meaning |
| :--- | :--- | :--- |
| `--k-purple` | `#7132f5` | the one brand colour — primary action, link, selected state |
| `--k-purple-dark` / `-deep` / `-lift` | `#5741d8` / `#5b1ecf` / `#855bfb` | outlined border, pressed fill, subtle fill base |
| `--k-ink` / `--k-gray` / `--k-silver` | `#101114` / `#374151` / `#64748b` | text at three weights |
| `--k-border` | `#dedee5` | hairline |
| `--k-green` / `--k-green-deep` | `#149e61` / `#026b3f` | positive, and badge text on a green wash |

**Grounds** — two that matter, the rest are mixes:
`--canvas` (what a card is made of) and `--canvas-deep` (the page under it),
plus `--raised`, `--surface`, `--surface-2`, `--surface-3`. Aliases `--bg`,
`--surface-raised` exist only for selectors that predate the real names.

**Semantic** — these are the ones components use:

| Group | Tokens |
| :--- | :--- |
| Brand | `--accent` (fills), `--ember` (writes), `--accent-hover`, `--accent-line`, `--accent-soft`, `--accent-wash`, `--on-accent`, `--focus-ring` |
| Status | `--live` (green) `--live-ink`, `--confirm` (amber), `--stop` (red), `--coral` |
| Status washes | `--live-soft`, `--confirm-soft`, `--stop-soft`, `--live-line`, `--confirm-line`, `--stop-line` |
| Structure | `--border` = `--hairline`, `--hairline-strong` |

**The colour rule:** green means running, amber means waiting on you, coral/red
means destructive. **Purple is never a status.** Nothing decorative is coloured.

**Hover/divider mixes** derive from `--tint` and `--shade` (RGB triplets), so a
theme flip is one pair of numbers rather than hundreds of declarations.

### Accent ramp

`applyAccentColor(hex)` in `frontend/src/store.jsx` writes one hex into an
11-step ramp as `color-mix` derivatives:

```
--color-accent-50   hex 6%  + white      --color-accent-600  hex 85% + black
--color-accent-100  hex 12% + white      --color-accent-700  hex 70% + black
--color-accent-200  hex 24% + white      --color-accent-800  hex 52% + black
--color-accent-300  hex 45% + white      --color-accent-900  hex 36% + black
--color-accent-400  hex 70% + white      --color-accent-950  hex 20% + black
--color-accent-500  hex (the accent itself)
```

plus `--accent`, `--accent-hover` (`82%` + black), `--accent-soft` (`18%`),
`--accent-wash` (`9%`), `--focus-ring` (`35%`), `--ember`, `--color-brand`,
`--primary`. Components read `var(--accent-500)` or `var(--accent)` — never a
hard-coded brand hex, or a user's chosen accent will not reach them.

### Themes

Eight curated palettes plus `system`, applied in `store.jsx` before React
mounts so the first paint is already correct:

| Dark | Light |
| :--- | :--- |
| `graphite` · `ink` · `nocturne` · `nvidia` | `paper` · `sand` · `claude` · `cursor` |

`store.jsx` stamps `<html data-theme>` and `<html data-theme-mode>` (and the
matching `color-scheme`, `.dark`, `.dark-mode`, `.light` classes) and updates
`<meta name="theme-color">` from `--canvas`. **The stylesheet owns every
colour** — no JavaScript repaints a swatch. Selectors are written
`[data-theme='ink']`, `[data-theme-mode='light']`; a rule that only matches one
mode will silently break in the other, so write the pair.

---

## 4. Geometry

Defined by tokens, not by ad-hoc Tailwind classes.

| Token | Value | Used for |
| :--- | :--- | :--- |
| `--radius-links` = `--r-xs` | `4px` | links, chips inside controls |
| `--radius-cards` = `--r-sm/md/lg`, `--radius-sm/md` | `6px` | cards, rows, list items |
| `--radius-lg` / `--r-xl` | `10px` | medium panels |
| `--r-2xl` / `--radius-xl` | `14px` | modals, floating menus |
| `--radius-inputs`, `--radius-buttons` | `9999px` | inputs and buttons (capsules) |
| `--radius-tags` = `--r-pill` | `9999px` | tag chips, toggles, avatars — things that are genuinely capsules |

The file-header brief says "caps at 12px, no pills" while the token block says
`9999px`. **The tokens win** — they are what the shipped buttons use. Treat that
line as a note about intent for *containers*, and do not "fix" the tokens to
match it without a design decision.

Elevation: a card separates from the page with a **hairline plus ~3% black at
24px blur**, not a drop shadow. Real shadow is reserved for things that float —
menus, modals, toasts.

---

## 5. Motion

The rules are written as a comment above the animation block in `index.css`,
and they are the contract:

- **`transform` and `opacity` only**, plus `grid-template-rows` where a real
  height change is needed (the one cheap way to animate to an unknown height
  without measuring).
- **Transitions over keyframes**, so a re-triggered animation retargets instead
  of restarting.
- **Durations:** anything a person hits a hundred times a day (hover, press) is
  **under 140ms**; anything describing something *arriving* is **200–280ms**.
  Nothing over 300ms.
- **No animation at all** on things hit constantly — notably the command palette,
  which opens dozens of times a day and where an entrance reads as lag.
- **`prefers-reduced-motion: reduce`** switches the whole block off — 44 blocks
  in `index.css`, plus a blanket one. New animations must land inside that.

Timing tokens: `--press: 120ms`, `--menu: 180ms`.

Easing tokens — use these, not literals:

| Token | Curve |
| :--- | :--- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` |

Anchoring: menus scale from the control that opened them; modals scale from
their own centre, because they are not anchored to anything.

---

## Other global switches on `<html>`

Set from `store.jsx` before mount, read by stylesheets:

| Attribute | Values | Effect |
| :--- | :--- | :--- |
| `data-theme` / `data-theme-mode` | see above | palette |
| `data-density` | e.g. `comfortable` | spacing density |
| `data-glass` | `full` … | glass material treatment |
| `data-spotlight-anim` | `spring` … | command-palette entrance |
| `--text-scale`, `--ui-scale` | number | Settings → text size |
