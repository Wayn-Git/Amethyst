/**
 * Transport Manager for Mobile Companion.
 *
 * Manages direct LAN connection to PC backend.
 */

export class TransportManager {
  constructor({ getHostUrl, getToken, onStateChange, isOnline } = {}) {
    this.getHostUrl = getHostUrl || (() => '')
    this.getToken = getToken || (() => '')
    this.onStateChange = onStateChange || (() => {})
    this.isOnline = isOnline || (() => (typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true))

    this._state = {
      path: 'offline', // 'direct' | 'standalone' | 'offline'
      latency: -1,
      lastProbe: 0,
      hostUrl: '',
      error: null,
      openFlows: 0,
    }

    this._probeTimer = null
    this._probing = false
    this._onOnline = null
    this._onOffline = null
  }

  getState() {
    return { ...this._state }
  }

  forcePath(path) {
    this._state.hostUrl = (this.getHostUrl() || '').replace(/\/+$/, '')
    this._state.path = path
    this.onStateChange(this.getState())
  }

  /**
   * Probe LAN connection with a fast 1.5s timeout.
   * If LAN responds, path = 'direct'.
   * Otherwise path = 'offline'.
   */
  async probe() {
    if (this._probing) return this._state.path
    this._probing = true

    const hostUrl = (this.getHostUrl() || '').replace(/\/+$/, '')
    const token = this.getToken()

    this._state.hostUrl = hostUrl

    // 1. Try Direct LAN if hostUrl is configured
    if (hostUrl) {
      const start = Date.now()
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 1500)

        const headers = {
          'Content-Type': 'application/json',
        }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
          headers['X-Amethyst-Device-Token'] = token
        }

        const res = await fetch(`${hostUrl}/api/remote/status`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (res.ok) {
          this._state.latency = Date.now() - start
          this._state.lastProbe = Date.now()
          this._state.path = 'direct'
          this._state.error = null
          this._probing = false
          this.onStateChange(this.getState())
          return 'direct'
        }
      } catch (err) {
        this._state.error = err.message
      }
    }

    // 2. Direct LAN probe failed or not configured.
    // Check if network is online (Cloud Standalone) or completely offline.
    const online = this.isOnline()
    const nextPath = online ? 'standalone' : 'offline'

    this._state.lastProbe = Date.now()
    this._state.path = nextPath
    this._state.latency = -1
    this._probing = false
    this.onStateChange(this.getState())
    return nextPath
  }

  /**
   * Dispatch request according to active transport.
   * Direct routes to ${hostUrl}/api${path}
   */
  async request(path, options = {}) {
    const state = this.getState()
    const token = this.getToken()
    const headers = { ...(options.headers || {}) }

    if (token) {
      if (!headers['Authorization']) headers['Authorization'] = `Bearer ${token}`
      if (!headers['X-Amethyst-Device-Token']) headers['X-Amethyst-Device-Token'] = token
    }

    let targetUrl = ''
    if (state.path === 'direct' && state.hostUrl) {
      const cleanPath = path.startsWith('/api') ? path.slice(4) : path
      const sub = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`
      targetUrl = `${state.hostUrl}/api${sub}`
    } else {
      throw new Error(state.path === 'standalone' ? 'PC host not reachable on LAN' : 'No transport available')
    }

    return fetch(targetUrl, {
      ...options,
      headers,
    })
  }

  startAutoProbe(intervalMs = 20000) {
    if (this._probeTimer) clearInterval(this._probeTimer)

    // Initial probe
    this.probe().catch(() => {})

    this._probeTimer = setInterval(() => {
      // Don't probe if screen is off/hidden
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      this.probe().catch(() => {})
    }, intervalMs)

    if (typeof window !== 'undefined') {
      this._onOnline = () => this.probe().catch(() => {})
      this._onOffline = () => {
        this._state.path = 'offline'
        this.onStateChange(this.getState())
      }
      window.addEventListener('online', this._onOnline)
      window.addEventListener('offline', this._onOffline)
    }
  }

  stopAutoProbe() {
    if (this._probeTimer) {
      clearInterval(this._probeTimer)
      this._probeTimer = null
    }
    if (typeof window !== 'undefined') {
      if (this._onOnline) {
        window.removeEventListener('online', this._onOnline)
        this._onOnline = null
      }
      if (this._onOffline) {
        window.removeEventListener('offline', this._onOffline)
        this._onOffline = null
      }
    }
  }
}

let defaultManager = null

export function getTransportManager(opts) {
  if (!defaultManager) {
    defaultManager = new TransportManager(opts)
  }
  return defaultManager
}
