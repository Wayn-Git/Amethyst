import { safeStorage } from '../lib/storage.js'
import { nativeVault, isNativeMobile } from '../lib/credentials.js'

export const CONNECTIONS_STORAGE_KEY = 'amethyst.connections.v1'
export const MS_CLIENT_ID = 'a7c42b18-1137-4d78-8d4c-91cd6be3acff'
export const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
export const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const MS_DEFAULT_SCOPES = 'Tasks.ReadWrite offline_access User.Read'
export const MS_DEFAULT_REDIRECT_URI = 'app.amethyst.companion://auth'

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
      const bMs = b.microsoft || b.microsoftTodo
      let msConn = null
      if (bMs && (bMs.refreshToken || bMs.refresh_token || bMs.accessToken || bMs.access_token)) {
        const rawExp = bMs.expiresAt || bMs.expires_at
        let expiresAt = Date.now() + 3600000
        if (typeof rawExp === 'number') {
          expiresAt = rawExp > 1e11 ? rawExp : rawExp * 1000
        }
        msConn = {
          accessToken: bMs.accessToken || bMs.access_token || '',
          refreshToken: bMs.refreshToken || bMs.refresh_token || '',
          accountId: bMs.accountId || bMs.account_id || '',
          email: bMs.email || bMs.account_email || '',
          scopes: bMs.scopes || bMs.scope || MS_DEFAULT_SCOPES,
          expiresAt,
          expired: false,
        }
      }
      memoryConnections = {
        composio: b.composio ? { apiKey: b.composio.api_key, userId: b.composio.user_id } : null,
        googleDrive: b.drive ? { rootFolderId: b.drive.root_folder_id, inboxFolderId: b.drive.inbox_folder_id } : null,
        microsoftTodo: msConn,
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
  let hasNativeVault = false
  try {
    const vault = await nativeVault()
    if (vault) {
      hasNativeVault = true
      await vault.set(CONNECTIONS_STORAGE_KEY, memoryConnections)
      safeStorage.removeItem(CONNECTIONS_STORAGE_KEY)
    }
  } catch {}

  if (!hasNativeVault) {
    try {
      safeStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(memoryConnections))
    } catch {}
  }

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
          error: res.data?.error || res.data?.error_description || 'OAuth exchange failed',
        })
      }
      const err = new Error(res.data?.error_description || `OAuth exchange failed (${res.status})`)
      err.status = res.status
      err.body = { error: res.data?.error, error_description: res.data?.error_description }
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
          error: errBody.error || errBody.error_description || 'OAuth exchange failed',
        })
      }
      const err = new Error(errBody.error_description || `OAuth exchange failed (${res.status})`)
      err.status = res.status
      err.body = { error: errBody.error, error_description: errBody.error_description }
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
            error: res.data?.error || res.data?.error_description || 'Refresh failed',
          })
        }
        const err = new Error(res.data?.error_description || `Refresh failed (${res.status})`)
        err.status = res.status
        err.body = { error: res.data?.error, error_description: res.data?.error_description }
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
            error: errBody.error || errBody.error_description || 'Refresh failed',
          })
        }
        const err = new Error(errBody.error_description || `Refresh failed (${res.status})`)
        err.status = res.status
        err.body = { error: errBody.error, error_description: errBody.error_description }
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
      scopes: data.scope || ms.scopes || MS_DEFAULT_SCOPES,
      expired: false,
    }

    await updateServiceConnection('microsoftTodo', tokenPayload)
    return tokenPayload
  } catch (err) {
    const isInvalidGrant =
      err.body?.error === 'invalid_grant' ||
      (err.message && err.message.toLowerCase().includes('invalid_grant'))

    if (isInvalidGrant) {
      // 1. Optional re-request to PC if reachable (never block, never loop)
      let pcBundle = null
      try {
        pcBundle = await requestFreshBundleFromPc({ timeoutMs: 1500 })
      } catch {
        pcBundle = null
      }

      if (pcBundle?.refreshToken && pcBundle.refreshToken !== ms.refreshToken) {
        await updateServiceConnection('microsoftTodo', pcBundle)
        return pcBundle
      }

      // 2. Primary recovery: direct device code fallback (works PC-off)
      await markServiceExpired('microsoftTodo')
      err.isInvalidGrant = true
      err.requiresDeviceCode = true
      throw err
    }

    await markServiceExpired('microsoftTodo')
    throw err
  }
}

/**
 * Retrieve PC host URL from local storage or identity if available.
 */
export function getPcHostUrl() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = safeStorage.getItem('amethyst.pc_host')
      if (stored) return stored
      const rawIdentity = safeStorage.getItem('amethyst.identity')
      if (rawIdentity) {
        const id = JSON.parse(rawIdentity)
        if (id?.hostUrl) return id.hostUrl
      }
    }
  } catch {}
  return ''
}

/**
 * Optional re-request for fresh Microsoft token bundle from PC if reachable.
 * Never blocks, never loops.
 */
