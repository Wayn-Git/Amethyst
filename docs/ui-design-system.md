# Home UI design system

Scope: UI shell and controls on `ui-redesign`. Existing navigation remains the only app navigation. Widget content and card primitives belong to the widgets session. Never infer connector data from reference images.

## Structure

Centered canvas, maximum 1600 px including padding. Header has date above greeting, capture trigger, Edit layout, Add widget, Home settings. Glance is four equal compact slots; two per row below 1024 px. Below it is a dense twelve-column grid. Needs you is one combined ranked region; the remaining registered Morning widgets retain their saved order. No extra timer, gauge, calendar placeholder, or navigation is introduced.

The server already supplies Morning: glance.clock, glance.weather, glance.next-event, glance.music, need.inbox, need.drafts, need.waiting, need.mentions, need.overdue, agent.brief, agent.feed, task.today, dev.prs, lib.resurface, feed.news. Preserve explicit saved layouts, including empty ones. System widgets stay in Home settings.

## Exact tokens

Fonts are bundled: Space Grotesk headings, Inter controls/body, JetBrains Mono dates/shortcuts. Type: greeting 28/36 weight 600, section 14/20 weight 600, body/control 13/20 weight 500, description 12/18 weight 400, metadata/keyboard 11/16 weight 400. Greeting tracking -0.03em; other tracking normal.

Spacing: 4, 8, 12, 16, 24, 32 px. Grid gutter 16 px everywhere. Canvas padding 32 px at 1024+, 24 px at 768–1023, 16 px below 768. Control radius 8 px, panel 12 px, checkbox/keyboard 4 px. Borders 1 px; focus outline 2 px with 2 px offset. Icons use the existing Icon adapter, 14–18 px in controls; no emoji icons. No decorative shadows, gradients, glow or blur in the shell.

| Viewport | S span | M span | L span | Glance columns |
|---|---:|---:|---:|---:|
| 1440+ | 3 | 6 | 12 | 4 |
| 1024–1439 | 4 | 6 | 12 | 4 |
| 768–1023 | 6 | 12 | 12 | 2 |
| 360–767 | 12 | 12 | 12 | 2 |

The grid also observes its own available width: S uses 4 columns below 1120 px of canvas, 6 below 900 px; M uses 12 below 900 px; all sizes use 12 below 600 px. This preserves widths beside the existing navigation.

Slots establish `container: widget / inline-size`. Card content must implement its own width adaptation in the widgets session: secondary tile text hidden below 240 px, second row line shown above 360 px, trailing actions moved into the menu below 320 px. These content rules are a handoff, not implemented by shell selectors. Cards must use their five-row preview and Show all drawer, not nested scrolling. Loading/data-refresh height guarantees likewise require widget-owned content bounds.

## Themes

Nine selectable modes: system plus eight palettes. System resolves to graphite in dark OS mode and paper in light OS mode. The table below records the existing exact palette values. Shell tokens `--ui-bg`, `--ui-panel`, `--ui-raised`, `--ui-text`, `--ui-muted`, `--ui-border`, `--ui-accent`, `--ui-on-accent` alias canvas-deep, canvas, surface, text, text-dim, hairline, accent, on-accent at the root. Home must not force light or dark colors independently of this mapping.

### graphite

| Token | Value |
|---|---|
| `--canvas-deep` | `#080706` |
| `--canvas` | `#0c0a09` |
| `--surface` | `#1c1917` |
| `--surface-2` | `#292524` |
| `--surface-3` | `#181615` |
| `--text` | `#fafaf9` |
| `--text-dim` | `#a8a29e` |
| `--text-faint` | `#78716c` |
| `--hairline` | `rgba(255, 255, 255, 0.08)` |
| `--hairline-strong` | `rgba(255, 255, 255, 0.16)` |
| `--accent` | `#8b5cf6` |
| `--accent-hover` | `#9d71f7` |
| `--on-accent` | `#ffffff` |
| `--live` | `#2fc888` |
| `--confirm` | `#e9b451` |
| `--stop` | `#ff6b7d` |
| `--on-stop` | `#1b0c0e` |
| `--scrim` | `rgba(0, 0, 0, 0.65)` |

### ink

