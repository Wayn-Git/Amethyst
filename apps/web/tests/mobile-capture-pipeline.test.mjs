import test from 'node:test'
import assert from 'node:assert/strict'

// Polyfill window.localStorage for Node test environment
if (typeof globalThis.window === 'undefined') {
  const store = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
  }
  globalThis.localStorage = globalThis.window.localStorage
}

import {
  enqueueSave,
  loadSavedItems,
  persistSavedItems,
  resumePendingPipelineItems,
  SAVED_ITEMS_STORAGE_KEY,
} from '../src/mobile/capturePipeline.js'
import { safeStorage } from '../src/lib/storage.js'

test('Capture Pipeline: Write-First Immediate Enqueue (<500ms)', async () => {
  safeStorage.removeItem(SAVED_ITEMS_STORAGE_KEY)

  const t0 = Date.now()
  const item = await enqueueSave('https://www.instagram.com/reel/DV79WToDXwb/')
  const duration = Date.now() - t0

  assert.ok(duration < 500, `Enqueue took ${duration}ms, must be <500ms`)
  assert.equal(item.status, 'queued')
  assert.equal(typeof item.id, 'string')
  assert.equal(item.id.length, 16)

  const itemsInStorage = loadSavedItems()
  assert.equal(itemsInStorage.length, 1)
  assert.equal(itemsInStorage[0].id, item.id)
})

test('Capture Pipeline: Deduplication on Duplicate Share', async () => {
  safeStorage.removeItem(SAVED_ITEMS_STORAGE_KEY)

  const item1 = await enqueueSave('https://www.instagram.com/p/Dfg7exjmqI2/')
  const item2 = await enqueueSave('https://www.instagram.com/p/Dfg7exjmqI2/')

  assert.equal(item1.id, item2.id)
  const items = loadSavedItems()
  assert.equal(items.length, 1)
})

test('Capture Pipeline: Auto-Resume Items Stuck in Processing on Relaunch', () => {
  const stuckItems = [
    {
      id: 'abc1234567890def',
      url: 'https://www.instagram.com/reel/test/',
      status: 'processing',
      progress: 'Fetching metadata…',
    },
    {
      id: 'ready1234567890a',
      url: 'https://www.instagram.com/reel/ready/',
      status: 'ready',
      progress: 'Done',
    },
  ]
  persistSavedItems(stuckItems)

  const resumed = resumePendingPipelineItems()
  const stuck = resumed.find((i) => i.id === 'abc1234567890def')
  assert.equal(stuck.status, 'queued')
  assert.match(stuck.progress, /Resuming/)

  const ready = resumed.find((i) => i.id === 'ready1234567890a')
  assert.equal(ready.status, 'ready')
})
