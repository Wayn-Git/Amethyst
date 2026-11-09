import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const here = new URL('.', import.meta.url).pathname
const out = join(here, '../node_modules/.island-status-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `
export { DynamicIslandStatus } from '${join(here, '../src/components/ui/apple/DynamicIslandStatus.jsx')}'
`
)

const bundle = await build({
  root: here,
  plugins: [react()],
  build: {
    lib: { entry, formats: ['es'], fileName: 'bundle' },
    outDir: out,
    emptyOutDir: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
  logLevel: 'silent',
})

const { DynamicIslandStatus } = await import(`${pathToFileURL(join(out, 'bundle.js')).href}?t=${Date.now()}`)

test('DynamicIslandStatus renders direct LAN mode', () => {
  const html = renderToStaticMarkup(
    React.createElement(DynamicIslandStatus, {
      status: 'direct',
      latency: 4,
    })
  )
  assert.match(html, /apple-dynamic-island/)
  assert.match(html, /apple-dynamic-island-indicator--direct/)
  assert.match(html, /LAN/)
  assert.match(html, /4ms/)
})

test('DynamicIslandStatus renders standalone cloud relay mode', () => {
  const html = renderToStaticMarkup(
    React.createElement(DynamicIslandStatus, {
      status: 'standalone',
    })
  )
  assert.match(html, /apple-dynamic-island-indicator--standalone/)
  assert.match(html, /Cloud Relay/)
})

test('DynamicIslandStatus renders offline mode with retry action', () => {
  const html = renderToStaticMarkup(
    React.createElement(DynamicIslandStatus, {
      status: 'offline',
      onRetry: () => {},
    })
  )
  assert.match(html, /apple-dynamic-island--expanded/)
  assert.match(html, /apple-dynamic-island-indicator--offline/)
  assert.match(html, /Offline/)
  assert.match(html, /Reconnect/)
})

