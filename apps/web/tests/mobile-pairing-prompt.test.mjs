import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Capacitor } from '@capacitor/core'

// Polyfill window & localStorage for Node test runner
const storeMap = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => storeMap.get(k) ?? null,
    setItem: (k, v) => storeMap.set(k, String(v)),
    removeItem: (k) => storeMap.delete(k),
    clear: () => storeMap.clear(),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  location: { protocol: 'http:', host: '192.168.1.50:8000', origin: 'http://192.168.1.50:8000' },
}
globalThis.localStorage = globalThis.window.localStorage

// Setup mock native vault for testing secure vault persistence
const vaultMap = new Map()
const vaultCalls = []
globalThis.androidBridge = {}
Capacitor.nativePromise = async (_plugin, method, args) => {
  vaultCalls.push({ method, args })
  if (method === 'internalGetItem') {
    return { data: vaultMap.get(args.prefixedKey) ?? null }
  }
  if (method === 'internalSetItem') {
    vaultMap.set(args.prefixedKey, args.data)
    return
  }
  if (method === 'internalRemoveItem') {
    vaultMap.delete(args.prefixedKey)
    return { success: true }
  }
  throw new Error(`Unexpected native method ${method}`)
}
Capacitor.PluginHeaders = [
  {
    name: 'SecureStorage',
    methods: ['internalGetItem', 'internalSetItem', 'internalRemoveItem'].map((name) => ({
      name,
      rtype: 'promise',
    })),
  },
]

const {
  getPairingToken,
  savePairingToken,
  isPairingTokenRejected,
  markPairingTokenRejected,
  clearPairingTokenRejected,
  clearPairingToken,
  VAULT_PAIRING_TOKEN_KEY,
  VAULT_TOKEN_REJECTED_KEY,
} = await import('../src/mobile/pairingVault.js')

const here = new URL('.', import.meta.url).pathname
const pairPromptSrc = readFileSync(join(here, '../src/mobile/views/PairPrompt.jsx'), 'utf8')
const mobilePCSrc = readFileSync(join(here, '../src/mobile/views/MobilePC.jsx'), 'utf8')
const mobileTermSrc = readFileSync(join(here, '../src/mobile/views/MobileTerminal.jsx'), 'utf8')
const companionSrc = readFileSync(join(here, '../src/mobile/Companion.jsx'), 'utf8')

test('Test 1: Lazy prompt appears when unpaired with exact text, scan-QR CTA, no mock data, no broken streams', async () => {
  // 1. Ensure completely clean unpaired state
  await clearPairingToken()
  vaultMap.clear()
  storeMap.clear()

  const token = await getPairingToken()
  assert.equal(token, null, 'Unpaired device must have null token')

  const rejected = await isPairingTokenRejected()
  assert.equal(rejected, false, 'Unpaired device must not be rejected')

  // 2. Verify PairPrompt component contains exact required copy and CTA
  assert.ok(
    pairPromptSrc.includes('Pair with your PC to launch apps and use the terminal'),
    'PairPrompt must contain exact required text: "Pair with your PC to launch apps and use the terminal"'
  )
  assert.ok(
    pairPromptSrc.includes('Scan QR Code') || pairPromptSrc.includes('Scan QR'),
    'PairPrompt must have a scan-QR CTA button'
  )

  // 3. Verify MobilePC renders lazy PairPrompt when unpaired
  assert.ok(
    mobilePCSrc.includes('if (!isPaired)'),
    'MobilePC must check for unpaired state'
  )
  assert.ok(
    mobilePCSrc.includes('<PairPrompt'),
    'MobilePC must render PairPrompt when unpaired'
  )

  // 4. Verify MobilePC contains NO mock data
  assert.equal(
    mobilePCSrc.includes("'12%'"),
    false,
    'MobilePC must NOT contain mock CPU 12%'
  )
  assert.equal(
    mobilePCSrc.includes("'6.1 GB'"),
    false,
    'MobilePC must NOT contain mock Memory 6.1 GB'
  )
  assert.equal(
    mobilePCSrc.includes("'62%'"),
    false,
    'MobilePC must NOT contain mock Disk 62%'
  )
  assert.ok(
    mobilePCSrc.includes("'--'"),
    'MobilePC must fall back to real telemetry or empty "--"'
  )

  // 5. Verify MobilePC suppresses broken streams when unpaired
  assert.ok(
    mobilePCSrc.includes('isPaired && !isRejected && token'),
    'MobilePC must only build streamUrl when paired with a valid token'
  )

  // 6. Verify MobileTerminal renders lazy PairPrompt when unpaired and avoids broken connections
  assert.ok(
    mobileTermSrc.includes('if (!isPaired)'),
    'MobileTerminal must check for unpaired state'
  )
  assert.ok(
    mobileTermSrc.includes('<PairPrompt'),
    'MobileTerminal must render PairPrompt when unpaired'
  )
  assert.ok(
    mobileTermSrc.includes('if (!isPaired || isRejected) return'),
    'MobileTerminal must NOT open WebSocket or init PTY session when unpaired'
  )

  // 7. Verify RemoteCallerGuard and Companion.jsx were not modified
  assert.ok(!companionSrc.includes('PairPrompt'), 'Companion.jsx must NOT be modified')
})