export async function requestFreshBundleFromPc({ timeoutMs = 1500, httpGet } = {}) {
  const hostUrl = getPcHostUrl()
  if (!hostUrl) return null

  const cleanHost = hostUrl.replace(/\/+$/, '')
  const url = `${cleanHost}/api/auth/microsoft/bundle`

  try {
    if (httpGet) {
      const res = await httpGet({ url, timeout: timeoutMs })
      if (res?.status === 200 && res.data?.connected && res.data?.bundle?.refresh_token) {
        const b = res.data.bundle
        const rawExp = b.expires_at || b.expiresAt
        let expiresAt = Date.now() + 3600000
        if (typeof rawExp === 'number') {
          expiresAt = rawExp > 1e11 ? rawExp : rawExp * 1000
        }
        return {
          refreshToken: b.refresh_token,
          accessToken: b.access_token || '',
          accountId: b.account_id || '',
          email: b.email || '',
          scopes: b.scopes || MS_DEFAULT_SCOPES,
          expiresAt,
          expired: false,
        }
      }
      return null
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res || !res.ok) return null
    const data = await res.json().catch(() => null)
    if (data?.connected && data?.bundle?.refresh_token) {
      const b = data.bundle
      const rawExp = b.expires_at || b.expiresAt
      let expiresAt = Date.now() + 3600000
      if (typeof rawExp === 'number') {
        expiresAt = rawExp > 1e11 ? rawExp : rawExp * 1000
      }
      return {
        refreshToken: b.refresh_token,
        accessToken: b.access_token || '',
        accountId: b.account_id || '',
        email: b.email || '',
        scopes: b.scopes || MS_DEFAULT_SCOPES,
        expiresAt,
        expired: false,
      }
    }
    return null
  } catch {
    // Unreachable, offline, or timed out - skip without blocking or looping
    return null
  }
}

export const MS_DEVICE_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode'

/**
 * Start direct Microsoft device code authorization flow on phone (primary recovery, works PC-off).
 */
export async function startPhoneDeviceCodeFlow({ httpPost } = {}) {
  const bodyParams = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    scope: MS_DEFAULT_SCOPES,
  })

  let data
  if (httpPost) {
    const res = await httpPost({
      url: MS_DEVICE_ENDPOINT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: bodyParams.toString(),
    })
    if (res.status >= 400) {
      throw new Error(res.data?.error_description || `Device auth request failed (${res.status})`)
    }
    data = res.data || res
  } else {
    const res = await fetch(MS_DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      throw new Error(errBody.error_description || `Device auth request failed (${res.status})`)
    }
    data = await res.json()
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || 'https://microsoft.com/devicelogin',
    expiresIn: data.expires_in || 900,
    interval: data.interval || 5,
    message: data.message || '',
  }
}

/**
 * Poll Microsoft token endpoint for device code authorization on phone (works PC-off).
 */
export async function pollPhoneDeviceCodeFlow({ deviceCode, httpPost } = {}) {
  if (!deviceCode) throw new Error('deviceCode is required')

  const bodyParams = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
  })

  let status = 200
  let payload = null

  if (httpPost) {
    const res = await httpPost({
      url: MS_TOKEN_ENDPOINT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: bodyParams.toString(),
    })
    status = res.status
    payload = res.data || res
  } else {
    const res = await fetch(MS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    })
    status = res.status
    payload = await res.json().catch(() => ({}))
  }

  if (status === 200 && payload?.access_token) {
    const expiresAt = Date.now() + ((payload.expires_in || 3600) - 60) * 1000
    const tokenPayload = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt,
      tokenType: payload.token_type || 'Bearer',
      scopes: payload.scope || MS_DEFAULT_SCOPES,
      expired: false,
    }
    await updateServiceConnection('microsoftTodo', tokenPayload)
    return { connected: true, status: 'completed', tokens: tokenPayload }
  }

  const err = payload?.error || ''
  if (err === 'authorization_pending' || err === 'slow_down') {
    return { connected: false, status: 'pending' }
  }
  if (err === 'expired_token' || err === 'code_expired') {
    return { connected: false, status: 'expired', error: 'Code expired. Please request a new code.' }
  }
  return { connected: false, status: 'failed', error: payload?.error_description || `Login failed: ${err}` }
}

/**
 * Disconnect Microsoft To Do, clearing bundle on both devices (best-effort on PC if offline).
 */
export async function disconnectMicrosoftTodo({ timeoutMs = 1500, httpPost } = {}) {
  await disconnectService('microsoftTodo')
  try {
    const { getBundle, saveBundle } = await import('./bundle.js')
    const b = await getBundle()
    if (b && b.microsoft) {
      delete b.microsoft
      await saveBundle(b)
    }
  } catch {}

  const hostUrl = getPcHostUrl()
  if (hostUrl) {
    const cleanHost = hostUrl.replace(/\/+$/, '')
    const url = `${cleanHost}/api/auth/microsoft/disconnect`
    try {
      if (httpPost) {
        await httpPost({ url, timeout: timeoutMs }).catch(() => {})
      } else {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
          }).catch(() => {})
        } finally {
          clearTimeout(timer)
        }
      }
    } catch {
      // Best-effort: ignore if PC is offline/unreachable
    }
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
