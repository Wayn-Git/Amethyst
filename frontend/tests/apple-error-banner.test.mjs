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
const out = join(here, '../node_modules/.apple-banner-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `
export { AppleErrorBanner } from '${join(here, '../src/components/ui/apple/AppleErrorBanner.jsx')}'
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

const { AppleErrorBanner } = await import(`${pathToFileURL(join(out, 'bundle.js')).href}?t=${Date.now()}`)

test('AppleErrorBanner returns null when visible is false', () => {
  const html = renderToStaticMarkup(
    React.createElement(AppleErrorBanner, { visible: false, service: 'google_drive' })
  )
  assert.equal(html, '')
})

test('AppleErrorBanner renders frosted banner with amber badge and action buttons when visible', () => {
  const html = renderToStaticMarkup(
    React.createElement(AppleErrorBanner, {
      visible: true,
      service: 'google_drive',
      email: 'user@example.com',
      onDismiss: () => {},
    })
  )
  assert.match(html, /apple-glass-banner/)
  assert.match(html, /apple-amber-badge/)
  assert.match(html, /Google Drive session expired/)
  assert.match(html, /user@example\.com/)
  assert.match(html, /Re-authenticate/)
  assert.match(html, /Dismiss/)
})
