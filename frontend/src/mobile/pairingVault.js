import { useEffect, useState, useCallback } from 'react'
import { nativeVault, storedIdentity, saveIdentity, removeIdentity, IDENTITY_KEY } from '../lib/credentials.js'
import { safeStorage } from '../lib/storage.js'

export const VAULT_PAIRING_TOKEN_KEY = 'amethyst.pairing.token'
export const VAULT_TOKEN_REJECTED_KEY = 'amethyst.pairing.token_rejected'

/**
 * Retrieve the active PC pairing token from native vault, credentials, or safe storage.
 * Returns null if not paired.
 */
export async function getPairingToken() {
  try {
    const vault = await nativeVault()
    if (vault) {
      const storedToken = await vault.get(VAULT_PAIRING_TOKEN_KEY)
      if (typeof storedToken === 'string' && storedToken.trim()) {
        return storedToken.trim()
      }
      const storedId = await vault.get(IDENTITY_KEY)
      if (storedId?.token && typeof storedId.token === 'string') {
        return storedId.token.trim()
      }
    }
  } catch {}

  try {
    const fromStorage = safeStorage.getItem(VAULT_PAIRING_TOKEN_KEY)
    if (fromStorage && typeof fromStorage === 'string' && fromStorage.trim()) {
      return fromStorage.trim()
    }
    const id = storedIdentity()
    if (id?.token && typeof id.token === 'string') {
      return id.token.trim()
    }
    const rawId = safeStorage.getItem(IDENTITY_KEY)
    if (rawId) {
      const parsed = JSON.parse(rawId)
      if (parsed?.token) return parsed.token.trim()
    }
  } catch {}

  return null
}

/**
 * Single source of truth for "paired" state.
 * Returns true if a valid pairing token exists and is not rejected.
 */
export async function isPaired() {
  try {
    const token = await getPairingToken()
    if (!token) return false
    const rejected = await isPairingTokenRejected()
    return !rejected
  } catch {
    return false
  }
}

/**
 * Persist the pairing token in native vault (one-time persistence across restart)
 * and update credentials / storage.
 */
export async function savePairingToken(token, options = {}) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid pairing token')
  }
  const cleanToken = token.trim()

  // 1. Vault persistence
  let hasNativeVault = false
  try {
    const vault = await nativeVault()
    if (vault) {
      hasNativeVault = true
      await vault.set(VAULT_PAIRING_TOKEN_KEY, cleanToken)
      await vault.remove(VAULT_TOKEN_REJECTED_KEY)
      safeStorage.removeItem(VAULT_PAIRING_TOKEN_KEY)
      safeStorage.removeItem(VAULT_TOKEN_REJECTED_KEY)
    }
  } catch {}

  // 2. Safe storage persistence (fallback when native vault unavailable)
  if (!hasNativeVault) {
    try {
      safeStorage.setItem(VAULT_PAIRING_TOKEN_KEY, cleanToken)
      safeStorage.removeItem(VAULT_TOKEN_REJECTED_KEY)
    } catch {}
  }

  // 3. Update sync credentials
  const targetDeviceId = options.deviceId || storedIdentity()?.deviceId || `dev_${Math.random().toString(36).slice(2, 10)}`
  try {
    const current = storedIdentity() || {}
    await saveIdentity({
      ...current,
      token: cleanToken,
      deviceId: targetDeviceId,
      hostUrl: options.hostUrl || current.hostUrl || '',
      permissions: options.permissions || current.permissions || {
        library: true,
        agent: true,
        terminal: true,
        pc: true,
      },
    })
  } catch {}

  // 4. Migrate local unpaired records to new owner on pairing completion
  try {
    const { migrateLocalRecordsToPaired } = await import('./storage.js')
    await migrateLocalRecordsToPaired(targetDeviceId)
  } catch {}

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('amethyst:pairing_changed', {
        detail: { token: cleanToken, isPaired: true },
      })
    )
  }

  return cleanToken
}

/**
 * Check if the active pairing token has been rejected or revoked by the PC.
 */
export async function isPairingTokenRejected() {
  try {
    const vault = await nativeVault()
    if (vault) {
      const rej = await vault.get(VAULT_TOKEN_REJECTED_KEY)
      if (rej === 'true' || rej === true) return true
    }
  } catch {}

  try {
    if (safeStorage.getItem(VAULT_TOKEN_REJECTED_KEY) === 'true') {
      return true
    }
  } catch {}

  return false
}

