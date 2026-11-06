/**
 * Dual-Transport Manager for Mobile Companion.
 *
 * Inspired by Happy (slopus/happy) Transport architecture:
 * Dynamically switches between Direct LAN (high-speed, 0 Cloudflare cost)
 * and Cloudflare Relay (encrypted sealed ops mailbox when away from LAN).
 */

export class TransportManager {
  constructor({ getHostUrl, getRelayUrl, getToken, onStateChange } = {}) {
    this.getHostUrl = getHostUrl || (() => '')
    this.getRelayUrl = getRelayUrl || (() => '')
    this.getToken = getToken || (() => '')
    this.onStateChange = onStateChange || (() => {})

    this._state = {
      path: 'offline',
      latency: -1,
      lastProbe: 0,
      hostUrl: '',
      relayUrl: '',
      error: null,
      openFlows: 0,
    }

    this._probeTimer = null
    this._probing = false
  }

  getState() {
    return { ...this._state }
  }

  forcePath(path) {
    this._state.hostUrl = (this.getHostUrl() || '').replace(/\/+$/, '')
    this._state.relayUrl = (this.getRelayUrl() || '').replace(/\/+$/, '')
    this._state.path = path
    this.onStateChange(this.getState())
  }

  /**
   * Probe LAN connection with a fast 1.5s timeout.
   * If LAN responds, path = 'direct'.
   * If LAN fails or unreachable, fallback to 'relayed' (Cloudflare Worker).
   * If neither is available or network is down, path = 'offline'.
   */
  async probe() {
    if (this._probing) return this._state.path
    this._probing = true

    const hostUrl = (this.getHostUrl() || '').replace(/\/+$/, '')
    const relayUrl = (this.getRelayUrl() || '').replace(/\/+$/, '')
    const token = this.getToken()

    this._state.hostUrl = hostUrl
    this._state.relayUrl = relayUrl

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

    // 2. Direct LAN probe failed or not configured; fallback to Cloudflare Relay
    if (relayUrl) {
      this._state.lastProbe = Date.now()
      this._state.path = 'relayed'
      this._state.latency = -1
      this._probing = false
      this.onStateChange(this.getState())
      return 'relayed'
    }

    // 3. No relay and no host reachable
    this._state.lastProbe = Date.now()
    this._state.path = 'offline'
    this._state.latency = -1
    this._probing = false
    this.onStateChange(this.getState())
    return 'offline'
  }

  /**
   * Dispatch request according to active transport.
   * Direct routes to ${hostUrl}/api${path}
   * Relayed routes to ${relayUrl}${path}
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
    } else if (state.relayUrl) {
      const sub = path.startsWith('/') ? path : `/${path}`
      targetUrl = `${state.relayUrl}${sub}`
    } else {
      throw new Error('No transport available')
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
      window.addEventListener('online', this._onOnline)
    }
  }

  stopAutoProbe() {
    if (this._probeTimer) {
      clearInterval(this._probeTimer)
      this._probeTimer = null
    }
    if (typeof window !== 'undefined' && this._onOnline) {
      window.removeEventListener('online', this._onOnline)
      this._onOnline = null
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
