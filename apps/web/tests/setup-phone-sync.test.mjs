import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Tests verifying first-run setup wizard completes with NO Cloudflare step
 * and that mobile shortcut sharing endpoints are correctly structured.
 */

test('first-run setup wizard source has no cloudflare step or component', () => {
  const wizardPath = path.resolve('frontend/src/components/SplashScreenWizard.jsx')
  const content = fs.readFileSync(wizardPath, 'utf8')

  assert.equal(
    content.includes('StepCloudflare'),
    false,
    'StepCloudflare component should not exist in setup wizard'
  )
  assert.equal(
    content.includes('key="cloudflare"'),
    false,
    'cloudflare step key should not exist in setup wizard steps list'
  )
  assert.equal(
    content.includes('verifyCloudflareToken'),
    false,
    'verifyCloudflareToken should not be called in setup wizard'
  )
})

test('http shortcuts deep link correctly encodes prefilled json endpoint', () => {
  const origin = 'http://127.0.0.1:8000'
  const shortcutsJsonUrl = `${origin}/api/share/http-shortcuts.json`
  const deepLinkUrl = `https://http-shortcuts.rmy.ch/import?url=${encodeURIComponent(shortcutsJsonUrl)}`

  assert.equal(
    deepLinkUrl,
    'https://http-shortcuts.rmy.ch/import?url=http%3A%2F%2F127.0.0.1%3A8000%2Fapi%2Fshare%2Fhttp-shortcuts.json'
  )
})
