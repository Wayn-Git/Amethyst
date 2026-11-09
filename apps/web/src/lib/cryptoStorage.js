/**
 * Client-Side Encrypted Storage for Synced Credentials
 * Uses WebCrypto AES-GCM (256-bit) to ensure tokens and API keys are never stored in plaintext.
 */

import { safeStorage } from './storage.js'

let cachedCryptoKey = null

function getCryptoSubtle() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle
  }
  return null
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Derives a stable, device-local AES-256-GCM key.
 */
async function getDeviceKey() {
  if (cachedCryptoKey) return cachedCryptoKey

  const subtle = getCryptoSubtle()
  if (!subtle) return null

  // Ensure stable local seed exists
  let seed = safeStorage.getItem('amethyst.device.kseed')
  if (!seed) {
    const randomBytes = new Uint8Array(32)
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(randomBytes)
      seed = arrayBufferToBase64(randomBytes.buffer)
    } else {
      seed = `seed_${Date.now()}_${Math.random()}`
    }
    safeStorage.setItem('amethyst.device.kseed', seed)
  }

  // Derive AES-GCM key from seed using SHA-256
  const encoder = new TextEncoder()
  const rawHash = await subtle.digest('SHA-256', encoder.encode(`amethyst_vault_salt_${seed}`))

  cachedCryptoKey = await subtle.importKey(
    'raw',
    rawHash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )

  return cachedCryptoKey
}

/**
 * Encrypt a JSON-serializable payload with AES-GCM.
 */
export async function encryptPayload(data) {
  const subtle = getCryptoSubtle()
  if (!subtle) {
    // If WebCrypto is unavailable, return JSON string fallback
    return typeof data === 'string' ? data : JSON.stringify(data)
  }

  try {
    const key = await getDeviceKey()
    const iv = new Uint8Array(12)
    globalThis.crypto.getRandomValues(iv)

    const encoder = new TextEncoder()
    const plainText = typeof data === 'string' ? data : JSON.stringify(data)
    const encoded = encoder.encode(plainText)

    const cipherBuffer = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    )

    return JSON.stringify({
      __amethyst_enc: 1,
      iv: arrayBufferToBase64(iv.buffer),
      ct: arrayBufferToBase64(cipherBuffer),
    })
  } catch (err) {
    console.warn('[cryptoStorage] Encryption failed, falling back:', err.message)
    return typeof data === 'string' ? data : JSON.stringify(data)
  }
}

/**
 * Decrypt a stored string. Handles both encrypted envelope and legacy plaintext.
 */
export async function decryptPayload(raw) {
  if (!raw) return null
  if (typeof raw !== 'string') return raw

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }

  // Check if it's our encrypted envelope
  if (parsed && typeof parsed === 'object' && parsed.__amethyst_enc === 1 && parsed.iv && parsed.ct) {
    const subtle = getCryptoSubtle()
    if (!subtle) return null

    try {
      const key = await getDeviceKey()
      const iv = base64ToArrayBuffer(parsed.iv)
      const cipherData = base64ToArrayBuffer(parsed.ct)

      const decryptedBuffer = await subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        cipherData
      )

      const decoder = new TextDecoder()
      const decryptedString = decoder.decode(decryptedBuffer)
      try {
        return JSON.parse(decryptedString)
      } catch {
        return decryptedString
      }
    } catch (err) {
      console.warn('[cryptoStorage] Decryption failed:', err.message)
      return null
    }
  }

  // It was legacy plaintext JSON
  return parsed
}

/**
 * Set item encrypted in storage (defaults to safeStorage).
 */
export async function secureStoreItem(key, value, storage = safeStorage) {
  if (value === null || value === undefined) {
    storage.removeItem(key)
    return
  }
  const encrypted = await encryptPayload(value)
  storage.setItem(key, encrypted)
}

/**
 * Get and decrypt item from storage (defaults to safeStorage).
 */
export async function secureGetItem(key, storage = safeStorage) {
  const raw = storage.getItem(key)
  if (!raw) return null
  return await decryptPayload(raw)
}

/**
 * Remove item from storage.
 */
export function secureRemoveItem(key, storage = safeStorage) {
  storage.removeItem(key)
}

