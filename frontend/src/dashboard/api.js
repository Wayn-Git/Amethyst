import { getBase, getAuthHeaders } from '../api.js'

export async function request(path, method = 'GET', body) {
  const response = await fetch(`${getBase()}${path}`, {
    method, headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    const message = Array.isArray(detail.detail) ? detail.detail.map(error => `${error.loc?.filter(part => part !== 'body').join('.') || 'Value'}: ${error.msg}`).join('; ') : detail.detail
    throw new Error(typeof message === 'string' && message ? message : `Request failed (${response.status})`)
  }
  return response.json()
}

export function cached(key) {
  try { return JSON.parse(localStorage.getItem(`amethyst.widgets.${key}`) || 'null') } catch { return null }
}
export function remember(key, value) {
  try { localStorage.setItem(`amethyst.widgets.${key}`, JSON.stringify(value)) } catch { /* SQLite remains authoritative. */ }
}
