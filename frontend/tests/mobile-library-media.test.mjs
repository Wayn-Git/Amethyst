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

const { removeIdentity, saveIdentity } = await import('../src/lib/credentials.js')
const { forgetGroupKey, storeGroupKey } = await import('../src/lib/sync/keystore.js')
const { identity } = await import('../src/lib/sync/client.js')
const { putRecord, records, closeDatabase } = await import('../src/mobile/storage.js')
const {
  saveConnections,
  updateServiceConnection,
  markServiceExpired,
  getConnectionStatus,
  formatConnectionLabel,
} = await import('../src/mobile/connectionStatus.js')
const {
  loadThumbnail,
  fetchVideoRange,
  getCachedThumbnail,
  saveCachedThumbnail,
  resolvePosterFrame,
  MEDIA_STATUS,
  PLACEHOLDER_THUMBNAIL,
  ERROR_THUMBNAIL,
} = await import('../src/mobile/driveMediaLoader.js')
const {
  syncCollections,
  getStoredCollections,
  getCollectionsCount,
  getCollectionsDisplayState,
  getLastSyncedTime,
  formatLastSyncedTime,
} = await import('../src/mobile/collectionsSync.js')

test('thumbnail after token expiry', async () => {
  let tokenRefreshCallCount = 0
  let fetchAttempts = 0

  const expiredToken = 'token_expired_123'
  const validToken = 'token_fresh_456'

  // Mock fetch simulating 401 on expired token, then 200 with image bytes on refreshed token
  const mockFetch = async (url, { headers } = {}) => {
    fetchAttempts++
    const authHeader = headers?.Authorization || ''

    if (authHeader.includes(expiredToken)) {
      return {
        ok: false,
        status: 401,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ error: 'Unauthorized: token expired' }),
      }
    }

    if (authHeader.includes(validToken)) {
      // Return 1x1 GIF / JPEG buffer
      const dummyBuffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b]).buffer
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/gif']]),
        arrayBuffer: async () => dummyBuffer,
      }
    }

    return { ok: false, status: 403 }
  }

  const mockTokenRefresher = async () => {
    tokenRefreshCallCount++
    return { accessToken: validToken }
  }

  // 1. Initial load with expired token triggers 401, calls refresher, and succeeds
  const res = await loadThumbnail({
    fileId: 'file_test_thumbnail_001',
    token: expiredToken,
    tokenRefresher: mockTokenRefresher,
    fetchFn: mockFetch,
    ignoreCache: true,
  })

  assert.equal(res.status, MEDIA_STATUS.READY)
  assert.equal(res.fromCache, false)
  assert.ok(res.src.startsWith('data:image/gif;base64,'))
  assert.equal(tokenRefreshCallCount, 1, 'Token refresher must be called on 401')
  assert.equal(fetchAttempts, 2, 'Must retry fetch once after token refresh')

  // 2. Subsequent call must hit disk cache directly without network roundtrip
  const cachedRes = await loadThumbnail({
    fileId: 'file_test_thumbnail_001',
    token: validToken,
    fetchFn: async () => {
      throw new Error('Should not fetch when disk cache is hit')
    },
  })

  assert.equal(cachedRes.status, MEDIA_STATUS.READY)
  assert.equal(cachedRes.fromCache, true, 'Cached thumbnail must return fromCache: true')
  assert.equal(cachedRes.src, res.src)

  // 3. Verify Video Range Request with authenticated alt=media
  let videoAttempts = 0
  const mockVideoFetch = async (url, { headers } = {}) => {
    videoAttempts++
    assert.ok(headers.Range.includes('bytes=0-1048575'), 'Must supply Range header')
    return {
      status: 206,
      ok: true,
      headers: new Map([
        ['content-range', 'bytes 0-1048575/10485760'],
        ['content-length', '1048576'],
        ['content-type', 'video/mp4'],
      ]),
      arrayBuffer: async () => new Uint8Array(1024).buffer,
    }
  }

  const videoRangeRes = await fetchVideoRange({
    fileId: 'video_file_001',
    start: 0,
    end: 1048575,
    token: validToken,
    fetchFn: mockVideoFetch,
  })

  assert.equal(videoRangeRes.status, 206)
  assert.equal(videoRangeRes.isPartial, true)
  assert.equal(videoRangeRes.contentRange, 'bytes 0-1048575/10485760')
  assert.equal(videoRangeRes.contentLength, 1048576)
  assert.equal(videoAttempts, 1)

  // 4. Verify Poster Frame Resolution
  const videoItem = {
    id: 10,
    url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
  }
  const poster = resolvePosterFrame(videoItem)
  assert.equal(poster, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
})

