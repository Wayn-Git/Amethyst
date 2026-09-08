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

  const [activeTab, setActiveTab] = useState('bookmarklet') // 'bookmarklet' | 'share' | 'instagram'
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  // Share token state
  const [shareStatus, setShareStatus] = useState(null)
  const [shareToken, setShareToken] = useState('')

  // Instagram state
  const [igState, setIgState] = useState(null)
  const [igBusy, setIgBusy] = useState('')
  const [igForm, setIgForm] = useState({
    app_secret: '',
    verify_token: '',
    access_token: '',
    owner: '',
  })
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

  // Instagram actions
  const runIg = async (key, work, note) => {
    setIgBusy(key)
    try {
      setIgState(await work())
      if (note) toast(note, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setIgBusy('')
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

  const saveRelay = () =>
    runIg(
      'relay',
      async () => {
        const next = await api.setInstagramRelay({
          url: relayForm.url || undefined,
          token: relayForm.token || undefined,
          enabled: true,
        })
        setRelayForm({ url: '', token: '' })
        return next
      },
      'Relay connected'
    )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          onMouseDown={onOverlayMouseDown(onClose)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="modal lib-integrations-modal"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Capture Integrations"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
        <div className="modal-head">
          <div>
            <div className="lib-header-eyebrow mono">
              <Icon name="link" size={12} />
              <span>External Capture</span>
            </div>
            <h2 className="modal-title">Capture & Integrations</h2>
          </div>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Segmented Pill Tabs */}
        <div className="lib-modal-tabs" role="tablist">
          <button
            type="button"
            className={`lib-modal-tab ${activeTab === 'bookmarklet' ? 'lib-modal-tab--active' : ''}`}
            onClick={() => setActiveTab('bookmarklet')}
            role="tab"
            aria-selected={activeTab === 'bookmarklet'}
          >
            <Icon name="book" size={13} />
            <span>Bookmarklet</span>
          </button>
          <button
            type="button"
            className={`lib-modal-tab ${activeTab === 'share' ? 'lib-modal-tab--active' : ''}`}
            onClick={() => setActiveTab('share')}
            role="tab"
            aria-selected={activeTab === 'share'}
          >
            <Icon name="send" size={13} />
            <span>Mobile Share Token</span>
          </button>
          <button
            type="button"
            className={`lib-modal-tab ${activeTab === 'instagram' ? 'lib-modal-tab--active' : ''}`}
            onClick={() => setActiveTab('instagram')}
            role="tab"
            aria-selected={activeTab === 'instagram'}
          >
            <Icon name="image" size={13} />
            <span>Instagram Reels</span>
          </button>
        </div>

        <div className="lib-modal-body">
          {/* 1. Bookmarklet Tab */}
          {activeTab === 'bookmarklet' && (
            <div className="lib-integ-section">
              <div className="lib-integ-card">
                <div className="lib-integ-card-head">
                  <div className="lib-integ-card-title">Browser One-Click Bookmarklet</div>
                  <span className="lib-integ-badge mono">Zero Config</span>
                </div>
                <p className="lib-integ-desc">
                  Drag this button directly to your browser's bookmarks bar. Whenever you are on an article, paper, or video page, click it to immediately capture it into AMETHYST.
                </p>

                <div className="lib-bookmarklet-target-box">
                  <a
                    className="btn btn--primary lib-bookmarklet-btn"
                    href={bookmarklet(origin)}
                    onClick={(e) => e.preventDefault()}
                    title="Drag this button to your bookmarks bar"
                  >
                    <Icon name="plus" size={14} /> Save to AMETHYST
                  </a>
                  <span className="lib-bookmarklet-hint mono">← Drag to Bookmarks Bar</span>
                </div>
              </div>

              <div className="lib-integ-steps">
                <div className="lib-integ-step">
                  <span className="lib-step-num mono">1</span>
                  <span>Drag the button into your browser bookmarks bar</span>
                </div>
                <div className="lib-integ-step">
                  <span className="lib-step-num mono">2</span>
                  <span>Visit any article, tutorial, paper, or video on the web</span>
                </div>
                <div className="lib-integ-step">
                  <span className="lib-step-num mono">3</span>
                  <span>Click <b>Save to AMETHYST</b> to capture and index in real-time</span>
                </div>
              </div>
            </div>
          )}

          {/* 2. Mobile Share Token Tab */}
          {activeTab === 'share' && (
            <div className="lib-integ-section">
              <div className="lib-integ-card">
                <div className="lib-integ-card-head">
                  <div>
                    <div className="lib-integ-card-title">Mobile Shortcut Capture Token</div>
                    <div className="lib-integ-subtitle">
                      Endpoint: <code>POST /api/share/capture</code>
                    </div>
                  </div>
                  <span
                    className={`lib-integ-status-pill mono ${
                      shareStatus?.enabled
                        ? 'lib-integ-status-pill--active'
                        : 'lib-integ-status-pill--inactive'
                    }`}
                  >
                    {shareStatus?.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <p className="lib-integ-desc">
                  Use this token in an iOS Shortcut or Android webhook to send links straight from your phone's Share sheet into your library.
                </p>

                <div className="lib-integ-actions-row">
                  {shareStatus?.enabled ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={rotateToken}
                      >
                        Rotate Token
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--ghost lib-btn-danger"
                        onClick={revokeToken}
                      >
                        Revoke Access
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--small btn--primary" onClick={rotateToken}>
                      Generate Token
                    </button>
                  )}
                </div>

                {shareToken && (
                  <div className="lib-token-display">
                    <code>{shareToken}</code>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => {
                        copyText(shareToken)
                        toast('Token copied to clipboard', 'ok')
                      }}
                    >
                      <Icon name="copy" size={13} /> Copy
                    </button>
                  </div>
                )}
              </div>

              <div className="lib-integ-callout">
                <Icon name="info" size={13} />
                <span>
                  Capture-only endpoint: this token cannot read, list, or execute anything on your system.
                </span>
              </div>
            </div>
          )}

          {/* 3. Instagram Capture Tab */}
          {activeTab === 'instagram' && (
            <div className="lib-integ-section">
              {!igState ? (
                <div className="lib-integ-loading mono">Loading Instagram settings...</div>
              ) : !igState.configured ? (
                <div className="lib-integ-card">
                  <div className="lib-integ-card-head">
                    <div className="lib-integ-card-title">Setup Meta Credentials</div>
                  </div>
                  <p className="lib-integ-desc">
                    Enter your Meta app credentials to enable reel capturing. They are stored securely in your OS keychain.
                  </p>
                  <div className="lib-manual-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <input
                      className="lib-input"
                      placeholder="App secret"
                      type="password"
                      value={igForm.app_secret}
                      onChange={(e) => setIgForm({ ...igForm, app_secret: e.target.value })}
                    />
                    <input
                      className="lib-input"
                      placeholder="Verify token"
                      value={igForm.verify_token}
                      onChange={(e) => setIgForm({ ...igForm, verify_token: e.target.value })}
                    />
                    <input
                      className="lib-input"
                      placeholder="Access token"
                      type="password"
                      value={igForm.access_token}
                      onChange={(e) => setIgForm({ ...igForm, access_token: e.target.value })}
                    />
                    <input
                      className="lib-input"
                      placeholder="Your Instagram account ID"
                      value={igForm.owner}
                      onChange={(e) => setIgForm({ ...igForm, owner: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    style={{ marginTop: 12 }}
                    disabled={igBusy === 'save'}
                    onClick={() =>
                      runIg(
                        'save',
                        async () => {
                          const saved = await api.saveInstagramCredentials({
                            app_secret: igForm.app_secret || null,
                            verify_token: igForm.verify_token || null,
                            access_token: igForm.access_token || null,
                            expires_in_days: igForm.access_token ? 60 : null,
                          })
                          if (igForm.owner) await api.updateInstagram({ owner_ig_id: igForm.owner })
                          setIgForm({ app_secret: '', verify_token: '', access_token: '', owner: '' })
                          return saved
                        },
                        'Credentials stored'
                      )
                    }
                  >
                    Save Credentials
                  </button>
                </div>
              ) : (
                <div className="lib-integ-rows">
                  {/* Webhook row */}
                  <div className="lib-integ-row">
                    <div>
                      <div className="lib-integ-row-title">Accepting Deliveries</div>
                      <div className="lib-integ-row-sub mono">{origin}{igState.webhook_path}</div>
                    </div>
                    <button
                      type="button"
                      className={`btn btn--small ${igState.settings.enabled ? 'btn--primary' : 'btn--ghost'}`}
                      disabled={igBusy === 'toggle'}
                      onClick={() =>
                        runIg(
                          'toggle',
                          () => api.updateInstagram({ enabled: !igState.settings.enabled }),
                          igState.settings.enabled ? 'Capture paused' : 'Capture active'
                        )
                      }
                    >
                      {igState.settings.enabled ? 'Active' : 'Paused'}
                    </button>
                  </div>

                  {/* Relay row */}
                  <div className="lib-integ-row">
                    <div>
                      <div className="lib-integ-row-title">Cloudflare Worker Relay</div>
                      <div className="lib-integ-row-sub mono">
                        {igState.relay.ready ? igState.relay.url : 'Not connected'}
                      </div>
                    </div>
                    {igState.relay.ready ? (
                      <div className="lib-integ-row-actions">
                        <button
                          type="button"
                          className="btn btn--small btn--ghost"
                          disabled={relaySyncing}
                          onClick={syncRelay}
                        >
                          {relaySyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--ghost lib-btn-danger"
                          disabled={igBusy === 'relay-off'}
                          onClick={() =>
                            runIg(
                              'relay-off',
                              () => api.clearInstagramRelay(),
                              'Relay disconnected'
                            )
                          }
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <div className="lib-integ-form-inline">
                        <input
                          className="lib-input"
                          placeholder="Worker URL"
                          value={relayForm.url}
                          onChange={(e) => setRelayForm({ ...relayForm, url: e.target.value })}
                        />
                        <input
                          className="lib-input"
                          type="password"
                          placeholder="Token"
                          value={relayForm.token}
                          onChange={(e) => setRelayForm({ ...relayForm, token: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          disabled={igBusy === 'relay' || !relayForm.url || !relayForm.token}
                          onClick={saveRelay}
                        >
                          Connect
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Transcription info */}
                  <div className="lib-integ-row">
                    <div>
                      <div className="lib-integ-row-title">Whisper Audio Transcription</div>
                      <div className="lib-integ-row-sub">
                        {igState.transcription
                          ? `${igState.transcription.provider} · ${igState.transcription.model}`
                          : 'No transcription provider configured'}
                      </div>
                    </div>
                    <span className="lib-integ-badge mono">
                      {igState.ffmpeg ? 'ffmpeg ready' : 'ffmpeg missing'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  )
}

// Backward-compatible stubs if needed
export function SharePanel({ _toast } = {}) {
  return null
}
export function InstagramPanel({ _toast } = {}) {
  return null
}
