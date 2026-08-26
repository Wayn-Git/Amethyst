import assert from 'node:assert/strict'

export function calculateProgress(completed, total) {
  if (!total || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
}

export function formatTimer(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60)
  const s = Math.max(0, seconds) % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

assert.equal(calculateProgress(0, 0), 0)
assert.equal(calculateProgress(3, 5), 60)
assert.equal(calculateProgress(5, 5), 100)
assert.equal(calculateProgress(7, 5), 100)
assert.equal(calculateProgress(-1, 5), 0)
assert.equal(formatTimer(1500), '25:00')
assert.equal(formatTimer(299), '04:59')
assert.equal(formatTimer(0), '00:00')
assert.equal(formatTimer(-5), '00:00')
console.log('PASS Focus timer and progress gauge calculation unit tests')
