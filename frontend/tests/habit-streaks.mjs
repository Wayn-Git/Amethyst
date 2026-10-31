import assert from 'node:assert/strict'
import { bestStreak } from '../src/dashboard/widgets/habitStreaks.js'

assert.equal(bestStreak([], 'daily', 1), 0)
assert.equal(bestStreak(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24'], 'daily', 1), 3)
assert.equal(bestStreak(['2026-10-19', '2026-10-20', '2026-10-26', '2026-10-27', '2026-11-09', '2026-11-10'], 'weekly', 2), 2)
console.log('habit streaks: passed')
