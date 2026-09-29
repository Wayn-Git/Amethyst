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
    const msg = err.error || err.data?.message || err.message || `Request failed with status ${res.status}`
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
    try {
      const res = await request('GET', '/provider')
      const providers = res?.all || []
      const connected = new Set(res?.connected || [])
      const models = []
      for (const p of providers) {
        const pModels = p.models || {}
        const isConn = connected.has(p.id)
        for (const [mId, mObj] of Object.entries(pModels)) {
          models.push({
            id: mId,
            name: mObj.name || mId,
            providerID: p.id,
            providerName: p.name || p.id,
            connected: isConn,
            status: mObj.status,
          })
        }
      }
      return models
    } catch (e) {
      console.warn('[opencode] Failed to fetch providers/models:', e)
      return []
    }
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
    let modelObj = body.model
    if (typeof modelObj === 'string') {
      if (modelObj.includes('/')) {
        const [providerID, ...rest] = modelObj.split('/')
        modelObj = { providerID, modelID: rest.join('/') }
      } else {
        modelObj = { providerID: 'opencode', modelID: modelObj }
      }
    } else if (modelObj && modelObj.id && !modelObj.modelID) {
      modelObj = { providerID: modelObj.providerID || 'opencode', modelID: modelObj.id }
    }
    const payload = {
      agent: body.agent || 'build',
      ...(modelObj ? { model: modelObj } : {}),
      ...(body.title ? { title: body.title } : {}),
    }
    const res = await request('POST', '/session', payload)
    return res?.data || res
  },
  getSession: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}`)
    return res?.data || res
  },
  deleteSession: (sessionID) => request('DELETE', `/session/${sessionID}`),

  // Prompts & Interactions
  prompt: (sessionID, body, opts = {}) => {
    const text = typeof body === 'string' ? body : body?.text || body?.prompt?.text || ''
    let modelObj = opts.model
    if (typeof modelObj === 'string') {
      if (modelObj.includes('/')) {
        const [providerID, ...rest] = modelObj.split('/')
        modelObj = { providerID, modelID: rest.join('/') }
      } else {
        modelObj = { providerID: 'opencode', modelID: modelObj }
      }
    } else if (modelObj && modelObj.id && !modelObj.modelID) {
      modelObj = { providerID: modelObj.providerID || 'opencode', modelID: modelObj.id }
    }
    const payload = {
      parts: [{ type: 'text', text }],
      ...(modelObj ? { model: modelObj } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
    }
    return request('POST', `/session/${sessionID}/prompt_async`, payload)
  },
  interrupt: (sessionID) => request('POST', `/session/${sessionID}/abort`),
  getMessages: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}/message`)
    return Array.isArray(res) ? res : res?.data || []
  },
  getDiff: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}/diff`)
    return Array.isArray(res) ? res : res?.data || []
  },
  getTodo: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}/todo`)
    return Array.isArray(res) ? res : res?.data || []
  },

  // Permissions
  listPermissions: async () => {
    const res = await request('GET', '/permission')
    return Array.isArray(res) ? res : res?.data || []
  },
  replyPermission: (requestID, body) => {
    let reply = typeof body === 'string' ? body : body?.reply || body?.response
    if (reply === 'allow') reply = 'once'
    if (reply === 'deny') reply = 'reject'
    const payload = {
      reply: reply || 'once',
      message: body?.message || '',
    }
    return request('POST', `/permission/${requestID}/reply`, payload)
  },

  // Events
  subscribeEvents,
}

export default opencode
