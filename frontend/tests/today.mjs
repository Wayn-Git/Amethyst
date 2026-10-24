import assert from 'node:assert/strict'
import { ageLabel, isLater, rankItems, rankTasks, safeLink } from '../src/views/today/model.js'
const now = new Date('2026-10-24T10:00:00Z')
assert.equal(ageLabel('2026-10-22T10:00:00Z', now), '2d ago')
assert.equal(ageLabel('bad', now), 'Date unavailable')
assert.equal(safeLink('javascript:alert(1)'), null)
assert.equal(safeLink('https://github.com/support'), 'https://github.com/support')
assert.equal(isLater({ state: 'waiting', snoozed_until: '2026-10-24T11:00:00Z' }, now), true)
assert.equal(isLater({ state: 'waiting', snoozed_until: '2026-10-24T09:00:00Z' }, now), false)
assert.equal(isLater({ state: 'done' }, now), true)
const items = rankItems([
  { id: 1, created_at: '2026-10-20T00:00:00Z' },
  { id: 2, priority: true, created_at: '2026-10-23T00:00:00Z' },
  { id: 3, follow_up_at: '2026-10-23T00:00:00Z', created_at: '2026-10-22T00:00:00Z' },
], now)
assert.deepEqual(items.map(i => i.id), [2, 3, 1])
assert.deepEqual(rankTasks([
  { id: 1, status: 'done', important: true },
  { id: 2, status: 'todo', important: true },
  { id: 3, status: 'todo', due_at: '2026-10-23T00:00:00Z' },
], now).map(i => i.id), [3, 2])
console.log('PASS Today ranking, dates, triage visibility, and safe links')
