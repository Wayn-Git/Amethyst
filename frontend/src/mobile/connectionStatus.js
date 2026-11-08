import { safeStorage } from '../lib/storage.js'
import { nativeVault, isNativeMobile } from '../lib/credentials.js'

export const CONNECTIONS_STORAGE_KEY = 'amethyst.connections.v1'
export const MS_CLIENT_ID = 'd3590ed6-52b3-4102-aeff-aad2292ab01c'
export const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
export const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const MS_DEFAULT_SCOPES = 'Tasks.ReadWrite offline_access User.Read'
export const MS_DEFAULT_REDIRECT_URI = 'http://localhost:8000/api/auth/microsoft/callback'

let memoryConnections = null
const subscribers = new Set()

function notifySubscribers(status) {
  for (const sub of subscribers) {
    try {
      sub(status)
    } catch {}
  }
}

export function subscribeConnectionStatus(listener) {
  subscribers.add(listener)
  listener(getConnectionStatus())
  return () => subscribers.delete(listener)
}

/**
 * Load raw connections object from secure vault or safeStorage fallback.
 */
export async function loadConnections() {
  if (memoryConnections) return memoryConnections

  try {
    const vault = await nativeVault()
    if (vault) {
      const stored = await vault.get(CONNECTIONS_STORAGE_KEY)
      if (stored) {
        memoryConnections = typeof stored === 'string' ? JSON.parse(stored) : stored
        return memoryConnections
      }
    }
  } catch {}

  try {
    const raw = safeStorage.getItem(CONNECTIONS_STORAGE_KEY)
    if (raw) {
      memoryConnections = JSON.parse(raw)
      return memoryConnections
    }
  } catch {}

  // Fall back to checking bundle if existing
  try {
    const { getBundle } = await import('./bundle.js')
    const b = await getBundle()
    if (b) {
      memoryConnections = {
        composio: b.composio ? { apiKey: b.composio.api_key, userId: b.composio.user_id } : null,
        googleDrive: b.drive ? { rootFolderId: b.drive.root_folder_id, inboxFolderId: b.drive.inbox_folder_id } : null,
        microsoftTodo: null,
      }
      return memoryConnections
    }
  } catch {}

  memoryConnections = {
    composio: null,
    googleDrive: null,
    microsoftTodo: null,
  }
  return memoryConnections
}

/**
 * Save connections data securely.
 */
export async function saveConnections(connections) {
  memoryConnections = { ...connections }
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.set(CONNECTIONS_STORAGE_KEY, memoryConnections)
    }
  } catch {}

  try {
    safeStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(memoryConnections))
  } catch {}

  notifySubscribers(getConnectionStatus())
}

/**
 * Evaluate single service connection status.
 * Returns 'connected' | 'expired' | 'missing'
 */
export function evaluateServiceStatus(service, data) {
  if (!data) return 'missing'

  if (service === 'composio') {
    if (!data.apiKey) return 'missing'
    if (data.expired) return 'expired'
    return 'connected'
  }

  if (service === 'googleDrive') {
    if (!data.accessToken && !data.refreshToken && !data.rootFolderId) return 'missing'
    if (data.expired) return 'expired'
    if (data.expiresAt && Date.now() >= data.expiresAt && !data.refreshToken) return 'expired'
    return 'connected'
  }

  if (service === 'microsoftTodo') {
    if (!data.accessToken && !data.refreshToken) return 'missing'
    if (data.expired) return 'expired'
    if (data.expiresAt && Date.now() >= data.expiresAt && !data.refreshToken) return 'expired'
    return 'connected'
  }

  return 'missing'
}

/**
 * Convert technical status code ('missing' | 'expired' | 'offline' | 'connected')
 * to display string ('not connected' | 'expired' | 'offline' | 'connected').
 */
export function formatConnectionLabel(status) {
  if (status === 'missing' || !status) return 'not connected'
  if (status === 'expired') return 'expired'
  if (status === 'offline') return 'offline'
  if (status === 'connected') return 'connected'
  return String(status)
}