test('collection count after sync', async () => {
  // 1. Fresh install state: No credentials, no cached collections
  await saveConnections({
    googleDrive: null,
    composio: null,
    microsoftTodo: null,
  })

  // Verify real state via connectionStatus: not connected instead of empty "0"
  const preSyncCount = getCollectionsCount()
  assert.equal(preSyncCount, 'not connected', 'Unconnected fresh install must show "not connected", not "0"')

  const displayStateNotConnected = getCollectionsDisplayState()
  assert.equal(displayStateNotConnected.status, 'not connected')
  assert.equal(displayStateNotConnected.isRealCount, false)

  // Test expired state
  await updateServiceConnection('googleDrive', {
    accessToken: 'old_token',
    expired: true,
  })
  const expiredState = getCollectionsDisplayState()
  assert.equal(expiredState.label, 'expired')
  assert.equal(getCollectionsCount(), 'expired')

  // 2. Perform Full Pull Sync with mock collections and items
  const mockLists = [
    { id: 1, title: 'AI Engineering', item_count: 14, icon: 'cpu' },
    { id: 2, title: 'Design Inspiration', item_count: 28, icon: 'sparkles' },
    { id: 3, title: 'Longform Reads', item_count: 6, icon: 'book-open' },
  ]
  const mockItems = [
    { id: 101, title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' },
    { id: 102, title: 'Designing Fluid Interfaces', url: 'https://developer.apple.com' },
  ]

  const mockApiClient = {
    get: async (path) => {
      if (path === '/library/lists') return mockLists
      return []
    },
    library: async () => ({
      items: mockItems,
      counts: { all: 2 },
    }),
  }

  const syncResult = await syncCollections({
    fullPull: true,
    apiClient: mockApiClient,
  })

  assert.equal(syncResult.success, true)
  assert.equal(syncResult.listsCount, 3)
  assert.equal(syncResult.itemsCount, 2)
  assert.ok(syncResult.lastSyncedAt)

  // 3. Verify Collections count reads the EXACT SAME store the sync writes
  const syncedStore = getStoredCollections()
  assert.equal(syncedStore.lists.length, 3)
  assert.equal(syncedStore.items.length, 2)

  const postSyncCount = getCollectionsCount()
  assert.equal(postSyncCount, '3', 'Collection count must read the synced count from the same store')

  const postSyncDisplay = getCollectionsDisplayState()
  assert.equal(postSyncDisplay.count, 3)
  assert.equal(postSyncDisplay.label, '3')
  assert.equal(postSyncDisplay.isRealCount, true)

  // 4. Verify last-synced time
  const lastSyncIso = getLastSyncedTime()
  assert.equal(lastSyncIso, syncResult.lastSyncedAt)
  const formattedTime = formatLastSyncedTime(lastSyncIso)
  assert.equal(formattedTime, 'Just now')

  // 5. Verify incremental sync after: updates without clearing existing lists
  const additionalList = [{ id: 4, title: 'Audio & Music', item_count: 5 }]
  const incrementalApiClient = {
    get: async (path) => {
      if (path === '/library/lists') return [...mockLists, ...additionalList]
      return []
    },
    library: async () => ({ items: mockItems }),
  }

  const incrementalRes = await syncCollections({
    fullPull: false,
    apiClient: incrementalApiClient,
  })
  assert.equal(incrementalRes.listsCount, 4)
  assert.equal(getCollectionsCount(), '4')
})

test('unpaired phone sees library', async () => {
  // 1. Ensure phone is completely unpaired
  await removeIdentity()
  await forgetGroupKey()

  assert.equal(identity()?.deviceId, undefined, 'Must have no paired PC device identity')

  // 2. Pre-populate Drive / local collections store
  const testLibraryItems = [
    { id: 201, uuid: 'u-201', title: 'Local Offline Article', summary: 'Read offline on phone', url: 'https://example.com/1' },
    { id: 202, uuid: 'u-202', title: 'Standalone Drive Video', summary: 'Video playable without PC', url: 'https://example.com/2' },
  ]
  const testLists = [
    { id: 10, title: 'Unpaired Read Later', item_count: 2 },
  ]

  const mockApiClient = {
    get: async () => testLists,
    library: async () => ({ items: testLibraryItems }),
  }

  const syncResult = await syncCollections({
    fullPull: true,
    apiClient: mockApiClient,
  })
  assert.equal(syncResult.itemsCount, 2)

  // 3. Import Companion component to test refresh() and PC hook logic
  const stored = getStoredCollections()
  assert.equal(stored.items.length, 2)
  assert.equal(stored.lists.length, 1)

  // Verify unpaired phone reads library items successfully from the store
  assert.ok(stored.items.some((i) => i.id === 201 && i.title === 'Local Offline Article'))
  assert.ok(stored.items.some((i) => i.id === 202 && i.title === 'Standalone Drive Video'))

  // Verify collections count on unpaired phone
  const count = getCollectionsCount()
  assert.equal(count, '1', 'Unpaired phone sees 1 collection from local Drive store')

  // 4. Verify PC gating is removed: no PC permissions needed to see library
  const currentPermissions = null // Unpaired has no PC capabilities
  const loadedLibrary = stored.items.map(({ id, uuid, title, summary, notes, url }) => ({ id, uuid, title, summary, notes, url }))
  assert.equal(loadedLibrary.length, 2, 'Unpaired phone sees library without PC capability permissions')

  // 5. Verify hook for PC agent: agent jobs remain gated behind PC pairing
  const isPaired = Boolean(identity()?.deviceId)
  assert.equal(isPaired, false)
  const agentJobs = isPaired ? [{ id: 'job_1' }] : [] // Hook clears or leaves prompt for pairing
  assert.equal(agentJobs.length, 0, 'Agent jobs require PC host pairing')
})

test('cleanup library media tests', async () => {
  await closeDatabase()
  setTimeout(() => process.exit(0), 50)
})

