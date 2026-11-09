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

const { calculateNextInterval, BACKOFF_MIN_MS, BACKOFF_MAX_MS, IDLE_MS, ACTIVE_MS } = await import('../src/lib/sync/useSync.js')

await test('returns ACTIVE_MS when queued items exist or ops applied', () => {
  const next = calculateNextInterval({ queuedCount: 3, applied: 0, synced: true, consecutiveErrors: 0 })
  assert.equal(next, ACTIVE_MS)

  const next2 = calculateNextInterval({ queuedCount: 0, applied: 2, synced: true, consecutiveErrors: 0 })
  assert.equal(next2, ACTIVE_MS)
})

await test('returns IDLE_MS when synced successfully and idle', () => {
  const next = calculateNextInterval({ queuedCount: 0, applied: 0, synced: true, consecutiveErrors: 0 })
  assert.equal(next, IDLE_MS)
})

await test('calculates exponential backoff with jitter on consecutive errors up to max', () => {
  const b1 = calculateNextInterval({ queuedCount: 0, applied: 0, synced: false, consecutiveErrors: 1 })
  assert.ok(b1 >= BACKOFF_MIN_MS && b1 <= BACKOFF_MIN_MS * 1.5, `b1=${b1}`)

  const b2 = calculateNextInterval({ queuedCount: 0, applied: 0, synced: false, consecutiveErrors: 2 })
  assert.ok(b2 >= BACKOFF_MIN_MS * 2 && b2 <= BACKOFF_MIN_MS * 2 * 1.5, `b2=${b2}`)

  const bMax = calculateNextInterval({ queuedCount: 0, applied: 0, synced: false, consecutiveErrors: 10 })
  assert.ok(bMax <= BACKOFF_MAX_MS * 1.25, `bMax=${bMax}`)
})

if (failCount > 0) {
  process.exit(1)
} else {
  console.log(`\nAll ${testCount} useSync interval tests passed!`)
}
