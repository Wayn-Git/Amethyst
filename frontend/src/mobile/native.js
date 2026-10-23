import { isNativeMobile } from '../lib/credentials.js'

export function pairingRoute(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'amethyst:' || url.hostname !== 'pair') throw new Error('Unsupported app link')
  const parameters = new URLSearchParams(url.hash.slice(1) || url.search.slice(1))
  if (!parameters.get('s')) throw new Error('Pairing link has no secret')
  // Only the known pairing fields reach the webview. Never navigate the
  // privileged native webview to an external origin supplied by a link.
  const selected = new URLSearchParams()
  for (const key of ['s', 'r', 'h']) {
    const value = parameters.get(key)
    if (value) selected.set(key, value)
  }
  return `/pair#${selected}`
}

export async function initializeNative() {
  if (!isNativeMobile()) return
  const { App } = await import('@capacitor/app')
  const open = ({ url }) => {
    try { window.location.assign(pairingRoute(url)) } catch { /* ignore unrelated links */ }
  }
  await App.addListener('appUrlOpen', open)
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event('online'))
  })
  const launch = await App.getLaunchUrl()
  if (launch?.url && !window.location.hash.includes('s=')) {
    try { window.history.replaceState(null, '', pairingRoute(launch.url)) } catch { /* not a pairing link */ }
  }
}
