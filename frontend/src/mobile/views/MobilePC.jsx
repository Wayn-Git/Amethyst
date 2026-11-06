import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api, getBase } from '../../api.js'

export default function MobilePC({ telemetry, isOnline, onOpenTerminal }) {
  const [screenshotData, setScreenshotData] = useState(null)
  const [loadingScreenshot, setLoadingScreenshot] = useState(false)
  const [fullscreenPreview, setFullscreenPreview] = useState(false)
  const [actionNotice, setActionNotice] = useState('')

  // Applications list modal state
  const [apps, setApps] = useState([])
  const [appsModalOpen, setAppsModalOpen] = useState(false)
  const [loadingApps, setLoadingApps] = useState(false)
  const [appSearch, setAppSearch] = useState('')

  // Telemetry values
  const cpu = telemetry?.cpu_percent !== undefined ? `${Math.round(telemetry.cpu_percent)}%` : '--%'
  const mem = telemetry?.memory_used_gb ? `${telemetry.memory_used_gb.toFixed(1)} GB` : '-- GB'
  const disk = telemetry?.disk_percent !== undefined ? `${Math.round(telemetry.disk_percent)}%` : '--%'

  const loadScreenshot = useCallback(async () => {
    setLoadingScreenshot(true)
    try {
      const res = await api.remoteScreenshot()
      if (res?.image) {
        setScreenshotData(res.image)
      }
    } catch (err) {
      setActionNotice(`Screenshot failed: ${err.message}`)
    } finally {
      setLoadingScreenshot(false)
    }
  }, [])

  useEffect(() => {
    loadScreenshot()
  }, [loadScreenshot])

  const handlePowerAction = async (action) => {
    try {
      setActionNotice(`Requesting ${action}…`)
      await api.remotePower(action)
      setActionNotice(`Sent ${action} command to your PC.`)
    } catch (err) {
      setActionNotice(`Power failed: ${err.message}`)
    }
  }

  const handleOpenApps = async () => {
    setAppsModalOpen(true)
    setLoadingApps(true)
    try {
      const res = await api.remoteApplications()
      if (res?.applications) {
        setApps(res.applications)
      }
    } catch (err) {
      setActionNotice(`Failed to list apps: ${err.message}`)
    } finally {
      setLoadingApps(false)
    }
  }

  const handleLaunchApp = async (app) => {
    try {
      setActionNotice(`Launching ${app.name}…`)
      await api.remoteLaunchApp(app.id || app.exec || app.name)
      setActionNotice(`Launched ${app.name}!`)
      setAppsModalOpen(false)
    } catch (err) {
      setActionNotice(`Launch failed: ${err.message}`)
    }
  }

  const filteredApps = apps.filter((app) => {
    if (!appSearch.trim()) return true
    const term = appSearch.toLowerCase()
    return (
      app.name?.toLowerCase().includes(term) ||
      app.comment?.toLowerCase().includes(term) ||
      app.id?.toLowerCase().includes(term)
    )
  })

  return (
    <motion.div
      className="m-body"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="m-r m-sp">
        <div>
          <div className="m-gl">Desktop at home</div>
          <h1 className="m-h">My PC</h1>
        </div>
        <span className="m-ch">
          <span className={`m-d ${isOnline ? '' : 'w'}`} />
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Screen Preview Card */}
      <div
        className="m-blk"
        style={{
          height: 190,
          position: 'relative',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090b',
        }}
      >
        {screenshotData ? (
          <img
            src={screenshotData}
            alt="Desktop screen stream"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onClick={() => setFullscreenPreview(true)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#A9A6A0' }}>
            <Icon name="desktop" size={28} />
            <span style={{ fontSize: 13 }}>{loadingScreenshot ? 'Capturing screen…' : 'Tap refresh to capture screen'}</span>
          </div>
        )}

        {/* Refresh & Fullscreen buttons */}
        <div className="m-r" style={{ position: 'absolute', right: 12, bottom: 12, gap: 8, zIndex: 2 }}>
          <button
            type="button"
            className="m-ib"
            style={{ background: 'rgba(30,25,20,0.85)', color: '#fff' }}
            aria-label="Refresh screenshot"
            disabled={loadingScreenshot}
            onClick={loadScreenshot}
          >
            <Icon name="arrow-clockwise" size={18} />
          </button>
          <button
            type="button"
            className="m-ib"
            style={{ background: 'rgba(30,25,20,0.85)', color: '#fff' }}
            aria-label="Full screen"
            disabled={!screenshotData}
            onClick={() => setFullscreenPreview(true)}
          >
            <Icon name="arrows-out" size={18} />
          </button>
        </div>
      </div>

      {/* 3-Column Telemetry Card */}
      <div className="m-g3" style={{ gap: 8 }}>
        <div className="m-c" style={{ padding: '12px 14px' }}>
          <div className="m-m">CPU</div>
          <div className="m-dsp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {cpu}
          </div>
        </div>
        <div className="m-c" style={{ padding: '12px 14px' }}>
          <div className="m-m">Memory</div>
          <div className="m-dsp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {mem}
          </div>
        </div>
        <div className="m-c" style={{ padding: '12px 14px' }}>
          <div className="m-m">Disk</div>
          <div className="m-dsp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {disk}
          </div>
        </div>
      </div>

      {/* 6-Tile Action Grid */}
      <div className="m-g3">
        {/* Screenshot */}
        <button
          type="button"
          className="m-c"
          style={{
            border: 0,
            font: "500 13px 'Instrument Sans', sans-serif",
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
            cursor: 'pointer',
          }}
          disabled={loadingScreenshot}
          onClick={loadScreenshot}
        >
          <span className="m-it">
            <Icon name="camera" size={20} />
          </span>
          {loadingScreenshot ? 'Taking…' : 'Screenshot'}
        </button>

        {/* Open app */}
        <button
          type="button"
          className="m-c"
          style={{
            border: 0,
            font: "500 13px 'Instrument Sans', sans-serif",
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
            cursor: 'pointer',
          }}
          onClick={handleOpenApps}
        >
          <span className="m-it">
            <Icon name="desktop" size={20} />
          </span>
          Open app
        </button>

        {/* Terminal */}
        <button
          type="button"
          className="m-c"
          style={{
            border: 0,
            font: "500 13px 'Instrument Sans', sans-serif",
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
            cursor: 'pointer',
          }}
          onClick={onOpenTerminal}
        >
          <span className="m-it">
            <Icon name="terminal" size={20} />
          </span>
          Terminal
        </button>

        {/* Lock */}
        <button
          type="button"
          className="m-c"
          style={{
            border: 0,
            font: "500 13px 'Instrument Sans', sans-serif",
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
            cursor: 'pointer',
          }}
          onClick={() => handlePowerAction('lock')}
        >
          <span className="m-it">
            <Icon name="lock" size={20} />
          </span>
          Lock
        </button>

        {/* Sleep */}
        <button
          type="button"
          className="m-c"
          style={{
            border: 0,
            font: "500 13px 'Instrument Sans', sans-serif",
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
            cursor: 'pointer',
          }}
          onClick={() => handlePowerAction('sleep')}
        >
          <span className="m-it">
            <Icon name="moon" size={20} />
          </span>
          Sleep
        </button>

        {/* Shut down */}
        <button
          type="button"
          className="m-c"
          style={{
            border: 0,
            font: "500 13px 'Instrument Sans', sans-serif",
            color: '#B8430F',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 6px',
            cursor: 'pointer',
          }}
          onClick={() => handlePowerAction('shutdown')}
        >
          <span className="m-it">
            <Icon name="power" size={20} />
          </span>
          Shut down
        </button>
      </div>

      {actionNotice && (
        <div style={{ textAlign: 'center', fontSize: 13, color: '#16a34a', marginTop: 4 }}>
          {actionNotice}
        </div>
      )}

      {/* Applications List Modal */}
      <AnimatePresence>
        {appsModalOpen && (
          <motion.div
            className="m-shell"
            style={{ position: 'fixed', inset: 0, zIndex: 130, background: '#ECEAE6' }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
          >
            <div className="m-body" style={{ paddingBottom: 24, gap: 12 }}>
              <div className="m-r m-sp">
                <button
                  type="button"
                  className="m-ib"
                  aria-label="Close"
                  onClick={() => setAppsModalOpen(false)}
                >
                  <Icon name="x" size={20} />
                </button>
                <div className="m-ttl" style={{ fontSize: 17 }}>
                  Installed Applications
                </div>
                <span style={{ width: 44 }} />
              </div>

              {/* App Search Input */}
              <div
                className="m-r"
                style={{
                  background: '#F6F4F1',
                  borderRadius: 999,
                  padding: '0 16px',
                  boxShadow: '0 1px 2px rgba(30,25,20,0.05)',
                }}
              >
                <span style={{ color: '#6E6A64', display: 'flex' }}>
                  <Icon name="search" size={18} />
                </span>
                <input
                  className="m-in"
                  placeholder="Search apps on your PC…"
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Apps List */}
              <div className="m-c" style={{ padding: '6px 16px', maxHeight: '68vh', overflowY: 'auto' }}>
                {loadingApps && (
                  <div style={{ padding: 24, textAlign: 'center', color: '#6E6A64' }}>
                    Loading installed applications from PC…
                  </div>
                )}

                {!loadingApps && filteredApps.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: '#6E6A64' }}>
                    No matching applications found.
                  </div>
                )}

                {!loadingApps &&
                  filteredApps.map((app, idx) => (
                    <div key={app.id || app.name || idx}>
                      <div
                        className="m-r m-sp"
                        style={{ padding: '12px 0', cursor: 'pointer' }}
                        onClick={() => handleLaunchApp(app)}
                      >
                        <div className="m-r" style={{ gap: 12, flex: 1, minWidth: 0 }}>
                          <span className="m-it">
                            <Icon name="desktop" size={20} />
                          </span>
                          <div className="m-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                            <div className="m-ttl" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {app.name}
                            </div>
                            {app.comment && (
                              <div className="m-m" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {app.comment}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="m-bt l"
                          style={{ minHeight: 34, padding: '0 14px', fontSize: 13 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleLaunchApp(app)
                          }}
                        >
                          Launch
                        </button>
                      </div>
                      {idx < filteredApps.length - 1 && <div className="m-hr" />}
                    </div>
                  ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Screenshot Modal */}
      <AnimatePresence>
        {fullscreenPreview && screenshotData && (
          <motion.div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 150,
              background: '#000',
              display: 'flex',
              flexDirection: 'column',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div style={{ padding: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="m-ib"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                onClick={() => setFullscreenPreview(false)}
              >
                <Icon name="x" size={20} />
              </button>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
              <img
                src={screenshotData}
                alt="Full screen desktop preview"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
