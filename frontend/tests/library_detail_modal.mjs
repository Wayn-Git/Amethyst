import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'

if (typeof global.document === 'undefined') {
  global.document = {
    head: { appendChild() {} },
    body: { addEventListener() {}, removeEventListener() {} },
    createElement: () => ({ setAttribute() {}, appendChild() {} }),
    createTextNode: () => ({}),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByTagName: () => [{ appendChild() {} }],
    documentElement: {
      style: { setProperty() {}, getPropertyValue() { return '' }, removeProperty() {} },
      setAttribute() {},
      classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    },
    addEventListener() {},
    removeEventListener() {},
  }
  class MockHTMLElement { focus() {} blur() {} }
  global.HTMLElement = MockHTMLElement
  global.window = {
    HTMLElement: MockHTMLElement,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  }
}

const here = new URL('.', import.meta.url).pathname
const out = join(here, '../node_modules/.library-modal-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `export { default } from ${JSON.stringify(join(here, '../src/views/library/LibraryDetailModal.jsx'))}\n`
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
const { default: LibraryDetailModal } = await import(pathToFileURL(join(out, bundled.fileName)).href)

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

test('renders Instagram slide item with Slide Analysis on overview and compact chips', () => {
  const item297 = {
    id: 297,
    title: 'Turn any codebase, knowledge base, or docs into an interactive knowledge graph 🦀',
    url: 'https://www.instagram.com/p/Deqni2Tic2N/',
    app: 'instagram',
    author: 'Daily Dose of Data Science',
    kind: 'video',
    media_path: null,
    summary: 'Understand Anything transforms codebases, knowledge bases, and documentation into searchable, queryable interactive knowledge graphs.',
    content: `# Turn any codebase, knowledge base, or docs into an interactive knowledge graph 🦀

Understand Anything transforms codebases, knowledge bases, and documentation into searchable, queryable interactive knowledge graphs.

## Mentioned
- tool — Claude Code: Supported AI coding assistant integration. (https://www.anthropic.com/claude-code)
- tool — Gemini CLI: Supported terminal-based AI coding agent. (https://github.com/google-gemini/gemini-cli)

## Slide Analysis

The image presents a screenshot of the website "Understand Anything".

* **Header Section**
	+ Title: "Understand Anything"
	+ Tagline: "Turn any codebase into knowledge graph."`,
    resources: [
      { type: 'tool', name: 'Claude Code', detail: 'Supported AI coding assistant.', url: 'https://www.anthropic.com/claude-code' },
      { type: 'tool', name: 'Gemini CLI', detail: 'Supported terminal-based AI agent.', url: 'https://github.com/google-gemini/gemini-cli' },
      { type: 'slide', name: 'Slide 1', url: '/api/library/297/slides/0', index: 0 },
    ],
  }

  const html = renderToStaticMarkup(
    React.createElement(LibraryDetailModal, {
      item: item297,
      onClose: () => {},
    })
  )

  // 1. Overview tab displays Slide Analysis breakdown
  assert.ok(html.includes('Slide &amp; Visual Breakdown') || html.includes('Slide & Visual Breakdown'), 'Must display Slide & Visual Breakdown on overview')
  assert.ok(html.includes('Header Section'), 'Must include Slide Analysis header content')

  // 2. Mentioned tools are compact chips, NOT giant boxes
  assert.ok(html.includes('lib-resource-chips-wrap'), 'Must render lib-resource-chips-wrap')
  assert.ok(html.includes('lib-resource-chip'), 'Must render lib-resource-chip')

  // 3. CTA buttons use clean lib-page-cta-pill and NO false third-party tool action buttons
  assert.ok(html.includes('lib-page-cta-pill'), 'Must use lib-page-cta-pill')
  const ctaRowMatch = html.match(/class="lib-page-cta-row"[\s\S]*?<\/div>/)
  assert.ok(ctaRowMatch, 'Must find cta row')
  assert.ok(!ctaRowMatch[0].includes('gemini-cli'), 'CTA row must NOT have false gemini-cli action button')

  // 4. No broken video player on static slide post
  assert.ok(!html.includes('lib-video-controls'), 'Must not render broken video player controls')
  assert.ok(!html.includes('0:00 / 0:00'), 'Must not show 0:00 video playback')
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
