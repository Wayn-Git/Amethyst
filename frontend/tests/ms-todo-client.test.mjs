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
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.localStorage = globalThis.window.localStorage

const {
  updateServiceConnection,
  loadConnections,
  getConnectionStatus,
  verifyRedirectUri,
  MS_DEFAULT_REDIRECT_URI,
  MS_TOKEN_ENDPOINT,
  MS_DEVICE_ENDPOINT,
  refreshMicrosoftToken,
  requestFreshBundleFromPc,
  startPhoneDeviceCodeFlow,
  pollPhoneDeviceCodeFlow,
  disconnectMicrosoftTodo,
} = await import('../src/mobile/connectionStatus.js')

const { saveBundle, getBundle, clearBundle } = await import('../src/mobile/bundle.js')

const {
  getTasks,
  createTask,
  completeTask,
  setGraphFetcher,
  clearGraphFetcher,
  GRAPH_BASE_URL,
} = await import('../src/mobile/msTodoClient.js')

test('Test 1: pagination follows @odata.nextLink across pages', async () => {
  storeMap.clear()
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'valid-test-access-token',
    refreshToken: 'valid-test-refresh-token',
    expiresAt: Date.now() + 3600000,
  })

  const calls = []
  setGraphFetcher(async ({ url, method }) => {
    calls.push({ url, method })

    if (url === `${GRAPH_BASE_URL}/me/todo/lists`) {
      return {
        status: 200,
        ok: true,
        data: {
          value: [{ id: 'list_default', displayName: 'Tasks', wellknownListName: 'defaultList' }],
        },
      }
    }

    if (url === `${GRAPH_BASE_URL}/me/todo/lists/list_default/tasks`) {
      return {
        status: 200,
        ok: true,
        data: {
          value: [
            { id: 'task_p1_1', title: 'Task Page 1', status: 'notStarted' },
            { id: 'task_p1_2', title: 'Task Page 1 - Two', status: 'completed' },
          ],
          '@odata.nextLink': `${GRAPH_BASE_URL}/me/todo/lists/list_default/tasks?$skip=2`,
        },
      }
    }

    if (url === `${GRAPH_BASE_URL}/me/todo/lists/list_default/tasks?$skip=2`) {
      return {
        status: 200,
        ok: true,
        data: {
          value: [
            { id: 'task_p2_1', title: 'Task Page 2', status: 'notStarted' },
          ],
        },
      }
    }

    return { status: 404, ok: false, data: { error: { message: 'Not found' } } }
  })

  try {
    const tasks = await getTasks('list_default', { includeCompleted: true })
    assert.equal(tasks.length, 3)
    assert.equal(tasks[0].id, 'task_p1_1')
    assert.equal(tasks[0].title, 'Task Page 1')
    assert.equal(tasks[0].completed, false)
    assert.equal(tasks[1].id, 'task_p1_2')
    assert.equal(tasks[1].completed, true)
    assert.equal(tasks[2].id, 'task_p2_1')
    assert.equal(tasks[2].title, 'Task Page 2')

    // Confirm nextLink was requested
    assert.ok(calls.some((c) => c.url.includes('$skip=2')))
  } finally {
    clearGraphFetcher()
  }
})

