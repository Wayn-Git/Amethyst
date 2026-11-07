import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepSplash source contains loading indicator, local services, and disclaimer', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepSplash.jsx', 'utf8')
  assert.match(content, /Starting local services/)
  assert.match(content, /127\.0\.0\.1 · opening vault/)
  assert.match(content, /getDisclaimerText/)
})

test('StepWelcome source contains 4 floating satellite chips and get-started action', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepWelcome.jsx', 'utf8')
  assert.match(content, /Meet Amethyst\./)
  assert.match(content, /Get started/)
  assert.match(content, /AI/)
  assert.match(content, /Files/)
  assert.match(content, /Phone/)
  assert.match(content, /Apps/)
})

