import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptPayload, decryptPayload, secureStoreItem, secureGetItem } from '../src/lib/cryptoStorage.js'

test('encryptPayload encrypts data and decryptPayload recovers original structure', async () => {
  const secretData = {
    apiKey: 'sk-ant-test-secret-1234567890',
    token: 'tok_live_device_secret_abcdef',
    providers: [{ name: 'anthropic', key: 'live-key-xyz' }],
  }

  const encrypted = await encryptPayload(secretData)
  assert.equal(typeof encrypted, 'string')
  // Verify secrets are NOT visible in plaintext
  assert.ok(!encrypted.includes('sk-ant-test-secret-1234567890'))
  assert.ok(!encrypted.includes('live-key-xyz'))
  assert.ok(encrypted.includes('__amethyst_enc'))

  const decrypted = await decryptPayload(encrypted)
  assert.deepEqual(decrypted, secretData)
})

test('decryptPayload seamlessly handles legacy unencrypted JSON', async () => {
  const legacyData = {
    hostUrl: 'http://192.168.1.100:8000',
    token: 'legacy_unencrypted_token',
  }
  const plainJson = JSON.stringify(legacyData)

  const result = await decryptPayload(plainJson)
  assert.deepEqual(result, legacyData)
})

test('secureStoreItem and secureGetItem work end-to-end with localStorage mock', async () => {
  const storage = new Map()
  const mockStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  }

  const credentials = {
    device_id: 'phone_01',
    llm: { provider: 'anthropic', api_key: 'super-secret-key' },
  }

  await secureStoreItem('amethyst.v2.bundle', credentials, mockStorage)

  // Verify stored value in raw storage is encrypted
  const rawStored = storage.get('amethyst.v2.bundle')
  assert.ok(!rawStored.includes('super-secret-key'))

  // Verify secureGetItem retrieves the decrypted credentials perfectly
  const retrieved = await secureGetItem('amethyst.v2.bundle', mockStorage)
  assert.deepEqual(retrieved, credentials)
})

