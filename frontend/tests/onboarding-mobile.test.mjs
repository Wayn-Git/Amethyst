import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepMobile has Scan to pair tab, Download app tab, and no Cloudflare references', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepMobile.jsx', 'utf8')
  assert.match(content, /Scan to pair/)
  assert.match(content, /Download app/)
  assert.match(content, /LAN :8443/)
  assert.match(content, /Pair later from Settings/)
  assert.equal(content.includes('cloudflare'), false, 'Should not mention cloudflare')
  assert.equal(content.includes('http-shortcuts'), false, 'Should not mention http-shortcuts')
})

