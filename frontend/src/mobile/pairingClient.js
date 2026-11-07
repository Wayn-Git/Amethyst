import { Capacitor, registerPlugin } from '@capacitor/core'
import { saveBundle } from './bundle.js'

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
        connectTimeoutMs: 3000,
        readTimeoutMs: 120000,
      })

      if (statusListener) {
        await statusListener.remove?.().catch(() => {})
      }

      if (!result?.bundle) {
        throw new Error('Pairing server did not return a valid bundle')
      }

      await saveBundle(result.bundle)
      return result.bundle
    } catch (err) {
      if (statusListener) {
        await statusListener.remove?.().catch(() => {})
      }

      const msg = err?.message || ''
      if (msg.includes('NO_HOST_RESPONDED') || msg.includes('timeout') || err?.code === 'NO_HOST_RESPONDED') {
        const error = new Error('Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.')
        error.code = 'NO_HOST_RESPONDED'
        throw error
      }
      if (msg.includes('DENIED') || err?.code === 'DENIED') {
        const error = new Error('Pairing was denied on your PC.')
        error.code = 'DENIED'
        throw error
      }
      if (msg.includes('CERT_MISMATCH') || err?.code === 'CERT_MISMATCH') {
        const error = new Error('Security error: Server certificate does not match the pairing QR code.')
        error.code = 'CERT_MISMATCH'
        throw error
      }
      if (msg.includes('APPROVAL_TIMEOUT') || err?.code === 'APPROVAL_TIMEOUT') {
        const error = new Error('Approval timed out on your PC. Please try again.')
        error.code = 'APPROVAL_TIMEOUT'
        throw error
      }

      throw err
    }
  }

  // Non-native / Web / Test environment simulation
  let connected = false
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
        return bundle
      }

      if (response.status === 403) {
        const err = new Error('Pairing was denied on your PC.')
        err.code = 'DENIED'
        throw err
      }

      if (response.status === 408) {
        const err = new Error('Approval timed out on your PC. Please try again.')
        err.code = 'APPROVAL_TIMEOUT'
        throw err
      }

      if (response.status === 400 || response.status === 401) {
        const err = new Error('Pairing token was rejected or already used.')
        err.code = 'INVALID_TOKEN'
        throw err
      }

      throw new Error(`PC returned HTTP ${response.status}`)
    } catch (err) {
      clearTimeout(connectTimer)
      if (err.code === 'DENIED' || err.code === 'INVALID_TOKEN' || err.code === 'APPROVAL_TIMEOUT') {
        throw err
      }
      // If connected but failed on response read
      if (connected) {
        if (err.name === 'AbortError') {
          const timeoutErr = new Error('Approval timed out on your PC. Please try again.')
          timeoutErr.code = 'APPROVAL_TIMEOUT'
          throw timeoutErr
        }
        throw err
      }
      // Try next host
    }
  }

  // If no host responded
  const error = new Error('Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.')
  error.code = 'NO_HOST_RESPONDED'
  throw error
}
