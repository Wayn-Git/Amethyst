import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { storedIdentity, saveIdentity } from '../../lib/credentials.js'
import { safeStorage } from '../../lib/storage.js'
import { getTransportManager } from '../../lib/sync/transportManager.js'

export default function MobileSettings({
  onClose,
  onOpenDiagnostics,
  onOpenSpikes,
  onUnpair,
  transportMode,
}) {
  const [faceIdEnabled, setFaceIdEnabled] = useState(true)
  const [phoneSharingEnabled, setPhoneSharingEnabled] = useState(true)
  const [appearance, setAppearance] = useState('Graphite')

  const initialHost = storedIdentity()?.hostUrl || safeStorage.getItem('amethyst.pc_host') || ''
  const [pcHost, setPcHost] = useState(initialHost)
  const [editingHost, setEditingHost] = useState(false)
  const [hostInput, setHostInput] = useState(initialHost)
  const [testShareStatus, setTestShareStatus] = useState('')
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const handleSaveHost = async () => {
    const trimmed = hostInput.trim().replace(/\/+$/, '')
    const formatted = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`
    setPcHost(formatted)
    safeStorage.setItem('amethyst.pc_host', formatted)
    const current = storedIdentity()
    if (current) {
      await saveIdentity({ ...current, hostUrl: formatted })
    }
    try {
      const tm = getTransportManager()
      tm.forcePath('direct')
      await tm.probe()
    } catch {}
    setEditingHost(false)
  }

  const handleTestShare = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        setTestShareStatus('Opening Android share menu…')
        await navigator.share({
          title: 'Amethyst Article',
          text: 'Check this article saved to Amethyst: https://amethyst.local/test-share',
          url: 'https://amethyst.local/test-share',
        })
        setTestShareStatus('Share sheet opened! Long-press Amethyst to Pin.')
        setTimeout(() => setTestShareStatus(''), 5000)
        return
      }
      setTestShareStatus('Enqueuing test link…')
      const { enqueueShare } = await import('../shareQueue.js')
      await enqueueShare('https://github.com/amethyst/amethyst')
      setTestShareStatus('Test item added! Check Library & share queue.')
      setTimeout(() => setTestShareStatus(''), 4500)
    } catch (err) {
      if (err.name === 'AbortError') {
        setTestShareStatus('')
      } else {
        setTestShareStatus(`Failed: ${err.message}`)
      }
    }
  }

  return (
    <motion.div
      className="s"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 140,
        background: '#F2F2F7',
        maxWidth: 480,
        margin: '0 auto',
      }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="b" style={{ paddingBottom: 24, gap: 14 }}>
        {/* Header */}
        <div className="r sp">
          <button
            type="button"
            className="ib"
            aria-label="Back"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="ttl" style={{ fontSize: 17 }}>
            Settings
          </div>
          <span style={{ width: 44 }} />
        </div>

        {/* General Section */}
        <div className="m" style={{ margin: '4px 0 -6px 4px' }}>
          General
        </div>
        <div className="c" style={{ padding: '4px 16px' }}>
          {/* Notifications */}
          <div className="r" style={{ padding: '12px 0', gap: 12, opacity: 0.55 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Notifications</div>
              <div className="m">System push & local alerts</div>
            </div>
            <span className="ch" style={{ fontSize: 11, padding: '3px 8px', color: '#6E6E73' }}>
              OS Managed
            </span>
          </div>

          <div className="hr" />

          {/* Appearance */}
          <div
            className="r"
            style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
            onClick={() => setAppearance(appearance === 'Graphite' ? 'System' : 'Graphite')}
          >
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Appearance</div>
              <div className="m">{appearance}</div>
            </div>
            <span style={{ color: '#8E8E93', display: 'flex' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </div>

          <div className="hr" />

          {/* Language */}
          <div className="r" style={{ padding: '12px 0', gap: 12, opacity: 0.55 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Language</div>
            </div>
            <span className="ch" style={{ fontSize: 11, padding: '3px 8px', color: '#6E6E73' }}>
              English (System)
            </span>
          </div>
        </div>

        {/* Connections Section */}
        <div className="m" style={{ margin: '4px 0 -6px 4px' }}>
          Connections & Sync
        </div>
        <div className="c" style={{ padding: '4px 16px' }}>
          {/* PC Host IP */}
          <div style={{ padding: '12px 0' }}>
            <div className="r sp" style={{ marginBottom: editingHost ? 8 : 0 }}>
              <div className="r" style={{ gap: 12 }}>
                <span className="it">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="20" height="14" x="2" y="3" rx="2" />
                    <line x1="8" x2="16" y1="21" y2="21" />
                    <line x1="12" x2="12" y1="17" y2="21" />
                  </svg>
                </span>
                <div>
                  <div style={{ fontWeight: 500 }}>PC Host Address</div>
                  <div className="m" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                    {pcHost || 'Not configured'}
                  </div>
                </div>
              </div>
              {!editingHost ? (
                <button
                  type="button"
                  className="ch glass"
                  style={{ fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}
                  onClick={() => {
                    setHostInput(pcHost)
                    setEditingHost(true)
                  }}
                >
                  Edit
                </button>
              ) : null}
            </div>

            {editingHost && (
              <div className="r" style={{ gap: 8, marginTop: 8 }}>
                <input
                  value={hostInput}
                  onChange={(e) => setHostInput(e.target.value)}
                  placeholder="e.g. 192.168.1.100:8000"
                  style={{
                    flex: 1,
                    height: 38,
                    padding: '0 12px',
                    borderRadius: 10,
                    border: '1px solid #D1D1D6',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  type="button"
                  className="bt"
                  style={{ minHeight: 38, padding: '0 14px', fontSize: 13 }}
                  onClick={handleSaveHost}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="ch"
                  style={{ minHeight: 38, padding: '0 12px', fontSize: 13 }}
                  onClick={() => setEditingHost(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="hr" />

          {/* Models */}
          <div className="r" style={{ padding: '12px 0', gap: 12, opacity: 0.55 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="16" height="16" x="4" y="4" rx="2" />
                <rect width="6" height="6" x="9" y="9" rx="1" />
                <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Models & Keys</div>
              <div className="m">Local & cloud LLM configuration</div>
            </div>
            <span className="ch" style={{ fontSize: 11, padding: '3px 8px', color: '#6E6E73' }}>
              PC Only
            </span>
          </div>

          <div className="hr" />

          {/* Connectors */}
          <div className="r" style={{ padding: '12px 0', gap: 12, opacity: 0.55 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22v-5" />
                <path d="M9 8V2" />
                <path d="M15 8V2" />
                <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Connectors</div>
              <div className="m">Mail, calendar, GitHub</div>
            </div>
            <span className="ch" style={{ fontSize: 11, padding: '3px 8px', color: '#6E6E73' }}>
              PC Only
            </span>
          </div>

          <div className="hr" />

          {/* Microsoft To Do */}
          <div className="r" style={{ padding: '12px 0', gap: 12, opacity: 0.55 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Microsoft To Do</div>
            </div>
            <span className="ch" style={{ fontSize: 11, padding: '3px 8px', color: '#6E6E73' }}>
              PC Only
            </span>
          </div>

          <div className="hr" />

          {/* Phone sharing */}
          <div className="r" style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Phone sharing</div>
              <div className="m">Queue while PC is offline</div>
            </div>
            <button
              type="button"
              className={`tg ${phoneSharingEnabled ? '' : 'off'}`}
              aria-label="Toggle phone sharing"
              onClick={() => setPhoneSharingEnabled(!phoneSharingEnabled)}
            >
              <i />
            </button>
          </div>
        </div>

        {/* Android Share Menu Pinning Guide Section */}
        <div className="m" style={{ margin: '4px 0 -6px 4px' }}>
          Android Share Sheet
        </div>
        <div className="c col" style={{ padding: '14px 16px', gap: 10 }}>
          <div className="r" style={{ gap: 10 }}>
            <span className="it" style={{ background: '#E5F0FF', color: '#0071E3' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
                <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Pin Amethyst in Share Menu</div>
              <div className="m" style={{ fontSize: 12, marginTop: 2 }}>
                Share links, articles, and reels directly into your Library
              </div>
            </div>
          </div>

          <div
            style={{
              background: '#F2F2F7',
              borderRadius: 12,
              padding: '10px 14px',
              fontSize: 12.5,
              lineHeight: 1.45,
              color: '#3A3A3C',
            }}
          >
            <strong>How to Pin:</strong> Open Chrome, Twitter, or Instagram &rarr; Tap <em>Share</em> &rarr; Find <strong>Amethyst</strong> in app list &rarr; Long-press Amethyst &rarr; Tap <strong>Pin</strong> to lock it at the top.
          </div>

          <div className="r sp" style={{ marginTop: 2 }}>
            <button
              type="button"
              className="ch glass"
              style={{ fontSize: 12.5, padding: '7px 14px', cursor: 'pointer' }}
              onClick={handleTestShare}
            >
              Send test share
            </button>
            {testShareStatus && (
              <span className="m" style={{ color: '#0071E3', fontSize: 12, fontWeight: 500 }}>
                {testShareStatus}
              </span>
            )}
          </div>
        </div>

        {/* Security Section */}
        <div className="m" style={{ margin: '4px 0 -6px 4px' }}>
          Security
        </div>
        <div className="c" style={{ padding: '4px 16px' }}>
          {/* Face ID Switch */}
          <div className="r" style={{ padding: '12px 0', gap: 12 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Unlock with Biometrics</div>
            </div>
            <button
              type="button"
              className={`tg ${faceIdEnabled ? '' : 'off'}`}
              aria-label="Toggle Face ID"
              onClick={() => setFaceIdEnabled(!faceIdEnabled)}
            >
              <i />
            </button>
          </div>

          <div className="hr" />

          {/* Linked Devices */}
          <div className="r" style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                <path d="M12 18h.01" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Linked devices</div>
              <div className="m">{transportMode || 'Primary PC (Active)'}</div>
            </div>
            <span style={{ color: '#8E8E93', display: 'flex' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </div>

          <div className="hr" />

          {/* Approvals */}
          <div className="r" style={{ padding: '12px 0', gap: 12, opacity: 0.55 }}>
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Approvals</div>
              <div className="m">Ask before risky actions</div>
            </div>
            <span className="ch" style={{ fontSize: 11, padding: '3px 8px', color: '#6E6E73' }}>
              Managed on PC
            </span>
          </div>

          <div className="hr" />

          {/* Connection Diagnostics */}
          <div
            className="r"
            style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
            onClick={onOpenDiagnostics}
          >
            <span className="it">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Connection diagnostics</div>
              <div className="m">Ping, latency, network trace</div>
            </div>
            <span style={{ color: '#8E8E93', display: 'flex' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </div>

          {/* Spike Harness (Debug) */}
          <div
            className="r"
            style={{ padding: '12px 0', gap: 12, cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.06)' }}
            onClick={onOpenSpikes}
          >
            <span className="it" style={{ color: '#10b981' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: '#10b981' }}>Spike Harness (Debug)</div>
              <div className="m">Run T1-T8 tests & export results.json</div>
            </div>
            <span style={{ color: '#10b981', display: 'flex' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </div>

          <div className="hr" />

          {/* Revoke This Phone */}
          <div
            className="r"
            style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
            onClick={() => setShowRevokeConfirm(true)}
          >
            <span className="it" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: '#DC2626' }}>Revoke this phone</div>
              <div className="m">Invalidates access on PC & clears encrypted credentials</div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showRevokeConfirm && (
          <motion.div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '0 16px calc(16px + env(safe-area-inset-bottom, 0px)) 16px',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRevokeConfirm(false)}
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxWidth: 400,
                width: '100%',
                margin: '0 auto',
              }}
            >
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.94)',
                  borderRadius: 14,
                  overflow: 'hidden',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                  textAlign: 'center',
                }}
              >
                <div style={{ padding: '16px 20px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    Revoke This Phone
                  </div>
                  <div style={{ fontSize: 13, color: '#3A3A3C', lineHeight: 1.4 }}>
                    This phone will be removed from your PC and its access token revoked immediately. Synced encrypted credentials will be permanently erased.
                  </div>
                </div>
                <div style={{ height: 1, background: 'rgba(60, 60, 67, 0.12)' }} />
                <button
                  type="button"
                  disabled={revoking}
                  onClick={async () => {
                    setRevoking(true)
                    try {
                      await onUnpair?.()
                    } finally {
                      setRevoking(false)
                      setShowRevokeConfirm(false)
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '16px',
                    background: 'transparent',
                    border: 'none',
                    color: '#FF3B30',
                    fontSize: 17,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'inherit',
                  }}
                >
                  {revoking ? 'Revoking…' : 'Revoke Phone & Disconnect'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowRevokeConfirm(false)}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: '#FFFFFF',
                  borderRadius: 14,
                  border: 'none',
                  color: '#007AFF',
                  fontSize: 17,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
