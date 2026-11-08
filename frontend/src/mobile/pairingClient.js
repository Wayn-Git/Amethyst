import { Capacitor, registerPlugin } from '@capacitor/core'
import { saveBundle } from './bundle.js'
import { saveIdentity } from '../lib/credentials.js'

// Native plugin bridge
export const Pairing = registerPlugin('Pairing')

/**
 * Decode and validate CONTRACT v2 QR payload.
 *
 * QR content: JSON, base64url:
 * {"v":2, "hosts":["192.168.1.5", ...], "port":<int>, "token":"<128-bit random>",
 *  "fp":"<SHA-256 of the PC's TLS cert>", "exp":<unix ts, 2 min>}
 */
export function decodeAndValidateQr(raw) {
  if (!raw || typeof raw !== 'string') {
    const err = new Error('Invalid QR code format. Please scan the pairing code shown on your PC.')
    err.code = 'BAD_SCAN'
    throw err
  }

  let text = raw.trim()
  let parsed = null

  // Try direct JSON
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // not direct JSON
    }
  }

  // Try base64url decode
  if (!parsed) {
    try {
      let b64 = text.replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4 !== 0) {
        b64 += '='
      }
      const decodedStr = typeof atob === 'function'
        ? atob(b64)
        : (typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : null)

      if (decodedStr) {
        parsed = JSON.parse(decodedStr)
      }
    } catch {
      const err = new Error('Invalid QR code format. Please scan the pairing code shown on your PC.')
      err.code = 'BAD_SCAN'
      throw err
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('Invalid QR code format. Please scan the pairing code shown on your PC.')
    err.code = 'BAD_SCAN'
    throw err
  }

  // 1. Version check
  if (parsed.v !== 2) {
    const err = new Error(`Wrong QR version (expected v2, got ${parsed.v ?? 'unknown'}). Please update Amethyst on your PC.`)
    err.code = 'WRONG_VERSION'
    throw err
  }

  // 2. Expiry check
  const nowSec = Math.floor(Date.now() / 1000)
  if (typeof parsed.exp !== 'number' || parsed.exp <= nowSec) {
    const err = new Error('This QR code has expired. Please generate a fresh code on your PC.')
    err.code = 'EXPIRED_QR'
    throw err
  }

  // 3. Structure check
  const validHosts = Array.isArray(parsed.hosts) && parsed.hosts.length > 0 && parsed.hosts.every(h => typeof h === 'string' && h.trim().length > 0)
  const validPort = typeof parsed.port === 'number' && parsed.port > 0 && parsed.port <= 65535
  const validToken = typeof parsed.token === 'string' && parsed.token.trim().length > 0
  const normalizedFp = typeof parsed.fp === 'string' ? parsed.fp.replace(/[:\s]/g, '').toLowerCase() : ''
  const validFp = /^[0-9a-f]{64}$/.test(normalizedFp)

  if (!validHosts || !validPort || !validToken || !validFp) {
    const err = new Error('Invalid QR code format. Please scan the pairing code shown on your PC.')
    err.code = 'BAD_SCAN'
    throw err
  }

  return {
    v: 2,
    hosts: parsed.hosts.map(h => h.trim()),
    port: parsed.port,
    token: parsed.token.trim(),
    fp: normalizedFp,
    exp: parsed.exp,
  }
}

/**
 * Get human-readable device label without logging sensitive details.
 */
export function getDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Mobile Phone'
  const ua = navigator.userAgent || ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android Phone'
  return 'Mobile Phone'
}

/**
 * Send explicit receipt acknowledgement to PC after vault write.
 */
