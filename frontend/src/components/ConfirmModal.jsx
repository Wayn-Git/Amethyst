import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Icon from './Icon.jsx'
import { api, prettyJSON } from '../api.js'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import { JsonViewer } from './arc/json-viewer/json-viewer'
import { CodeBlock } from './arc/code-block/code-block'
import './confirm-modal.css'

/* Modern Tool Execution Confirmation Modal.
   The turn is suspended while this is up. Keyboard-driven:
   - Enter: Allow and execute
   - Esc: Decline
   - R: Toggle "Remember choice" for this operation */

function getToolMeta(name = '', args = {}) {
  const n = String(name).toLowerCase()
  if (n.includes('shell') || n.includes('bash') || n.includes('cmd') || n.includes('exec') || args.command || args.CommandLine) {
    return {
      category: 'Terminal Shell',
      icon: 'term',
      title: 'Run terminal command?',
      type: 'command',
    }
  }
  if (n.includes('delete') || n.includes('remove') || n.includes('destroy')) {
    return {
      category: 'Destructive Action',
      icon: 'trash',
      title: 'Delete resource?',
      type: 'delete',
    }
  }
  if (n.includes('write') || n.includes('edit') || n.includes('artifact') || n.includes('patch') || args.path || args.TargetFile) {
    return {
      category: 'Filesystem Mutation',
      icon: 'edit',
      title: 'Modify files on disk?',
      type: 'file',
    }
  }
  if (n.includes('browser') || n.includes('web') || n.includes('fetch') || n.includes('network') || args.url) {
    return {
      category: 'Network Action',
      icon: 'globe',
      title: 'Perform network request?',
      type: 'network',
    }
  }
  return {
    category: 'Tool Execution',
    icon: 'shield',
    title: `Allow ${name}?`,
    type: 'tool',
  }
}

