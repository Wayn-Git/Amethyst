import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, getBase } from '../../api.js'
import { usePairingStatus } from '../pairingVault.js'
import PairPrompt from './PairPrompt.jsx'

const STREAM_TIMEOUT_SECONDS = 45

function isTokenRejectedError(err) {
  if (!err) return false
  const status = err.status || err.statusCode
  if (status === 401 || status === 403) return true
  const msg = (err.message || String(err)).toLowerCase()
  return (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('pair a device') ||
    msg.includes('token was rejected') ||
    msg.includes('revoked')
  )
}

export default function MobilePC({ telemetry, isOnline, onOpenTerminal }) {
  const { isPaired, isRejected, token, markRejected, clearRejected } = usePairingStatus()

  const [screenshotData, setScreenshotData] = useState(null)
  const [loadingScreenshot, setLoadingScreenshot] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamSecondsLeft, setStreamSecondsLeft] = useState(STREAM_TIMEOUT_SECONDS)
  const [streamNotice, setStreamNotice] = useState('')
  const [fullscreenPreview, setFullscreenPreview] = useState(false)
  const [actionNotice, setActionNotice] = useState('')
  const [rescanModalOpen, setRescanModalOpen] = useState(false)

  // Applications list modal state
  const [apps, setApps] = useState([])
  const [appsModalOpen, setAppsModalOpen] = useState(false)
  const [loadingApps, setLoadingApps] = useState(false)
  const [appSearch, setAppSearch] = useState('')

  const timerRef = useRef(null)

  // No mock data: show actual telemetry or '--'
  const cpu = telemetry?.cpu_percent !== undefined ? `${Math.round(telemetry.cpu_percent)}%` : '--'
  const mem = telemetry?.memory_used_gb !== undefined ? `${telemetry.memory_used_gb.toFixed(1)} GB` : '--'
  const disk = telemetry?.disk_percent !== undefined ? `${Math.round(telemetry.disk_percent)}%` : '--'

  // Still screenshot on-demand
  const loadScreenshot = useCallback(async () => {
    if (!isPaired) return
    setLoadingScreenshot(true)
    setActionNotice('')
    try {
      const res = await api.remoteScreenshot()
      if (res?.image) {
        setScreenshotData(res.image)
      }
    } catch (err) {
      if (isTokenRejectedError(err)) {
        markRejected(err.message)
      }
      setActionNotice(`Screenshot: ${err.message}`)
    } finally {
      setLoadingScreenshot(false)
    }
  }, [isPaired, markRejected])

  // Auto-close countdown timer for live screen stream
  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    setStreamSecondsLeft(STREAM_TIMEOUT_SECONDS)
    setStreamNotice('')

    timerRef.current = setInterval(() => {
      setStreamSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          setIsStreaming(false)
          setStreamNotice('Live view paused after 45s to conserve PC resources & connection.')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isStreaming])

  const startStream = () => {
    if (!isPaired || isRejected) return
    setIsStreaming(true)
    setStreamSecondsLeft(STREAM_TIMEOUT_SECONDS)
    setStreamNotice('')
  }

  const stopStream = () => {
    setIsStreaming(false)
    if (timerRef.current) clearInterval(timerRef.current)
    setStreamNotice('')
  }

  const extendStream = () => {
    setStreamSecondsLeft(STREAM_TIMEOUT_SECONDS)
  }

  const handlePowerAction = async (action) => {
    if (!isPaired || isRejected) return
    try {
      setActionNotice(`Requesting ${action}…`)
      await api.remotePower(action)
      setActionNotice(`Sent ${action} command to your PC.`)
    } catch (err) {
      if (isTokenRejectedError(err)) {
        markRejected(err.message)
      }
      setActionNotice(`Power failed: ${err.message}`)
    }
  }

  const handleOpenAppsModal = async () => {
    if (!isPaired || isRejected) return
    setAppsModalOpen(true)
    setLoadingApps(true)
    try {
      const res = await api.remoteApplications()
      if (Array.isArray(res)) setApps(res)
      else if (res?.applications) setApps(res.applications)
    } catch (err) {
      if (isTokenRejectedError(err)) {
        markRejected(err.message)
      }
      console.warn('[MobilePC] Failed fetching apps:', err.message)
    } finally {
      setLoadingApps(false)
    }
  }

  const handleLaunchApp = async (app) => {
    const target = app.id || app.name || app
    try {
      setActionNotice(`Launching ${app.name || app}…`)
      await api.remoteLaunchApp(target)
      setAppsModalOpen(false)
      setActionNotice(`Launched ${app.name || app}`)
    } catch (err) {
      if (isTokenRejectedError(err)) {
        markRejected(err.message)
      }
      setActionNotice(`Launch failed: ${err.message}`)
    }
  }

  const base = getBase()
  const streamUrl = isPaired && !isRejected && token
    ? `${base}/remote/screen/stream?token=${encodeURIComponent(token)}`
    : ''

  // 1. UNPAIRED STATE: Render lazy PairPrompt, no mock data, no broken streams
  if (!isPaired) {
    return (
      <motion.div
        className="b"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="r sp" style={{ marginBottom: 4 }}>
          <h1 className="h">My PC</h1>
        </div>

        <PairPrompt />
      </motion.div>
    )
  }

  // 2. PAIRED STATE: Render live controls, plus Re-scan QR banner if rejected
  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Top Header */}
      <div className="r sp">
        <div>
          <div className="gl">Desktop at home</div>
          <h1 className="h">My PC</h1>
        </div>
        <span className="ch">
          <span className={`d ${isOnline && !isRejected ? '' : 'w'}`} />
          {isRejected ? 'Rejected' : isOnline ? 'Online' : 'Connecting'}
        </span>
      </div>

      {/* Rejected Token Re-scan Banner on these screens only */}
      {isRejected && (
        <aside
          className="rescan-banner"
          role="alert"
          style={{
            background: 'rgba(217, 84, 30, 0.12)',
            border: '1px solid rgba(217, 84, 30, 0.3)',
            borderRadius: 16,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: '#D9541E', fontSize: 13 }}>
              Pairing token rejected
            </div>
            <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 2 }}>
              Your PC rejected the pairing token. Re-scan the QR code to reconnect.
            </div>
          </div>
          <button
            type="button"
            className="bt l"
            style={{
              height: 36,
              minHeight: 36,
              padding: '0 14px',
              fontSize: 12,
              flexShrink: 0,
              background: '#D9541E',
            }}
            onClick={() => setRescanModalOpen(true)}
            aria-label="Re-scan QR"
          >
            Re-scan QR
          </button>
        </aside>
      )}

      {/* PC Live Screen & Screenshot Frame */}
      <div
        className="blk"
        style={{
          minHeight: 190,
          position: 'relative',
          padding: 0,
          overflow: 'hidden',
          borderRadius: 24,
          background: '#0B0B0C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={isStreaming ? extendStream : undefined}
      >
        {isStreaming && streamUrl ? (
          <img
            src={streamUrl}
            alt="Live PC Screen"
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            onError={() => {
              stopStream()
              setStreamNotice('Live stream disconnected. Tap to retry.')
            }}
          />
        ) : screenshotData ? (
          <img
            src={screenshotData.startsWith('data:') ? screenshotData : `data:image/jpeg;base64,${screenshotData}`}
            alt="PC Desktop Screen"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            className="col"
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              width: '100%',
              height: '100%',
              padding: '24px 16px',
              background: 'radial-gradient(ellipse at center, #1C1C1E 0%, #0B0B0C 100%)',
              color: '#8E8E93',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                background: 'rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#A1A1A6',
              }}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>
                Desktop View Off
              </div>
              <div className="m" style={{ fontSize: 11.5, marginTop: 2, color: '#8E8E93' }}>
                Start live stream or take a quick screenshot
              </div>
            </div>
          </div>
        )}

        {/* Live Streaming Badge & Timer */}
        {isStreaming && (
          <div
            className="r"
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              gap: 6,
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(10px)',
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 11,
              color: '#34C759',
              fontWeight: 500,
            }}
          >
            <span className="d" style={{ background: '#34C759' }} />
            <span>Live • {streamSecondsLeft}s</span>
          </div>
        )}

        {/* Action Overlay Controls */}
        <div className="r" style={{ position: 'absolute', right: 12, bottom: 12, gap: 8 }}>
          {isStreaming ? (
            <button
              type="button"
              className="ib"
              aria-label="Pause live stream"
              style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', color: '#fff', width: 40, height: 40 }}
              onClick={stopStream}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="ib"
              aria-label="Start live screen stream"
              style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', color: '#fff', width: 40, height: 40 }}
              onClick={startStream}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className="ib"
            aria-label="Capture still screenshot"
            style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', color: '#fff', width: 40, height: 40 }}
            onClick={loadScreenshot}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </button>

          {(screenshotData || isStreaming) && (
            <button
              type="button"
              className="ib"
              aria-label="Full screen"
              style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', color: '#fff', width: 40, height: 40 }}
              onClick={() => setFullscreenPreview(true)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Stream Auto-Close Status / Notice */}
      {streamNotice && (
        <div
          className="r sp"
          style={{
            background: 'rgba(0,113,227,0.08)',
            border: '1px solid rgba(0,113,227,0.16)',
            borderRadius: 14,
            padding: '8px 12px',
            fontSize: 12,
            color: '#0071E3',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{streamNotice}</span>
          <button
            type="button"
            className="ch"
            style={{ flexShrink: 0, fontSize: 11, padding: '3px 8px' }}
            onClick={startStream}
          >
            Resume
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="m" style={{ textAlign: 'center', color: '#0071E3', fontSize: 12 }}>
          {actionNotice}
        </div>
      )}

      {/* Telemetry 3-Column Grid (real values or '--') */}
      <div className="g3" style={{ gap: 8 }}>
        <div className="c" style={{ padding: '12px 14px' }}>
          <div className="m">CPU</div>
          <div className="dsp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {cpu}
          </div>
        </div>
        <div className="c" style={{ padding: '12px 14px' }}>
          <div className="m">Memory</div>
          <div className="dsp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {mem}
          </div>
        </div>
        <div className="c" style={{ padding: '12px 14px' }}>
          <div className="m">Disk</div>
          <div className="dsp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {disk}
          </div>
        </div>
      </div>

      {/* Remote Quick Actions Grid */}
      <div className="g3">
        <button
          type="button"
          className="c act"
          style={{
            border: 0,
            font: "500 13px 'Inter', sans-serif",
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
          }}
          onClick={isStreaming ? stopStream : startStream}
        >
          <span className="it" style={{ color: isStreaming ? '#34C759' : '#1D1D1F' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
          </span>
          {isStreaming ? 'Stop stream' : 'View screen'}
        </button>

        <button
          type="button"
          className="c act"
          style={{
            border: 0,
            font: "500 13px 'Inter', sans-serif",
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
          }}
          onClick={handleOpenAppsModal}
        >
          <span className="it">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="7" height="7" x="3" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="14" rx="1" />
              <rect width="7" height="7" x="3" y="14" rx="1" />
            </svg>
          </span>
          Apps
        </button>

        <button
          type="button"
          className="c act"
          style={{
            border: 0,
            font: "500 13px 'Inter', sans-serif",
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
          }}
          onClick={onOpenTerminal}
        >
          <span className="it">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" x2="20" y1="19" y2="19" />
            </svg>
          </span>
          Terminal
        </button>

        <button
          type="button"
          className="c act"
          style={{
            border: 0,
            font: "500 13px 'Inter', sans-serif",
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
          }}
          onClick={() => handlePowerAction('lock')}
        >
          <span className="it">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          Lock
        </button>

        <button
          type="button"
          className="c act"
          style={{
            border: 0,
            font: "500 13px 'Inter', sans-serif",
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
          }}
          onClick={() => handlePowerAction('sleep')}
        >
          <span className="it">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </span>
          Sleep
        </button>

        <button
          type="button"
          className="c act"
          style={{
            border: 0,
            font: "500 13px 'Inter', sans-serif",
            color: '#B8430F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
          }}
          onClick={() => {
            if (window.confirm('Shut down your PC?')) handlePowerAction('shutdown')
          }}
        >
          <span className="it" style={{ color: '#B8430F' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
            </svg>
          </span>
          Shut down
        </button>
      </div>

      {/* Fullscreen Preview Modal */}
      <AnimatePresence>
        {fullscreenPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              background: '#000',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="r sp" style={{ padding: 16, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }}>
              <div className="r" style={{ gap: 8 }}>
                <span style={{ color: '#fff', fontWeight: 600 }}>PC Screen</span>
                {isStreaming && (
                  <span style={{ color: '#34C759', fontSize: 12 }}>• Live ({streamSecondsLeft}s)</span>
                )}
              </div>
              <button
                type="button"
                className="ch glass"
                onClick={() => setFullscreenPreview(false)}
              >
                Close
              </button>
            </div>
            <div
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={isStreaming ? extendStream : undefined}
            >
              {isStreaming && streamUrl ? (
                <img
                  src={streamUrl}
                  alt="Live PC Desktop Screen"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : screenshotData ? (
                <img
                  src={screenshotData.startsWith('data:') ? screenshotData : `data:image/jpeg;base64,${screenshotData}`}
                  alt="PC Desktop Screen"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Applications Modal */}
      <AnimatePresence>
        {appsModalOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 150,
              background: '#F2F2F7',
              display: 'flex',
              flexDirection: 'column',
              padding: 'max(18px, env(safe-area-inset-top, 18px)) 18px max(18px, env(safe-area-inset-bottom, 18px))',
            }}
          >
            <div className="r sp" style={{ marginBottom: 12 }}>
              <div className="ttl" style={{ fontSize: 18 }}>Installed Applications</div>
              <button
                type="button"
                className="ch"
                onClick={() => setAppsModalOpen(false)}
              >
                Done
              </button>
            </div>

            <div
              className="r"
              style={{
                background: '#FFFFFF',
                borderRadius: 999,
                padding: '0 14px',
                boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                marginBottom: 12,
                height: 44,
                minHeight: 44,
                maxHeight: 44,
                flex: 'none',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                style={{
                  flex: 1,
                  border: 0,
                  outline: 0,
                  background: 'transparent',
                  font: "14px 'Inter', sans-serif",
                  color: '#1D1D1F',
                  height: '100%',
                }}
                placeholder="Search applications…"
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
              />
            </div>

            <div className="c col" style={{ flex: 1, overflowY: 'auto', gap: 2 }}>
              {loadingApps ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#6E6E73' }}>
                  Loading applications…
                </div>
              ) : (
                apps
                  .filter((a) => (a.name || a).toLowerCase().includes(appSearch.toLowerCase()))
                  .map((app, idx) => {
                    const iconSrc = app.icon_url
                      ? `${base}${app.icon_url}${token ? `&token=${encodeURIComponent(token)}` : ''}`
                      : null
                    return (
                      <div
                        key={app.id || idx}
                        className="r sp"
                        style={{
                          padding: '10px 4px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #E5E5EA',
                          alignItems: 'center',
                          gap: 12,
                        }}
                        onClick={() => handleLaunchApp(app)}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            background: '#F2F2F7',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            flexShrink: 0,
                            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                          }}
                        >
                          {iconSrc ? (
                            <img
                              src={iconSrc}
                              alt=""
                              style={{ width: 28, height: 28, objectFit: 'contain' }}
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : (
                            <span style={{ fontWeight: 600, fontSize: 15, color: '#6E6E73' }}>
                              {(app.name || 'A').charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {app.name || app}
                          </div>
                          {app.comment && (
                            <div className="m" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                              {app.comment}
                            </div>
                          )}
                        </div>

                        <span className="ch" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>
                          Launch
                        </span>
                      </div>
                    )
                  })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Re-scan QR Modal */}
      <AnimatePresence>
        {rescanModalOpen && (
          <PairPrompt
            isRejected
            onPaired={() => {
              clearRejected()
              setRescanModalOpen(false)
            }}
            onScan={() => {}}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
