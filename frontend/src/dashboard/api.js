import { getBase, getAuthHeaders } from '../api.js'
import { identity } from '../lib/sync/client.js'

export async function request(path, method = 'GET', body, timeoutMs = 3500) {
  const response = await fetch(`${getBase()}${path}`, {
    method, headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    const message = Array.isArray(detail.detail) ? detail.detail.map(error => `${error.loc?.filter(part => part !== 'body').join('.') || 'Value'}: ${error.msg}`).join('; ') : detail.detail
    if (response.status === 403 && typeof message === 'string' && message.includes('answers the full API')) {
      try {
        localStorage.removeItem('amethyst.sync.identity.v1')
        localStorage.removeItem('amethyst.v2.bundle')
      } catch {}
    }
    throw new Error(typeof message === 'string' && message ? message : `Request failed (${response.status})`)
  }
  return response.json()
}

export function cached(key) {
  try {
    const owner = identity()?.deviceId
    const scoped = localStorage.getItem(`amethyst.widgets.${owner || "desktop"}.${key}`)
    // Only the desktop may inherit the pre-companion cache.
    const legacy = !owner && localStorage.getItem(`amethyst.widgets.${key === 'layout.default' ? 'layout' : key}`)
    return JSON.parse(scoped || legacy || 'null')
  } catch { return null }
}
export function remember(key, value) {
  try { localStorage.setItem(`amethyst.widgets.${identity()?.deviceId || "desktop"}.${key}`, JSON.stringify(value)) } catch { /* SQLite remains authoritative. */ }
}
export function clearDeviceCache() {
  const owner = identity()?.deviceId
  if (!owner) return
  const prefix = `amethyst.widgets.${owner}.`
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(prefix)) localStorage.removeItem(key)
  }
}
