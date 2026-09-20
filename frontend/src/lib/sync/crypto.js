/**
 * The browser's half of the sealed envelope.
 *
 * A mirror of `backend/sync/crypto.py`, and it has to be an exact one: the two
 * sides seal for each other, so a difference in the key derivation, the nonce
 * length or what goes into the associated data is not a style difference, it is
 * a phone that silently receives nothing. `tests/test_sync_interop.py` seals on
 * one side and opens on the other in both directions, which is the only way to
 * keep these two files honest about each other.
 *
 * WebCrypto rather than a library: AES-GCM and HKDF are both native in every
 * browser this runs in, and shipping a megabyte of JavaScript to do what
 * `crypto.subtle` already does would be its own answer to why not.
 *
 * On where the group key lives. It is held in localStorage on the phone, which
 * means an XSS in this app is a total compromise of what syncs -- there is no
 * way around that for a key a web page must use. It is bounded by the key only
 * ever reaching devices the user paired by hand, and by `amethyst device
 * --revoke` taking one out within a poll.
 */

import { gcm } from '@noble/ciphers/aes.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const KEY_BYTES = 32
const NONCE_BYTES = 12
const PAIR_INFO = new TextEncoder().encode('amethyst-pair-v1')

export function b64(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function unb64(text) {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** What the ciphertext is bound to: its own row at the relay. */
function aad(opId, deviceId) {
  return new TextEncoder().encode(`${opId}\0${deviceId}`)
}

function getRandomBytes(len) {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint8Array(len))
  }
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = (Math.random() * 256) | 0
  return bytes
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const pairs = Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    return `{${pairs.join(',')}}`
  }
  return JSON.stringify(value)
}

async function aesKey(key) {
  if (typeof CryptoKey !== 'undefined' && key instanceof CryptoKey) return key
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
  return key
}

export async function seal(payload, { opId, deviceId, key }) {
  const nonce = getRandomBytes(NONCE_BYTES)
  const raw = new TextEncoder().encode(canonical(payload))
  const associatedData = aad(opId, deviceId)

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: associatedData },
        await aesKey(key),
        raw,
      )
      return { nonce: b64(nonce), ciphertext: b64(ciphertext) }
    } catch {
      // Fall back to noble
    }
  }

  // Pure JavaScript fallback using @noble/ciphers
  const rawKey = (typeof CryptoKey !== 'undefined' && key instanceof CryptoKey)
    ? new Uint8Array(await crypto.subtle.exportKey('raw', key))
    : (key instanceof Uint8Array ? key : new Uint8Array(key))
  const cipher = gcm(rawKey, nonce, associatedData)
  const ciphertext = cipher.encrypt(raw)
  return { nonce: b64(nonce), ciphertext: b64(ciphertext) }
}

export async function unseal(nonce, ciphertext, { opId, deviceId, key }) {
  const associatedData = aad(opId, deviceId)
  const nonceBytes = unb64(nonce)
  const cipherBytes = unb64(ciphertext)

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const raw = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonceBytes, additionalData: associatedData },
        await aesKey(key),
        cipherBytes,
      )
      return JSON.parse(new TextDecoder().decode(raw))
    } catch {
      // Fall back to noble or throw
    }
  }

  try {
    const rawKey = (typeof CryptoKey !== 'undefined' && key instanceof CryptoKey)
      ? new Uint8Array(await crypto.subtle.exportKey('raw', key))
      : (key instanceof Uint8Array ? key : new Uint8Array(key))
    const cipher = gcm(rawKey, nonceBytes, associatedData)
    const raw = cipher.decrypt(cipherBytes)
    return JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new Error('this payload did not open under the group key')
  }
}

export async function pairKey(pairSecret) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const material = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(pairSecret), 'HKDF', false, ['deriveBits'],
      )
      const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: PAIR_INFO },
        material,
        KEY_BYTES * 8,
      )
      return new Uint8Array(bits)
    } catch {
      // Fall through to noble
    }
  }

  return hkdf(sha256, new TextEncoder().encode(pairSecret), new Uint8Array(0), PAIR_INFO, KEY_BYTES)
}
