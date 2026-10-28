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
const { saveIdentity } = await import('../src/lib/credentials.js')
const { storeGroupKey, forgetGroupKey } = await import('../src/lib/sync/keystore.js')
const { putRecord, records, clearDeviceRecords } = await import('../src/mobile/storage.js')
const { pairingRoute } = await import('../src/mobile/native.js')

test('offline records are encrypted, durable and isolated by paired device', async () => {
  await saveIdentity({ deviceId: 'a' })
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
  await saveIdentity({ deviceId: 'b' })
  assert.deepEqual(await records(), [])
  await clearDeviceRecords()
  await saveIdentity({ deviceId: 'a' })
  assert.equal((await records()).length, 1)
  await clearDeviceRecords()
  assert.deepEqual(await records(), [])
  await forgetGroupKey()
  await assert.rejects(putRecord('capture:2', {}), /Pair this device/)
  db.close()
})

test('pairing links stay on the local route and discard unknown fields', () => {
  assert.equal(pairingRoute('amethyst://pair?s=secret&r=https%3A%2F%2Fr.example&redirect=https://evil.example'), '/pair#s=secret&r=https%3A%2F%2Fr.example')
  assert.throws(() => pairingRoute('https://evil.example/pair?s=secret'))
  assert.throws(() => pairingRoute('amethyst://pair'))
})

test('unpair invalidates an offline write that has not committed', async () => {
  await saveIdentity({ deviceId: 'race' })
  await storeGroupKey(new Uint8Array(32).fill(8))
  const saving = putRecord('snapshot', { title: 'old account' })
  const rejected = assert.rejects(saving, /pairing changed/)
  await clearDeviceRecords()
  await rejected
  assert.deepEqual(await records(), [])
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