/**
 * Mark pairing token as rejected by PC (shows Re-scan QR banner on MobilePC & MobileTerminal).
 */
export async function markPairingTokenRejected(reason = 'rejected') {
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.set(VAULT_TOKEN_REJECTED_KEY, 'true')
    }
  } catch {}

  try {
    safeStorage.setItem(VAULT_TOKEN_REJECTED_KEY, 'true')
  } catch {}

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('amethyst:token_rejected', {
        detail: { reason },
      })
    )
  }
}

/**
 * Clear the rejected flag after successful re-scan / re-pairing.
 */
export async function clearPairingTokenRejected() {
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.remove(VAULT_TOKEN_REJECTED_KEY)
    }
  } catch {}

  try {
    safeStorage.removeItem(VAULT_TOKEN_REJECTED_KEY)
  } catch {}

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('amethyst:token_restored'))
  }
}

/**
 * Clear pairing token completely (unpair).
 */
export async function clearPairingToken() {
  try {
    const vault = await nativeVault()
    if (vault) {
      await vault.remove(VAULT_PAIRING_TOKEN_KEY)
      await vault.remove(VAULT_TOKEN_REJECTED_KEY)
    }
  } catch {}

  try {
    safeStorage.removeItem(VAULT_PAIRING_TOKEN_KEY)
    safeStorage.removeItem(VAULT_TOKEN_REJECTED_KEY)
  } catch {}

  try {
    await removeIdentity()
  } catch {}

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('amethyst:pairing_changed', {
        detail: { token: null, isPaired: false },
      })
    )
  }
}

/**
 * React hook to observe pairing state, token rejection, and lifecycle.
 */
export function usePairingStatus() {
  const getSyncToken = () => {
    try {
      return safeStorage.getItem(VAULT_PAIRING_TOKEN_KEY) || storedIdentity()?.token || ''
    } catch {
      return ''
    }
  }

  const getSyncRejected = () => {
    try {
      return safeStorage.getItem(VAULT_TOKEN_REJECTED_KEY) === 'true'
    } catch {
      return false
    }
  }

  const [status, setStatus] = useState(() => {
    const tok = getSyncToken()
    return {
      isPaired: Boolean(tok),
      isRejected: getSyncRejected(),
      token: tok,
      loading: false,
    }
  })

  const refresh = useCallback(async () => {
    const tok = await getPairingToken()
    const rej = await isPairingTokenRejected()
    setStatus({
      isPaired: Boolean(tok),
      isRejected: rej,
      token: tok || '',
      loading: false,
    })
  }, [])

  useEffect(() => {
    refresh()

    const onPairingChanged = () => {
      refresh()
    }
    const onTokenRejected = () => {
      setStatus((prev) => ({ ...prev, isRejected: true }))
    }
    const onTokenRestored = () => {
      setStatus((prev) => ({ ...prev, isRejected: false }))
    }
    const onStorage = (e) => {
      if (e.key === VAULT_PAIRING_TOKEN_KEY || e.key === VAULT_TOKEN_REJECTED_KEY || e.key === IDENTITY_KEY) {
        refresh()
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('amethyst:pairing_changed', onPairingChanged)
      window.addEventListener('amethyst:token_rejected', onTokenRejected)
      window.addEventListener('amethyst:token_restored', onTokenRestored)
      window.addEventListener('storage', onStorage)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('amethyst:pairing_changed', onPairingChanged)
        window.removeEventListener('amethyst:token_rejected', onTokenRejected)
        window.removeEventListener('amethyst:token_restored', onTokenRestored)
        window.removeEventListener('storage', onStorage)
      }
    }
  }, [refresh])

  const pair = useCallback(async (newToken, options) => {
    await savePairingToken(newToken, options)
    await refresh()
  }, [refresh])

  const markRejected = useCallback(async (reason) => {
    await markPairingTokenRejected(reason)
    setStatus((prev) => ({ ...prev, isRejected: true }))
  }, [])

  const clearRejected = useCallback(async () => {
    await clearPairingTokenRejected()
    setStatus((prev) => ({ ...prev, isRejected: false }))
  }, [])

  return {
    isPaired: status.isPaired,
    isRejected: status.isRejected,
    token: status.token,
    loading: status.loading,
    pair,
    markRejected,
    clearRejected,
    refresh,
  }
}
