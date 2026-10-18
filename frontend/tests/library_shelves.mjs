import { strict as assert } from 'node:assert'
import { partitionLibraryShelves } from '../src/views/library/shelfUtils.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push({ name, message: err.message, stack: err.stack })
  }
}

// Test 1: Empty and invalid inputs
test('handles empty input gracefully', () => {
  const result = partitionLibraryShelves([])
  assert.deepEqual(result, {
    jumpBackIn: [],
    essential: [],
    media: [],
    reading: [],
  })

  const nullResult = partitionLibraryShelves(null)
  assert.deepEqual(nullResult, {
    jumpBackIn: [],
    essential: [],
    media: [],
    reading: [],
  })
})

// Test 2: Jump Back In (processing or fresh < 48 hours)
test('partitions fresh or processing items into jumpBackIn', () => {
  const now = Date.now()
  const freshItem = {
    id: 'item-1',
    title: 'Freshly Captured Article',
    kind: 'article',
    created_at: new Date(now - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
  }
  const processingItem = {
    id: 'item-2',
    title: 'Syncing Reel',
    kind: 'video',
    status: 'enriching',
    isProcessing: true,
    created_at: new Date(now - 1000 * 60 * 60 * 72).toISOString(), // 3 days ago but processing
  }
  const oldItem = {
    id: 'item-3',
    title: 'Old Read Item',
    kind: 'article',
    created_at: new Date(now - 1000 * 60 * 60 * 96).toISOString(), // 4 days ago
  }

  const result = partitionLibraryShelves([freshItem, processingItem, oldItem])
  assert.equal(result.jumpBackIn.length, 2)
  assert.equal(result.jumpBackIn[0].id, 'item-1')
  assert.equal(result.jumpBackIn[1].id, 'item-2')
})

// Test 3: Essential shelf (rating 5 items)
test('partitions 5-star items into essential shelf', () => {
  const fiveStar = {
    id: 'item-star',
    title: 'Essential Masterpiece',
    rating: 5,
    kind: 'article',
    created_at: '2026-01-01T00:00:00Z',
  }
  const fourStar = {
    id: 'item-four',
    title: 'Good Item',
    rating: 4,
    kind: 'article',
    created_at: '2026-01-01T00:00:00Z',
  }

  const result = partitionLibraryShelves([fiveStar, fourStar])
  assert.equal(result.essential.length, 1)
  assert.equal(result.essential[0].id, 'item-star')
  // Essential item should not be duplicated in reading
  assert.equal(result.reading.length, 1)
  assert.equal(result.reading[0].id, 'item-four')
})

// Test 4: Media & Watchlist vs Reading & Insights
test('separates media items from reading items', () => {
  const youtube = {
    id: 'media-yt',
    title: 'Deep Dive on Systems',
    kind: 'video',
    app: 'youtube',
    url: 'https://youtube.com/watch?v=123',
  }
  const reel = {
    id: 'media-reel',
    title: 'Comedy Reel',
    url: 'https://www.instagram.com/reel/xyz123/',
  }
  const podcast = {
    id: 'media-pod',
    title: 'Founder Interview',
    kind: 'podcast',
    app: 'spotify',
  }
  const article = {
    id: 'read-art',
    title: 'Subgrid Documentation',
    kind: 'article',
    url: 'https://developer.mozilla.org',
  }
  const note = {
    id: 'read-note',
    title: 'Personal Dev Thoughts',
    kind: 'note',
  }

  const result = partitionLibraryShelves([youtube, reel, podcast, article, note])
  assert.equal(result.media.length, 3)
  assert.deepEqual(result.media.map((i) => i.id), ['media-yt', 'media-reel', 'media-pod'])
  assert.equal(result.reading.length, 2)
  assert.deepEqual(result.reading.map((i) => i.id), ['read-art', 'read-note'])
})

if (failures.length > 0) {
  console.error(`${passed} passed, ${failures.length} failed:`)
  for (const f of failures) {
    console.error(`- ${f.name}: ${f.message}`)
  }
  process.exit(1)
} else {
  console.log(`${passed} passed, 0 failed`)
}
