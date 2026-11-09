import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeItemHash,
  pickDeterministicWinner,
  formatDriveItemPayload,
} from '../src/mobile/driveSync.js'

test('Drive Sync: 16-hex Item Hash Generation', () => {
  const url1 = 'https://www.instagram.com/reel/DV79WToDXwb/'
  const hash1 = computeItemHash(url1)
  assert.equal(typeof hash1, 'string')
  assert.equal(hash1.length, 16)
  assert.match(hash1, /^[0-9a-f]{16}$/)

  // Idempotent for same URL
  const hash2 = computeItemHash(url1)
  assert.equal(hash1, hash2)
})

test('Drive Sync: Deterministic Winner Rule (Lowest createdTime, fileId)', () => {
  const files = [
    { id: 'file_B', createdTime: '2026-11-09T18:00:02.000Z' },
    { id: 'file_A', createdTime: '2026-11-09T18:00:01.000Z' },
    { id: 'file_C', createdTime: '2026-11-09T18:00:03.000Z' },
  ]
  const winner = pickDeterministicWinner(files)
  assert.equal(winner.id, 'file_A')

  // Tie-breaker when createdTime is identical: lowest fileId lexicographically
  const tieFiles = [
    { id: 'drive_z_999', createdTime: '2026-11-09T18:00:01.000Z' },
    { id: 'drive_a_001', createdTime: '2026-11-09T18:00:01.000Z' },
  ]
  const tieWinner = pickDeterministicWinner(tieFiles)
  assert.equal(tieWinner.id, 'drive_a_001')
})

test('Drive Sync: formatDriveItemPayload Combines Metadata and Markdown Note', () => {
  const item = {
    url: 'https://www.instagram.com/reel/DV79WToDXwb/',
    caption: 'Learn Python coding with clean architecture',
    summary: 'A brief guide to software principles.',
    tags: ['python', 'coding'],
    mediaType: 'video',
    music: { songName: 'Original audio', artistName: 'Dev' },
  }
  const payload = formatDriveItemPayload(item)
  assert.match(payload.fileName, /^[0-9a-f]{16}\.json$/)

  const parsed = JSON.parse(payload.textContent)
  assert.equal(parsed.originalUrl, item.url)
  assert.equal(parsed.summary, item.summary)
  assert.match(parsed.markdownNote, /# A brief guide to software principles\./)
  assert.match(parsed.markdownNote, /### Caption/)
})
