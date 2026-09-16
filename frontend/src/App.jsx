import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Routes, Route } from 'react-router-dom'
import Icon from './components/Icon.jsx'
import BrandMark from './components/BrandMark.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import Shortcuts from './components/Shortcuts.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import Sidebar from './components/Sidebar.jsx'
import PanelResizer from './components/PanelResizer.jsx'
import UserMenu from './components/UserMenu.jsx'
import ConfirmDialogHost from './components/ui/ConfirmDialog.jsx'
import { BootScreen, SkeletonView } from './components/Skeleton.jsx'
import { useApp } from './store.jsx'
import { API_ORIGIN } from './api.js'
import { chord, isTyping, MOD_LABEL } from './keys.js'
import { byDigit, byId, forRoutes } from './nav.js'
import { COMPONENTS } from './views/registry.js'
import Pair from './views/Pair.jsx'
import RemoteOnly from './views/RemoteOnly.jsx'
import { paired as isPaired } from './lib/sync/client.js'
import Chat from './views/Chat.jsx'

/* The workbench.

   Four columns, each with one job, instead of two columns with four jobs
   between them. The marks on the left are where you can go. The column beside
   them is what you have said. The middle is the thing you are doing. The panel
   on the right is the machinery behind it -- every tool call, every step, every
   number -- which used to be interleaved with the answer in the middle column
   and made a conversation read like a build log.

   The two outer columns collapse independently, so a narrow window loses the
   history before it loses the navigation, and a wide one can show all four. */



/* The daemon's side of the palette.

   The tray process owns the global hotkey, and a chord pressed while this window
   is behind another one -- or not open at all -- cannot reach the listener
   below. So the daemon does not try to open the palette; it says that it should
   be open, two ways, one per case.

   A window that already exists is listening on the control stream, and the
   palette goes up in the window the user is looking at. When none existed the
   daemon opened this one, and said so in the address instead.

   EventSource reconnects on its own, which is the whole of "reconnect cleanly"
   here: the daemon restarting, or this page outliving it, needs no code. */
function useDaemonSummon() {
  const { setOverlay } = useApp()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('cmd') === 'palette') {
      setOverlay('palette')
      // Strip it: a reload is not a second summons, and the address belongs to
      // the view rather than to how it was opened.
      params.delete('cmd')
      const query = params.toString()
      window.history.replaceState(
        {}, '',
        window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
      )
    }

    const stream = new EventSource(`${API_ORIGIN}/api/control/stream`)
    stream.onmessage = (e) => {
      try {
        if (JSON.parse(e.data).type === 'palette') {
          // When native desktop is running with pywebview, the native spotlight window is raised.
          // The main workbench window should not open an overlapping duplicate palette!
          if (document.documentElement.dataset.native === '1') {
            return
          }
          setOverlay((prev) => (prev === 'palette' ? null : 'palette'))
          window.focus()
        }
      } catch { /* a frame this build does not know about is not an error */ }
    }
    return () => stream.close()
  }, [setOverlay])
}

/* Every binding in one listener.

   Scattering `keydown` handlers across components is how two of them end up
   owning Escape and neither works reliably. This is the only global listener;
   local ones exist inside a field or an open menu, where they are about that
   field or that menu, and they stop propagation when they act. */
