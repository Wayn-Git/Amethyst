import { strict as assert } from 'node:assert'

let testCount = 0
let failCount = 0

async function test(name, fn) {
  testCount++
  try {
    await fn()
    console.log(`✔ ${name}`)
  } catch (err) {
    failCount++
    console.error(`✖ ${name}:`, err.message)
  }
}

// Global fetch mock helper
let originalFetch = globalThis.fetch

function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => handler(url, opts)
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

const { TransportManager } = await import('../src/lib/sync/transportManager.js')

await test('probes LAN and sets path to direct when host responds 200', async () => {
  mockFetch(async (url) => {
    if (url.includes('/remote/status')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, host: 'my-pc' }) }
    }
    return { ok: false, status: 404 }
  })

  try {
    const tm = new TransportManager({
      getHostUrl: () => 'http://192.168.1.50:8000',
      getToken: () => 'token-123',
    })

    const path = await tm.probe()
    assert.equal(path, 'direct')
    assert.equal(tm.getState().path, 'direct')
    assert.equal(tm.getState().hostUrl, 'http://192.168.1.50:8000')
    assert.ok(tm.getState().latency >= 0)
  } finally {
    restoreFetch()
  }
})

await test('sets path to offline when LAN probe times out or rejects', async () => {
  mockFetch(async (url) => {
    if (url.includes('/remote/status')) {
      throw new Error('Connection refused / timeout')
    }
    return { ok: false, status: 500 }
  })

  try {
    let notifiedState = null
    const tm = new TransportManager({
      getHostUrl: () => 'http://192.168.1.50:8000',
      getToken: () => 'token-123',
      onStateChange: (state) => { notifiedState = state },
    })

    const path = await tm.probe()
    assert.equal(path, 'offline')
    assert.equal(tm.getState().path, 'offline')
    assert.equal(notifiedState?.path, 'offline')
  } finally {
    restoreFetch()
  }
})

await test('marks offline when no host available', async () => {
  const tm = new TransportManager({
    getHostUrl: () => '',
    getToken: () => '',
  })

  const path = await tm.probe()
  assert.equal(path, 'offline')
  assert.equal(tm.getState().path, 'offline')
})

await test('request routes to hostUrl when direct and throws when offline', async () => {
  const calls = []
  mockFetch(async (url, opts) => {
    calls.push({ url, method: opts?.method || 'GET' })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })

  try {
    const tm = new TransportManager({
      getHostUrl: () => 'http://192.168.1.50:8000',
      getToken: () => 'token-abc',
    })

    tm.forcePath('direct')
    await tm.request('/remote/status')
    assert.equal(calls[calls.length - 1].url, 'http://192.168.1.50:8000/api/remote/status')

    tm.forcePath('offline')
    await assert.rejects(async () => {
      await tm.request('/ops', { method: 'POST' })
    }, /No transport available/)
  } finally {
    restoreFetch()
  }
})

if (failCount > 0) {
  process.exit(1)
} else {
  console.log(`\nAll ${testCount} transportManager tests passed!`)
}
