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

/**
 * Compact and key-sorted at every depth, matching `json.dumps(sort_keys=True,
 * separators=(",", ":"))` on the other side, so a given payload produces the
 * same bytes in both languages.
 *
 * Deliberately not `JSON.stringify(value, Object.keys(value).sort())`: passing
 * an array as the second argument makes it a *recursive key allowlist*, not a
 * key order, so every nested key absent from the top-level list is dropped. That
 * version shipped an op whose `fields` was an empty object -- syntactically
 * perfect, silently carrying nothing -- and only the interop test caught it.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const pairs = Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    return `{${pairs.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Accepts either raw bytes or an already-imported key.
 *
 * The group key arrives as a non-extractable `CryptoKey` from `keystore.js` and
 * is passed straight through; the pairing key is derived per handshake and is
 * bytes. Both work, and the group key never becomes bytes on this side.
 */
async function aesKey(key) {
  if (key instanceof CryptoKey) return key
  return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function seal(payload, { opId, deviceId, key }) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const raw = new TextEncoder().encode(canonical(payload))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(opId, deviceId) },
    await aesKey(key),
    raw,
  )
  return { nonce: b64(nonce), ciphertext: b64(ciphertext) }
}

export async function unseal(nonce, ciphertext, { opId, deviceId, key }) {
  let raw
  try {
    raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(nonce), additionalData: aad(opId, deviceId) },
      await aesKey(key),
      unb64(ciphertext),
    )
  } catch {
    // Wrong key, wrong envelope or tampering, deliberately not distinguished:
    // the caller's response to all three is to drop the op.
    throw new Error('this payload did not open under the group key')
  }
  return JSON.parse(new TextDecoder().decode(raw))
}

/**
 * The key both sides of a pairing derive from the shared secret.
 *
 * HKDF with no salt, matching devices.py. The secret carries 160 bits, so there
 * is nothing here for a slow KDF to buy -- those exist to punish guessing a
 * secret short enough to guess.
 */
export async function pairKey(pairSecret) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pairSecret), 'HKDF', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: PAIR_INFO },
    material,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}
