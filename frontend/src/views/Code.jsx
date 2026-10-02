import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import opencodeClient from '../lib/opencode.js'
import './code.css'

export default function Code() {
  const {
    opencode,
    codeActiveSessionId,
    codeActiveProjectId,
    workspace,
    toast,
  } = useApp()

  const status = opencode?.status || { running: false, loading: true, port: null }
  const iframeKey = opencode?.iframeKey || 0
  const start = opencode?.start

  const iframeRef = useRef(null)
  const lastSrcRef = useRef('')
  const [sessions, setSessions] = useState([])
  const [projects, setProjects] = useState([])

  useEffect(() => {
    if (status?.running) {
      Promise.all([
        opencodeClient.listSessions().catch(() => []),
        opencodeClient.listProjects().catch(() => []),
      ]).then(([sList, pList]) => {
        setSessions(Array.isArray(sList) ? sList : [])
        setProjects(Array.isArray(pList) ? pList : [])
      })
    }
  }, [status?.running, iframeKey])

  const activeSession = useMemo(() => {
    if (!codeActiveSessionId) return null
    return sessions.find((s) => s.id === codeActiveSessionId) || null
  }, [sessions, codeActiveSessionId])

  const activeProject = useMemo(() => {
    if (codeActiveProjectId) {
      return projects.find((p) => p.id === codeActiveProjectId) || null
    }
    return projects.find((p) => p.worktree && p.worktree !== '/') || projects[0] || null
  }, [projects, codeActiveProjectId])

  const host = typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1'
  const currentDir = activeSession?.directory || activeProject?.worktree || workspace || ''
  const encodedDir = currentDir ? opencodeClient.encodeDir(currentDir) : ''

  const iframeSrc = useMemo(() => {
    if (!status?.port) return ''
    if (activeSession?.id && encodedDir) {
      return `http://${host}:${status.port}/${encodedDir}/session/${activeSession.id}`
    }
    if (encodedDir) {
      return `http://${host}:${status.port}/${encodedDir}`
    }
    return `http://${host}:${status.port}/`
  }, [host, status?.port, activeSession?.id, encodedDir])

  // Navigate existing iframe smoothly without destroying DOM
  useEffect(() => {
    if (iframeRef.current && iframeSrc && iframeSrc !== lastSrcRef.current) {
      lastSrcRef.current = iframeSrc
      iframeRef.current.src = iframeSrc
    }
  }, [iframeSrc])

  const copyCmd = useCallback(
    async (cmd) => {
      try {
        await navigator.clipboard.writeText(cmd)
        toast('Command copied to clipboard', 'good')
      } catch (err) {
        toast('Failed to copy command', 'bad')
      }
    },
    [toast]
  )

  return (
    <div className="code-view">
      {/* Main Content Area - Full height flush with WorkbenchBar */}
      <main className="code-frame-container">
        {status?.running && iframeSrc ? (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={iframeSrc}
            className="code-native-iframe"
            title="OpenCode Desktop"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : status?.loading ? (
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
          <div className="code-state-card code-offline-card">
            <div className="code-state-icon">
              <Icon name="code" size={36} />
            </div>
            <h3 className="code-state-title">OpenCode Engine is Offline</h3>
            <p className="code-state-desc">
              Start the local OpenCode server or install the binary to run the native AI coding engine across macOS, Linux, and Windows.
            </p>

            {status?.error && (
              <div className="code-error-box">
                <Icon name="info" size={14} />
                <span>{status.error}</span>
              </div>
            )}

            <div className="code-offline-actions">
              <button
                type="button"
                className="code-btn code-btn-primary code-btn-large"
                onClick={start}
              >
                <Icon name="play" size={16} />
                <span>Start OpenCode Engine</span>
              </button>
            </div>

            <div className="code-install-guide">
              <div className="code-install-guide-title">
                Not installed on this machine? Install in one command:
              </div>
              <div className="code-install-tabs">
                <div className="code-install-row">
                  <span className="code-install-label">macOS / Linux:</span>
                  <code className="code-install-cmd">curl -fsSL https://opencode.ai/install.sh | bash</code>
                  <button
                    type="button"
                    className="code-copy-btn"
                    onClick={() => copyCmd('curl -fsSL https://opencode.ai/install.sh | bash')}
                    title="Copy command"
                    aria-label="Copy macOS / Linux install command"
                  >
                    <Icon name="copy" size={13} />
                  </button>
                </div>
                <div className="code-install-row">
                  <span className="code-install-label">npm / Windows:</span>
                  <code className="code-install-cmd">npm i -g opencode-ai</code>
                  <button
                    type="button"
                    className="code-copy-btn"
                    onClick={() => copyCmd('npm i -g opencode-ai')}
                    title="Copy command"
                    aria-label="Copy npm install command"
                  >
                    <Icon name="copy" size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
