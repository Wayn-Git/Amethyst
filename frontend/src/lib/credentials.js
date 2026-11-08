import { Capacitor } from '@capacitor/core'
import { safeStorage } from './storage.js'

export const isNativeMobile = () => Capacitor.isNativePlatform()
export const IDENTITY_KEY = 'amethyst.sync.identity.v1'
let nativeIdentity = null
let secureStore = null

export function _setSecureStoreForTest(store) {
  secureStore = store
}

export async function nativeVault() {
  if (secureStore) return secureStore
  if (!isNativeMobile()) return null
  if (!secureStore) {
    const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage')
    await SecureStorage.setKeyPrefix('amethyst_')
    await SecureStorage.setSynchronize(false)
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
    // Capacitor proxies synthesize any property, including `then`. Returning
    // the proxy from an async function makes Promise assimilation invoke a
    // nonexistent native then() method and leaves startup pending forever.
    secureStore = {
      get: (...args) => SecureStorage.get(...args),
      set: (...args) => SecureStorage.set(...args),
      remove: (...args) => SecureStorage.remove(...args),
    }
  }
  return secureStore
}

export async function initializeCredentials() {
  const vault = await nativeVault()
  if (!vault) return
  nativeIdentity = await vault.get(IDENTITY_KEY)
  const legacy = safeStorage.getItem(IDENTITY_KEY)
  if (!nativeIdentity && legacy) {
    const parsed = JSON.parse(legacy)
    await vault.set(IDENTITY_KEY, parsed)
    nativeIdentity = parsed
  }
  // Remove only after the secure write succeeds; errors fail boot closed.
  safeStorage.removeItem(IDENTITY_KEY)
}

export function storedIdentity() {
  if (isNativeMobile() && nativeIdentity) return nativeIdentity
  try {
    const raw = safeStorage.getItem(IDENTITY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed) {
        if (isNativeMobile() && !nativeIdentity) nativeIdentity = parsed
        return parsed
      }
    }
  } catch {}
  return nativeIdentity || null
}

export async function saveIdentity(identity) {
  nativeIdentity = identity
  try {
    safeStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
    if (identity?.hostUrl) {
      safeStorage.setItem('amethyst.pc_host', identity.hostUrl)
    }
  } catch {}
  const vault = await nativeVault()
  if (vault) {
    try {
      await vault.set(IDENTITY_KEY, identity)
    } catch {}
  }
}

export async function removeIdentity() {
  nativeIdentity = null
  try {
    safeStorage.removeItem(IDENTITY_KEY)
    safeStorage.removeItem('amethyst.pc_host')
  } catch {}
  const vault = await nativeVault()
  if (vault) {
    try {
      await vault.remove(IDENTITY_KEY)
    } catch {}
  }
}
