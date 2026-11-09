import test from 'node:test'
import assert from 'node:assert/strict'
import { getClientOSFromUA, getDisclaimerText } from '../src/components/onboarding/clientOS.js'

test('detects macOS from user agent', () => {
  assert.equal(getClientOSFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'Mac')
  assert.equal(getDisclaimerText('Mac'), 'Everything stays on this Mac until you connect something.')
})

test('detects Windows from user agent', () => {
  assert.equal(getClientOSFromUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'PC')
  assert.equal(getDisclaimerText('PC'), 'Everything stays on this PC until you connect something.')
})

test('detects Linux from user agent', () => {
  assert.equal(getClientOSFromUA('Mozilla/5.0 (X11; Linux x86_64)'), 'Linux machine')
  assert.equal(getDisclaimerText('Linux machine'), 'Everything stays on this Linux machine until you connect something.')
})

test('defaults safely when user agent unknown', () => {
  assert.equal(getClientOSFromUA(''), 'computer')
  assert.equal(getDisclaimerText('computer'), 'Everything stays on this computer until you connect something.')
})