test('Test 2: expired token refresh automatically updates access token and fulfills request', async () => {
  storeMap.clear()
  // Expired timestamp
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'stale-token',
    refreshToken: 'valid-refresh-token',
    expiresAt: Date.now() - 5000,
  })

  let refreshCalled = false
  let graphReceivedNewToken = false

  // Mock global fetch to handle token endpoint refresh and Graph API call
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (url === MS_TOKEN_ENDPOINT) {
      refreshCalled = true
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'fresh-access-token-999',
          refresh_token: 'valid-refresh-token',
          expires_in: 3600,
        }),
      }
    }

    if (url.includes('/me/todo/lists')) {
      const authHeader = options.headers?.Authorization || options.headers?.authorization
      if (authHeader === 'Bearer fresh-access-token-999') {
        graphReceivedNewToken = true
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          value: [{ id: 'task_fresh_1', title: 'Refreshed Task', status: 'notStarted' }],
        }),
      }
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    }
  }

  try {
    const tasks = await getTasks('list_custom')
    assert.ok(refreshCalled, 'Token endpoint was called for refresh')
    assert.ok(graphReceivedNewToken, 'Graph API received the fresh access token')
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].title, 'Refreshed Task')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Test 3: 401 after refresh failure shows reconnect state', async () => {
  storeMap.clear()
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'revoked-token',
    refreshToken: 'revoked-refresh-token',
    expiresAt: Date.now() + 100000, // Appears non-expired locally
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url === MS_TOKEN_ENDPOINT) {
      // Refresh fails with 400 invalid_grant
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'The refresh token has expired or been revoked.',
        }),
      }
    }

    if (url.includes('/me/todo/lists')) {
      // Graph rejects with 401
      return {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: { code: 'InvalidAuthenticationToken', message: 'Access token expired' },
        }),
      }
    }

    return { ok: false, status: 500 }
  }

  try {
    let thrownError = null
    try {
      await getTasks('list_custom')
    } catch (err) {
      thrownError = err
    }

    assert.ok(thrownError, 'getTasks threw an error on failed 401 refresh')
    assert.equal(thrownError.code, 'TOKEN_EXPIRED')

    // Verify connection state transitioned to reconnect state ('expired')
    const conn = getConnectionStatus()
    assert.equal(conn.microsoftTodo, 'expired')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Test 4: create and complete tasks call proper Graph endpoints and update status', async () => {
  storeMap.clear()
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'valid-test-access-token',
    refreshToken: 'valid-test-refresh-token',
    expiresAt: Date.now() + 3600000,
  })

  const calls = []
  setGraphFetcher(async ({ url, method, data }) => {
    calls.push({ url, method, data })

    if (method === 'POST' && url.includes('/tasks')) {
      return {
        status: 201,
        ok: true,
        data: {
          id: 'created_task_1',
          title: data.title,
          status: 'notStarted',
        },
      }
    }

    if (method === 'PATCH' && url.includes('/tasks/created_task_1')) {
      return {
        status: 200,
        ok: true,
        data: {
          id: 'created_task_1',
          title: 'Created Task',
          status: data.status,
        },
      }
    }

    return { status: 404, ok: false }
  })

  try {
    const created = await createTask({ title: 'Created Task', listId: 'list_123' })
    assert.equal(created.id, 'created_task_1')
    assert.equal(created.title, 'Created Task')
    assert.equal(created.completed, false)

    const completed = await completeTask('list_123', 'created_task_1', true)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.completed, true)

    const uncompleted = await completeTask('list_123', 'created_task_1', false)
    assert.equal(uncompleted.status, 'todo')
    assert.equal(uncompleted.completed, false)

    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[1].method, 'PATCH')
    assert.equal(calls[1].data.status, 'completed')
    assert.equal(calls[2].method, 'PATCH')
    assert.equal(calls[2].data.status, 'notStarted')
  } finally {
    clearGraphFetcher()
  }
})

test('Test 5: redirect URI verification handles valid, default, and invalid inputs', () => {
  assert.equal(
    verifyRedirectUri('http://localhost:8000/api/auth/microsoft/callback'),
    'http://localhost:8000/api/auth/microsoft/callback'
  )
  assert.equal(
    verifyRedirectUri('https://app.amethyst.dev/auth/callback'),
    'https://app.amethyst.dev/auth/callback'
  )
  assert.equal(
    verifyRedirectUri('app.amethyst.companion://auth/callback'),
    'app.amethyst.companion://auth/callback'
  )

  // Empty or undefined falls back to MS_DEFAULT_REDIRECT_URI
  assert.equal(MS_DEFAULT_REDIRECT_URI, 'app.amethyst.companion://auth')
  assert.equal(verifyRedirectUri(''), MS_DEFAULT_REDIRECT_URI)
  assert.equal(verifyRedirectUri(null), MS_DEFAULT_REDIRECT_URI)
  assert.equal(verifyRedirectUri(undefined), MS_DEFAULT_REDIRECT_URI)

  // Malformed scheme throws
  assert.throws(() => verifyRedirectUri('ftp://invalidscheme.com/cb'), /Unsupported redirect URI protocol/)
})

