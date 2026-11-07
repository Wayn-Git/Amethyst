import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeAndValidateQr,
  pairDevice,
} from '../src/mobile/pairingClient.js'
import {
  getBundle,
  saveBundle,
  clearBundle,
  hasBundle,
  loadFixtureBundle,
  BUNDLE_FIXTURE,
} from '../src/mobile/bundle.js'

function toBase64Url(obj) {
  const json = JSON.stringify(obj)
  return Buffer.from(json)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

test('CONTRACT v2 QR decoding and validation', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 120
  const validPayload = {
    v: 2,
    hosts: ['192.168.1.5', '10.0.0.12'],
    port: 8443,
    token: '128bitrandomtokenstringhere12345',
    fp: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
    exp: futureExp,
  }

  // 1. Valid base64url encoded QR
  const b64url = toBase64Url(validPayload)
  const decoded = decodeAndValidateQr(b64url)
  assert.equal(decoded.v, 2)
  assert.deepEqual(decoded.hosts, ['192.168.1.5', '10.0.0.12'])
  assert.equal(decoded.port, 8443)
  assert.equal(decoded.token, '128bitrandomtokenstringhere12345')
  assert.equal(decoded.fp, validPayload.fp)
  assert.equal(decoded.exp, futureExp)

  // 2. Direct JSON format
  const fromJson = decodeAndValidateQr(JSON.stringify(validPayload))
  assert.equal(fromJson.v, 2)
  assert.equal(fromJson.port, 8443)

  // 3. Normalized fingerprint with colons
  const withColons = {
    ...validPayload,
    fp: 'A1:B2:C3:D4:E5:F6:78:90:A1:B2:C3:D4:E5:F6:78:90:A1:B2:C3:D4:E5:F6:78:90:A1:B2:C3:D4:E5:F6:78:90',
  }
  const decodedColons = decodeAndValidateQr(toBase64Url(withColons))
  assert.equal(decodedColons.fp, validPayload.fp)

  // 4. Wrong version rejection
  assert.throws(
    () => decodeAndValidateQr(toBase64Url({ ...validPayload, v: 1 })),
    (err) => err.code === 'WRONG_VERSION' && err.message.includes('expected v2')
  )
  assert.throws(
    () => decodeAndValidateQr(toBase64Url({ ...validPayload, v: 3 })),
    (err) => err.code === 'WRONG_VERSION'
  )

  // 5. Expired QR rejection
  const pastExp = Math.floor(Date.now() / 1000) - 10
  assert.throws(
    () => decodeAndValidateQr(toBase64Url({ ...validPayload, exp: pastExp })),
    (err) => err.code === 'EXPIRED_QR' && err.message.includes('expired')
  )

  // 6. Bad scan / invalid formats
  assert.throws(() => decodeAndValidateQr(''), (err) => err.code === 'BAD_SCAN')
  assert.throws(() => decodeAndValidateQr('not-json-or-base64-???'), (err) => err.code === 'BAD_SCAN')
  assert.throws(() => decodeAndValidateQr(toBase64Url({ ...validPayload, hosts: [] })), (err) => err.code === 'BAD_SCAN')
  assert.throws(() => decodeAndValidateQr(toBase64Url({ ...validPayload, port: -1 })), (err) => err.code === 'BAD_SCAN')
  assert.throws(() => decodeAndValidateQr(toBase64Url({ ...validPayload, token: '' })), (err) => err.code === 'BAD_SCAN')
  assert.throws(() => decodeAndValidateQr(toBase64Url({ ...validPayload, fp: 'short' })), (err) => err.code === 'BAD_SCAN')
})

test('CONTRACT v2 bundle storage and retrieval in Keystore/Keychain', async () => {
  await clearBundle()
  assert.equal(await getBundle(), null)
  assert.equal(await hasBundle(), false)

  const testBundle = {
    device_id: 'dev_test_phone_99',
    llm: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      api_key: 'sk-ant-test-key-secret',
    },
    composio: {
      api_key: 'comp_test_key_secret',
      user_id: 'user_test_99',
    },
    drive: {
      root_folder_id: 'drive_root_folder_99',
      inbox_folder_id: 'drive_inbox_folder_99',
    },
    prompts: {
      summary: 'Summarize test prompt',
    },
  }

  await saveBundle(testBundle)
  assert.equal(await hasBundle(), true)

  const retrieved = await getBundle()
  assert.deepEqual(retrieved, testBundle)

  // Clear bundle
  await clearBundle()
  assert.equal(await getBundle(), null)
  assert.equal(await hasBundle(), false)
})