| Token | Value |
|---|---|
| `--canvas-deep` | `#000000` |
| `--canvas` | `#000000` |
| `--surface` | `#0a0a0a` |
| `--surface-2` | `#121212` |
| `--surface-3` | `#181818` |
| `--text` | `#ffffff` |
| `--text-dim` | `#a1a1aa` |
| `--text-faint` | `#71717a` |
| `--hairline` | `#212327` |
| `--hairline-strong` | `#3a3a3f` |
| `--accent` | `#a855f7` |
| `--accent-hover` | `#b975f9` |
| `--on-accent` | `#ffffff` |
| `--live` | `#30d088` |
| `--confirm` | `#edb84a` |
| `--stop` | `#ff6878` |
| `--on-stop` | `#1b0c0e` |
| `--scrim` | `rgba(0, 0, 0, 0.75)` |

### nocturne

| Token | Value |
|---|---|
| `--canvas-deep` | `#000014` |
| `--canvas` | `#010120` |
| `--surface` | `#0a0d2a` |
| `--surface-2` | `#141838` |
| `--surface-3` | `#06081c` |
| `--text` | `#f1f5ff` |
| `--text-dim` | `#94a9c4` |
| `--text-faint` | `#657b98` |
| `--hairline` | `rgba(241, 245, 255, 0.09)` |
| `--hairline-strong` | `rgba(241, 245, 255, 0.18)` |
| `--accent` | `#635bff` |
| `--accent-hover` | `#7a73ff` |
| `--on-accent` | `#ffffff` |
| `--live` | `#00d66f` |
| `--confirm` | `#e8b048` |
| `--stop` | `#f06878` |
| `--on-stop` | `#1b0c0e` |
| `--scrim` | `rgba(0, 0, 0, 0.7)` |

### nvidia

| Token | Value |
|---|---|
| `--canvas-deep` | `#000000` |
| `--canvas` | `#000000` |
| `--surface` | `#111111` |
| `--surface-2` | `#1a1a1a` |
| `--surface-3` | `#0a0a0a` |
| `--text` | `#ffffff` |
| `--text-dim` | `#a7a7a7` |
| `--text-faint` | `#757575` |
| `--hairline` | `#2b2b2b` |
| `--hairline-strong` | `#5e5e5e` |
| `--accent` | `#76b900` |
| `--accent-hover` | `#8dd405` |
| `--on-accent` | `#000000` |
| `--live` | `#76b900` |
| `--confirm` | `#df6500` |
| `--stop` | `#e52020` |
| `--on-stop` | `#ffffff` |
| `--scrim` | `rgba(0, 0, 0, 0.7)` |

### paper

| Token | Value |
|---|---|
| `--canvas-deep` | `#f6f6f9` |
| `--canvas` | `#ffffff` |
| `--surface` | `#f2f2f6` |
| `--surface-2` | `#ededf2` |
| `--surface-3` | `#ebebf1` |
| `--text` | `#101114` |
| `--text-dim` | `#686b82` |
| `--text-faint` | `#9497a9` |
| `--hairline` | `#dedee5` |
| `--hairline-strong` | `#c5c5d1` |
| `--accent` | `#7132f5` |
| `--accent-hover` | `#5b1ecf` |
| `--on-accent` | `#ffffff` |
| `--live` | `#149e61` |
| `--confirm` | `#d4940a` |
| `--stop` | `#d9363e` |
| `--on-stop` | `#ffffff` |
| `--scrim` | `rgba(0, 0, 0, 0.35)` |

### sand

| Token | Value |
|---|---|
| `--canvas-deep` | `#eae7e5` |
| `--canvas` | `#f5f5f5` |
| `--surface` | `#f0efed` |
| `--surface-2` | `#e7e5e4` |
| `--surface-3` | `#dedad6` |
| `--text` | `#0c0a09` |
| `--text-dim` | `#777169` |
| `--text-faint` | `#a8a29e` |
| `--hairline` | `#e7e5e4` |
| `--hairline-strong` | `#d6d3d1` |
| `--accent` | `#d97706` |
| `--accent-hover` | `#b45309` |
| `--on-accent` | `#ffffff` |
| `--live` | `#16a34a` |
| `--confirm` | `#d97706` |
| `--stop` | `#dc2626` |
| `--on-stop` | `#ffffff` |
| `--scrim` | `rgba(0, 0, 0, 0.35)` |

### claude

| Token | Value |
|---|---|
| `--canvas-deep` | `#f3f1ea` |
| `--canvas` | `#faf9f5` |
| `--surface` | `#f5f0e8` |
| `--surface-2` | `#efe9de` |
| `--surface-3` | `#e8e0d2` |
| `--text` | `#141413` |
| `--text-dim` | `#6c6a64` |
| `--text-faint` | `#8e8b82` |
| `--hairline` | `#e6dfd8` |
| `--hairline-strong` | `#cfcac0` |
| `--accent` | `#cc785c` |
| `--accent-hover` | `#a9583e` |
| `--on-accent` | `#ffffff` |
| `--live` | `#5db872` |
| `--confirm` | `#d4a017` |
| `--stop` | `#c64545` |
| `--on-stop` | `#ffffff` |
| `--scrim` | `rgba(20, 20, 19, 0.35)` |

