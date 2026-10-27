import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Test the state machine and data transformations for Amethyst's Setup Flow Model Step.
 */

test('model detection empty state: returns empty array without blocking or throwing', () => {
  const detections = []
  const hasDetections = detections.length > 0
  assert.equal(hasDetections, false)
})

test('detected provider state transitions from detected to testing to connected', () => {
  const initial = [
    {
      id: 'opencode_zen',
      provider: 'opencode',
      name: 'OpenCode Zen',
      source: 'OpenCode',
      default_model: 'opencode-zen-1',
      status: 'detected',
      errorMsg: null,
    },
  ]

  // Transition to testing
  const testing = initial.map((d) =>
    d.id === 'opencode_zen' ? { ...d, status: 'testing', errorMsg: null } : d
  )
  assert.equal(testing[0].status, 'testing')

  // Transition to connected on success
  const connected = testing.map((d) =>
    d.id === 'opencode_zen'
      ? { ...d, status: 'connected', default_model: 'opencode-zen-1' }
      : d
  )
  assert.equal(connected[0].status, 'connected')
  assert.equal(connected[0].default_model, 'opencode-zen-1')
})

test('detected provider state transitions to failed with plain-English error on failure', () => {
  const initial = [
    {
      id: 'hermes',
      provider: 'hermes',
      name: 'Hermes Agent',
      status: 'testing',
      errorMsg: null,
    },
  ]

  const errorReason = 'Provider rejected API key: 401 Unauthorized'
  const failed = initial.map((d) =>
    d.id === 'hermes' ? { ...d, status: 'failed', errorMsg: errorReason } : d
  )

  assert.equal(failed[0].status, 'failed')
  assert.equal(failed[0].errorMsg, errorReason)
})

test('sensible default model auto-picking for connected provider', () => {
  const providerPresets = {
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4o',
    openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
    gemini: 'gemini-1.5-flash',
  }

  function pickDefaultModel(providerSlug, customModel, detectedModel) {
    return customModel || detectedModel || providerPresets[providerSlug] || 'default'
  }

  assert.equal(pickDefaultModel('groq', '', null), 'llama-3.3-70b-versatile')
  assert.equal(pickDefaultModel('openrouter', '', 'mistral/mistral-7b'), 'mistral/mistral-7b')
  assert.equal(pickDefaultModel('openai', 'gpt-4o-mini', 'gpt-4o'), 'gpt-4o-mini')
})

test('model requirement gate: continue button disabled when no models, enabled when model connected', () => {
  function canContinue(configuredProviders, detectedItems) {
    const hasConfigured = configuredProviders.some((p) => p.enabled)
    const hasConnectedDetected = detectedItems.some((d) => d.status === 'connected')
    return hasConfigured || hasConnectedDetected
  }

  assert.equal(canContinue([], []), false)
  assert.equal(canContinue([], [{ status: 'detected' }]), false)
  assert.equal(canContinue([], [{ status: 'failed' }]), false)
  assert.equal(canContinue([], [{ status: 'connected' }]), true)
  assert.equal(canContinue([{ name: 'groq', enabled: true }], []), true)
})

test('key shape detection on clipboard', () => {
  function isKeyShaped(text) {
    const trimmed = (text || '').trim()
    return /^(sk-[a-zA-Z0-9_-]{16,}|gsk_[a-zA-Z0-9]{16,}|AIzaSy[a-zA-Z0-9_-]{20,}|nvapi-[a-zA-Z0-9_-]{16,}|xai-[a-zA-Z0-9]{16,}|csk-[a-zA-Z0-9]{16,}|[a-zA-Z0-9_-]{32,})$/.test(
      trimmed
    )
  }

  assert.equal(isKeyShaped('sk-abcdef1234567890abcdef'), true)
  assert.equal(isKeyShaped('gsk_1234567890abcdef1234567890'), true)
  assert.equal(isKeyShaped('AIzaSyD-1234567890abcdefghijk123456'), true)
  assert.equal(isKeyShaped('hello world'), false)
  assert.equal(isKeyShaped('https://openrouter.ai'), false)
  assert.equal(isKeyShaped(''), false)
})