test('Fixture bundle for sessions D and E', async () => {
  await clearBundle()

  // Validate fixture structure against CONTRACT v2 schema
  assert.ok(BUNDLE_FIXTURE.device_id, 'Fixture must have device_id')
  assert.ok(BUNDLE_FIXTURE.llm.provider, 'Fixture must have llm.provider')
  assert.ok(BUNDLE_FIXTURE.llm.model, 'Fixture must have llm.model')
  assert.ok(BUNDLE_FIXTURE.llm.api_key, 'Fixture must have llm.api_key')
  assert.ok(BUNDLE_FIXTURE.composio.api_key, 'Fixture must have composio.api_key')
  assert.ok(BUNDLE_FIXTURE.composio.user_id, 'Fixture must have composio.user_id')
  assert.ok(BUNDLE_FIXTURE.drive.root_folder_id, 'Fixture must have drive.root_folder_id')
  assert.ok(BUNDLE_FIXTURE.drive.inbox_folder_id, 'Fixture must have drive.inbox_folder_id')
  assert.ok(BUNDLE_FIXTURE.prompts.summary, 'Fixture must have prompts.summary')

  // Load fixture bundle
  const loaded = await loadFixtureBundle()
  assert.deepEqual(loaded, BUNDLE_FIXTURE)
  assert.deepEqual(await getBundle(), BUNDLE_FIXTURE)

  await clearBundle()
})

