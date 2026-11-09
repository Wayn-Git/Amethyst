import { Capacitor } from '@capacitor/core'
import { safeStorage } from '../lib/storage.js'
import { secureStoreItem, secureGetItem, secureRemoveItem } from '../lib/cryptoStorage.js'

const KEY_PREFIX = 'amethyst_'

/**
 * Get API key or secret from native SecureStorage (EncryptedSharedPreferences on Android).
 * Falls back to AES-256-GCM encrypted cryptoStorage if native storage is unavailable.
 */
export async function getSecureKey(key) {
  if (Capacitor.isNativePlatform() && window.Capacitor?.Plugins?.SecureStorage) {
    try {
      const plugin = window.Capacitor.Plugins.SecureStorage
      const res = await plugin.internalGetItem({ prefixedKey: `${KEY_PREFIX}${key}` })
      if (res && res.data) {
        try {
          return JSON.parse(res.data)
        } catch {
          return res.data
        }
      }
    } catch (e) {
      console.warn(`[SecureStorage] Error getting ${key}:`, e.message)
    }
  }
  return (await secureGetItem(key)) || ''
}

/**
 * Set API key or secret in native SecureStorage and purge from plain localStorage.
 * Falls back to AES-256-GCM encrypted cryptoStorage when native storage is unavailable.
 */
export async function setSecureKey(key, value) {
  if (Capacitor.isNativePlatform() && window.Capacitor?.Plugins?.SecureStorage) {
    try {
      const plugin = window.Capacitor.Plugins.SecureStorage
      await plugin.internalSetItem({
        prefixedKey: `${KEY_PREFIX}${key}`,
        data: JSON.stringify(value),
      })
      // Purge from plain localStorage and cryptoStorage so secrets never sit in plain text
      safeStorage.removeItem(key)
      secureRemoveItem(key)
      return true
    } catch (e) {
      console.warn(`[SecureStorage] Error setting ${key}:`, e.message)
    }
  }
  await secureStoreItem(key, value)
  return true
}

/**
 * Remove key from both native secure storage and encrypted fallback.
 */
export async function removeSecureKey(key) {
  if (Capacitor.isNativePlatform() && window.Capacitor?.Plugins?.SecureStorage) {
    try {
      const plugin = window.Capacitor.Plugins.SecureStorage
      await plugin.internalRemoveItem({ prefixedKey: `${KEY_PREFIX}${key}` })
    } catch {}
  }
  secureRemoveItem(key)
  safeStorage.removeItem(key)
}
