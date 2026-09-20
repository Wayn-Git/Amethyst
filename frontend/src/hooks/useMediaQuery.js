import { useSyncExternalStore } from 'react'

/* One subscription per query, shared by every component that asks for it.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the first render
 * already knows the answer, so a phone does not paint the desktop shell for a
 * frame and then swap it. That flash is the whole reason a layout that reads
 * the viewport in an effect looks broken on a slow device. */

const stores = new Map()

function storeFor(query) {
  let store = stores.get(query)
  if (store) return store
  const list = window.matchMedia(query)
  const watchers = new Set()
  const relay = () => watchers.forEach((fn) => fn())
  store = {
    subscribe(fn) {
      watchers.add(fn)
      if (watchers.size === 1) list.addEventListener('change', relay)
      return () => {
        watchers.delete(fn)
        if (watchers.size === 0) list.removeEventListener('change', relay)
      }
    },
    get: () => list.matches,
  }
  stores.set(query, store)
  return store
}

const noMatch = () => false
const noSubscribe = () => () => {}

export function useMediaQuery(query) {
  const canMatch = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const store = canMatch ? storeFor(query) : null
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.get : noMatch,
    noMatch,
  )
}

/* The one breakpoint that changes the shape of the application rather than the
   size of its parts: below it the rail is a drawer over the page instead of a
   column beside it. Written once here so the JavaScript that decides how the
   rail behaves and the CSS that draws it cannot drift apart. */
export const COMPACT_QUERY = '(max-width: 859.98px)'

export const useCompact = () => useMediaQuery(COMPACT_QUERY)

/* The other breakpoint that changes the shape of the application: whether this
   is a phone at all.

   Deliberately not the same question as `useCompact`. Compact asks "is the
   window narrow", and its answer is a drawer instead of a column. This asks "is
   there room for the workbench at all", because its answer is a different
   application: the remote control.

   Two clauses, one per orientation, and what they are really testing is the
   *short* side of the screen -- which CSS cannot ask for directly. A phone's
   short side is about 430px at the largest; a tablet's is 744px at the
   smallest. So: narrow in portrait, or short in landscape.

     iPhone portrait    390x844   -> width 390   phone
     iPhone landscape   844x390   -> height 390  phone
     iPad portrait      768x1024  ->             workbench
     iPad landscape    1024x768   ->             workbench

   An earlier version used `(pointer: coarse) and (max-width: 899.98px)` for the
   second clause and caught every iPad in portrait with it, which is the one
   device that has the screen for the real interface and a coarse pointer.

   A desktop window dragged below 600px does match, and that is intended: the
   four-column workbench does not fit there either. `?desktop=1` is the way out
   for anyone who disagrees.

   What this is NOT is a user-agent sniff. A phone is a shape, the browser will
   answer honestly about its shape, and a table of device names goes stale. */
export const PHONE_QUERY =
  '(max-width: 599.98px), (max-height: 429.98px) and (orientation: landscape)'

export const usePhone = () => useMediaQuery(PHONE_QUERY)