/**
 * Synchronous read of current connections status object.
 * Returns: { googleDrive, composio, microsoftTodo }
 */
export function getConnectionStatus() {
  const c = memoryConnections || {}
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  const base = {
    googleDrive: evaluateServiceStatus('googleDrive', c.googleDrive),
    composio: evaluateServiceStatus('composio', c.composio),
    microsoftTodo: evaluateServiceStatus('microsoftTodo', c.microsoftTodo),
  }
  if (isOffline) {
    if (base.googleDrive === 'connected') base.googleDrive = 'offline'
    if (base.composio === 'connected') base.composio = 'offline'
    if (base.microsoftTodo === 'connected') base.microsoftTodo = 'offline'
  }
  return base
}

/**
 * Update a specific service credentials.
 */
export async function updateServiceConnection(service, data) {
  const current = await loadConnections()
  const next = {
    ...current,
    [service]: data ? { ...(current[service] || {}), ...data, expired: data.expired ?? false } : null,
  }
  await saveConnections(next)
  return getConnectionStatus()
}

/**
 * Mark a service token as expired (e.g. on 401).
 */
export async function markServiceExpired(service) {
  const current = await loadConnections()
  if (current[service]) {
    current[service].expired = true
    await saveConnections(current)
  }
}

/**
 * Disconnect a service.
 */
export async function disconnectService(service) {
  const current = await loadConnections()
  delete current[service]
  await saveConnections(current)
}

/* -------------------------------------------------------------------------- */
/* Microsoft OAuth 2.0 PKCE Helpers (No client secret, standard public client) */
/* -------------------------------------------------------------------------- */

function base64UrlEncode(bytes) {
  let binary = ''
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Generate PKCE code verifier and code challenge (S256).
 */
export async function generatePkce() {
  const randomBytes = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  } else {
    for (let i = 0; i < 32; i++) randomBytes[i] = (Math.random() * 256) | 0
  }
  const verifier = base64UrlEncode(randomBytes)

  let challenge = verifier
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(verifier)
      const digest = await crypto.subtle.digest('SHA-256', data)
      challenge = base64UrlEncode(digest)
    } catch {}
  }
  return { verifier, challenge }
}

/**
 * Verify and normalize a Microsoft OAuth redirect URI.
 */
export function verifyRedirectUri(uri) {
  if (!uri || typeof uri !== 'string' || !uri.trim()) {
    return MS_DEFAULT_REDIRECT_URI
  }
  const trimmed = uri.trim()
  let protocol = ''
  try {
    const parsed = new URL(trimmed)
    protocol = parsed.protocol
  } catch {
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
    if (match) {
      protocol = match[1] + ':'
    }
  }

  const allowedProtocols = ['http:', 'https:', 'app.amethyst.companion:']
  if (!protocol || !allowedProtocols.includes(protocol)) {
    throw new Error(`Unsupported redirect URI protocol: ${protocol || 'none'}`)
  }

  return trimmed
}

/**
 * Start Microsoft OAuth PKCE login URL.
 */