### cursor

| Token | Value |
|---|---|
| `--canvas-deep` | `#efeee8` |
| `--canvas` | `#f7f7f4` |
| `--surface` | `#ffffff` |
| `--surface-2` | `#fafaf7` |
| `--surface-3` | `#f0efe8` |
| `--text` | `#26251e` |
| `--text-dim` | `#5a5852` |
| `--text-faint` | `#807d72` |
| `--hairline` | `#e6e5e0` |
| `--hairline-strong` | `#cfcdc4` |
| `--accent` | `#f54e00` |
| `--accent-hover` | `#d04200` |
| `--on-accent` | `#ffffff` |
| `--live` | `#1f8a65` |
| `--confirm` | `#c08532` |
| `--stop` | `#cf2d56` |
| `--on-stop` | `#ffffff` |
| `--scrim` | `rgba(38, 37, 30, 0.35)` |

## Controls and interactions

Use AppButton for Home controls; preserve the existing Base UI components for Input, Checkbox, Tabs, Menu (dropdown-menu), Dialog, Select and Tooltip. NativeSelect is the native size selector. Switch.jsx retains the existing controlled on/onChange API. Kbd.jsx is display-only. Toast uses the existing Sonner host and action API.

| Control | Appearance and behavior |
|---|---|
| Button | Primary accent fill/on-accent text; secondary raised fill/border; ghost transparent; destructive stop fill/on-stop text. Sizes small 28 px, medium 36 px, large 44 px; icon 36 px square with accessible name. Hover strengthens border; primary uses accent-hover. Press translates 1 px. Disabled opacity .45 and no action. Loading disables, sets aria-busy and retains label/width. |
| Input / Select | Raised fill, 1 px border, 8 px radius, 36 px minimum; Input labels supplied by caller; invalid state retained from Base UI. NativeSelect loading sets aria-busy and disables. Native keyboard selection; Base UI Select keeps its popup keyboard semantics. |
| Checkbox / Switch | Accent fill for checked/on; visible label or aria-label required; Space toggles; disabled .45 opacity. |
| Tabs | Surface-2 track, surface-3 selected tab; Base UI roving focus and arrow keys; disabled tabs skipped. |
| Menu | Bordered opaque panel; highlighted item surface-3; Base UI keyboard navigation, Escape and focus restoration. |
| Drawer | Right edge, width min(520 px, viewport), full dynamic viewport height, 24 px padding; native modal dialog traps focus, Escape closes, restores opener; only drawer itself scrolls. |
| Dialog | Existing Base UI/modal implementation; opaque themed panel, 12 px radius, border; retain focus trap, Esc, labels and destructive confirmation behavior. |
| Tooltip | Opaque bordered panel; existing hover/focus and Escape semantics; never the only accessible label. |
| Toast | Existing Sonner region, themed border/panel; layout change uses a single replaceable toast with Undo. Save errors remain in the Home live region. |
| Kbd | Mono 11/16, 2×4 px padding, surface-2, 1 px border, 4 px radius; no interaction state. |

All interactive controls use focus-visible outline, disabled behavior and pressed feedback. Loading applies to asynchronous actions, not display-only Kbd or tooltip text; do not fabricate asynchronous behavior for a checkbox or tab.

Edit mode exposes drag and size controls. Arrow keys move/resize by a step; at mobile widths use explicit up/down controls. Pointer moves reflow the actual grid; Escape/cancel restores the pre-gesture layout. Save is serialized through the existing layout API, with undo captured before each gesture. Collapsing preserves mounted widget content. Moving changes outer placement without changing the memoized widget view props/context; periodic clock/data updates remain independent.

Motion: 150 ms controls, 200 ms layout/drawer, cubic-bezier(.2,.8,.2,1). Layout uses transform-only Web Animations. Reduced-motion disables layout animation and drawer slide. 60 fps is a hardware profiling target, not established by functional tests.

Palette: existing command/search behavior and navigation preserved, opaque themed surface and shared buttons. System widgets remain reachable through existing search results.

## Enforcement

`frontend/lint/ui-controls.js` defines warning `amethyst-ui/no-raw-controls` for JSX button/input/select/textarea outside the shared UI/base/modal/notification primitive directories and dashboard primitives. This is advisory; it does not change runtime behavior. Never change widget data contracts to satisfy UI rules.
