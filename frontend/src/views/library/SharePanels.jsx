import { Button as HouseButton, Input as HouseInput } from '../../components/ui/bento/index.jsx'
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

  const [activeTab, setActiveTab] = useState('bookmarklet') // 'bookmarklet' | 'phone'
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  // Share token state
  const [shareStatus, setShareStatus] = useState(null)
  const [shareToken, setShareToken] = useState('')

  // Load share status
  useEffect(() => {
    if (!open) return
    api
      .shareStatus()
      .then(setShareStatus)
      .catch(() => setShareStatus({ enabled: false }))
  }, [open])

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
            <HouseButton
              type="button"
              className="lib-modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <Icon name="x" size={14} />
            </HouseButton>
          </div>

          {/* Tabs */}
          <div style={{ padding: '16px 20px 0' }}>
            <div className="lib-modal-tabs">
              <HouseButton
                type="button"
                className={`lib-modal-tab ${activeTab === 'bookmarklet' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setActiveTab('bookmarklet')}
              >
                <Icon name="bookmark" size={14} />
                <span>Browser Bookmarklet</span>
              </HouseButton>
              <HouseButton
                type="button"
                className={`lib-modal-tab ${activeTab === 'phone' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setActiveTab('phone')}
              >
                <Icon name="link" size={14} />
                <span>Phone / Shortcuts</span>
              </HouseButton>
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
                    <HouseButton
                      type="button"
                      className="lib-btn"
                      onClick={rotateToken}
                    >
                      {shareStatus?.enabled ? 'Rotate Token' : 'Enable & Create Token'}
                    </HouseButton>
                    {shareStatus?.enabled && (
                      <HouseButton
                        type="button"
                        className="lib-btn"
                        style={{ color: '#ef4444' }}
                        onClick={revokeToken}
                      >
                        Revoke
                      </HouseButton>
                    )}
                  </div>
                </div>

                {shareToken && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 8, background: 'rgba(113, 50, 245, 0.06)', border: '1px solid rgba(113, 50, 245, 0.2)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                      Your Private Share Token (Copy Now):
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <HouseInput
                        type="text"
                        readOnly
                        value={shareToken}
                        className="lib-form-input"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      />
                      <HouseButton
                        type="button"
                        className="lib-btn lib-btn--primary"
                        onClick={() => {
                          copyText(shareToken)
                          toast('Token copied to clipboard', 'ok')
                        }}
                      >
                        Copy
                      </HouseButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lib-modal-footer">
            <HouseButton
              type="button"
              className="lib-btn"
              onClick={onClose}
            >
              Close
            </HouseButton>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
