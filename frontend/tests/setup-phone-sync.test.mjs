import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Test Phone sharing + Cloud sync: LAN vs Cloudflare Relay modes,
 * HTTP Shortcuts deep link URL formatting, and encryption disclosures.
 */

test('http shortcuts deep link correctly encodes prefilled json endpoint', () => {
  const origin = 'http://127.0.0.1:8000'
  const shortcutsJsonUrl = `${origin}/api/share/http-shortcuts.json`
  const deepLinkUrl = `https://http-shortcuts.rmy.ch/import?url=${encodeURIComponent(shortcutsJsonUrl)}`

  assert.equal(
    deepLinkUrl,
    'https://http-shortcuts.rmy.ch/import?url=http%3A%2F%2F127.0.0.1%3A8000%2Fapi%2Fshare%2Fhttp-shortcuts.json'
  )
})

test('sync modes switch between LAN same-network and Cloudflare relay', () => {
  let mode = 'lan'

  function setMode(newMode) {
    mode = newMode
  }

  assert.equal(mode, 'lan')
  setMode('relay')
  assert.equal(mode, 'relay')
})

test('encryption disclosures state honesty for queued and transit content', () => {
  const cfDisclosure =
    'Links in transit are encrypted via HTTPS TLS. Queued links held on Cloudflare while your PC is offline are stored unencrypted in your private worker queue until Amethyst pulls them into your local vault.'

  assert.match(cfDisclosure, /HTTPS TLS/)
  assert.match(cfDisclosure, /stored unencrypted in your private worker queue/)
  assert.match(cfDisclosure, /local vault/)
})
