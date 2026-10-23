import { identity } from '../lib/sync/client.js'
import { groupKey } from '../lib/sync/keystore.js'
import { seal, unseal } from '../lib/sync/crypto.js'

let generation = 0
let database
async function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('amethyst.mobile', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = null; reject(request.error) }
  })
  return database
}

async function principal() {
  const owner = identity()?.deviceId
  const key = await groupKey()
  if (!owner || !key) throw new Error('Pair this device before saving offline content.')
  return { owner, key }
}

export async function putRecord(name, value) {
  const started = generation
  const { owner, key } = await principal()
  const id = `${owner}:${name}`
  const sealed = await seal(value, { opId: id, deviceId: owner, key })
  const db = await open()
  if (started !== generation || identity()?.deviceId !== owner) throw new Error('Device pairing changed while saving')
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
  const owner = identity()?.deviceId
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
