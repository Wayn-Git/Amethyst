/* The one list of what pages exist.
 *
 * This used to be four hand-maintained lists (App.jsx's keybindings, the
 * rail, the command palette, Settings' "Pages" links) that had already
 * drifted apart -- different labels for the same place, Settings missing a
 * link to Mail entirely, a beta marker baked into one label string and not
 * the others. One registry, one place to add a view. */

export const NAV = [
  { id: 'chat', path: '/chat', label: 'Chat', icon: 'chat', digit: 1 },
  // Today comes second in the rail because that is where a day starts, but it
  // carries digit 8 rather than 2: renumbering seven digits people already have
  // in their fingers is a worse trade than one entry whose position and digit
  // disagree.
  { id: 'today', path: '/today', label: 'Today', icon: 'sun', digit: 8, rail: true, settings: true },
  { id: 'tasks', path: '/tasks', label: 'Tasks', icon: 'check', digit: 2, rail: true, settings: true },
  { id: 'mail', path: '/mail', label: 'Mail', icon: 'mail', digit: 3, rail: true, settings: true, beta: true },
  { id: 'capabilities', path: '/capabilities', label: 'Skills & connectors', icon: 'grid', digit: 4, rail: true, settings: true },
  { id: 'automations', path: '/automations', label: 'Automations', icon: 'clock', digit: 5, rail: true, settings: true, beta: true },
  { id: 'memory', path: '/memory', label: 'Memory', icon: 'spark', digit: 6, rail: true, settings: true },
  { id: 'library', path: '/library', label: 'Library', icon: 'book', digit: 9, rail: true, settings: true },
  // Reached from Settings rather than the rail. It is a page you open when
  // something looks wrong, not one you open every day, and the rail is worth
  // more to the pages that are.
  { id: 'logs', path: '/logs', label: 'Activity', icon: 'logs', digit: 7, settings: true },
  // No digit, no rail entry, no Settings link: reached only from the
  // degraded/offline banner or the command palette. That's an existing
  // product decision, not an oversight this file is fixing.
  { id: 'dash', path: '/dash', label: 'Status', icon: 'dash' },
  // The phone's page: this machine, read from somewhere else. No rail entry and
  // no digit, because on the machine itself it is pointless -- everything it
  // shows is a stale copy of what Chat already has live. The offline banner and
  // Settings > Devices are how you reach it, which is also where you are when
  // you need it.
  { id: 'remote', path: '/remote', label: 'Remote', icon: 'link' },
  { id: 'settings', path: '/settings', label: 'Settings', icon: 'sliders' },
]

/* Beta pages are off until someone turns them on in Settings, and "off" means
   gone: not in the rail, not in the palette, not on a digit, and not routed.
   A page that is switched off but still reachable by typing its address is a
   switch that does not do what it says. */
const shown = (beta) => NAV.filter((n) => beta || !n.beta)

export const byId = (id) => NAV.find((n) => n.id === id)
export const forRail = (beta) => shown(beta).filter((n) => n.rail)
export const forSettings = (beta) => shown(beta).filter((n) => n.settings)
export const forPalette = (beta) => shown(beta)
export const forRoutes = (beta) => shown(beta).filter((n) => n.id !== 'chat')
export const byDigit = (n, beta) => shown(beta).find((v) => v.digit === n)
export const pathFor = (id) => byId(id)?.path ?? '/chat'
export const isBeta = (id) => Boolean(byId(id)?.beta)
