import { getBase, getAuthHeaders } from '../api.js'
import { identity } from '../lib/sync/client.js'
import { putRecord, records } from './storage.js'

let flushing = null

export async function saveCapture({ title, text = '', url = '' }) {
  if (!title.trim() || (!text.trim() && !url.trim())) throw new Error('Add a title and text or a link.')
  if (title.length > 400 || text.length > 100000 || url.length > 8192) throw new Error('This capture is too large.')
  if (url && !['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Use an HTTP or HTTPS link.')
  const capture = { id: crypto.randomUUID(), title: title.trim(), text, url,
    deviceId: identity()?.deviceId, state: 'queued', createdAt: new Date().toISOString() }
  await putRecord(`capture:${capture.id}`, capture)
  return capture
}

export async function captures() {
  return (await records('capture:')).map(row => row.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function flushCaptures() {
  if (flushing) return flushing
  flushing = flush().finally(() => { flushing = null })
  return flushing
}

async function flush() {
  const owner = identity()?.deviceId
  for (const capture of await captures()) {
    if (!['queued', 'accepted', 'running', 'waiting', 'paused'].includes(capture.state)) continue
    if (identity()?.deviceId !== owner || capture.deviceId !== owner) break
    try {
      const response = capture.jobId
        ? await fetch(`${getBase()}/jobs/${encodeURIComponent(capture.jobId)}`, { headers: getAuthHeaders(), signal: AbortSignal.timeout(15000) })
        : await fetch(`${getBase()}/mobile/captures`, {
          method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: capture.id, title: capture.title, text: capture.text, url: capture.url, approved: true }),
          signal: AbortSignal.timeout(15000),
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
