import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
const values = new Map()
globalThis.window = { localStorage: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
} }
globalThis.localStorage = globalThis.window.localStorage

const { saveIdentity, removeIdentity } = await import('../src/lib/credentials.js')
const { storeGroupKey, forgetGroupKey } = await import('../src/lib/sync/keystore.js')
const {
  putRecord,
  records,
  clearDeviceRecords,
  migrateLocalRecordsToPaired,
  getLocalOwner,
  getLocalKey,
  closeDatabase,
  principal,
} = await import('../src/mobile/storage.js')
const { saveCapture, captures } = await import('../src/mobile/captures.js')
const { savePairingToken, clearPairingToken } = await import('../src/mobile/pairingVault.js')
const { unseal, seal } = await import('../src/lib/sync/crypto.js')
const { pairingRoute } = await import('../src/mobile/native.js')

async function resetStorage() {
  await clearPairingToken()
  await removeIdentity()
  await forgetGroupKey()
  values.clear()
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('amethyst.mobile', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('records', { keyPath: 'id' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = reject
  })
  if (db.objectStoreNames.contains('records')) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').clear()
      tx.oncomplete = resolve
      tx.onerror = reject
    })
  }
  db.close()
  await closeDatabase()
}

test('offline records are encrypted, durable and isolated by paired device', async () => {
  await resetStorage()

  await saveIdentity({ deviceId: 'a', token: 'tok_a' })
  const key = await storeGroupKey(new Uint8Array(32).fill(7))
  assert.equal(key.extractable, false)
  await putRecord('capture:1', { text: 'private capture' })
  assert.deepEqual(await records('capture:'), [{ name: 'capture:1', value: { text: 'private capture' } }])
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('amethyst.mobile'); r.onsuccess = () => resolve(r.result); r.onerror = reject
  })
  const raw = await new Promise(resolve => {
    const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result)
  })
  assert.equal(JSON.stringify(raw).includes('private capture'), false)
  await saveIdentity({ deviceId: 'b', token: 'tok_b' })
  assert.deepEqual(await records(), [])
  await clearDeviceRecords()
  await saveIdentity({ deviceId: 'a', token: 'tok_a' })
  assert.equal((await records()).length, 1)
  await clearDeviceRecords()
  assert.deepEqual(await records(), [])

  // Prove missing group key / vault failure falls back to local identity instead of throwing
  await forgetGroupKey()
  await putRecord('capture:2', { text: 'fallback save' })
  const fallbackRecs = await records('capture:2')
  assert.equal(fallbackRecs.length, 1)
  assert.equal(fallbackRecs[0].value.text, 'fallback save')

  db.close()
  await resetStorage()
})

test('pairing links stay on the local route and discard unknown fields', () => {
  assert.equal(pairingRoute('amethyst://pair?s=secret&r=https%3A%2F%2Fr.example&redirect=https://evil.example'), '/pair#s=secret&r=https%3A%2F%2Fr.example')
  assert.throws(() => pairingRoute('https://evil.example/pair?s=secret'))
  assert.throws(() => pairingRoute('amethyst://pair'))
})

test('unpair invalidates an offline write that has not committed', async () => {
  await resetStorage()
  await saveIdentity({ deviceId: 'race', token: 'tok_race' })
  await storeGroupKey(new Uint8Array(32).fill(8))
  const saving = putRecord('snapshot', { title: 'old account' })
  const rejected = assert.rejects(saving, /pairing changed/)
  await clearDeviceRecords()
  await rejected
  assert.deepEqual(await records(), [])
  await resetStorage()
})

test('save 3 captures unpaired, pair, confirm all 3 arrive under new owner, none dropped', async () => {
  await resetStorage()

  // 1. Save 3 captures while unpaired
  const cap1 = await saveCapture({ title: 'Capture 1', text: 'Text 1' })
  const cap2 = await saveCapture({ title: 'Capture 2', text: 'Text 2' })
  const cap3 = await saveCapture({ title: 'Capture 3', text: 'Text 3' })

  assert.ok(cap1.deviceId.startsWith('local_'))
  assert.ok(cap2.deviceId.startsWith('local_'))
  assert.ok(cap3.deviceId.startsWith('local_'))

  const unpairedCaps = await captures()
  assert.equal(unpairedCaps.length, 3)

  // 2. Complete pairing with new owner
  const newOwner = 'dev_pc_owner_888'
  const newKey = await storeGroupKey(new Uint8Array(32).fill(99))
  await savePairingToken('tok_valid_pair_888', { deviceId: newOwner })

  // 3. Confirm all 3 arrive under the new owner, none dropped
  const pairedCaps = await captures()
  assert.equal(pairedCaps.length, 3, 'All 3 captures must arrive under new owner, none dropped')
  for (const c of pairedCaps) {
    assert.equal(c.deviceId, newOwner, 'Each capture must be re-stamped with new owner')
  }

  // Cleanup
  await resetStorage()
})

