import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
/* The faces are bundled, not fetched.

   AMETHYST is local-first by design -- the database is on this disk, the
   documents are on this disk, the secrets are in this machine's keychain -- and
   then the stylesheet reached out to fonts.googleapis.com on every boot. That
   is a request to a third party announcing that this machine started the app,
   and on a laptop with no connection it is a two-second stall followed by the
   interface rendering in a face nobody chose. Self-hosted, it is neither.

   Latin subsets only: the variable Sans covers 400-700 in one file, and Mono
   is pulled at the two weights the interface actually sets. */
import './styles/fonts.css'
import './globals.css'
import './index.css'
import './styles/sidebar.css'
import './views/library/library.css'
import App from './App.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import { AppProvider } from './store.jsx'

/* One bundle, two shapes.

   The daemon opens this page twice: once as the application, and once at
   `?spotlight=1` as the floating bar the hotkey summons. The bar is the palette
   and nothing else -- no rail, no transcript, no chrome -- because the whole
   point of it is to be gone again two seconds later.

   The window behind it is transparent so the card keeps its rounded corners,
   which means this page must not paint a background of its own. */
const params = new URLSearchParams(window.location.search)
const SPOTLIGHT = params.get('spotlight') === '1'

/* Inside AMETHYST's own window rather than a browser tab.

   WebKitGTK composites a `backdrop-filter` far more expensively than Chrome or
   Firefox do, and this interface asks for one on every overlay, menu and toast.
   In a tab that is somebody else's problem; in the window this app *is*, it is
   the difference between smooth and not. The flag lets one stylesheet rule
   stand them all down without touching how the same build looks in a browser. */
if (params.get('native') === '1') document.documentElement.dataset.native = '1'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Outside AppProvider: the store reads useNavigate/useLocation to make
        the URL the source of truth for which view is open. */}
    <BrowserRouter>
      <AppProvider>
        {SPOTLIGHT ? <CommandPalette bare /> : <App />}
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
)

/* Tell the desktop shell the interface is mounted and safe to show.

   The shell keeps its window hidden until this fires, which is what stops a
   launch from ever showing an empty WebView or a half-drawn page.

   Deliberately NOT requestAnimationFrame. A hidden window is not composited, so
   WebKit never runs a rAF callback in one -- which made "wait for the first
   paint" a deadlock: the shell would not show the window until it painted, and
   it could not paint until it was shown. The 8s fallback hid it, so the window
   appeared late and looked like a slow backend rather than a bug.

   What is actually being asked is "has React committed a tree yet", and that
   question has a direct answer: the root has children. setTimeout runs in a
   hidden window where rAF does not, so this polls on a short clock and gives up
   quietly -- the shell has its own fallback, and a signal that never comes must
   not be a page that never loads. */
const signalMounted = () => {
  const send = () => window.pywebview?.api?.ready?.(SPOTLIGHT ? 'spotlight' : 'main')
  const root = document.getElementById('root')
  let tries = 0
  const check = () => {
    if (root?.firstChild) return send()
    if ((tries += 1) > 150) return send() // ~3s: tell it anyway rather than never
    setTimeout(check, 20)
  }
  check()
}
if (window.pywebview) signalMounted()
else window.addEventListener('pywebviewready', signalMounted, { once: true })
