import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepStorage has Composio API key, Google Drive Amethyst root, and optional toolkits', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepStorage.jsx', 'utf8')
  assert.match(content, /Composio/)
  assert.match(content, /Google Drive/)
  assert.match(content, /My Drive \/ Amethyst \//)
  assert.match(content, /Gmail/)
  assert.match(content, /Slack/)
  assert.match(content, /GitHub/)
})
