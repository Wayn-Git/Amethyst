import { Capacitor } from '@capacitor/core'
import { safeStorage } from './storage.js'
import { secureStoreItem, secureGetItem, secureRemoveItem } from './cryptoStorage.js'

export const isNativeMobile = () => Capacitor.isNativePlatform()
export const IDENTITY_KEY = 'amethyst.sync.identity.v1'
let nativeIdentity = null
let secureStore = null
let initPromise = null

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

export function initializeCredentials() {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const vault = await nativeVault()
      if (vault) {
        nativeIdentity = await vault.get(IDENTITY_KEY)
        if (typeof nativeIdentity === 'string') {
          try { nativeIdentity = JSON.parse(nativeIdentity) } catch {}
        }
      }
      if (!nativeIdentity) {
        nativeIdentity = await secureGetItem(IDENTITY_KEY)
      }
      if (nativeIdentity && typeof nativeIdentity === 'object') {
        try {
          await secureStoreItem(IDENTITY_KEY, nativeIdentity)
          if (nativeIdentity.hostUrl) {
            safeStorage.setItem('amethyst.pc_host', nativeIdentity.hostUrl)
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[credentials] initializeCredentials error:', err)
    }
    return nativeIdentity
  })()
  return initPromise
}

// Auto-start initialization at module import time
if (typeof window !== 'undefined') {
  initializeCredentials()
}

export async function getStoredIdentityAsync() {
  if (!nativeIdentity) {
    await initializeCredentials()
  }
  return storedIdentity()
}

export function isCredentialsReady() {
  return Boolean(nativeIdentity)
}

export function storedIdentity() {
  if (nativeIdentity) {
    if (typeof nativeIdentity === 'string') {
      try { nativeIdentity = JSON.parse(nativeIdentity) } catch {}
    }
    return nativeIdentity
  }
  try {
    const raw = safeStorage.getItem(IDENTITY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && !parsed.__amethyst_enc) {
        nativeIdentity = parsed
        return parsed
      }
    }
  } catch {}
  return null
}

export async function saveIdentity(identity) {
  nativeIdentity = identity
  try {
    await secureStoreItem(IDENTITY_KEY, identity)
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
    secureRemoveItem(IDENTITY_KEY)
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
