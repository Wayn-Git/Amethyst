import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api, copyText } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'

export function bookmarklet(origin) {
  return `javascript:void(window.open('${origin}/library?url='+encodeURIComponent(location.href),'_blank'))`
}

export function CaptureIntegrationsModal({ open, onClose, toast }) {
  const panelRef = useRef(null)
  useModalDismiss(open, onClose)

  const [activeTab, setActiveTab] = useState('bookmarklet') // 'bookmarklet' | 'phone' | 'instagram'
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  // Share token state
  const [shareStatus, setShareStatus] = useState(null)
  const [shareToken, setShareToken] = useState('')

  // Instagram state
  const [igState, setIgState] = useState(null)
  const [relayForm, setRelayForm] = useState({ url: '', token: '' })
  const [relaySyncing, setRelaySyncing] = useState(false)

  // Load share status
  useEffect(() => {
    if (!open) return
    api
      .shareStatus()
      .then(setShareStatus)
      .catch(() => setShareStatus({ enabled: false }))
  }, [open])

  // Load Instagram state
  const loadInstagram = useCallback(async () => {
    try {
      setIgState(await api.instagram())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (open) loadInstagram()
  }, [open, loadInstagram])

  if (!open) return null

  // Share Token actions
  const rotateToken = async () => {
    try {
      const next = await api.rotateShareToken()
      setShareToken(next.token)
      setShareStatus({ enabled: true })
      toast('Token generated — copy now, it is not shown again', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const revokeToken = async () => {
    try {
      await api.revokeShareToken()
      setShareToken('')
      setShareStatus({ enabled: false })
      toast('Sharing disabled', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const syncRelay = async () => {
    setRelaySyncing(true)
    try {
      const result = await api.syncInstagramRelay()
      toast(
        result.synced
          ? `Synced ${result.pulled} items`
          : result.error || 'Could not reach relay',
        result.synced ? 'ok' : 'bad'
      )
      setIgState(await api.instagram())
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setRelaySyncing(false)
    }
  }

  const saveRelay = async (e) => {
    e?.preventDefault()
    try {
      const next = await api.setInstagramRelay({
        url: relayForm.url || undefined,
        token: relayForm.token || undefined,
        enabled: true,
      })
      setIgState(next)
      setRelayForm({ url: '', token: '' })
      toast('Relay connection saved', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  return (
    <AnimatePresence>
      <div
        className="lib-modal-overlay"
        onMouseDown={(e) => onOverlayMouseDown(e, panelRef, onClose)}
      >
        <motion.div
          ref={panelRef}
          className="lib-modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Capture & Integrations"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Header */}
          <div className="lib-modal-header">
            <h2 className="lib-modal-title">
              <Icon name="link" size={16} />
              <span>Capture & Sync Integrations</span>
            </h2>
            <button
              type="button"
              className="lib-modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ padding: '16px 20px 0' }}>
            <div className="lib-modal-tabs">
              <button
                type="button"
                className={`lib-modal-tab ${activeTab === 'bookmarklet' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setActiveTab('bookmarklet')}
              >
                <Icon name="bookmark" size={14} />
                <span>Browser Bookmarklet</span>
              </button>
              <button
                type="button"
                className={`lib-modal-tab ${activeTab === 'phone' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setActiveTab('phone')}
              >
                <Icon name="link" size={14} />
                <span>Phone / Shortcuts</span>
              </button>
              <button
                type="button"
                className={`lib-modal-tab ${activeTab === 'instagram' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setActiveTab('instagram')}
              >
                <Icon name="camera" size={14} />
                <span>Instagram Relay</span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="lib-modal-body">
            {activeTab === 'bookmarklet' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                  Drag this button into your browser bookmarks bar. Clicking it on any article, YouTube video, or page will instantly send it to Amethyst.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                  <a
                    href={bookmarklet(origin)}
                    className="lib-btn lib-btn--primary"
                    style={{ cursor: 'grab', padding: '10px 20px', height: 'auto', fontSize: 14 }}
                    onClick={(e) => {
                      if (!e.metaKey && !e.ctrlKey) {
                        e.preventDefault()
                        toast('Drag this button to your browser bookmarks toolbar', 'info')
                      }
                    }}
                  >
                    <Icon name="bookmark" size={16} />
                    <span>+ Save to Amethyst</span>
                  </a>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
                  Bookmarklet URL targets: <code>{origin}/library?url=...</code>
                </div>
              </div>
            )}

            {activeTab === 'phone' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                  Send links from your phone's share sheet via Apple Shortcuts, Tasker, or webhook.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      Share Ingestion Webhook
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                      Status: {shareStatus?.enabled ? 'Active' : 'Disabled'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="lib-btn"
                      onClick={rotateToken}
                    >
                      {shareStatus?.enabled ? 'Rotate Token' : 'Enable & Create Token'}
                    </button>
                    {shareStatus?.enabled && (
                      <button
                        type="button"
                        className="lib-btn"
                        style={{ color: '#ef4444' }}
                        onClick={revokeToken}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>

                {shareToken && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 8, background: 'rgba(113, 50, 245, 0.06)', border: '1px solid rgba(113, 50, 245, 0.2)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                      Your Private Share Token (Copy Now):
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        readOnly
                        value={shareToken}
                        className="lib-form-input"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      />
                      <button
                        type="button"
                        className="lib-btn lib-btn--primary"
                        onClick={() => {
                          copyText(shareToken)
                          toast('Token copied to clipboard', 'ok')
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'instagram' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                  Automatically pull saved posts, reels, and carousels from your Instagram relay container.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      Relay Status
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                      {igState?.relay?.configured ? `Connected: ${igState.relay.url}` : 'Not connected'}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="lib-btn"
                    disabled={relaySyncing}
                    onClick={syncRelay}
                  >
                    <Icon name="refresh" size={13} />
                    <span>{relaySyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>
                </div>

                <form onSubmit={saveRelay} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="lib-form-group">
                    <label className="lib-form-label" htmlFor="lib-relay-url">Relay Endpoint URL</label>
                    <input
                      id="lib-relay-url"
                      type="url"
                      className="lib-form-input"
                      placeholder="http://localhost:8081"
                      value={relayForm.url}
                      onChange={(e) => setRelayForm({ ...relayForm, url: e.target.value })}
                    />
                  </div>
                  <div className="lib-form-group">
                    <label className="lib-form-label" htmlFor="lib-relay-token">Relay Bearer Token</label>
                    <input
                      id="lib-relay-token"
                      type="password"
                      className="lib-form-input"
                      placeholder="••••••••••••"
                      value={relayForm.token}
                      onChange={(e) => setRelayForm({ ...relayForm, token: e.target.value })}
                    />
                  </div>
                  <button
                    type="submit"
                    className="lib-btn lib-btn--primary"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Save Relay Connection
                  </button>
                </form>
              </div>
            )}
          </div>

          <div className="lib-modal-footer">
            <button
              type="button"
              className="lib-btn"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