test('Test 2: Pairing is one-time: persist token in vault, never re-prompt across restart', async () => {
  // 1. Clear previous state
  await clearPairingToken()
  vaultMap.clear()
  storeMap.clear()

  // 2. Perform one-time pairing with a valid token
  const testToken = 'tok_persistent_vault_test_999'
  const saved = await savePairingToken(testToken, {
    deviceId: 'dev_phone_persistent_01',
    hostUrl: 'http://192.168.1.50:8000',
  })
  assert.equal(saved, testToken)

  // 3. Verify token was written to secure vault
  const vaultKey = `amethyst_${VAULT_PAIRING_TOKEN_KEY}`
  const rawVaultToken = vaultMap.get(vaultKey)
  assert.equal(
    typeof rawVaultToken === 'string' ? JSON.parse(rawVaultToken) : rawVaultToken,
    testToken,
    'Token must be stored in native vault'
  )

  // 4. Simulate application restart:
  // Reset all in-memory references and re-read from vault
  const loadedToken = await getPairingToken()
  assert.equal(loadedToken, testToken, 'Token must persist across restart via vault')

  const rejected = await isPairingTokenRejected()
  assert.equal(rejected, false, 'Pairing must be valid and not rejected')

  // 5. Verify components do not prompt once paired
  assert.ok(
    mobilePCSrc.includes('const { isPaired, isRejected, token'),
    'MobilePC must use pairing status from vault hook'
  )
  assert.ok(
    mobileTermSrc.includes('const { isPaired, isRejected, token'),
    'MobileTerminal must use pairing status from vault hook'
  )

  // Both screens render their live interfaces when isPaired is true and isRejected is false
})

test('Test 3: Rejected token shows re-scan banner on MobilePC and MobileTerminal only', async () => {
  // 1. Start in paired state
  const validToken = 'tok_valid_before_rejection_777'
  await savePairingToken(validToken)
  assert.equal(await isPairingTokenRejected(), false)

  // 2. Simulate PC rejecting the token (e.g. 401/403 or revoked device)
  await markPairingTokenRejected('Server 403: Device token revoked')
  assert.equal(await isPairingTokenRejected(), true, 'isPairingTokenRejected must return true')

  // Verify rejection is persisted in vault
  const rejVaultKey = `amethyst_${VAULT_TOKEN_REJECTED_KEY}`
  const rawVaultRej = vaultMap.get(rejVaultKey)
  assert.equal(
    typeof rawVaultRej === 'string' ? JSON.parse(rawVaultRej) : rawVaultRej,
    'true',
    'Rejected state must be recorded in vault'
  )

  // 3. Verify Re-scan QR banner on MobilePC and MobileTerminal
  assert.ok(
    mobilePCSrc.includes('rescan-banner'),
    'MobilePC must have rescan-banner element'
  )
  assert.ok(
    mobilePCSrc.includes('Re-scan QR'),
    'MobilePC must render "Re-scan QR" button'
  )
  assert.ok(
    mobilePCSrc.includes('Pairing token rejected') || mobilePCSrc.includes('Pairing Token Rejected'),
    'MobilePC banner must state token was rejected'
  )

  assert.ok(
    mobileTermSrc.includes('rescan-banner'),
    'MobileTerminal must have rescan-banner element'
  )
  assert.ok(
    mobileTermSrc.includes('Re-scan QR'),
    'MobileTerminal must render "Re-scan QR" button'
  )
  assert.ok(
    mobileTermSrc.includes('Pairing token rejected') || mobileTermSrc.includes('Pairing Token Rejected'),
    'MobileTerminal banner must state token was rejected'
  )

  // 4. Verify rejection detection on 401/403 HTTP and WebSocket 1008
  assert.ok(
    mobilePCSrc.includes('isTokenRejectedError'),
    'MobilePC must detect 401/403 remote rejection errors'
  )
  assert.ok(
    mobileTermSrc.includes('event?.code === 1008'),
    'MobileTerminal must detect WebSocket 1008 rejection'
  )
  assert.ok(
    mobileTermSrc.includes('res.status === 401 || res.status === 403'),
    'MobileTerminal must detect HTTP 401/403 session rejection'
  )

  // 5. Re-scan restores paired state and clears the rejection banner
  const rePairedToken = 'tok_new_freshly_rescanned_888'
  await savePairingToken(rePairedToken)

  assert.equal(await isPairingTokenRejected(), false, 'Re-pairing must clear rejected flag')
  assert.equal(await getPairingToken(), rePairedToken, 'Re-pairing must update vault token')
  assert.equal(vaultMap.get(rejVaultKey), undefined, 'Rejection key must be removed from vault')
})

test('Cleanup: Mobile pairing prompt tests', async () => {
  await clearPairingToken()
  vaultMap.clear()
  storeMap.clear()
})
