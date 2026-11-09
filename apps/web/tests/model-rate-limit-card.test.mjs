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
const out = join(here, '../node_modules/.model-card-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `
export { ModelRateLimitCard } from '${join(here, '../src/components/ui/apple/ModelRateLimitCard.jsx')}'
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

const { ModelRateLimitCard } = await import(`${pathToFileURL(join(out, 'bundle.js')).href}?t=${Date.now()}`)

test('ModelRateLimitCard renders rate limit status, countdown, and buttons', () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelRateLimitCard, {
      model: 'anthropic/claude-3-5-sonnet',
      error: 'HTTP 429 Too Many Requests',
      retryAfter: 28,
      fallbackModel: 'groq/llama-3.3-70b-versatile',
      onRetry: () => {},
      onSwitchFallback: () => {},
    })
  )

  assert.match(html, /apple-rate-limit-card/)
  assert.match(html, /Rate Limit Exceeded/i)
  assert.match(html, /Claude 3\.5 Sonnet/)
  assert.match(html, /28s/)
  assert.match(html, /Retry Now/)
  assert.match(html, /Switch to Llama 3\.3/)
})