test('Host probing with 3s timeout and approval handling', async () => {
  await clearBundle()

  const qrPayload = {
    v: 2,
    hosts: ['192.168.1.100', '192.168.1.101'],
    port: 8443,
    token: 'test_token_123',
    fp: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
    exp: Math.floor(Date.now() / 1000) + 120,
  }

  const originalFetch = globalThis.fetch
  const calls = []
  const statusHistory = []

  // Case 1: First host fails, second host approves
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts })
    if (url.includes('192.168.1.100')) {
      throw new Error('Connection refused')
    }
    if (url.includes('192.168.1.101')) {
      return {
        status: 200,
        json: async () => BUNDLE_FIXTURE,
      }
    }
    throw new Error('Unknown host')
  }

  const result = await pairDevice({
    qrPayload,
    deviceLabel: 'Test Phone',
    onStatusChange: (status) => statusHistory.push(status),
  })

  assert.deepEqual(result, BUNDLE_FIXTURE)
  assert.ok(calls.length === 2, 'Should have tried host 1 then host 2')
  assert.ok(statusHistory.includes('connecting'))
  assert.ok(statusHistory.includes('waiting_approval'))
  assert.deepEqual(await getBundle(), BUNDLE_FIXTURE)

  await clearBundle()

  // Case 2: No hosts respond -> exact error string
  calls.length = 0
  globalThis.fetch = async () => {
    throw new Error('Network unreachable')
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => {
      return (
        err.code === 'NO_HOST_RESPONDED' &&
        err.message === 'Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.'
      )
    }
  )

  // Case 3: PC Denies request (403)
  globalThis.fetch = async (url) => {
    if (url.includes('192.168.1.100')) {
      return {
        status: 403,
        json: async () => ({ error: 'denied' }),
      }
    }
    throw new Error('Should not reach second host')
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => err.code === 'DENIED' && err.message.includes('denied')
  )

  // Case 4: Token rejected / expired (401)
  globalThis.fetch = async (url) => {
    if (url.includes('192.168.1.100')) {
      return {
        status: 401,
        json: async () => ({ error: 'unauthorized' }),
      }
    }
    throw new Error('Should not reach second host')
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => err.code === 'INVALID_TOKEN'
  )

  // Case 5: Connected but PC times out waiting for user approval (HTTP 408)
  globalThis.fetch = async (url) => {
    if (url.includes('192.168.1.100')) {
      return {
        status: 408,
        json: async () => ({ error: 'approval_timeout' }),
      }
    }
    throw new Error('Should not reach second host')
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => err.code === 'APPROVAL_TIMEOUT' && err.message.includes('timed out')
  )

  // Case 6: Connection refused on all hosts -> CONNECTION_REFUSED with triedSummary
  globalThis.fetch = async () => {
    throw new Error('ConnectException: Connection refused')
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => {
      assert.equal(err.code, 'CONNECTION_REFUSED')
      assert.equal(err.port, 8443)
      assert.ok(err.triedSummary.includes('192.168.1.100:8443 (ConnectException: Connection refused)'))
      assert.ok(err.triedSummary.includes('192.168.1.101:8443 (ConnectException: Connection refused)'))
      // Verify token is never in triedSummary or error message
      assert.ok(!err.triedSummary.includes(qrPayload.token))
      assert.ok(!err.message.includes(qrPayload.token))
      return true
    }
  )

  // Case 7: Connect timeout on all hosts -> CONNECT_TIMEOUT
  globalThis.fetch = async () => {
    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    throw abortErr
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => {
      assert.equal(err.code, 'CONNECT_TIMEOUT')
      assert.equal(err.port, 8443)
      assert.ok(err.triedSummary.includes('192.168.1.100:8443 (Connect timed out)'))
      assert.ok(!err.triedSummary.includes(qrPayload.token))
      return true
    }
  )

  // Case 8: Too many attempts -> HTTP 429 TOO_MANY_ATTEMPTS
  globalThis.fetch = async (url) => {
    if (url.includes('192.168.1.100')) {
      return {
        status: 429,
        json: async () => ({ error: 'max_attempts_exceeded' }),
      }
    }
    throw new Error('Should not reach second host')
  }

  await assert.rejects(
    async () => {
      await pairDevice({
        qrPayload,
        deviceLabel: 'Test Phone',
      })
    },
    (err) => {
      assert.equal(err.code, 'TOO_MANY_ATTEMPTS')
      assert.ok(err.message.includes('Too many failed pairing attempts'))
      return true
    }
  )

  // Restore fetch
  globalThis.fetch = originalFetch
  await clearBundle()
})

test('Paired screen displays model and Drive folder, never keys', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const here = new URL('.', import.meta.url).pathname
  const source = readFileSync(join(here, '../src/mobile/views/MobilePaired.jsx'), 'utf8')

  // Verify visible fields logic
  assert.ok(source.includes('bundle?.llm?.model'), 'Model name must be bound from bundle')
  assert.ok(source.includes('bundle?.drive?.root_folder_id'), 'Drive folder root ID must be bound from bundle')
  assert.ok(source.includes('Unpair Device'), 'Unpair button text must be present')
  assert.ok(source.includes('clearBundle'), 'Unpair must call clearBundle()')

  // CRITICAL SECURITY INVARIANT: Keys and tokens must NEVER be read, rendered or referenced
  assert.equal(source.includes('api_key'), false, 'LLM and Composio api_key must NEVER be referenced in Paired view')
  assert.equal(source.includes('.token'), false, 'Pairing token must NEVER be referenced in Paired view')
})

test('Zero manual entry: No HTTP Shortcuts, manual URL or token fields in pairing view', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const here = new URL('.', import.meta.url).pathname
  const pairSource = readFileSync(join(here, '../src/views/Pair.jsx'), 'utf8')
  const scannerSource = readFileSync(join(here, '../src/components/QrScanner.jsx'), 'utf8')

  // No manual token, header, or URL text inputs in Pair flow
  assert.equal(pairSource.includes('input type="text"'), false, 'Pair view must not contain manual text input')
  assert.equal(pairSource.includes('HTTP Shortcuts'), false, 'Pair view must not reference HTTP Shortcuts')
  assert.equal(scannerSource.includes('onManual'), false, 'QrScanner must not contain manual code entry prop')
  assert.equal(scannerSource.includes('enter code manually'), false, 'QrScanner must not prompt for manual entry')
})

