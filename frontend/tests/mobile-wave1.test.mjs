import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const storeMap = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => storeMap.get(k) ?? null,
    setItem: (k, v) => storeMap.set(k, String(v)),
    removeItem: (k) => storeMap.delete(k),
    clear: () => storeMap.clear(),
  },
}
globalThis.localStorage = globalThis.window.localStorage

// Mock fetch to respond immediately in test
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ job_id: 'job_mock_1', state: 'accepted' }),
})

const { removeIdentity, saveIdentity } = await import('../src/lib/credentials.js')
const { storeGroupKey, forgetGroupKey } = await import('../src/lib/sync/keystore.js')
const {
  putRecord,
  records,
  clearDeviceRecords,
  migrateLocalRecordsToPaired,
  getLocalOwner,
  principal,
  closeDatabase,
} = await import('../src/mobile/storage.js')
const { saveCapture, captures, flushCaptures } = await import('../src/mobile/captures.js')
const {
  getConnectionStatus,
  loadConnections,
  saveConnections,
  updateServiceConnection,
  markServiceExpired,
  generatePkce,
  evaluateServiceStatus,
} = await import('../src/mobile/connectionStatus.js')
const { processJob, stopShareQueue } = await import('../src/mobile/shareQueue.js')

test('Wave 1: Unpaired phone can save and retrieve records standalone', async () => {
  await removeIdentity()
  await forgetGroupKey()

  const p = await principal()
  assert.equal(p.isPaired, false)
  assert.ok(p.owner.startsWith('local_'))
  assert.ok(p.key)

  await putRecord('note:1', { text: 'offline note without pairing' })
  const loaded = await records('note:')
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].value.text, 'offline note without pairing')
})

test('Wave 1: Unpaired phone can save capture without throwing pairing error', async () => {
  await removeIdentity()
  await forgetGroupKey()

  const cap = await saveCapture({
    title: 'Offline Article',
    text: 'Saved while offline and unpaired',
    url: 'https://example.com/test',
  })

  assert.ok(cap.id)
  assert.equal(cap.title, 'Offline Article')
  assert.ok(cap.deviceId.startsWith('local_'))

  const all = await captures()
  assert.ok(all.some((c) => c.id === cap.id && c.title === 'Offline Article'))
})

test('Wave 1: Migration step on pairing re-encrypts under PC group key, re-stamps owner and flushes', async () => {
  await removeIdentity()
  await forgetGroupKey()

  // 1. Save local capture while unpaired
  const localCap = await saveCapture({
    title: 'Pre-pairing capture',
    text: 'Must survive pairing and be flushed',
  })
  assert.ok(localCap.deviceId.startsWith('local_'))

  // 2. Simulate pairing: new PC identity and new group key
  const pcDeviceId = 'dev_pc_host_999'
  const pcKeyBytes = new Uint8Array(32).fill(42)
  const pcKey = await storeGroupKey(pcKeyBytes)
  await saveIdentity({
    deviceId: pcDeviceId,
    token: 'tok_pc_999',
    hostUrl: 'http://192.168.1.50:8000',
  })

  // 3. Run migration
  const migrationResult = await migrateLocalRecordsToPaired(pcDeviceId, pcKey)
  assert.ok(migrationResult.migrated >= 1)

  // 4. Verify record is now stamped with pcDeviceId under paired principal
  const pairedCaptures = await captures()
  const found = pairedCaptures.find((c) => c.id === localCap.id)
  assert.ok(found, 'Pre-pairing capture must exist in paired records')
  assert.equal(found.deviceId, pcDeviceId, 'Pre-pairing capture must be re-stamped with pcDeviceId')

  // Clean up
  await removeIdentity()
  await forgetGroupKey()
})

test('Wave 1: Connection status contract transitions between missing, connected and expired', async () => {
  await saveConnections({
    composio: null,
    googleDrive: null,
    microsoftTodo: null,
  })

  const initialStatus = getConnectionStatus()
  assert.deepEqual(initialStatus, {
    googleDrive: 'missing',
    composio: 'missing',
    microsoftTodo: 'missing',
  })

  // Add Microsoft To Do credentials
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'valid_access_token',
    refreshToken: 'valid_refresh_token',
    expiresAt: Date.now() + 3600000,
  })

  let status = getConnectionStatus()
  assert.equal(status.microsoftTodo, 'connected')

  // Mark expired
  await markServiceExpired('microsoftTodo')
  status = getConnectionStatus()
  assert.equal(status.microsoftTodo, 'expired')

  // PKCE Generation check
  const { verifier, challenge } = await generatePkce()
  assert.ok(verifier.length >= 43)
  assert.ok(challenge.length >= 43)
  assert.notEqual(verifier, challenge)
})

test('Wave 1: shareQueue keeps job queued locally when unpaired without authError', async () => {
  const job = {
    id: 'test_share_unpaired_01',
    route: 'summary',
    url: 'https://example.com/article',
    rawText: 'Test article content',
    attempts: 0,
    state: 'queued',
  }

  // bundleResolver returns null (unpaired)
  const result = await processJob(job, {
    bundleResolver: async () => null,
  })

  assert.equal(result, false)
  assert.equal(job.state, 'queued')
  assert.equal(job.authError, false)
  assert.ok(job.progress.includes('offline') || job.progress.includes('standalone'))
})

test('Wave 1 cleanup', async () => {
  stopShareQueue()
  await closeDatabase()
  setTimeout(() => process.exit(0), 50)
})
