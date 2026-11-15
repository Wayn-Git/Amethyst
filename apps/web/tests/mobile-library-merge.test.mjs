import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeOptimisticItems } from '../src/mobile/libraryMerge.js'

const now = () => new Date().toISOString()
const ago = (ms) => new Date(Date.now() - ms).toISOString()

test('keeps a just-created server item while sync has not caught up', () => {
  const created = { id: 42, url: 'https://example.com/reel', status: 'processing', created_at: now() }
  const merged = mergeOptimisticItems([created], [{ id: 1 }, { id: 2 }])
  assert.equal(merged[0].id, 42)
  assert.equal(merged.length, 3)
})

test('drops the pending copy once sync returns the same item', () => {
  const created = { id: 42, url: 'https://example.com/reel', status: 'processing', created_at: now() }
  const merged = mergeOptimisticItems([created], [{ id: 42, url: 'https://example.com/reel', status: 'ready' }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'ready')
})

test('matches by URL when ids differ', () => {
  const temp = { id: 'opt-1', url: 'https://example.com/a', status: 'processing', is_optimistic: true, created_at: now() }
  const merged = mergeOptimisticItems([temp], [{ id: 9, url: 'https://example.com/a' }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 9)
})

test('expires an optimistic card after two minutes', () => {
  const temp = { id: 'opt-1', url: 'https://example.com/a', is_optimistic: true, created_at: ago(121000) }
  const merged = mergeOptimisticItems([temp], [{ id: 1 }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 1)
})

test('expires a stale processing copy after ten minutes', () => {
  const stale = { id: 42, status: 'processing', created_at: ago(601000) }
  const merged = mergeOptimisticItems([stale], [{ id: 1 }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 1)
})

test('does not keep a ready item missing from the sync page', () => {
  const ready = { id: 42, status: 'ready', created_at: now() }
  const merged = mergeOptimisticItems([ready], [{ id: 1 }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 1)
})

test('drops items without a parseable creation time', () => {
  const broken = { id: 42, status: 'processing', created_at: 'not-a-date' }
  const merged = mergeOptimisticItems([broken], [{ id: 1 }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 1)
})

test('keeps current items when the incoming page is empty', () => {
  const current = [{ id: 42, status: 'processing', created_at: now() }]
  assert.deepEqual(mergeOptimisticItems(current, []), current)
})
