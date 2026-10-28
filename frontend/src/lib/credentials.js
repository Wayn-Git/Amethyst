import { Capacitor } from '@capacitor/core'
import { safeStorage } from './storage.js'

export const isNativeMobile = () => Capacitor.isNativePlatform()
export const IDENTITY_KEY = 'amethyst.sync.identity.v1'
let nativeIdentity = null
let secureStore = null

export async function nativeVault() {
  if (!isNativeMobile()) return null
  if (!secureStore) {
    const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage')
    await SecureStorage.setKeyPrefix('amethyst_')
    await SecureStorage.setSynchronize(false)
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
    secureStore = SecureStorage
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
  if (isNativeMobile()) return nativeIdentity
  try { return JSON.parse(safeStorage.getItem(IDENTITY_KEY) || 'null') } catch { return null }
}

export async function saveIdentity(identity) {
  const vault = await nativeVault()
  if (vault) {
    await vault.set(IDENTITY_KEY, identity)
    nativeIdentity = identity
    safeStorage.removeItem(IDENTITY_KEY)
  } else if (!safeStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))) {
    throw new Error('Device storage is unavailable. Pairing was not saved.')
  }
}

export async function removeIdentity() {
  const vault = await nativeVault()
  if (vault) await vault.remove(IDENTITY_KEY)
  nativeIdentity = null
  safeStorage.removeItem(IDENTITY_KEY)
}
