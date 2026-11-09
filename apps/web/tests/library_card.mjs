import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const here = new URL('.', import.meta.url).pathname
const out = join(here, '../node_modules/.library-card-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `export { default } from ${JSON.stringify(join(here, '../src/views/library/LibraryCard.jsx'))}\n`
)

const result = await build({
  root: out,
  logLevel: 'silent',
  plugins: [react()],
  build: {
    ssr: entry,
    outDir: out,
    emptyOutDir: false,
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/server',
        'framer-motion',
        'motion',
      ],
    },
  },
})

const [{ output }] = [result].flat()
const bundled = output.find((chunk) => chunk.isEntry)
const { default: LibraryCard } = await import(pathToFileURL(join(out, bundled.fileName)).href)

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

import React from 'react'

test('renders standard url item without throwing', () => {
  const item = {
    id: 1,
    url: 'https://example.com/article',
    title: 'Example Article',
    kind: 'article',
    site: 'example.com',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('Example Article'))
})

test('renders note item without throwing', () => {
  const item = {
    id: 2,
    title: 'My Personal Note',
    kind: 'note',
    content: 'Some note text',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('My Personal Note'))
})

test('renders post item with author without throwing', () => {
  const item = {
    id: 3,
    url: 'https://x.com/someone/status/12345',
    title: 'Tweet title',
    kind: 'post',
    author: 'someone',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('Tweet title'))
})

test('renders vertical reel with play button overlay and platform badge', () => {
  const item = {
    id: 4,
    url: 'https://www.instagram.com/reel/12345/',
    title: 'Instagram Reel Title',
    kind: 'video',
    app: 'instagram',
    duration_seconds: 45,
    thumbnail_path: '/path/to/thumb.jpg',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('Instagram Reel Title'))
  assert.ok(html.includes('lib-card-play-btn'), 'Expected play button on video media')
  assert.ok(html.includes('lib-card-platform-pill'), 'Expected platform badge on media')
})

test('renders summary directly without ugly dot-concatenation', () => {
  const item = {
    id: 5,
    title: 'Article With Summary',
    summary: 'First takeaway point.\nSecond key detail.\nThird conclusion.',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(!html.includes('lib-card-summary-sep'), 'Summary should not have artificial separator dots')
  assert.ok(html.includes('First takeaway point.'))
})

test('deduplicates content when excerpt or summary matches title exactly', () => {
  const item = {
    id: 6,
    title: 'Test Hook Item',
    excerpt: 'Test Hook Item',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('Test Hook Item'))
  // The summary element should NOT exist with identical duplicate text
  assert.ok(!html.includes('lib-card-summary'), 'Duplicate title in excerpt should be suppressed from summary')
})

test('renders carousel slide controls and dots for multi-slide posts', () => {
  const item = {
    id: 7,
    title: 'Multi-slide Post',
    kind: 'post',
    app: 'instagram',
    thumbnail_path: '/thumb.jpg',
    resources: [
      { type: 'slide', index: 0, url: 'https://example.com/slide1.jpg' },
      { type: 'slide', index: 1, url: 'https://example.com/slide2.jpg' },
      { type: 'slide', index: 2, url: 'https://example.com/slide3.jpg' },
    ],
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('lib-card-carousel-pill'), 'Expected carousel counter pill')
  assert.ok(html.includes('1/3'), 'Expected slide 1/3 indicator')
  assert.ok(html.includes('lib-card-slide-nav--next'), 'Expected next slide navigation button')
  assert.ok(html.includes('lib-card-slide-dots'), 'Expected slide dots container')
})

test('renders kind-aware "Want to watch" progress pill for video with unstarted progress', () => {
  const item = {
    id: 8,
    title: 'Awesome Video',
    kind: 'video',
    progress: 'unstarted',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('lib-card-status-pill--unstarted'), 'Expected unstarted pill class')
  assert.ok(html.includes('Want to watch'), 'Expected "Want to watch" label')
})

test('renders kind-aware "Watching" progress pill for video with in_progress status', () => {
  const item = {
    id: 9,
    title: 'Awesome Video 2',
    kind: 'video',
    progress: 'in_progress',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('lib-card-status-pill--in_progress'), 'Expected in_progress pill class')
  assert.ok(html.includes('Watching'), 'Expected "Watching" label')
})

test('renders kind-aware "Want to read" progress pill for article with unstarted progress', () => {
  const item = {
    id: 10,
    title: 'Awesome Article',
    kind: 'article',
    progress: 'unstarted',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('lib-card-status-pill--unstarted'), 'Expected unstarted pill class')
  assert.ok(html.includes('Want to read'), 'Expected "Want to read" label')
})

test('streamlines card actions to Pin and More menu', () => {
  const item = {
    id: 11,
    title: 'Streamlined Card Item',
    kind: 'article',
    url: 'https://example.com/test',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('lib-overflow-wrap'), 'Expected More menu wrapper')
  assert.ok(!html.includes('lib-card-action-btn--danger'), 'Trash button should be deferred to more menu')
})

test('eliminates nested role="button" on card article container for accessibility', () => {
  const item = {
    id: 12,
    title: 'Accessible Card',
    kind: 'article',
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(!html.includes('<article ref="cardRef" data-item-id="12" role="button"'), 'Card article should not have role="button"')
  assert.ok(!html.includes('tabindex="0"') || !html.includes('<article tabindex="0"'), 'Card article should not have tabindex="0"')
})

test('suppresses duplicate duration in footer when media overlay already renders duration', () => {
  const item = {
    id: 13,
    title: 'Video with duration',
    kind: 'video',
    thumbnail_path: '/thumb.jpg',
    duration_seconds: 120,
    duration: 120,
  }
  const html = renderToStaticMarkup(
    React.createElement(LibraryCard, { item })
  )
  assert.ok(html.includes('lib-card-duration-badge'), 'Expected duration on media overlay')
  assert.ok(!html.includes('class="lib-card-duration"'), 'Expected duration in footer to be suppressed')
})

if (failures.length > 0) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) {
    console.error(`  - ${f.name}: ${f.message}`)
  }
  process.exit(1)
} else {
  console.log(`\n${passed} passed, 0 failed`)
  process.exit(0)
}
