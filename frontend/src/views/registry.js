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
  today: () => import('./Today.jsx'),
  tasks: () => import('./Tasks.jsx'),
  mail: () => import('./Mail.jsx'),
  capabilities: () => import('./Capabilities.jsx'),
  automations: () => import('./Automations.jsx'),
  memory: () => import('./Memory.jsx'),
  library: () => import('./Library.jsx'),
  logs: () => import('./Logs.jsx'),
  dash: () => import('./Dashboard.jsx'),
  remote: () => import('./Remote.jsx'),
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

      if (!pageHasAlreadyBeenForceRefreshed && isChunkError) {
        window.sessionStorage.setItem('amethyst_chunk_retry', 'true')
        window.location.reload()
        return new Promise(() => {})
      }
      throw error
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
