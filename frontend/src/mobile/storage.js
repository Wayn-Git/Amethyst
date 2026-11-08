import { identity } from '../lib/sync/client.js'
import { groupKey } from '../lib/sync/keystore.js'
import { seal, unseal, b64, unb64 } from '../lib/sync/crypto.js'
import { safeStorage } from '../lib/storage.js'
import { nativeVault } from '../lib/credentials.js'

let generation = 0
let database
let heldLocalKey = null

const LOCAL_OWNER_KEY = 'amethyst.mobile.local_owner'
const LOCAL_VAULT_KEY = 'amethyst_local_key'

export function getLocalOwner() {
  let id = safeStorage.getItem(LOCAL_OWNER_KEY)
  if (!id) {
    id = `local_${Math.random().toString(36).slice(2, 10)}`
    safeStorage.setItem(LOCAL_OWNER_KEY, id)
  }
  return id
}

export async function getLocalKey() {
  if (heldLocalKey) return heldLocalKey

  try {
    const vault = await nativeVault()
    if (vault) {
      const saved = await vault.get(LOCAL_VAULT_KEY)
      if (saved) {
        heldLocalKey = unb64(saved)
        return heldLocalKey
      }
    }
  } catch {}

  const stored = safeStorage.getItem('amethyst.local_k')
  if (stored) {
    heldLocalKey = unb64(stored)
    return heldLocalKey
  }

  const bytes = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = (Math.random() * 256) | 0
  }
  heldLocalKey = bytes

  try {
    const vault = await nativeVault()
    if (vault) await vault.set(LOCAL_VAULT_KEY, b64(bytes))
  } catch {}
  try {
    safeStorage.setItem('amethyst.local_k', b64(bytes))
  } catch {}

  return heldLocalKey
}

async function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('amethyst.mobile', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = null; reject(request.error) }
  })
  return database
}

export async function closeDatabase() {
  if (database) {
    try {
      const db = await database
      db.close()
    } catch {}
    database = null
  }
}

export async function principal() {
  const pairedOwner = identity()?.deviceId
  const pairedKey = await groupKey()
  if (pairedOwner && pairedKey) {
    return { owner: pairedOwner, key: pairedKey, isPaired: true }
  }

  // If a device identity is set but groupKey is missing, reject
  if (pairedOwner && !pairedKey) {
    throw new Error('Pair this device before saving offline content.')
  }

  // Standalone unpaired fallback
  const localOwner = getLocalOwner()
  const localKey = await getLocalKey()
  return { owner: localOwner, key: localKey, isPaired: false }
}

export async function putRecord(name, value) {
  const started = generation
  const { owner, key } = await principal()
  const id = `${owner}:${name}`
  const sealed = await seal(value, { opId: id, deviceId: owner, key })
  const db = await open()

  const currentPrincipal = await principal()
  if (started !== generation || currentPrincipal.owner !== owner) {
    throw new Error('Device pairing changed while saving')
  }

  // Resolve at COMMIT, not at the individual put request's success event.
  await new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put({ id, ...sealed })
    tx.oncomplete = resolve
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Offline storage failed'))
  })
}

export async function records(prefix = '') {
  const { owner, key } = await principal()
  const db = await open()
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return Promise.all(rows.filter(row => row.id.startsWith(`${owner}:${prefix}`)).map(async row => ({
    name: row.id.slice(owner.length + 1),
    value: await unseal(row.nonce, row.ciphertext, { opId: row.id, deviceId: owner, key }),
  })))
}

export async function clearDeviceRecords() {
  generation += 1
  const owner = identity()?.deviceId || getLocalOwner()
  if (!owner) return
  const db = await open()
  await new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    const store = tx.objectStore('records')
    const cursor = store.openKeyCursor()
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return
      if (String(row.key).startsWith(`${owner}:`)) store.delete(row.key)
      row.continue()
    }
    tx.oncomplete = resolve
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

/**
 * Migration step on pairing:
 * Re-encrypt local records under the PC group key, re-stamp owner, then flush.
 */
export async function migrateLocalRecordsToPaired(newOwner, newKey) {
  generation += 1
  const localOwner = getLocalOwner()
  const localKey = await getLocalKey()
  if (!localOwner || !localKey || !newOwner || !newKey) return { migrated: 0 }

  const db = await open()
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const localRows = rows.filter(r => r.id.startsWith(`${localOwner}:`))
  let migrated = 0

  for (const row of localRows) {
    const name = row.id.slice(localOwner.length + 1)
    try {
      const val = await unseal(row.nonce, row.ciphertext, { opId: row.id, deviceId: localOwner, key: localKey })
      if (val && typeof val === 'object' && val.deviceId) {
        val.deviceId = newOwner
      }
      const newId = `${newOwner}:${name}`
      const newSealed = await seal(val, { opId: newId, deviceId: newOwner, key: newKey })

      await new Promise((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite')
        const store = tx.objectStore('records')
        store.put({ id: newId, ...newSealed })
        store.delete(row.id)
        tx.oncomplete = resolve
        tx.onerror = tx.onabort = () => reject(tx.error)
      })
      migrated++
    } catch (err) {
      console.warn('[StorageMigration] Failed migrating row:', row.id, err)
    }
  }

  // Trigger flush of captures
  try {
    const { flushCaptures } = await import('./captures.js')
    await flushCaptures()
  } catch {}

  return { migrated }
}
