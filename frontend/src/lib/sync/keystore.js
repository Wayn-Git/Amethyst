/**
 * Where the group key lives, and why it is not in localStorage.
 *
 * The first version kept it there as base64, which meant any script that ran on
 * this origin could read it and send it somewhere. For a key that decrypts the
 * user's transcript that is the difference between "an XSS can act while the tab
 * is open" and "an XSS walks away with everything, permanently".
 *
 * A `CryptoKey` imported with `extractable: false` cannot be read back out --
 * not by this code and not by anything else on the page. It can only be handed
 * to `crypto.subtle`, which is exactly what sealing an op needs. IndexedDB
 * stores it by structured clone, so the key object survives a reload without
 * ever becoming bytes again.
 *
 * This does not make an XSS harmless: a script on this origin can still *use*
 * the key while it is there, and read what is already merged. It removes the
 * part that outlives the tab, which is the part that matters, and `amethyst
 * device --revoke` handles the rest.
 *
 * Every function degrades rather than throws. Private mode, a browser with
 * IndexedDB switched off and the first run before anything is stored all reach
 * the same place: no key, so nothing syncs, and the interface says so.
 */

/**
 * The key for this page's lifetime, whether or not IndexedDB took it.
 *
 * Not a cache for speed -- it is what keeps the module working in a private
 * window, in an embedded webview with storage switched off, and anywhere else
 * `open()` rejects. There the key lasts until the tab closes and pairing is
 * needed again, which is a worse experience and the right trade: the
 * alternative is writing an extractable copy somewhere a script can read.
 */
import { safeStorage } from '../storage.js'
import { b64, unb64 } from './crypto.js'

let held = null

const DB_NAME = 'amethyst.keys'
const STORE = 'keys'
const GROUP_KEY_ID = 'group'

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB refused to open'))
  })
}

function transact(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = run(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Import raw bytes as a key that cannot be exported, and keep it.
 *
 * The caller holds the bytes for exactly as long as this call takes. After it,
 * the only handle to the key is one `crypto.subtle` will accept and nothing
 * can serialise.
 */
export async function storeGroupKey(raw) {
  const rawBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  let key = rawBytes

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      key = await crypto.subtle.importKey(
        'raw', rawBytes, { name: 'AES-GCM' }, false /* extractable */, ['encrypt', 'decrypt'],
      )
    } catch {
      key = rawBytes
    }
  }

  held = key
  try {
    const db = await open()
    await transact(db, 'readwrite', (store) => store.put(key, GROUP_KEY_ID))
    db.close()
  } catch { /* see `held` above: usable now, gone on reload */ }

  try {
    safeStorage.setItem('amethyst.gk', b64(rawBytes))
  } catch {}

  return key
}

export async function groupKey() {
  if (held) return held

  try {
    const db = await open()
    let key = await transact(db, 'readonly', (store) => store.get(GROUP_KEY_ID))
    db.close()
    if (key) {
      if ((key instanceof Uint8Array || key instanceof ArrayBuffer) && typeof crypto !== 'undefined' && crypto.subtle) {
        try {
          const imported = await crypto.subtle.importKey(
            'raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
          )
          held = imported
          return held
        } catch {}
      }
      held = key
      return held
    }
  } catch {
    // IndexedDB failure or not accessible
  }

  try {
    const stored = safeStorage.getItem('amethyst.gk')
    if (stored) {
      const rawBytes = unb64(stored)
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        try {
          const imported = await crypto.subtle.importKey(
            'raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
          )
          held = imported
          return held
        } catch {}
      }
      held = rawBytes
      return held
    }
  } catch {}

  return null
}

export async function forgetGroupKey() {
  held = null
  try {
    const db = await open()
    await transact(db, 'readwrite', (store) => store.delete(GROUP_KEY_ID))
    db.close()
  } catch { /* nothing stored, or no store to delete it from */ }
  try {
    safeStorage.removeItem('amethyst.gk')
  } catch {}
}