test('Test 6: handoff on pair: bundle with microsoft credentials stores in vault and sets connected with no sign-in', async () => {
  storeMap.clear()
  await clearBundle()

  const pairingBundle = {
    device_id: 'phone_handoff_test_01',
    llm: {
      providers: [{ provider: 'anthropic', model: 'claude-3-5-sonnet', api_key: 'sk-ant-test' }],
      default: 0,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      api_key: 'sk-ant-test',
    },
    composio: { api_key: 'comp_test_key', user_id: 'user_01' },
    drive: { root_folder_id: 'root_123', inbox_folder_id: 'inbox_456' },
    prompts: { summary: 'Concise summary' },
    microsoft: {
      refresh_token: 'handoff-refresh-token-xyz',
      access_token: 'handoff-access-token-abc',
      account_id: 'ms-account-12345',
      email: 'user@example.com',
      scopes: 'Tasks.ReadWrite offline_access',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  }

  // Simulate receiving pairing bundle on phone
  await saveBundle(pairingBundle)

  // Verify phone vault has credentials and status is connected with zero sign-in steps
  const status = getConnectionStatus()
  assert.equal(status.microsoftTodo, 'connected')

  // Verify vault has full token bundle
  const conn = await (await import('../src/mobile/connectionStatus.js')).loadConnections()
  assert.equal(conn.microsoftTodo?.refreshToken, 'handoff-refresh-token-xyz')
  assert.equal(conn.microsoftTodo?.accessToken, 'handoff-access-token-abc')
  assert.equal(conn.microsoftTodo?.email, 'user@example.com')
  assert.equal(conn.microsoftTodo?.accountId, 'ms-account-12345')
})

test('Test 7: phone works with PC off after handoff: refreshes directly against login.microsoftonline.com and calls Graph', async () => {
  storeMap.clear()
  await clearBundle()

  // Phone was paired and received Microsoft bundle, but PC is now completely OFF (safeStorage pc_host is unreachable)
  globalThis.window.localStorage.setItem('amethyst.pc_host', 'http://192.168.1.99:9999')

  const pairingBundle = {
    device_id: 'phone_pc_off_01',
    llm: {
      providers: [{ provider: 'anthropic', model: 'claude-3-5-sonnet', api_key: 'sk-ant-test' }],
      default: 0,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      api_key: 'sk-ant-test',
    },
    composio: { api_key: 'comp_test_key', user_id: 'user_01' },
    drive: { root_folder_id: 'root_123', inbox_folder_id: 'inbox_456' },
    prompts: { summary: 'Concise summary' },
    microsoft: {
      refresh_token: 'rt-device-pc-off',
      access_token: 'stale-access-token',
      expires_at: Math.floor(Date.now() / 1000) - 100, // Expired: forces refresh directly
      scopes: 'Tasks.ReadWrite offline_access',
    },
  }
  await saveBundle(pairingBundle)

  // Unpair phone from PC to prove complete decoupling!
  await clearBundle()

  let msTokenEndpointCalled = false
  let graphEndpointCalled = false
  let pcEndpointCalled = false

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('192.168.1.99')) {
      pcEndpointCalled = true
      throw new Error('ECONNREFUSED - PC is powered off')
    }

    if (url === MS_TOKEN_ENDPOINT) {
      msTokenEndpointCalled = true
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'fresh-standalone-token-888',
          refresh_token: 'rt-device-pc-off-renewed',
          expires_in: 3600,
        }),
      }
    }

    if (url.includes('/me/todo/lists')) {
      const authHeader = options.headers?.Authorization || options.headers?.authorization
      if (authHeader === 'Bearer fresh-standalone-token-888') {
        graphEndpointCalled = true
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          value: [{ id: 'task_standalone', title: 'Work Done Standalone' }],
        }),
      }
    }

    return { ok: false, status: 404, json: async () => ({}) }
  }

  try {
    const tasks = await getTasks('list_custom')
    assert.ok(msTokenEndpointCalled, 'Phone refreshed directly against login.microsoftonline.com')
    assert.ok(graphEndpointCalled, 'Phone queried graph.microsoft.com directly with fresh token')
    assert.equal(pcEndpointCalled, false, 'PC was never called for token access')
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].title, 'Work Done Standalone')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Test 8: rotation conflict (invalid_grant) falls back to direct device code sign-in', async () => {
  storeMap.clear()
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'stale-token',
    refreshToken: 'conflict-refresh-token',
    expiresAt: Date.now() - 5000,
  })

  // Mock token refresh returning invalid_grant, and device code endpoints working PC-off
  const originalFetch = globalThis.fetch
  let deviceCodeStarted = false
  let deviceCodePolled = false

  globalThis.fetch = async (url, options = {}) => {
    // 1. Refresh fails with invalid_grant
    if (url === MS_TOKEN_ENDPOINT && options.body?.includes('grant_type=refresh_token')) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'The refresh token was rotated or revoked.',
        }),
      }
    }

    // 2. Direct device code start
    if (url === MS_DEVICE_ENDPOINT) {
      deviceCodeStarted = true
      return {
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'mock-dev-code-123',
          user_code: 'XYZ-123',
          verification_uri: 'https://microsoft.com/devicelogin',
          expires_in: 900,
          interval: 5,
        }),
      }
    }

    // 3. Direct device code poll
    if (url === MS_TOKEN_ENDPOINT && options.body?.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code')) {
      deviceCodePolled = true
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'device-recovered-token-555',
          refresh_token: 'device-recovered-refresh-777',
          expires_in: 3600,
        }),
      }
    }

    return { ok: false, status: 404 }
  }

  try {
    // Refresh attempt triggers invalid_grant
    let refreshErr = null
    try {
      await refreshMicrosoftToken()
    } catch (e) {
      refreshErr = e
    }
    assert.ok(refreshErr, 'refresh throws on invalid_grant')
    assert.equal(refreshErr.isInvalidGrant, true)
    assert.equal(refreshErr.requiresDeviceCode, true)
    assert.equal(getConnectionStatus().microsoftTodo, 'expired')

    // Direct device code recovery (PC is off, client calls Microsoft directly)
    const deviceStart = await startPhoneDeviceCodeFlow()
    assert.ok(deviceCodeStarted, 'Device code flow started directly against Microsoft')
    assert.equal(deviceStart.userCode, 'XYZ-123')
    assert.equal(deviceStart.deviceCode, 'mock-dev-code-123')

    const pollRes = await pollPhoneDeviceCodeFlow({ deviceCode: deviceStart.deviceCode })
    assert.ok(deviceCodePolled, 'Device code polled directly against Microsoft')
    assert.equal(pollRes.connected, true)
    assert.equal(getConnectionStatus().microsoftTodo, 'connected')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Test 9: optional PC re-request skipped when PC unreachable without blocking or looping', async () => {
  storeMap.clear()
  globalThis.window.localStorage.setItem('amethyst.pc_host', 'http://192.168.1.200:8000')

  let pcAttempts = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url.includes('192.168.1.200')) {
      pcAttempts++
      throw new Error('Connection refused / host unreachable')
    }
    if (url === MS_TOKEN_ENDPOINT) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Rotated token',
        }),
      }
    }
    return { ok: false, status: 404 }
  }

  try {
    await updateServiceConnection('microsoftTodo', {
      refreshToken: 'stale-rt',
      expiresAt: Date.now() - 1000,
    })

    const t0 = Date.now()
    let thrown = null
    try {
      await refreshMicrosoftToken()
    } catch (e) {
      thrown = e
    }
    const elapsed = Date.now() - t0

    assert.ok(thrown)
    assert.equal(thrown.isInvalidGrant, true)
    assert.equal(pcAttempts, 1, 'Only attempted PC once, never looped')
    assert.ok(elapsed < 2000, 'Never blocked for long when PC was unreachable')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Test 10: disconnect action clears bundle on both devices (best-effort on PC if offline)', async () => {
  storeMap.clear()
  await updateServiceConnection('microsoftTodo', {
    accessToken: 'active-tok',
    refreshToken: 'active-rt',
    expiresAt: Date.now() + 3600000,
  })
  assert.equal(getConnectionStatus().microsoftTodo, 'connected')

  // Case 1: PC online receives disconnect
  globalThis.window.localStorage.setItem('amethyst.pc_host', 'http://192.168.1.50:8000')
  let pcDisconnectCalled = false

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/auth/microsoft/disconnect')) {
      pcDisconnectCalled = true
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: false, status: 404 }
  }

  try {
    await disconnectMicrosoftTodo()
    assert.ok(pcDisconnectCalled, 'PC notified on disconnect')
    assert.equal(getConnectionStatus().microsoftTodo, 'missing')

    // Case 2: PC offline doesn't crash disconnect
    await updateServiceConnection('microsoftTodo', {
      accessToken: 'active-tok-2',
      refreshToken: 'active-rt-2',
      expiresAt: Date.now() + 3600000,
    })
    globalThis.fetch = async () => {
      throw new Error('Host unreachable (PC is off)')
    }

    await disconnectMicrosoftTodo()
    assert.equal(getConnectionStatus().microsoftTodo, 'missing')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Test 11: Risk c: re-pair safety: phone with existing token + pairing payload with no MS bundle -> vault still has the token', async () => {
  storeMap.clear()
  const { saveBundle, getBundle } = await import('../src/mobile/bundle.js')

  // Phone already has Microsoft connection & tokens from previous handoff
  const initialBundle = {
    device_id: 'phone-001',
    llm: {
      providers: [{ provider: 'anthropic', model: 'claude', api_key: 'key' }],
      default: 0,
      provider: 'anthropic',
      model: 'claude',
      api_key: 'key',
    },
    composio: { api_key: 'comp-key', user_id: 'comp-uid' },
    drive: { root_folder_id: 'rfid', inbox_folder_id: 'ifid' },
    prompts: { summary: 'concise summary' },
    microsoft: {
      refreshToken: 'existing-valid-phone-refresh-token',
      accessToken: 'existing-phone-access-token',
      email: 'user@phone.com',
      expiresAt: Date.now() + 3600000,
    },
  }

  await saveBundle(initialBundle)
  assert.equal(getConnectionStatus().microsoftTodo, 'connected')

  const conns1 = await loadConnections()
  assert.equal(conns1.microsoftTodo.refreshToken, 'existing-valid-phone-refresh-token')

  // PC and phone pair again later while PC is in handed_off state (payload has NO microsoft bundle)
  const rePairBundleWithoutMs = {
    device_id: 'phone-001',
    llm: {
      providers: [{ provider: 'anthropic', model: 'claude', api_key: 'key' }],
      default: 0,
      provider: 'anthropic',
      model: 'claude',
      api_key: 'key',
    },
    composio: { api_key: 'comp-key', user_id: 'comp-uid' },
    drive: { root_folder_id: 'rfid', inbox_folder_id: 'ifid' },
    prompts: { summary: 'concise summary' },
  }

  await saveBundle(rePairBundleWithoutMs)

  // Assert: Vault still retains the valid Microsoft token!
  const conns2 = await loadConnections()
  assert.equal(conns2.microsoftTodo.refreshToken, 'existing-valid-phone-refresh-token')
  assert.equal(getConnectionStatus().microsoftTodo, 'connected')

  const retrievedBundle = await getBundle()
  assert.ok(retrievedBundle.microsoft)
  assert.equal(retrievedBundle.microsoft.refreshToken, 'existing-valid-phone-refresh-token')
})

