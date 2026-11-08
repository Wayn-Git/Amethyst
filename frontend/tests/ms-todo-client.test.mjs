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
  getConnectionStatus,
  verifyRedirectUri,
  MS_DEFAULT_REDIRECT_URI,
  MS_TOKEN_ENDPOINT,
} = await import('../src/mobile/connectionStatus.js')

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
  assert.equal(verifyRedirectUri(''), MS_DEFAULT_REDIRECT_URI)
  assert.equal(verifyRedirectUri(null), MS_DEFAULT_REDIRECT_URI)
  assert.equal(verifyRedirectUri(undefined), MS_DEFAULT_REDIRECT_URI)

  // Malformed scheme throws
  assert.throws(() => verifyRedirectUri('ftp://invalidscheme.com/cb'), /Unsupported redirect URI protocol/)
})
