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
const out = join(here, '../node_modules/.showcase-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `
export { ErrorStatesShowcase } from '${join(here, '../src/components/ui/stageshow/ErrorStatesShowcase.jsx')}'
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

const { ErrorStatesShowcase } = await import(`${pathToFileURL(join(out, 'bundle.js')).href}?t=${Date.now()}`)

test('ErrorStatesShowcase renders side-by-side macOS window and iPhone frame', () => {
  const html = renderToStaticMarkup(React.createElement(ErrorStatesShowcase))

  // Should render Stageshow stage container
  assert.match(html, /error-states-showcase/)
  // Should render desktop window and phone
  assert.match(html, /AppleErrorBanner|Google Drive session expired/)
  assert.match(html, /ModelRateLimitCard|Rate Limit Exceeded/)
  assert.match(html, /DynamicIslandStatus|LAN|Offline/)
})
