import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cssPath = path.resolve(__dirname, '../src/components/ui/apple/error-states.css')

test('error-states.css exists and contains required Apple utility classes and tokens', () => {
  assert.ok(fs.existsSync(cssPath), 'error-states.css must exist')
  const content = fs.readFileSync(cssPath, 'utf8')

  // Check required classes
  assert.match(content, /\.apple-glass-banner/, 'must define .apple-glass-banner')
  assert.match(content, /\.apple-rate-limit-card/, 'must define .apple-rate-limit-card')
  assert.match(content, /\.apple-dynamic-island/, 'must define .apple-dynamic-island')
  assert.match(content, /\.apple-pill-btn/, 'must define .apple-pill-btn')
  assert.match(content, /\.apple-amber-badge/, 'must define .apple-amber-badge')

  // Check Apple visual properties
  assert.match(content, /backdrop-filter:\s*blur\(/, 'must utilize backdrop-filter blur for frosted acrylic')
  assert.match(content, /border-radius:\s*(9999px|999px|16px|20px|24px)/, 'must feature Apple rounded corners')
})
