import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepProfile implements 9 themes and 5 accents matching Settings', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepProfile.jsx', 'utf8')
  for (const theme of ['system', 'graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor']) {
    assert.ok(content.includes(theme), `Missing theme: ${theme}`)
  }
  for (const accent of ['#7132f5', '#2563eb', '#10b981', '#f43f5e', '#f59e0b']) {
    assert.ok(content.includes(accent), `Missing accent: ${accent}`)
  }
  assert.match(content, /Display name/)
  assert.match(content, /Full name/)
  assert.match(content, /Handle/)
})
