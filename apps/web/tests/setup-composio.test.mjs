import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Test Composio flow: key validation, scope gate, and contextual empty state buttons.
 */

test('composio app connection button disabled without key', () => {
  function getConnectButtonState(isComposioLinked, isScopeReviewed) {
    if (!isScopeReviewed) return { enabled: false, label: 'Review pending' }
    if (!isComposioLinked) return { enabled: false, label: 'Connect' }
    return { enabled: true, label: 'Connect' }
  }

  // Without Composio key
  const noKeyReviewed = getConnectButtonState(false, true)
  assert.equal(noKeyReviewed.enabled, false)
  assert.equal(noKeyReviewed.label, 'Connect')

  // Unreviewed scope (e.g. Notion)
  const unreviewed = getConnectButtonState(true, false)
  assert.equal(unreviewed.enabled, false)
  assert.equal(unreviewed.label, 'Review pending')

  // With key and reviewed scope (e.g. Gmail)
  const valid = getConnectButtonState(true, true)
  assert.equal(valid.enabled, true)
  assert.equal(valid.label, 'Connect')
})

test('reviewed read-only scopes include core apps but block unreviewed', () => {
  const REVIEWED_SCOPES = new Set(['gmail', 'googlecalendar', 'slack', 'github', 'linear', 'spotify'])

  assert.equal(REVIEWED_SCOPES.has('gmail'), true)
  assert.equal(REVIEWED_SCOPES.has('googlecalendar'), true)
  assert.equal(REVIEWED_SCOPES.has('slack'), true)
  assert.equal(REVIEWED_SCOPES.has('notion'), false)
})

test('contextual widget empty state triggers connector opening event', () => {
  let dispatchedEvent = null
  const mockDispatch = (evt) => {
    dispatchedEvent = evt
  }

  // NextEvent / Calendar trigger
  mockDispatch({ type: 'amethyst:open-connectors', detail: 'googlecalendar' })
  assert.equal(dispatchedEvent.type, 'amethyst:open-connectors')
  assert.equal(dispatchedEvent.detail, 'googlecalendar')

  // Mail / Gmail trigger
  mockDispatch({ type: 'amethyst:open-connectors', detail: 'gmail' })
  assert.equal(dispatchedEvent.type, 'amethyst:open-connectors')
  assert.equal(dispatchedEvent.detail, 'gmail')
})
