# Shared UI Components

The application shell, navigation, overlays, transcript pieces, dialogs and the
small primitives every view uses.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [FRONTEND.md](../FRONTEND.md), [components/design-system.md](design-system.md),
[sections/chat.md](../sections/chat.md), [sections/today.md](../sections/today.md).

## Shell

`frontend/src/App.jsx` is the workbench. It owns:

- the four-column layout: navigation rail, conversation column, main view,
  right panel;
- route rendering through `COMPONENTS` from `views/registry.js`;
- the global key listener;
- the command palette and other overlays;
- the daemon control stream (`/api/control/stream`);
- pairing notifications;
- boot and splash states;
- the mobile bottom navigation.

The layout collapses the two outer columns independently. A narrow window loses
history before navigation; a wide one can show all four.

`AppTitleBar.jsx` is the desktop title bar: window controls, menu, view title
and panel toggles. It uses Electron IPC when present, then `window.pywebview.api`,
then browser fullscreen.

`PanelResizer.jsx` is the draggable right-panel edge. Pointer events and
`setPointerCapture` keep the drag alive outside the four-pixel strip. Width is
written during the drag and persisted once on release.

`ErrorBoundary.jsx` wraps views so a render failure shows a recoverable error
instead of a blank window.

`Skeleton.jsx` provides `BootScreen`, `SkeletonView` and the ASCII skeleton used
while the first API answer is pending.

## Navigation

| Component | Role |
|---|---|
| `Sidebar.jsx` | Primary navigation, conversation list, search, pin/rename/archive/delete, user menu |
| `MobileNav.jsx` | Bottom bar: Chat, Today, Tasks, Library, More |
| `CommandPalette.jsx` | Global search, navigation, web results, actions |
| `Shortcuts.jsx` | Keyboard reference overlay |
| `nav.js` | Route metadata, rail groups, palette entries, digit shortcuts |
| `keys.js` | Chord normalization, labels, typing detection |

`Sidebar` reads `forRail()` from `nav.js`; it does not hardcode a second route
list. `prefetchView()` warms a lazy chunk on hover.

The command palette has a native spotlight mode for pywebview. It calls
`window.pywebview.api.open_main`, `hide`, `minimize`, `maximize` or `close` when
present. In the browser it uses the normal overlay path.

## Overlays and dialogs

| Component | Role |
|---|---|
| `ConfirmModal.jsx` | Tool approval: risk, arguments, allow/deny, remember choice |
| `ui/ConfirmDialog.jsx` | Promise-based confirm host used by views |
| `PairingApprovalModal.jsx` | Device pairing: name, role, permission checkboxes |
| `SplashScreenWizard.jsx` | First-run setup |
| `ArtifactPanel.jsx` | Streamed artifact viewer/editor |
| `SourcesSidePanel.jsx` | Sources extracted from an answer |
| `TerminalDrawer.jsx` | Embedded terminal |
| `ContextPopover.jsx` | Context usage details |
| `GuardMenu.jsx`, `ModelMenu.jsx`, `EffortMenu.jsx` | Composer controls |
| `UserMenu.jsx` | Profile, settings, sign-out |

`ConfirmModal` is keyboard-driven: Enter allows, Escape declines, R toggles
"remember". It renders arguments as JSON or code, never as raw HTML.

`PairingApprovalModal` is the authority UI for the permission map. Its defaults
match `DEFAULT_PERMISSIONS`: dashboard, library and agent on; screen, input,
files, terminal, clipboard and the rest off.

## Transcript components

