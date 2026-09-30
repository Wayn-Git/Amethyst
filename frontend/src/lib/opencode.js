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
  syncAmethyst: () => request('POST', '/sync_amethyst'),

  // OpenCode Core APIs
  health: () => request('GET', '/health'),
  listAgents: async () => {
    const res = await request('GET', '/agent')
    const list = Array.isArray(res) ? res : res?.data || []
    return list.map((a) => ({
      ...a,
      id: a.name || a.id,
      name: a.name || a.id,
    }))
  },
  listModels: async () => {
    try {
      const res = await request('GET', '/provider')
      const providers = res?.all || []
      const connected = new Set(res?.connected || [])
      const amethystProviderIDs = new Set([
        'opencode',
        'opencode-zen',
        'mistral',
        'groq',
        'nvidia',
        'google',
        'kilocode',
        'kilo',
      ])

      const models = []
      for (const p of providers) {
        const isConn = connected.has(p.id)
        // If provider is not connected and not opencode, skip to avoid dumping thousands of unconfigured models
        if (!isConn && p.id !== 'opencode') continue

        const pModels = p.models || {}
        const modelEntries = Object.entries(pModels)

        // For massive proxy gateways like kilo with thousands of models, only include curated / default / free models
        const isMassiveGateway = modelEntries.length > 80 && p.id === 'kilo'

        for (const [mId, mObj] of modelEntries) {
          const lowerId = mId.toLowerCase()
          const isFree =
            lowerId.includes('free') ||
            (p.id === 'opencode' && (!mObj.cost || mObj.cost.input === 0))

          if (isMassiveGateway) {
            // Only keep Amethyst default kilo models or top free models
            const isCurated =
              mId === 'stepfun/step-3.7-flash:free' ||
              lowerId.includes('gemini-3') ||
              lowerId.includes('qwen') ||
              lowerId.includes('deepseek')
            if (!isCurated && !isFree) continue
          }

          const isReasoning =
            lowerId.includes('r1') ||
            lowerId.includes('reason') ||
            lowerId.includes('think') ||
            Boolean(mObj.capabilities?.reasoning)
          const isVision = Boolean(
            mObj.capabilities?.vision ||
              lowerId.includes('vision') ||
              lowerId.includes('4v') ||
              lowerId.includes('omni')
          )
          const isAmethyst = amethystProviderIDs.has(p.id)

          models.push({
            id: mId,
            name: mObj.name || mId,
            providerID: p.id,
            providerName: p.name || p.id,
            connected: isConn,
            status: mObj.status,
            isFree,
            isReasoning,
            isVision,
            isAmethyst,
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
    return res || { all: [], connected: [], default: {} }
  },
  syncAmethyst: () => request('POST', '/sync_amethyst'),
  getConfig: () => request('GET', '/config'),
  updateConfig: (body) => request('PATCH', '/config', body),
  setAuth: (providerID, key) =>
    request('PUT', `/auth/${providerID}`, { type: 'api', key }),
  removeAuth: (providerID) => request('DELETE', `/auth/${providerID}`),

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
    let modelPayload = undefined
    if (body.model) {
      if (typeof body.model === 'string') {
        if (body.model.includes('/')) {
          const [pId, ...rest] = body.model.split('/')
          modelPayload = { providerID: pId, id: rest.join('/') }
        } else {
          modelPayload = { providerID: 'opencode', id: body.model }
        }
      } else if (typeof body.model === 'object') {
        const mId = body.model.id || body.model.modelID
        const pId = body.model.providerID || 'opencode'
        if (mId) {
          modelPayload = { providerID: pId, id: mId }
        }
      }
    }
    const payload = {
      agent: body.agent || 'build',
      ...(modelPayload ? { model: modelPayload } : {}),
      ...(body.title ? { title: body.title } : {}),
    }
    const res = await request('POST', '/session', payload)
    return res?.data || res
  },
  getSession: async (sessionID) => {
    const res = await request('GET', `/session/${sessionID}`)
    return res?.data || res
  },
  updateSession: (sessionID, body) => request('PATCH', `/session/${sessionID}`, body),
  deleteSession: (sessionID) => request('DELETE', `/session/${sessionID}`),

  // Prompts & Interactions
  prompt: (sessionID, body, opts = {}) => {
    const text = typeof body === 'string' ? body : body?.text || body?.prompt?.text || ''
    let modelPayload = undefined
    const rawModel = opts.model
    if (rawModel) {
      if (typeof rawModel === 'string') {
        if (rawModel.includes('/')) {
          const [pId, ...rest] = rawModel.split('/')
          modelPayload = { providerID: pId, modelID: rest.join('/') }
        } else {
          modelPayload = { providerID: 'opencode', modelID: rawModel }
        }
      } else if (typeof rawModel === 'object') {
        const mId = rawModel.modelID || rawModel.id
        const pId = rawModel.providerID || 'opencode'
        if (mId) {
          modelPayload = { providerID: pId, modelID: mId }
        }
      }
    }
    const payload = {
      parts: [{ type: 'text', text }],
      ...(modelPayload ? { model: modelPayload } : {}),
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
