/**
 * OpenCode API Client for Amethyst.
 * Proxies all requests through Amethyst backend at `/api/opencode/*`.
 */

import { getApiOrigin, API_ORIGIN, getAuthHeaders } from '../api.js'

function getBase() {
  const origin = getApiOrigin() || API_ORIGIN || ''
  return origin ? `${origin}/api/opencode` : '/api/opencode'
}

async function request(method, path, body = undefined, options = {}) {
  const url = `${getBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers = {
    ...getAuthHeaders(),
    ...options.headers,
  }
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url, {
    method,
    headers,
    body:
      body !== undefined
        ? typeof body === 'string' || body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
    ...options,
  })

  if (!res.ok) {
    let err
    try {
      err = await res.json()
    } catch {
      err = { error: res.statusText || `Request failed with status ${res.status}` }
    }
    const msg = err.error || err.message || `Request failed with status ${res.status}`
    const error = new Error(msg)
    error.status = res.status
    error.details = err
    throw error
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return res.json()
  }
  return res.text()
}

/**
 * EventSource subscription for OpenCode real-time events.
 * Returns an unbind / cleanup function.
 */
function subscribeEvents(onEvent, onError) {
  const base = getBase()
  const url = `${base}/event`
  const es = new EventSource(url)

  es.onmessage = (e) => {
    if (!e.data) return
    try {
      const parsed = JSON.parse(e.data)
      onEvent?.(parsed)
    } catch (err) {
      console.warn('[opencode] SSE parse error', err, e.data)
    }
  }

  es.onerror = (err) => {
    onError?.(err)
  }

  return () => {
    es.close()
  }
}

export const opencode = {
  // Subprocess management
  status: () => request('GET', '/status'),
  start: () => request('POST', '/start'),
  stop: () => request('POST', '/stop'),

  // OpenCode Core APIs
  health: () => request('GET', '/health'),
  listAgents: async () => {
    const res = await request('GET', '/agent')
    return Array.isArray(res) ? res : res?.data || []
  },
  listModels: async () => {
    const res = await request('GET', '/model')
    return Array.isArray(res) ? res : res?.data || []
  },
  listProviders: async () => {
    const res = await request('GET', '/provider')
    return Array.isArray(res) ? res : res?.data || []
  },

  // Sessions
  listSessions: async (opts = {}) => {
    const query = new URLSearchParams()
    if (opts.cursor) query.set('cursor', opts.cursor)
    if (opts.limit) query.set('limit', String(opts.limit))
    const qStr = query.toString() ? `?${query.toString()}` : ''
    const res = await request('GET', `/session${qStr}`)
    return Array.isArray(res) ? res : res?.data || []
  },
  createSession: async (body = {}) => {
    const res = await request('POST', '/session', body)
    return res?.data || res
  },
  getSession: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}`)
    return res?.data || res
  },
  deleteSession: (sessionID) => request('DELETE', `/session/${sessionID}`),

  switchAgent: (sessionID, agent) =>
    request('POST', `/session/${sessionID}/agent`, { agent }),
  switchModel: (sessionID, model) =>
    request('POST', `/session/${sessionID}/model`, typeof model === 'string' ? { model } : model),

  // Prompts & Interactions
  prompt: (sessionID, body) => {
    // Normalise body if user passes a plain string
    const payload =
      typeof body === 'string'
        ? { prompt: { text: body } }
        : body?.prompt
        ? body
        : { prompt: { text: body?.text || '' } }
    return request('POST', `/session/${sessionID}/prompt`, payload)
  },
  interrupt: (sessionID) => request('POST', `/session/${sessionID}/interrupt`),
  getHistory: async (sessionID, opts = {}) => {
    const query = new URLSearchParams()
    if (opts.cursor) query.set('cursor', opts.cursor)
    if (opts.limit) query.set('limit', String(opts.limit))
    const qStr = query.toString() ? `?${query.toString()}` : ''
    const res = await request('GET', `/session/${sessionID}/history${qStr}`)
    return Array.isArray(res) ? res : res?.data || []
  },
  getContext: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}/context`)
    return res?.data || res
  },

  // Permissions
  listPermissions: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}/permission`)
    return Array.isArray(res) ? res : res?.data || []
  },
  replyPermission: (sessionID, requestID, body) => {
    let reply = typeof body === 'string' ? body : body?.reply
    if (reply === 'allow') reply = 'once'
    if (reply === 'deny') reply = 'reject'
    const payload = {
      reply: reply || 'once',
      message: body?.message || '',
    }
    return request('POST', `/session/${sessionID}/permission/${requestID}/reply`, payload)
  },

  // Commands & Skills
  listCommands: async () => {
    const res = await request('GET', '/command')
    return Array.isArray(res) ? res : res?.data || []
  },
  listSkills: async () => {
    const res = await request('GET', '/skill')
    return Array.isArray(res) ? res : res?.data || []
  },

  // Events
  subscribeEvents,
}

export default opencode
