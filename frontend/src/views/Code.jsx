import { useState, useEffect, useMemo, useCallback } from 'react'
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
  const reloadIframe = opencode?.reloadIframe

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
  }, [status?.running, iframeKey, codeActiveSessionId])

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

  const projectName = currentDir ? currentDir.split('/').filter(Boolean).pop() : 'Default Workspace'
  const sessionTitle = activeSession?.title || activeSession?.slug || 'All Sessions'

  return (
    <div className="code-view">
      {/* Top Context Bar */}
      {status?.running && (
        <header className="code-context-bar">
          <div className="code-context-breadcrumb">
            <span className="code-context-project" title={currentDir || 'Workspace'}>
              <Icon name="folder" size={14} />
              <span>{projectName}</span>
            </span>
            <span className="code-context-separator">/</span>
            <span className="code-context-session" title={sessionTitle}>
              <Icon name="code" size={13} />
              <span>{sessionTitle}</span>
            </span>
            {activeSession?.agent && activeSession.agent !== 'build' && (
              <span className="sb-code-agent-badge">{activeSession.agent}</span>
            )}
          </div>

          <div className="code-context-actions">
            <div className="wb-code-status-pill">
              <span className={`code-status-dot ${status.running ? 'running' : 'stopped'}`} />
              <span className="wb-code-status-text">{status.running ? 'Running' : 'Offline'}</span>
              {status.port && <span className="wb-code-port">:{status.port}</span>}
            </div>

            {iframeSrc && (
              <a
                href={iframeSrc}
                target="_blank"
                rel="noreferrer"
                className="code-action-btn"
                title="Open native OpenCode in browser tab"
              >
                <Icon name="arrow-up-right" size={14} />
                <span>Open in Browser</span>
              </a>
            )}

            <button
              type="button"
              className="code-action-btn"
              onClick={reloadIframe}
              title="Reload engine frame"
              aria-label="Reload engine frame"
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className="code-frame-container">
        {status?.running && iframeSrc ? (
          <iframe
            key={`${iframeKey}-${activeSession?.id || 'root'}`}
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
