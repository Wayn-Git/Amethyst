import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import opencode from '../lib/opencode.js'
import { useApp } from '../store.jsx'
import './code.css'

export default function Code() {
  const { setView } = useApp()
  const [serverStatus, setServerStatus] = useState({
    running: false,
    port: null,
    loading: true,
    error: null,
  })
  const [syncing, setSyncing] = useState(false)
  const [syncToast, setSyncToast] = useState(null)
  const [iframeKey, setIframeKey] = useState(0)

  const checkStatus = useCallback(async (quiet = false) => {
    if (!quiet) {
      setServerStatus((prev) => ({ ...prev, loading: true, error: null }))
    }
    try {
      const data = await opencode.status()
      setServerStatus({
        running: Boolean(data?.running),
        port: data?.port || null,
        loading: false,
        error: null,
      })
    } catch (err) {
      setServerStatus({
        running: false,
        port: null,
        loading: false,
        error: err.message || 'Cannot reach Amethyst OpenCode service',
      })
    }
  }, [])

  useEffect(() => {
    checkStatus()
    const interval = setInterval(() => {
      checkStatus(true)
    }, 4000)
    return () => clearInterval(interval)
  }, [checkStatus])

  const handleStart = async () => {
    setServerStatus((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const res = await opencode.start()
      if (res?.running && res?.port) {
        setServerStatus({
          running: true,
          port: res.port,
          loading: false,
          error: null,
        })
        setIframeKey((k) => k + 1)
      } else {
        await checkStatus()
      }
    } catch (err) {
      setServerStatus((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to start OpenCode',
      }))
    }
  }

  const handleStop = async () => {
    setServerStatus((prev) => ({ ...prev, loading: true }))
    try {
      await opencode.stop()
      setServerStatus({
        running: false,
        port: null,
        loading: false,
        error: null,
      })
    } catch (err) {
      setServerStatus((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to stop OpenCode',
      }))
    }
  }

  const handleSyncKeys = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await opencode.syncAmethyst()
      const count = res?.synced?.length || 0
      setSyncToast({
        type: 'success',
        text: count > 0 ? `Synced ${count} provider keys` : 'No new keys to sync',
      })
    } catch (err) {
      setSyncToast({
        type: 'error',
        text: err.message || 'Failed to sync API keys',
      })
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncToast(null), 3500)
    }
  }

  const host = typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1'
  const opencodeUrl = serverStatus.port ? `http://${host}:${serverStatus.port}/` : ''

  const handleOpenExternal = () => {
    if (opencodeUrl) {
      window.open(opencodeUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="code-view">
      {/* Top Header with Amethyst Integration Controls */}
      <header className="code-header">
        <div className="code-header-left">
          {/* Mode Switcher (Work | Code) */}
          <div className="wb-mode-switcher">
            <button
              type="button"
              className="wb-mode-btn"
              onClick={() => setView?.('chat')}
              title="Work Mode (Conversations & Assistant)"
            >
              <Icon name="chat" size={14} />
              <span>Work</span>
            </button>
            <button
              type="button"
              className="wb-mode-btn is-active"
              title="Code Mode (OpenCode Desktop Interface)"
            >
              <Icon name="code" size={14} />
              <span>Code</span>
            </button>
          </div>

          <div className="code-brand">
            <Icon name="code" size={16} />
            <span>OpenCode Engine</span>
          </div>

          <div className="code-status-badge">
            <span
              className={`code-status-dot ${
                serverStatus.loading ? 'starting' : serverStatus.running ? 'running' : 'stopped'
              }`}
            />
            <span>
              {serverStatus.loading
                ? 'Connecting...'
                : serverStatus.running
                ? 'Connected'
                : 'Stopped'}
            </span>
            {serverStatus.port && <span className="code-port-pill">:{serverStatus.port}</span>}
          </div>

          {syncToast && (
            <div className={`code-header-toast ${syncToast.type}`}>
              <Icon name={syncToast.type === 'success' ? 'check' : 'alert'} size={13} />
              <span>{syncToast.text}</span>
            </div>
          )}
        </div>

        <div className="code-header-right">
          {serverStatus.running ? (
            <>
              <button
                type="button"
                className="code-btn"
                onClick={handleSyncKeys}
                disabled={syncing}
                title="Sync Amethyst AI provider API keys to OpenCode"
              >
                <Icon
                  name={syncing ? 'circle-notch' : 'key'}
                  size={14}
                  className={syncing ? 'spin' : ''}
                />
                <span>{syncing ? 'Syncing...' : 'Sync Keys'}</span>
              </button>

              <button
                type="button"
                className="code-btn"
                onClick={() => setIframeKey((k) => k + 1)}
                title="Reload OpenCode interface"
              >
                <Icon name="refresh" size={14} />
                <span>Reload</span>
              </button>

              <button
                type="button"
                className="code-btn"
                onClick={handleOpenExternal}
                title="Open OpenCode web interface in a dedicated browser tab"
              >
                <Icon name="external-link" size={14} />
                <span>Open in Tab</span>
              </button>

              <button
                type="button"
                className="code-btn"
                onClick={handleStop}
                title="Stop local OpenCode process"
              >
                <Icon name="stop" size={14} />
                <span>Stop</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="code-btn code-btn-primary"
              onClick={handleStart}
              disabled={serverStatus.loading}
              title="Launch OpenCode subprocess"
            >
              <Icon
                name={serverStatus.loading ? 'circle-notch' : 'play'}
                size={14}
                className={serverStatus.loading ? 'spin' : ''}
              />
              <span>{serverStatus.loading ? 'Starting...' : 'Start OpenCode'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="code-frame-container">
        {serverStatus.running && opencodeUrl ? (
          <iframe
            key={iframeKey}
            src={opencodeUrl}
            className="code-native-iframe"
            title="OpenCode Desktop"
            allow="clipboard-read; clipboard-write"
          />
        ) : serverStatus.loading ? (
          <div className="code-state-card">
            <div className="code-state-icon spin">
              <Icon name="circle-notch" size={32} />
            </div>
            <h3 className="code-state-title">Connecting to OpenCode Engine...</h3>
            <p className="code-state-desc">
              Checking local subprocess status and establishing connection.
            </p>
          </div>
        ) : (
          <div className="code-state-card">
            <div className="code-state-icon">
              <Icon name="code" size={36} />
            </div>
            <h3 className="code-state-title">OpenCode Engine is Offline</h3>
            <p className="code-state-desc">
              Start the local OpenCode server to load the official desktop web interface with full
              session history, multi-agent workspaces, code diffs, and AI tools.
            </p>
            {serverStatus.error && (
              <div className="code-error-box">
                <Icon name="alert" size={14} />
                <span>{serverStatus.error}</span>
              </div>
            )}
            <button
              type="button"
              className="code-btn code-btn-primary code-btn-large"
              onClick={handleStart}
            >
              <Icon name="play" size={16} />
              <span>Start OpenCode Engine</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
