import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api, copyText } from '../../api.js'
import { useApp } from '../../store.jsx'

export default function ComposioConnectModal({ open, onClose, onConnected, composioStatus }) {
  const { toast } = useApp()
  const modalRef = useRef(null)
  const inputRef = useRef(null)
  const pollTimerRef = useRef(null)

  const [keyDraft, setKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showManualKey, setShowManualKey] = useState(false)

  // Browser OAuth state
  const [loginSession, setLoginSession] = useState(null)
  const [isPolling, setIsPolling] = useState(false)
  const [pollError, setPollError] = useState(null)

  const isConfigured = Boolean(composioStatus?.configured)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setIsPolling(false)
  }, [])

  // Cleanup polling on unmount or modal close
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
      }
    }
  }, [])

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setKeyDraft('')
      setShowKey(false)
      setBusy(false)
      setDisconnecting(false)
      setShowManualKey(false)
      setLoginSession(null)
      setPollError(null)
      stopPolling()
    } else {
      stopPolling()
    }
  }, [open, stopPolling])

  // Escape key handler
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        stopPolling()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, stopPolling])

  // 1-Click Browser OAuth Login
  const handleStartBrowserLogin = async () => {
    setBusy(true)
    setPollError(null)
    stopPolling()

    try {
      const session = await api.startComposioLogin()
      if (!session?.login_url || !session?.session_id) {
        throw new Error('Invalid session response from Composio')
      }

      setLoginSession(session)
      setIsPolling(true)

      // Open Composio browser login window
      window.open(session.login_url, '_blank')
      toast('Opened Composio login in a new tab', 'ok')

      let attempts = 0
      const maxAttempts = 150 // ~5 minutes at 2s intervals

      pollTimerRef.current = setInterval(async () => {
        attempts++
        try {
          const res = await api.pollComposioLogin(session.session_id)
          if (res?.status === 'linked' && res?.configured) {
            stopPolling()
            toast('Successfully connected to Composio!', 'ok')
            if (onConnected) onConnected(res)
            onClose()
            return
          }

          if (res?.status === 'expired' || res?.status === 'failed') {
            stopPolling()
            setPollError('Login session expired or failed. Please try again.')
            return
          }
        } catch (pollErr) {
          // Keep polling through transient network glitches
          if (attempts > 10 && attempts % 15 === 0) {
            console.warn('Composio poll warning:', pollErr)
          }
        }

        if (attempts >= maxAttempts) {
          stopPolling()
          setPollError('Authentication timed out. Please try again.')
        }
      }, 2000)
    } catch (err) {
      toast(err.message || 'Failed to start Composio login', 'bad')
      setPollError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Fallback: Manual Key Save
  const handleSaveKey = async (e) => {
    if (e) e.preventDefault()
    const trimmed = keyDraft.trim()
    if (!trimmed) {
      toast('Please enter a Composio API key', 'amber')
      return
    }

    setBusy(true)
    try {
      const res = await api.saveComposioKey(trimmed)
      toast('Composio connected and verified successfully', 'ok')
      setKeyDraft('')
      setShowManualKey(false)
      if (onConnected) onConnected(res)
      onClose()
    } catch (err) {
      toast(err.message || 'Failed to validate Composio API key', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.deleteComposioKey()
      toast('Composio disconnected', 'ok')
      setShowManualKey(false)
      setLoginSession(null)
      stopPolling()
      if (onConnected) onConnected(null)
    } catch (err) {
      toast(err.message || 'Failed to disconnect Composio', 'bad')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="mcp-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              stopPolling()
              onClose()
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="composio-connect-title"
        >
          <motion.div
            className="mcp-modal-shell"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 450, damping: 30 }}
            style={{ maxWidth: 520 }}
          >
            <div className="mcp-modal" ref={modalRef}>
              <div className="mcp-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'rgba(168, 85, 247, 0.15)',
                      color: 'var(--accent, #a855f7)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="cloud" size={16} />
                  </span>
                  <div>
                    <h2 id="composio-connect-title" className="mcp-modal-title" style={{ fontSize: 16, lineHeight: 1.2 }}>
                      {isConfigured ? 'Composio Settings' : 'Connect with Composio'}
                    </h2>
                    <span style={{ fontSize: 12, color: 'var(--text-dim, #888)' }}>
                      1-click cloud SaaS apps & managed OAuth
                    </span>
                  </div>
                </div>

                <motion.button
                  type="button"
                  className="icon-btn mcp-modal-close"
                  onClick={() => {
                    stopPolling()
                    onClose()
                  }}
                  whileHover={{ rotate: 90, scale: 1.1 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  aria-label="Close"
                >
                  <Icon name="x" size={16} />
                </motion.button>
              </div>

              <div className="mcp-modal-form" style={{ padding: '18px 20px' }}>
                {/* Connection Status Box */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: isConfigured ? 'rgba(34, 197, 94, 0.08)' : 'var(--surface-2, rgba(255, 255, 255, 0.03))',
                    border: `1px solid ${isConfigured ? 'rgba(34, 197, 94, 0.25)' : 'var(--border, rgba(255, 255, 255, 0.08))'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isConfigured ? 'var(--live, #22c55e)' : 'var(--text-faint, #666)',
                        boxShadow: isConfigured ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                        {isConfigured ? 'Composio Connected' : 'Ready to Connect'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {isConfigured
                          ? `Active mode: ${composioStatus?.key_mode || 'user'} account`
                          : 'Zero-configuration cloud connectors via Google'}
                      </div>
                    </div>
                  </div>

                  {isConfigured && (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => handleStartBrowserLogin()}
                      disabled={busy}
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      Reconnect
                    </button>
                  )}
                </div>

                {!isConfigured ? (
                  <div>
                    {/* Primary Hero: 1-Click Browser OAuth */}
                    {!isPolling ? (
                      <div
                        style={{
                          padding: '16px',
                          borderRadius: 10,
                          background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.06) 0%, rgba(168, 85, 247, 0.02) 100%)',
                          border: '1px solid rgba(168, 85, 247, 0.2)',
                          textAlign: 'center',
                          marginBottom: 16,
                        }}
                      >
                        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px 0', color: 'var(--text)' }}>
                          Log in with Google
                        </h3>
                        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 16px 0', lineHeight: 1.45 }}>
                          Click below to sign in with Google on Composio. Amethyst automatically captures your account and enables all apps without needing an API key.
                        </p>

                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={handleStartBrowserLogin}
                          disabled={busy}
                          style={{
                            width: '100%',
                            padding: '10px 16px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            fontSize: 13,
                            fontWeight: 500,
                            boxShadow: '0 2px 10px rgba(168, 85, 247, 0.25)',
                          }}
                        >
                          <Icon name="external-link" size={14} />
                          {busy ? 'Opening login…' : 'Sign in with Google'}
                        </button>
                      </div>
                    ) : (
                      /* Live Linking / Waiting State */
                      <div
                        style={{
                          padding: '18px',
                          borderRadius: 10,
                          background: 'var(--surface-2, rgba(255, 255, 255, 0.03))',
                          border: '1px solid var(--accent, #a855f7)',
                          textAlign: 'center',
                          marginBottom: 16,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
                          <span
                            className="status-dot live"
                            style={{
                              width: 10,
                              height: 10,
                              animation: 'pulse 1.5s infinite',
                            }}
                          />
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                            Waiting for browser login…
                          </span>
                        </div>

                        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 14px 0', lineHeight: 1.45 }}>
                          Complete your sign-in in the opened browser tab. If prompted, confirm the authorization code below:
                        </p>

                        {loginSession?.code && (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 14px',
                              borderRadius: 6,
                              background: 'var(--canvas, #000)',
                              border: '1px solid var(--border)',
                              fontFamily: 'var(--font-mono, monospace)',
                              fontSize: 18,
                              fontWeight: 700,
                              letterSpacing: '0.1em',
                              color: 'var(--accent, #a855f7)',
                              marginBottom: 14,
                            }}
                          >
                            <span>{loginSession.code}</span>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => {
                                copyText(loginSession.code)
                                toast('Code copied', 'ok')
                              }}
                              title="Copy code"
                              style={{ padding: 4 }}
                            >
                              <Icon name="copy" size={12} />
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                          {loginSession?.login_url && (
                            <button
                              type="button"
                              className="btn btn--small btn--ghost"
                              onClick={() => window.open(loginSession.login_url, '_blank')}
                              style={{ fontSize: 12 }}
                            >
                              Re-open Tab <Icon name="external-link" size={11} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => stopPolling()}
                            style={{ fontSize: 12 }}
                          >
                            Cancel
                          </button>
                        </div>

                        {pollError && (
                          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--coral, #ef4444)' }}>
                            {pollError}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Secondary Accordion: Manual API Key Fallback */}
                    <div style={{ borderTop: '1px solid var(--border, rgba(255, 255, 255, 0.08))', paddingTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => setShowManualKey((s) => !s)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-dim)',
                          fontSize: 12,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: 0,
                        }}
                      >
                        <Icon name={showManualKey ? 'chevron-down' : 'chevron-right'} size={12} />
                        <span>Or enter a Composio API key manually</span>
                      </button>

                      {showManualKey && (
                        <motion.form
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.15 }}
                          onSubmit={handleSaveKey}
                          style={{ marginTop: 12 }}
                        >
                          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <input
                              id="composio-api-key"
                              ref={inputRef}
                              type={showKey ? 'text' : 'password'}
                              value={keyDraft}
                              onChange={(e) => setKeyDraft(e.target.value)}
                              placeholder="Paste API key (uak_..., ck_..., etc.)"
                              style={{
                                width: '100%',
                                padding: '9px 40px 9px 12px',
                                borderRadius: 6,
                                background: 'var(--surface, rgba(0, 0, 0, 0.2))',
                                border: '1px solid var(--border, rgba(255, 255, 255, 0.12))',
                                color: 'var(--text)',
                                fontSize: 13,
                                fontFamily: 'var(--font-mono, monospace)',
                                outline: 'none',
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => setShowKey((s) => !s)}
                              style={{
                                position: 'absolute',
                                right: 10,
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-dim)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                padding: 4,
                              }}
                              aria-label={showKey ? 'Hide key' : 'Show key'}
                            >
                              <Icon name={showKey ? 'eye-slash' : 'eye'} size={14} />
                            </button>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                            <button
                              type="submit"
                              className="btn btn--small btn--primary"
                              disabled={busy || !keyDraft.trim()}
                              style={{ minWidth: 90 }}
                            >
                              {busy ? 'Validating…' : 'Save Key'}
                            </button>
                          </div>
                        </motion.form>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Connected Information Screen */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                      Composio is connected and ready. You can enable, connect, or manage individual apps
                      (Gmail, Slack, GitHub, Linear, etc.) directly from the plugins catalogue.
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                      <a
                        href="https://dashboard.composio.dev"
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn--small btn--ghost"
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        Composio Dashboard <Icon name="external-link" size={12} />
                      </a>

                      <button
                        type="button"
                        className="btn btn--small btn--danger"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        style={{ color: 'var(--coral, #ef4444)' }}
                      >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