async function sendPairingAck({ host, port, apiPort, token, deviceId }) {
  const payload = JSON.stringify({ token, device_id: deviceId })
  if (host && port) {
    try {
      await fetch(`https://${host}:${port}/pair/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {})
    } catch (_) {}
  }
  if (host && apiPort) {
    try {
      await fetch(`http://${host}:${apiPort}/api/pairing/v2/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {})
    } catch (_) {}
  }
}

/**
 * Execute scan-and-pair under CONTRACT v2.
 *
 * 1. POST https://<host>:<port>/pair body {"token","device_label"}
 * 2. Tries each host in "hosts" with ~3s timeout.
 * 3. Shows "Waiting for approval on your PC..." when host connects.
 * 4. Pinned TLS only (never unpinned).
 * 5. Returns and saves bundle on approval.
 */
export async function pairDevice({ qrPayload, deviceLabel, onStatusChange }) {
  const label = deviceLabel || getDeviceLabel()
  const { hosts, port, token, fp } = qrPayload

  onStatusChange?.('connecting')

  // Native mobile path (Android custom TrustManager / iOS URLSessionDelegate)
  if (Capacitor.isNativePlatform()) {
    let statusListener = null
    try {
      statusListener = await Pairing.addListener?.('pairingState', (data) => {
        if (data?.state === 'waiting_approval') {
          onStatusChange?.('waiting_approval')
        }
      })
    } catch {
      // Listener setup failed, proceed with direct call
    }

    try {
      const result = await Pairing.pair({
        hosts,
        port,
        fp,
        token,
        deviceLabel: label,
        connectTimeoutMs: 8000,
        readTimeoutMs: 120000,
      })

      if (statusListener) {
        await statusListener.remove?.().catch(() => {})
      }

      if (!result?.bundle) {
        throw new Error('Pairing server did not return a valid bundle')
      }

      await saveBundle(result.bundle)

      const matchedHost = result?.host || (hosts && hosts[0]) || ''
      const apiPort = result.bundle?.api_port || 8000
      const hostUrl = matchedHost ? `http://${matchedHost}:${apiPort}` : ''
      try {
        await saveIdentity({
          deviceId: result.bundle.device_id,
          token,
          hostUrl,
          name: label,
          permissions: { library: true, agent: true, terminal: true, pc: true },
        })
      } catch (e) {
        console.warn('[PairingClient] Could not save identity:', e)
      }

      if (result.bundle?.microsoft) {
        await sendPairingAck({
          host: matchedHost,
          port,
          apiPort,
          token,
          deviceId: result.bundle.device_id,
        })
      }

      return result.bundle
    } catch (err) {
      if (statusListener) {
        await statusListener.remove?.().catch(() => {})
      }

      const rawMsg = err?.message || ''
      const rawCode = err?.code || err?.data?.code || ''
      const errData = err?.data || {}
      const attempts = errData.attempts || []
      const triedPort = errData.port || port
      const triedSummary = errData.triedSummary || (
        attempts.length > 0
          ? attempts.map(a => `${a.host}:${a.port || triedPort} (${a.message || a.errorType})`).join(', ')
          : hosts.map(h => `${h}:${triedPort}`).join(', ')
      )

      let code = rawCode
      let msg = rawMsg

      if (rawCode === 'DENIED' || rawMsg.includes('DENIED') || rawMsg.includes('denied')) {
        code = 'DENIED'
        msg = 'Pairing was denied on your PC.'
      } else if (rawCode === 'APPROVAL_TIMEOUT' || rawMsg.includes('APPROVAL_TIMEOUT') || rawMsg.includes('Approval timed out')) {
        code = 'APPROVAL_TIMEOUT'
        msg = 'Approval timed out on your PC. Please try again.'
      } else if (rawCode === 'TOO_MANY_ATTEMPTS' || rawMsg.includes('TOO_MANY_ATTEMPTS') || rawMsg.includes('429')) {
        code = 'TOO_MANY_ATTEMPTS'
        msg = 'Too many failed pairing attempts. Pairing locked out.'
      } else if (rawCode === 'INVALID_TOKEN' || rawMsg.includes('INVALID_TOKEN') || rawMsg.includes('expired') || rawMsg.includes('401')) {
        code = 'INVALID_TOKEN'
        msg = 'Pairing token was rejected or expired.'
      } else if (rawCode === 'CERT_MISMATCH' || rawMsg.includes('CERT_MISMATCH') || rawMsg.includes('fingerprint mismatch')) {
        code = 'CERT_MISMATCH'
        msg = 'Security error: Server certificate does not match the pairing QR code.'
      } else if (rawCode === 'CONNECTION_REFUSED' || rawMsg.includes('Connection refused')) {
        code = 'CONNECTION_REFUSED'
        msg = `Connection refused on port ${triedPort}. Check PC pairing window and firewall.`
      } else if (rawCode === 'CONNECT_TIMEOUT' || (rawCode === 'NO_HOST_RESPONDED' && rawMsg.includes('timed out'))) {
        code = 'CONNECT_TIMEOUT'
        msg = `Connection timed out on port ${triedPort}. Phone and PC must be on the same Wi-Fi.`
      } else if (rawCode === 'NO_HOST_RESPONDED') {
        code = 'NO_HOST_RESPONDED'
        msg = 'Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.'
      } else if (!code) {
        code = 'UNKNOWN'
      }

      const error = new Error(msg)
      error.code = code
      error.port = triedPort
      error.attempts = attempts
      error.triedSummary = triedSummary
      throw error
    }
  }

  // Non-native / Web / Test environment simulation
  let connected = false
  const attempts = []
  for (const host of hosts) {
    const url = `https://${host}:${port}/pair`
    const controller = new AbortController()
    const connectTimer = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, device_label: label }),
        signal: controller.signal,
      })
      clearTimeout(connectTimer)
      connected = true
      onStatusChange?.('waiting_approval')

      if (response.status === 200) {
        const bundle = await response.json()
        await saveBundle(bundle)

        const apiPort = bundle?.api_port || 8000
        const hostUrl = host ? `http://${host}:${apiPort}` : ''
        try {
          await saveIdentity({
            deviceId: bundle.device_id,
            token,
            hostUrl,
            name: label,
            permissions: { library: true, agent: true, terminal: true, pc: true },
          })
        } catch (e) {
          console.warn('[PairingClient] Could not save identity:', e)
        }

        if (bundle?.microsoft) {
          await sendPairingAck({
            host,
            port,
            apiPort,
            token,
            deviceId: bundle.device_id,
          })
        }

        return bundle
      }

      if (response.status === 403) {
        console.warn(`[PairingClient] Host ${host}:${port} failed: DENIED`)
        const err = new Error('Pairing was denied on your PC.')
        err.code = 'DENIED'
        err.port = port
        err.attempts = [...attempts, { host, port, errorType: 'DENIED', message: 'Pairing denied' }]
        err.triedSummary = `${host}:${port} (Pairing denied)`
        throw err
      }

      if (response.status === 408) {
        console.warn(`[PairingClient] Host ${host}:${port} failed: APPROVAL_TIMEOUT`)
        const err = new Error('Approval timed out on your PC. Please try again.')
        err.code = 'APPROVAL_TIMEOUT'
        err.port = port
        err.attempts = [...attempts, { host, port, errorType: 'APPROVAL_TIMEOUT', message: 'Approval timed out' }]
        err.triedSummary = `${host}:${port} (Approval timed out)`
        throw err
      }

      if (response.status === 429) {
        console.warn(`[PairingClient] Host ${host}:${port} failed: TOO_MANY_ATTEMPTS`)
        const err = new Error('Too many failed pairing attempts. Pairing locked out.')
        err.code = 'TOO_MANY_ATTEMPTS'
        err.port = port
        err.attempts = [...attempts, { host, port, errorType: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' }]
        err.triedSummary = `${host}:${port} (Too many attempts)`
        throw err
      }

      if (response.status === 400 || response.status === 401) {
        console.warn(`[PairingClient] Host ${host}:${port} failed: INVALID_TOKEN`)
        const err = new Error('Pairing token was rejected or already used.')
        err.code = 'INVALID_TOKEN'
        err.port = port
        err.attempts = [...attempts, { host, port, errorType: 'INVALID_TOKEN', message: 'Invalid token' }]
        err.triedSummary = `${host}:${port} (Invalid token)`
        throw err
      }

      throw new Error(`PC returned HTTP ${response.status}`)
    } catch (err) {
      clearTimeout(connectTimer)
      if (err.code === 'DENIED' || err.code === 'INVALID_TOKEN' || err.code === 'APPROVAL_TIMEOUT' || err.code === 'TOO_MANY_ATTEMPTS') {
        throw err
      }
      if (connected) {
        if (err.name === 'AbortError') {
          console.warn(`[PairingClient] Host ${host}:${port} failed: APPROVAL_TIMEOUT`)
          const timeoutErr = new Error('Approval timed out on your PC. Please try again.')
          timeoutErr.code = 'APPROVAL_TIMEOUT'
          timeoutErr.port = port
          throw timeoutErr
        }
        throw err
      }

      const isTimeout = err.name === 'AbortError'
      const errType = isTimeout
        ? 'CONNECT_TIMEOUT'
        : (err.message?.toLowerCase().includes('refused') ? 'CONNECTION_REFUSED' : 'NETWORK_ERROR')
      const errMsg = isTimeout
        ? 'Connect timed out'
        : (err.message || 'Connection failed')

      console.warn(`[PairingClient] Host ${host}:${port} failed: ${errType}`)
      attempts.push({ host, port, errorType: errType, message: errMsg })
    }
  }

  // All hosts failed
  const allRefused = attempts.length > 0 && attempts.every(a => a.errorType === 'CONNECTION_REFUSED')
  const allTimeout = attempts.length > 0 && attempts.every(a => a.errorType === 'CONNECT_TIMEOUT')
  const hasRefused = attempts.some(a => a.errorType === 'CONNECTION_REFUSED')

  let primaryCode = 'NO_HOST_RESPONDED'
  let primaryMsg = 'Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.'

  if (allRefused || hasRefused) {
    primaryCode = 'CONNECTION_REFUSED'
    primaryMsg = `Connection refused on port ${port}. Check PC pairing window and firewall.`
  } else if (allTimeout) {
    primaryCode = 'CONNECT_TIMEOUT'
    primaryMsg = `Connection timed out on port ${port}. Phone and PC must be on the same Wi-Fi.`
  }

  const triedSummary = attempts.map(a => `${a.host}:${a.port} (${a.message})`).join(', ')
  const error = new Error(primaryMsg)
  error.code = primaryCode
  error.port = port
  error.attempts = attempts
  error.triedSummary = triedSummary
  throw error
}