export default function ConfirmModal({ pending = [], onDecide }) {
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(null)
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState('formatted') // 'formatted' | 'raw'
  const [decisionError, setDecisionError] = useState('')
  const allowRef = useRef(null)
  const panelRef = useRef(null)

  const item = pending.length ? pending[pending.length - 1] : null
  const queueCount = pending.length

  const sensitive = /sensitive path/i.test(item?.reason || '')
  const risk = String(item?.risk || 'medium').toLowerCase()
  const isHighRisk = risk === 'high' || risk === 'critical'
  const isMediumRisk = risk === 'medium'

  useFocusTrap(panelRef, Boolean(item))

  const decide = useCallback(async (target, allow) => {
    if (!target || busy) return
    setDecisionError('')
    setBusy(target.id)
    try {
      await api.decideConfirmation(target.id, { allow, remember })
      onDecide(target.id)
    } catch (err) {
      // Do not remove request when decision did not reach server. Keeping gate
      // visible prevents an accidental tool execution after a transport error.
      setDecisionError(err?.message || 'Could not submit permission decision. Try again.')
    } finally {
      setBusy(null)
      setRemember(false)
    }
  }, [busy, onDecide, remember])

  useEffect(() => {
    if (!item) return undefined
    allowRef.current?.focus()

    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const typing = e.target?.tagName === 'INPUT'
        || e.target?.tagName === 'TEXTAREA'
        || e.target?.isContentEditable
      if (typing && e.key !== 'Escape') return

      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (!busy) decide(item, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (!busy) decide(item, false)
      } else if (!sensitive && e.key.toLowerCase?.() === 'r') {
        e.preventDefault()
        setRemember((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [item, decide, sensitive, busy])

  const copyText = useCallback((text) => {
    if (!text) return
    navigator.clipboard?.writeText(typeof text === 'string' ? text : JSON.stringify(text, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }, [])

  const toolMeta = useMemo(() => {
    if (!item) return { category: 'Tool Call', icon: 'shield', title: 'Approve tool call?', type: 'tool' }
    return getToolMeta(item.tool_name, item.arguments)
  }, [item])

  const args = item?.arguments || {}
  const command = args.command || args.CommandLine || args.cmd || null
  const filePath = args.path || args.file_path || args.TargetFile || args.DirectoryPath || null
  const contentPreview = typeof args.content === 'string'
    ? args.content
    : typeof args.CodeContent === 'string'
      ? args.CodeContent
      : null

  const reason = item?.reason && !/^\S+ is rated \w+ risk\.?$/.test(item.reason.trim())
    ? item.reason
    : null

  const windowClasses = [
    'confirm-modal-window',
    isHighRisk ? 'is-high-risk' : isMediumRisk ? 'is-medium-risk' : 'is-low-risk',
    sensitive ? 'is-sensitive' : '',
  ].filter(Boolean).join(' ')

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          className="confirm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className={windowClasses}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Permission required"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            {/* Header */}
            <div className="confirm-header">
              <div className="confirm-icon-box">
                <Icon name={toolMeta.icon} size={20} />
              </div>
              <div className="confirm-header-content">
                <div className="confirm-header-meta">
                  <span className="confirm-eyebrow">{toolMeta.category}</span>
                  <div className="confirm-badges">
                    {queueCount > 1 && (
                      <span className="confirm-queue-pill">
                        {queueCount} pending
                      </span>
                    )}
                    <span className="confirm-risk-pill">
                      <span className="confirm-risk-dot" />
                      {sensitive ? 'Sensitive' : `${risk.charAt(0).toUpperCase()}${risk.slice(1)} Risk`}
                    </span>
                  </div>
                </div>
                <h3 className="confirm-title">{toolMeta.title}</h3>
                <div className="confirm-subtitle">
                  Agent requested to call <code className="confirm-tool-chip">{item.tool_name}</code>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="confirm-body">
              {decisionError && (
                <div className="confirm-reason-box" role="alert">
                  <Icon name="alert" size={15} />
                  <span>{decisionError}</span>
                </div>
              )}
              {/* Reason notice if escalation or sensitive path */}
              {reason && (
                <div className="confirm-reason-box">
                  <Icon name={sensitive ? 'lock' : 'alert'} size={15} />
                  <span>{reason}</span>
                </div>
              )}

              {/* Inspector Card */}
              <div className="confirm-inspect-card">
                <div className="confirm-inspect-header">
                  <span className="confirm-inspect-title">
                    <Icon name={toolMeta.type === 'command' ? 'term' : toolMeta.type === 'file' ? 'page' : 'sliders'} size={13} />
                    Parameters
                  </span>
                  <div className="confirm-inspect-tabs">
                    <button
                      type="button"
                      className={`confirm-tab-btn${viewMode === 'formatted' ? ' is-active' : ''}`}
                      onClick={() => setViewMode('formatted')}
                    >
                      Formatted
                    </button>
                    <button
                      type="button"
                      className={`confirm-tab-btn${viewMode === 'raw' ? ' is-active' : ''}`}
                      onClick={() => setViewMode('raw')}
                    >
                      Raw JSON
                    </button>
                  </div>
                </div>

                {viewMode === 'raw' ? (
                  <div className="confirm-raw-json-viewer" style={{ padding: '6px 12px 12px 12px' }}>
                    <JsonViewer data={args || {}} rootName="parameters" maxHeight={240} defaultExpandDepth={2} />
                  </div>
                ) : (
                  <>
                    {/* Command view */}
                    {command ? (
                      <div className="confirm-terminal-box">
                        <button
                          type="button"
                          className="confirm-terminal-copy"
                          onClick={() => copyText(command)}
                          title="Copy command to clipboard"
                        >
                          <Icon name={copied ? 'check' : 'copy'} size={12} />
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <div className="confirm-terminal-line">
                          <span className="confirm-terminal-prompt">$</span>
                          <span className="confirm-terminal-cmd">{command}</span>
                        </div>
                      </div>
                    ) : null}

                    {/* File view */}
                    {filePath && !command ? (
                      <div className="confirm-file-box">
                        <div className="confirm-file-path-row">
                          <Icon name="page" size={14} />
                          <span>{filePath}</span>
                        </div>
                        {contentPreview && (
                          <div style={{ marginTop: 8 }}>
                            <CodeBlock
                              code={contentPreview}
                              language={filePath.split('.').pop() || 'text'}
                              filename={filePath.split('/').pop() || 'file'}
                              maxLines={10}
                            />
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* General key-value params */}
                    {!command && !filePath ? (
                      <div className="confirm-kv-table">
                        {Object.entries(args).length === 0 ? (
                          <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '4px 0' }}>
                            No arguments passed
                          </div>
                        ) : (
                          Object.entries(args).map(([k, v]) => (
                            <div className="confirm-kv-row" key={k}>
                              <span className="confirm-kv-key">{k}</span>
                              <span className="confirm-kv-val">
                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Remember Decision Card */}
              <div
                className={`confirm-remember-card${sensitive ? ' is-disabled' : ''}`}
                onClick={() => {
                  if (!sensitive) setRemember((r) => !r)
                }}
                role="checkbox"
                aria-checked={remember && !sensitive}
                aria-disabled={sensitive}
                tabIndex={sensitive ? -1 : 0}
                onKeyDown={(e) => {
                  if (!sensitive && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault()
                    setRemember((r) => !r)
                  }
                }}
              >
                <div className={`confirm-toggle-switch${remember && !sensitive ? ' is-checked' : ''}`}>
                  <div className="confirm-toggle-thumb" />
                </div>
                <div className="confirm-remember-info">
                  <div className="confirm-remember-title-row">
                    <span>Remember decision for this operation</span>
                    <kbd className="confirm-kbd" style={{ marginLeft: 'auto' }}>R</kbd>
                  </div>
                  <div className="confirm-remember-desc">
                    {sensitive ? (
                      <span style={{ color: 'var(--stop, #ef4444)' }}>
                        Disabled: sensitive paths always require confirmation and cannot be stored.
                      </span>
                    ) : (
                      <>
                        Auto-approves future calls matching{' '}
                        <strong className="confirm-remember-key mono">
                          {item.operation_key || item.tool_name}
                        </strong>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="confirm-footer">
              <button
                type="button"
                className="confirm-btn confirm-btn-decline"
                disabled={busy === item.id}
                onClick={() => decide(item, false)}
              >
                <Icon name="x" size={14} />
                <span>Decline</span>
                <kbd className="confirm-kbd">Esc</kbd>
              </button>

              <button
                type="button"
                ref={allowRef}
                className="confirm-btn confirm-btn-allow"
                disabled={busy === item.id}
                onClick={() => decide(item, true)}
              >
                {busy === item.id ? (
                  <Icon name="circle-notch" size={15} className="confirm-spinner" />
                ) : (
                  <Icon name="check" size={15} />
                )}
                <span>Allow &amp; Execute</span>
                <kbd className="confirm-kbd">Enter ↵</kbd>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