function useGlobalKeys() {
  const {
    view, setView, overlay, setOverlay, chat, conversations, activeId,
    toggleRail, closeRail, compact, railOpen, betaPages,
    toggleTerminal,
  } = useApp()

  const cycleConversation = useCallback((delta) => {
    if (!conversations.length) return
    const at = conversations.findIndex((c) => c.id === activeId)
    const next = conversations[(at + delta + conversations.length) % conversations.length]
    if (next && next.id !== activeId) {
      setView('chat')
      chat.selectConversation?.(next.id)
    }
  }, [conversations, activeId, chat, setView])

  useEffect(() => {
    const onKey = (e) => {
      const combo = chord(e)
      const typing = isTyping(e.target)

      // Escape is shared: whatever is open closes first, and only when nothing
      // is open does it reach the running turn. The drawer sits between them --
      // it covers the page on a phone, so it is "what is open" there too.
      if (combo === 'escape') {
        if (overlay) { e.preventDefault(); setOverlay(null); return }
        if (compact && railOpen) { e.preventDefault(); closeRail(); return }
        if (chat.turnRunning) { e.preventDefault(); chat.stop?.(); return }
        return
      }

      if (combo === 'mod+k') {
        e.preventDefault()
        setOverlay((curr) => (curr === 'palette' ? null : 'palette'))
        return
      }
      if (combo === 'mod+shift+o') { e.preventDefault(); setView('chat'); chat.startFresh?.(); return }
      if (combo === 'mod+l') { e.preventDefault(); setView('chat'); chat.focusComposer?.(); return }
      if (combo === 'mod+/') { e.preventDefault(); setView('chat'); chat.openPlus?.(); return }
      if (combo === 'mod+u') { e.preventDefault(); setView('chat'); chat.attach?.(); return }
      if (combo === 'mod+b') { e.preventDefault(); toggleRail(); return }
      if (combo === 'mod+,') { e.preventDefault(); setView(view === 'settings' ? 'chat' : 'settings'); return }
      if (combo === 'mod+arrowup') { e.preventDefault(); cycleConversation(-1); return }
      if (combo === 'mod+arrowdown') { e.preventDefault(); cycleConversation(1); return }
      if (combo === 'mod+m') { e.preventDefault(); chat.toggleMemory?.(); return }
      if (combo === 'mod+shift+m') { e.preventDefault(); chat.cycleEffort?.(); return }
      if (combo === 'mod+p') { e.preventDefault(); setView('chat'); chat.togglePin?.(); return }
      if (combo === 'f2' && activeId) { e.preventDefault(); setView('chat'); chat.beginRename?.(activeId); return }
      if (combo === 'mod+`' || combo === 'ctrl+`') { e.preventDefault(); toggleTerminal(); return }

      const digit = /^mod\+([1-9])$/.exec(combo)
      if (digit) {
        e.preventDefault()
        const target = byDigit(Number(digit[1]), betaPages)
        if (target) setView(target.id)
        return
      }

      if (!typing && (combo === 'shift+?' || combo === '?')) {
        e.preventDefault()
        setOverlay(overlay === 'shortcuts' ? null : 'shortcuts')
        return
      }
      // Bare `/` from anywhere goes where a skill name is typed.
      if (!typing && combo === '/' && view === 'chat') {
        e.preventDefault()
        chat.focusComposer?.('/')
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    view, setView, overlay, setOverlay, chat, cycleConversation, activeId,
    toggleRail, closeRail, compact, railOpen, betaPages, toggleTerminal,
  ])
}

/* The bar over the working column.

   It says where you are, which the rail no longer can now that the rail is
   marks, and it holds the two switches for the columns either side of it. */
function WorkbenchBar() {
  const {
    setOverlay, view, setView, compact, railOpen, toggleRail,
    panel, togglePanel, userProfile, autoHideTopBar,
  } = useApp()

  return (
    <>
      {autoHideTopBar && <div className="wb-bar-hover-trigger" />}
      <header className={`wb-bar${autoHideTopBar ? ' wb-bar--autohide' : ''}`}>
        <div className="wb-bar-left">
          {(!railOpen || compact) && (
            <div className="wb-bar-toggle-group">
              <button
                type="button"
                className="wb-icon-btn"
                onClick={toggleRail}
                title={`Open sidebar — ${MOD_LABEL}+B`}
                aria-label="Open sidebar"
              >
                <Icon name="sidebar" size={15} />
              </button>
              <UserMenu align="start" side="bottom" sideOffset={8}>
                <button
                  type="button"
                  className="wb-bar-user-btn"
                  title={`User menu for ${userProfile?.name || 'User'} — Click to edit name or open settings`}
                >
                  <div className="sb-user-avatar sb-user-avatar--xs">
                    {(userProfile?.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span className="wb-bar-user-name">{userProfile?.name || 'User'}</span>
                  <Icon name="chevron" size={9} style={{ opacity: 0.6 }} />
                </button>
              </UserMenu>
            </div>
          )}
        </div>

        {/* Center: Apple-style Refined Search Bar */}
        <div className="wb-bar-center">
          <button
            type="button"
            className="wb-search-bar"
            onClick={() => setOverlay((curr) => (curr === 'palette' ? null : 'palette'))}
            title={`Search or jump to — ${MOD_LABEL}+K`}
            aria-label="Search or command palette"
          >
            <Icon name="search" size={13} className="wb-search-icon" />
            <span className="wb-search-placeholder">Search or jump to...</span>
            <kbd className="wb-search-kbd">{MOD_LABEL}+K</kbd>
          </button>
        </div>

        {/* Right Icon Actions: Artifact Panel + Settings + Brand Logo */}
        <div className="wb-bar-actions">
          <button
            type="button"
            className={`wb-icon-btn${panel ? ' is-active' : ''}`}
            onClick={togglePanel}
            title={panel ? 'Hide artifact panel' : 'Show artifact panel'}
            aria-label={panel ? 'Hide artifact panel' : 'Show artifact panel'}
            aria-pressed={panel}
          >
            <Icon name="layout" size={15} />
          </button>

          <button
            type="button"
            className={`wb-icon-btn${view === 'settings' ? ' is-active' : ''}`}
            onClick={() => setView('settings')}
            title={`Settings — ${MOD_LABEL}+,`}
            aria-label="Settings"
          >
            <Icon name="sliders" size={15} />
          </button>

          <div className="wb-bar-brand-wrap wb-bar-brand-right" title="Amethyst">
            <BrandMark size={20} />
            <span className="wb-bar-brand-text">AMETHYST</span>
          </div>
        </div>
      </header>
    </>
  )
}

/* The drawer's backdrop.
 *
 * It is a button rather than a div because tapping it is the ordinary way out
 * of the drawer on a touch device, and an interactive element that only a
 * pointer can reach is exactly the thing this pass exists to remove. */
function RailScrim({ onClose }) {
  return (
    <button
      type="button"
      className="rail-scrim"
      aria-label="Close navigation"
      onClick={onClose}
    />
  )
}

function Toasts() {
  const { toasts } = useApp()
  /* `aria-live` is the whole point of a toast for anyone not looking at the
     corner of the screen: "connector ready, 16 tools" was visible feedback and
     silent feedback at the same time. Polite, because none of these interrupt
     anything. */
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const {
    view, setView, server, retryServer, compact, railOpen, closeRail, panel, panelWidth, panelExpanded,
    betaPages,
  } = useApp()

  // Whether this browser belongs to a machine, and whether somebody has said
  // they want to set that up. Held here rather than read on every render
  // because `isPaired` touches localStorage, and because pairing has to move
  // this screen on without a reload.
  const [paired, setPaired] = useState(isPaired)
  const [remoteFirst, setRemoteFirst] = useState(false)

  useEffect(() => {
    window.__amethyst_navigate = (pathOrId) => {
      const id = pathOrId.replace(/^\//, '')
      setView(id || 'chat')
    }
    return () => {
      delete window.__amethyst_navigate
    }
  }, [setView])

  // Beta pages are not routed while they are switched off, so their addresses
  // fall through to the redirect below rather than rendering a page the rail
  // and the palette both say does not exist.
  const routed = useMemo(() => forRoutes(betaPages), [betaPages])
  useGlobalKeys()
  useDaemonSummon()
  const stageRef = useRef(null)

  /* The tab reports where you are. It used to say the same eleven words on
     every page, which makes a row of pinned tabs unreadable and a browser's
     history search useless. */
  useEffect(() => {
    const here = byId(view)
    document.title = here && here.id !== 'chat'
      ? `${here.label} · AMETHYST`
      : 'AMETHYST · personal operating system'
  }, [view])

  // Nothing is mounted until the backend answers. Every view here opens by
  // fetching, so mounting them against a container that is still booting draws
  // a page of failures and then leaves it there -- a deploy that looks broken
  // for the fifty seconds it takes to start. The frame says what is happening
  // instead, and the views mount into real data.
  //
  // Except on a device that has no backend to wait for. A phone loads this app
  // from wherever it is hosted and the machine is at home behind a router, so
  // "the API did not answer" is not a fault there -- it is the normal state,
  // and the workbench below is the wrong thing to show even if it could load.
  //
  // This used to fall through to the boot screen regardless, which meant a
  // phone waited ninety seconds for a server that was never going to answer and
  // then sat on an error, with the pairing controls stranded inside a Settings
  // page it could not reach. The device that most needed to pair was the one
  // that could not.
  // `verified` rather than `phase` alone: 'ready' is optimistic until a ping has
  // actually answered, and a paired phone must not be shown the workbench for
  // the length of that guess.
  if (server.phase !== 'ready' || !server.verified) {
    if (paired) return <RemoteOnly />
    // Offered immediately rather than after the wake gives up: a paired phone
    // knows what it is, and an unpaired one asking to be paired is not a
    // failure state worth making somebody wait out.
    if (server.phase === 'down' || remoteFirst) {
      return <Pair onPaired={() => setPaired(true)} />
    }
    return (
      <BootScreen
        server={server}
        onRetry={retryServer}
        onRemote={() => setRemoteFirst(true)}
      />
    )
  }

  const isChat = view === 'chat'
  const drawerOpen = compact && railOpen

  return (
    <div
      className={
        `wb app${compact ? ' app--compact wb--compact' : ''}`
        + `${drawerOpen ? ' app--drawer wb--drawer' : ''}`
        + `${railOpen ? '' : ' wb--rail-hidden'}`
        + `${panel ? '' : ' wb--panel-hidden'}`
        + `${panel && panelExpanded ? ' wb--panel-full' : ''}`
      }
    >
      <Sidebar />
      {drawerOpen && <RailScrim onClose={closeRail} />}
      {/* `inert` is what keeps a screen reader and the Tab key out of the page
          the drawer is covering. Without it the drawer looks modal and behaves
          like a decoration. */}
      {/* A real boolean: React 19 reflects `inert` from one, and an empty
          string is treated as false, which quietly left the page behind the
          drawer fully tabbable. */}
      <div className="wb-main stage" ref={stageRef} inert={drawerOpen}>
        {view !== 'settings' && <WorkbenchBar />}
        {/* Chat stays mounted, outside <Routes>: unmounting it mid-turn
            would drop the stream. */}
        <main className={`main${isChat ? '' : ' main--hidden'}`}>
          <ErrorBoundary><Chat /></ErrorBoundary>
        </main>
        {!isChat && (
          <main className="main view-swap" key={view}>
            <ErrorBoundary>
              {/* The skeleton stands in for the chunk arriving, which on a
                  local server is one frame and on a slow connection is the
                  difference between a blank stage and a page loading. */}
              <Suspense fallback={<SkeletonView rows={5} aside={view === 'tasks' || view === 'mail'} />}>
                <Routes>
                  {routed.map((v) => {
                    const Comp = COMPONENTS[v.id]
                    return <Route key={v.id} path={v.path} element={<Comp />} />
                  })}
                  <Route path="*" element={<Navigate to="/chat" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        )}
      </div>
      {/* The panel is a slot rather than a component: whichever view is open
          fills it through a portal, and it collapses on its own when nothing
          has anything to put there. */}
      {view !== 'settings' && (
      <aside
        className="wb-panel"
        id="wb-panel"
        aria-label="Run detail"
        inert={drawerOpen}
        style={{ '--panel-w': `${panelWidth}px` }}
      >
        <PanelResizer />
      </aside>
      )}
      <CommandPalette />
      <Shortcuts />
      
      <OnboardingWizard />
      <ConfirmDialogHost />
      <Toasts />
    </div>
  )
}