| Component | Role |
|---|---|
| `TurnTrace.jsx` | Tool calls, results, subagents, parallel jobs, connector cards |
| `TurnRail.jsx` | Jump between turns |
| `ToolChipsTrace.jsx` | Compact tool chips |
| `ResponseActionBar.jsx` | Copy, retry, edit, branch |
| `ResponseEditor.jsx` | Edit a user message |
| `ResponseArtifactBox.jsx` | Inline artifact card |
| `SubagentCard.jsx` | Subagent status and trace |
| `ParallelJobCard.jsx` | Fan-out batch progress |
| `ComposioConnectCard.jsx` | App connection prompt |
| `ConnectorWaitCard.jsx` | Connector suspended on a person |
| `markdown/Markdown.jsx` | Markdown renderer, code blocks, links |
| `widgets/` | Inline widget envelopes from `widget` events |

`TurnTrace` maps backend events to activity items. It must tolerate an unknown
event type: the backend can add one before the frontend knows it.

## Shared primitives

| Component | Role |
|---|---|
| `Icon.jsx` | Named SVG icon set |
| `BrandMark.jsx` | Logo |
| `LoaderIcon.jsx`, `MatrixLoader.jsx` | Loading indicators |
| `EmptyState.jsx`, `ErrorState.jsx` | Empty and failure states |
| `Table.jsx` | Simple table |
| `Badge.jsx`, `Kbd.jsx` | Small display primitives |
| `Field.jsx` | Label, hint and error wrapper |
| `ui/AppButton.jsx` | House button |
| `ui/NativeSelect.jsx` | Styled native select |
| `ui/Switch.jsx` | Switch |
| `ui/bento/index.jsx` | Bento primitives; see [design-system.md](design-system.md) |

Views should use these rather than re-implementing a button, dialog or empty
state.

## State and data

Shared state is `frontend/src/store.jsx` (`useApp`). It owns:

- current view and overlay;
- conversation list and active id;
- rail and panel visibility and widths;
- compact/mobile mode;
- terminal open state;
- beta page flags;
- capabilities tab;
- toast/notification helpers.

Feature state stays local to its view. Do not put a widget's fetched data in the
global store; `useWidget` owns it.

The API client is `frontend/src/api.js`. It owns fetch, SSE parsing, auth
headers, error normalization and `serverTime`. Components do not call `fetch`
directly for application data.

See [systems/state.md](../systems/state.md).

## Accessibility

- Every icon-only control needs an `aria-label`.
- Dialogs trap focus and restore it on close.
- `Escape` closes the topmost overlay before it reaches a running turn.
- The command palette is keyboard-navigable.
- Widgets expose `aria-label` and live status text.
- Reduced motion is honored by `motion.js` and CSS.
- Color is never the only signal; risk and status also carry text.

## Modification guide

| Change | Touch |
|---|---|
| Add a route | `views/registry.js`, `nav.js`, the view, `App.jsx` if eager |
| Add a nav item | `nav.js`; `Sidebar` and `MobileNav` read it |
| Add a global shortcut | `App.jsx` `useGlobalKeys`, `Shortcuts.jsx` |
| Add an overlay | `store.jsx` overlay union, `App.jsx`, focus trap |
| Change approval UI | `ConfirmModal.jsx`, confirmation payload |
| Change pairing UI | `PairingApprovalModal.jsx`, `devices.py` permissions |
| Add a transcript event | `TurnTrace.jsx`, `api.js` dispatch, backend emitter |
| Change the shell layout | `App.jsx`, `store.jsx`, shell CSS |

Rules:

- One global key listener. Local listeners stop propagation when they act.
- Lazy-load every view except Chat.
- Keep route metadata in `nav.js`, not duplicated in the sidebar.
- Do not parse SSE in a component.
- Do not store fetched widget data globally.
- Every async surface needs loading, empty, error and retry states.

## Known issues

- `Sidebar.jsx` and `CommandPalette.jsx` are large; both mix data fetching,
  layout and interaction.
- Some older views still import `ui/bento` directly and bypass newer
  primitives.
- The shell has both Electron IPC and pywebview bridges; a new native action
  must handle both or degrade in the browser.
- `TurnTrace` supports several activity renderers; adding an event may require
  choosing one rather than adding a fourth.
- `views/Today.jsx` and `views/today/` are legacy and not routed.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