test('fresh unpaired store saveCapture() succeeds and "Pair this device" throw is unreachable', async () => {
  await resetStorage()

  // Fresh unpaired store: saveCapture must succeed without throwing
  const freshCap = await saveCapture({ title: 'Fresh Unpaired', text: 'Should succeed' })
  assert.ok(freshCap.id)
  assert.ok(freshCap.deviceId.startsWith('local_'))

  const list = await captures()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, freshCap.id)

  // Even if a deviceId is set in identity without group key / without valid pairing token,
  // principal() returns local identity instead of throwing
  await saveIdentity({ deviceId: 'orphan_device_without_key' })
  const capWithOrphan = await saveCapture({ title: 'Orphan ID', text: 'Falls back to local' })
  assert.ok(capWithOrphan.deviceId.startsWith('local_'))

  await resetStorage()
})

test('crash-safety: kill mid-migration, relaunch, no loss and no duplicates', async () => {
  await resetStorage()

  // Save 3 captures while unpaired
  const c1 = await saveCapture({ title: 'Crash Cap 1', text: 'T1' })
  const c2 = await saveCapture({ title: 'Crash Cap 2', text: 'T2' })
  const c3 = await saveCapture({ title: 'Crash Cap 3', text: 'T3' })

  const localOwner = getLocalOwner()
  const newOwner = 'dev_crash_test_owner'
  const newKey = await storeGroupKey(new Uint8Array(32).fill(55))
  const localKey = await getLocalKey()

  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('amethyst.mobile', 1)
    r.onsuccess = () => res(r.result)
    r.onerror = rej
  })

  // Atomically migrate only record 1 (simulating partial migration before sudden kill)
  const row1 = await new Promise((res, rej) => {
    const r = db.transaction('records').objectStore('records').get(`${localOwner}:capture:${c1.id}`)
    r.onsuccess = () => res(r.result)
    r.onerror = rej
  })
  assert.ok(row1, 'Row 1 must exist before partial migration')

  const val1 = await unseal(row1.nonce, row1.ciphertext, { opId: row1.id, deviceId: localOwner, key: localKey })
  val1.deviceId = newOwner
  const newId1 = `${newOwner}:capture:${c1.id}`
  const newSealed1 = await seal(val1, { opId: newId1, deviceId: newOwner, key: newKey })

  await new Promise((res, rej) => {
    const tx = db.transaction('records', 'readwrite')
    const store = tx.objectStore('records')
    store.put({ id: newId1, ...newSealed1 })
    store.delete(row1.id)
    tx.oncomplete = res
    tx.onerror = rej
  })

  // At this point (simulated crash state):
  // c1 is under newOwner, c2 and c3 are still under localOwner.
  // Now "relaunch": pairing completed, migrateLocalRecordsToPaired is invoked again.
  await saveIdentity({ deviceId: newOwner, token: 'tok_crash_safety' })
  const rerunResult = await migrateLocalRecordsToPaired(newOwner, newKey)
  assert.equal(rerunResult.migrated, 2, 'Remaining 2 unmigrated records must be migrated on relaunch')

  // Verify all records in IndexedDB: exactly 3 records, all under newOwner, 0 duplicates, 0 lost
  const allRows = await new Promise((res, rej) => {
    const r = db.transaction('records').objectStore('records').getAll()
    r.onsuccess = () => res(r.result)
    r.onerror = rej
  })
  const captureRows = allRows.filter(r => r.id.includes(':capture:'))
  assert.equal(captureRows.length, 3, 'Must contain exactly 3 captures in total (no duplicates, no loss)')
  assert.ok(captureRows.every(r => r.id.startsWith(`${newOwner}:`)), 'All captures must be owned by newOwner')
  assert.equal(allRows.filter(r => r.id.startsWith(`${localOwner}:capture:`)).length, 0, 'No orphaned local captures')

  db.close()
  await resetStorage()
})

test('required approval ignores skip-confirm preferences and replacement cancels', async () => {
  const { confirm, resolveConfirm, onConfirmState } = await import('../src/components/ui/confirmStore.js')
  window.localStorage.setItem('amethyst.ui.v1', JSON.stringify({ confirmDestructive: false }))
  let current
  const off = onConfirmState(value => { current = value })
  const first = confirm({ title: 'Power off', required: true })
  assert.equal(current.title, 'Power off')
  const second = confirm({ title: 'Reboot', required: true })
  assert.equal(await first, false)
  resolveConfirm(false)
  assert.equal(await second, false)
  off()
})

test('dashboard caches preserve desktop layout without exposing it to paired devices', async () => {
  globalThis.localStorage = window.localStorage
  const { removeIdentity } = await import('../src/lib/credentials.js')
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) })
  const { cached, remember } = await import('../src/dashboard/api.js')
  await removeIdentity()
  localStorage.setItem('amethyst.widgets.layout', JSON.stringify({ widgets: [{ id: 'legacy' }] }))
  assert.equal(cached('layout.default').widgets[0].id, 'legacy')
  await saveIdentity({ deviceId: 'phone-a' })
  assert.equal(cached('layout.default'), null)
  remember('layout.mobile', { widgets: [{ id: 'phone-only' }] })
  await saveIdentity({ deviceId: 'phone-b' })
  assert.equal(cached('layout.mobile'), null)
  await saveIdentity({ deviceId: 'phone-a' })
  assert.equal(cached('layout.mobile').widgets[0].id, 'phone-only')
})
