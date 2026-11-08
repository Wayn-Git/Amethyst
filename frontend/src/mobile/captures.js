import { getBase, getAuthHeaders } from '../api.js'
import { identity } from '../lib/sync/client.js'
import { putRecord, records, principal } from './storage.js'

let flushing = null

export async function saveCapture({ title, text = '', url = '' }) {
  if (!title?.trim() && !text?.trim() && !url?.trim()) throw new Error('Add a title and text or a link.')
  if ((title?.length || 0) > 400 || (text?.length || 0) > 100000 || (url?.length || 0) > 8192) throw new Error('This capture is too large.')
  if (url && !['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Use an HTTP or HTTPS link.')

  const { owner } = await principal()
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const capture = {
    id,
    title: (title || '').trim(),
    text: text || '',
    url: url || '',
    deviceId: owner,
    state: 'queued',
    createdAt: new Date().toISOString(),
  }
  await putRecord(`capture:${capture.id}`, capture)
  return capture
}

export async function captures() {
  return (await records('capture:'))
    .map(row => row.value)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export function flushCaptures() {
  if (flushing) return flushing
  flushing = flush().finally(() => { flushing = null })
  return flushing
}

function timeoutSignal(ms = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  if (typeof t?.unref === 'function') t.unref()
  return ctrl.signal
}

async function flush() {
  const owner = identity()?.deviceId
  // Unpaired device holds captures locally without dropping them
  if (!owner) return

  for (const capture of await captures()) {
    if (!['queued', 'accepted', 'running', 'waiting', 'paused'].includes(capture.state)) continue

    // Never drop pre-pairing captures; ensure owner stamp matches current paired device
    if (capture.deviceId !== owner) {
      capture.deviceId = owner
      await putRecord(`capture:${capture.id}`, capture)
    }

    if (identity()?.deviceId !== owner) break

    try {
      const response = capture.jobId
        ? await fetch(`${getBase()}/jobs/${encodeURIComponent(capture.jobId)}`, { headers: getAuthHeaders(), signal: timeoutSignal(15000) })
        : await fetch(`${getBase()}/mobile/captures`, {
          method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: capture.id, title: capture.title, text: capture.text, url: capture.url, approved: true }),
          signal: timeoutSignal(15000),
        })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `Request failed (${response.status})`)
      capture.jobId = result.job_id || capture.jobId
      capture.state = result.state === 'queued' && capture.jobId ? 'accepted' : result.state
      capture.error = result.error || ''
      if (identity()?.deviceId !== owner) break
      await putRecord(`capture:${capture.id}`, capture)
    } catch (error) {
      if (identity()?.deviceId !== owner) break
      await putRecord(`capture:${capture.id}`, { ...capture, error: error.message })
      break // Offline or refused: retain the capture and stop flooding the host.
    }
  }
}