export async function createMicrosoftAuthUrl({ redirectUri, state }) {
  const verifiedRedirect = verifyRedirectUri(redirectUri)
  const { verifier, challenge } = await generatePkce()
  const st = state || `ms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Store verifier and redirect URI in safeStorage for code exchange
  safeStorage.setItem(`amethyst.ms_verifier.${st}`, verifier)
  safeStorage.setItem(`amethyst.ms_redirect_uri.${st}`, verifiedRedirect)

  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: verifiedRedirect,
    response_mode: 'query',
    scope: MS_DEFAULT_SCOPES,
    state: st,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  return {
    url: `${MS_AUTH_ENDPOINT}?${params.toString()}`,
    state: st,
    verifier,
    redirectUri: verifiedRedirect,
  }
}

/**
 * Exchange Microsoft OAuth auth code for tokens.
 */
export async function exchangeMicrosoftCode({ code, state, redirectUri, verifier: providedVerifier, httpPost }) {
  const verifier = providedVerifier || (state ? safeStorage.getItem(`amethyst.ms_verifier.${state}`) : null)
  const storedRedirect = state ? safeStorage.getItem(`amethyst.ms_redirect_uri.${state}`) : null
  const targetRedirectUri = verifyRedirectUri(redirectUri || storedRedirect || MS_DEFAULT_REDIRECT_URI)

  if (state) {
    safeStorage.removeItem(`amethyst.ms_verifier.${state}`)
    safeStorage.removeItem(`amethyst.ms_redirect_uri.${state}`)
  }

  const bodyParams = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    scope: MS_DEFAULT_SCOPES,
    code,
    redirect_uri: targetRedirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier || '',
  })

  const isDev =
    (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV)

  let data
  if (httpPost) {
    const res = await httpPost({
      url: MS_TOKEN_ENDPOINT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: bodyParams.toString(),
    })
    if (res.status >= 400) {
      if (isDev) {
        console.error('[connectionStatus] Microsoft code exchange error:', {
          status: res.status,
          body: res.data,
        })
      }
      const err = new Error(res.data?.error_description || `OAuth exchange failed (${res.status})`)
      err.status = res.status
      err.body = res.data
      throw err
    }
    data = res.data || res
  } else {
    const res = await fetch(MS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      if (isDev) {
        console.error('[connectionStatus] Microsoft code exchange error:', {
          status: res.status,
          body: errBody,
        })
      }
      const err = new Error(errBody.error_description || `OAuth exchange failed (${res.status})`)
      err.status = res.status
      err.body = errBody
      throw err
    }
    data = await res.json()
  }

  const expiresAt = Date.now() + ((data.expires_in || 3600) - 60) * 1000
  const tokenPayload = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    tokenType: data.token_type || 'Bearer',
    scopes: data.scope,
  }

  await updateServiceConnection('microsoftTodo', tokenPayload)
  return tokenPayload
}

/**
 * Refresh Microsoft OAuth access token using refresh_token.
 */
export async function refreshMicrosoftToken({ httpPost } = {}) {
  const current = await loadConnections()
  const ms = current?.microsoftTodo
  if (!ms?.refreshToken) {
    await markServiceExpired('microsoftTodo')
    const err = new Error('Token expired, reconnect')
    err.status = 401
    err.code = 'TOKEN_EXPIRED'
    throw err
  }

  const bodyParams = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    scope: MS_DEFAULT_SCOPES,
    refresh_token: ms.refreshToken,
    grant_type: 'refresh_token',
  })

  const isDev =
    (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV)

  try {
    let data
    if (httpPost) {
      const res = await httpPost({
        url: MS_TOKEN_ENDPOINT,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: bodyParams.toString(),
      })
      if (res.status >= 400) {
        if (isDev) {
          console.error('[connectionStatus] Microsoft token refresh failed:', {
            status: res.status,
            body: res.data,
          })
        }
        const err = new Error(res.data?.error_description || `Refresh failed (${res.status})`)
        err.status = res.status
        err.body = res.data
        err.code = 'TOKEN_EXPIRED'
        throw err
      }
      data = res.data || res
    } else {
      const res = await fetch(MS_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        if (isDev) {
          console.error('[connectionStatus] Microsoft token refresh failed:', {
            status: res.status,
            body: errBody,
          })
        }
        const err = new Error(errBody.error_description || `Refresh failed (${res.status})`)
        err.status = res.status
        err.body = errBody
        err.code = 'TOKEN_EXPIRED'
        throw err
      }
      data = await res.json()
    }

    const expiresAt = Date.now() + ((data.expires_in || 3600) - 60) * 1000
    const tokenPayload = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || ms.refreshToken,
      expiresAt,
      tokenType: data.token_type || 'Bearer',
    }

    await updateServiceConnection('microsoftTodo', tokenPayload)
    return tokenPayload
  } catch (err) {
    await markServiceExpired('microsoftTodo')
    throw err
  }
}

/**
 * Get valid Microsoft access token, refreshing automatically if close to expiration.
 */
export async function getMicrosoftAccessToken({ httpPost, forceRefresh = false } = {}) {
  const current = await loadConnections()
  const ms = current?.microsoftTodo
  if (!ms || (!ms.accessToken && !ms.refreshToken)) {
    const err = new Error('Not connected')
    err.code = 'NOT_CONNECTED'
    err.status = 401
    throw err
  }

  const isExpired = ms.expired || !ms.accessToken || (ms.expiresAt && Date.now() >= ms.expiresAt) || forceRefresh
  if (isExpired) {
    if (ms.refreshToken) {
      const refreshed = await refreshMicrosoftToken({ httpPost })
      return refreshed.accessToken
    }
    await markServiceExpired('microsoftTodo')
    const err = new Error('Token expired, reconnect')
    err.code = 'TOKEN_EXPIRED'
    err.status = 401
    throw err
  }

  return ms.accessToken
}

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/**
 * Refresh Google Drive access token using refresh_token.
 */
export async function refreshGoogleDriveToken({ httpPost } = {}) {
  const current = await loadConnections()
  const gd = current?.googleDrive
  if (!gd?.refreshToken) {
    await markServiceExpired('googleDrive')
    const err = new Error('Token expired, reconnect Google Drive')
    err.code = 'TOKEN_EXPIRED'
    err.status = 401
    throw err
  }

  const bodyParams = new URLSearchParams({
    client_id: gd.clientId || gd.client_id || '',
    refresh_token: gd.refreshToken,
    grant_type: 'refresh_token',
  })
  if (gd.clientSecret || gd.client_secret) {
    bodyParams.set('client_secret', gd.clientSecret || gd.client_secret)
  }

  try {
    let data
    if (httpPost) {
      const res = await httpPost({
        url: GOOGLE_TOKEN_ENDPOINT,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: bodyParams.toString(),
      })
      if (res.status >= 400) {
        throw new Error(res.data?.error_description || `Google Drive refresh failed (${res.status})`)
      }
      data = res.data || res
    } else {
      const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const err = new Error(errBody.error_description || `Google Drive refresh failed (${res.status})`)
        err.body = errBody
        err.code = 'TOKEN_EXPIRED'
        throw err
      }
      data = await res.json()
    }

    const expiresAt = Date.now() + ((data.expires_in || 3600) - 60) * 1000
    const tokenPayload = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || gd.refreshToken,
      expiresAt,
      tokenType: data.token_type || 'Bearer',
      expired: false,
    }

    await updateServiceConnection('googleDrive', tokenPayload)
    return tokenPayload
  } catch (err) {
    await markServiceExpired('googleDrive')
    throw err
  }
}

/**
 * Get valid Google Drive access token, refreshing if close to expiration.
 */
export async function getGoogleDriveAccessToken({ httpPost, forceRefresh = false } = {}) {
  const current = await loadConnections()
  const gd = current?.googleDrive
  if (!gd || (!gd.accessToken && !gd.refreshToken)) {
    const err = new Error('Not connected')
    err.code = 'NOT_CONNECTED'
    err.status = 401
    throw err
  }

  const isExpired = gd.expired || !gd.accessToken || (gd.expiresAt && Date.now() >= gd.expiresAt) || forceRefresh
  if (isExpired) {
    if (gd.refreshToken) {
      const refreshed = await refreshGoogleDriveToken({ httpPost })
      return refreshed.accessToken
    }
    await markServiceExpired('googleDrive')
    const err = new Error('Token expired, reconnect Google Drive')
    err.code = 'TOKEN_EXPIRED'
    err.status = 401
    throw err
  }

  return gd.accessToken
}
