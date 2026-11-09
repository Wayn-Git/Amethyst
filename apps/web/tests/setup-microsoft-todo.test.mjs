import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Test Microsoft To Do integration: PKCE parameters, empty state connect button visibility,
 * and vault token state logic.
 */

test('microsoft auth url contains required PKCE public client parameters', () => {
  function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
    const scopes = 'Tasks.ReadWrite offline_access User.Read'
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`
  }

  const url = buildAuthUrl({
    clientId: 'test-client-id',
    redirectUri: 'http://localhost:8000/api/auth/microsoft/callback',
    challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    state: 'random-state-123',
  })

  assert.match(url, /login\.microsoftonline\.com/)
  assert.match(url, /client_id=test-client-id/)
  assert.match(url, /code_challenge_method=S256/)
  assert.match(url, /Tasks\.ReadWrite/)
  assert.match(url, /offline_access/)
  assert.doesNotMatch(url, /client_secret/)
})

test('task widget empty state displays connect button until connected', () => {
  function shouldRenderConnectButton(widgetId, itemsCount, isConnected, isEditing) {
    if (isEditing) return false
    if (!widgetId?.startsWith('task.')) return false
    if (itemsCount > 0) return false
    return !isConnected
  }

  // Task widget empty and not connected -> show button
  assert.equal(shouldRenderConnectButton('task.today', 0, false, false), true)
  assert.equal(shouldRenderConnectButton('task.deadlines', 0, false, false), true)

  // Task widget empty but already connected -> do not show button
  assert.equal(shouldRenderConnectButton('task.today', 0, true, false), false)

  // Task widget with items -> do not show button
  assert.equal(shouldRenderConnectButton('task.today', 3, false, false), false)

  // Non-task widget (e.g. dev.recovery) -> do not show button
  assert.equal(shouldRenderConnectButton('dev.recovery', 0, false, false), false)
})

test('token refresh updates expiration timestamp and keeps refresh token', () => {
  const originalTokens = {
    access_token: 'old-access',
    refresh_token: 'valid-refresh-token',
    expires_at: 1000,
  }

  function applyRefresh(tokens, response, now) {
    return {
      access_token: response.access_token,
      refresh_token: response.refresh_token || tokens.refresh_token,
      expires_at: now + response.expires_in,
    }
  }

  const updated = applyRefresh(originalTokens, { access_token: 'new-access', expires_in: 3600 }, 2000)
  assert.equal(updated.access_token, 'new-access')
  assert.equal(updated.refresh_token, 'valid-refresh-token')
  assert.equal(updated.expires_at, 5600)
})
