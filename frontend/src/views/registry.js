import Settings from './Settings.jsx'
import { lazy } from 'react'
import Chat from './Chat.jsx'

/* Which component each place in `nav.js` renders, and how to fetch it early.
 *
 * Chat is imported outright; every other view is fetched when it is first
 * opened. All eight used to ship in one 600kB script that had to arrive, parse
 * and execute before the composer could take a keystroke — and seven of them
 * are pages most sessions never visit. Chat stays eager because it is where
 * the application opens and where it stays.
 *
 * Kept out of App.jsx so that file exports a component and nothing else, which
 * is what keeps fast refresh working on it. */

const LOADERS = {
  today: () => import('../dashboard/Home.jsx'),
  tasks: () => import('./Tasks.jsx'),
  mail: () => import('./Mail.jsx'),
  converter: () => import('./Converter.jsx'),
  capabilities: () => import('./Capabilities.jsx'),
  automations: () => import('./Automations.jsx'),
  memory: () => import('./Memory.jsx'),
  library: () => import('./Library.jsx'),
  code: () => import('./Code.jsx'),
  logs: () => import('./Logs.jsx'),
  dash: () => import('./Dashboard.jsx'),
  remote: () => import('./Remote.jsx'),
  install: () => import('./Install.jsx'),
  // settings eager
}

function lazyWithRetry(componentImport) {
  return lazy(async () => {
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.sessionStorage.getItem('amethyst_chunk_retry') || 'false',
    )

    try {
      const component = await componentImport()
      window.sessionStorage.setItem('amethyst_chunk_retry', 'false')
      return component
    } catch (error) {
      const msg = String(error?.message || error).toLowerCase()
      const isChunkError =
        msg.includes('module script') ||
        msg.includes('dynamically imported module') ||
        msg.includes('loading chunk') ||
        msg.includes('failed to fetch')

      if (pageHasAlreadyBeenForceRefreshed || !isChunkError) throw error

      /* A reload is fatal to a running turn: unloading the page drops the
         turn fetch and the control stream in the same instant, the turn ends
         as a client disconnect, and the interface then blames "the provider"
         for a model that streamed 200 the whole way. Rebuild windows make
         view chunks briefly unfetchable, so the failure usually lands
         exactly while something is streaming. Park instead: reload once the
         turn settles, with a ceiling so a wedged turn cannot postpone it
         forever. */
      if (window.__AMETHYST_TURN_ACTIVE === true) {
        window.__AMETHYST_PENDING_CHUNK_RELOAD = true
        await new Promise((resolve) => {
          let settled = false
          const leave = () => {
            if (settled) return
            settled = true
            clearTimeout(ceiling)
            window.removeEventListener('amethyst:turn-settled', leave)
            resolve()
          }
          const ceiling = setTimeout(leave, 120_000)
          window.addEventListener('amethyst:turn-settled', leave)
        })
        window.__AMETHYST_PENDING_CHUNK_RELOAD = false
      }

      window.sessionStorage.setItem('amethyst_chunk_retry', 'true')
      window.location.reload()
      return new Promise(() => {})
    }
  })
}

export const COMPONENTS = {
  chat: Chat,
  settings: Settings,
  ...Object.fromEntries(
    Object.entries(LOADERS).map(([id, load]) => [id, lazyWithRetry(load)]),
  ),
}

/* Warm a chunk on intent rather than on arrival: hovering a rail entry, or
 * reaching it with the keyboard, is enough notice to have the script in cache
 * by the time the click lands. Each is asked for once — the browser caches the
 * module either way, but there is no reason to hand it the same promise twice.
 *
 * A failed prefetch is deliberately silent: the real navigation will ask
 * again, and an error here is about a page nobody has opened yet. */
const asked = new Set()

export function prefetchView(id) {
  const load = LOADERS[id]
  if (!load || asked.has(id)) return
  asked.add(id)
  load().catch(() => asked.delete(id))
}
