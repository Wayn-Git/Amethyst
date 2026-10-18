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

if (failures.length > 0) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) {
    console.error(`  - ${f.name}: ${f.message}`)
  }
  process.exit(1)
} else {
  console.log(`\n${passed} passed, 0 failed`)
}
