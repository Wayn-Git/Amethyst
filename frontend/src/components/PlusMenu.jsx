import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './Icon.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { MOD_LABEL } from '../keys.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { useMenuFit } from '../hooks/useMenuFit.js'
import { connectorState } from './connectorState.js'
import { FadeScrollArea } from './ui/skiper/index.js'

function MicroSwitch({ on, disabled }) {
  return (
    <span
      className={`pm-switch${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
      aria-hidden="true"
    >
      <span className="pm-switch-thumb" />
    </span>
  )
}

export default function PlusMenu({
  conversationId,
  workspace,
  onWorkspace,
  onClose,
  onNavigate,
  onAttach,
  placement = 'up',
}) {
  const { caps, refreshCaps, setCapEnabled, busyCap, setCapabilitiesTab, toast } = useApp()
  const [panel, setPanel] = useState(null) // 'workspace' | 'skills'
  const [toolsOpen, setToolsOpen] = useState(false)
  const [allConnectors, setAllConnectors] = useState(false)
  const [memory, setMemory] = useState(null)
  const [tools, setTools] = useState([])
  const [draftWorkspace, setDraftWorkspace] = useState(workspace || '')
  const [busy, setBusy] = useState('')
  const ref = useRef(null)
  const fileRef = useRef(null)

  const scope = conversationId || null

  useEffect(() => {
    refreshCaps(scope)
    api.memory(scope).then(setMemory).catch(() => setMemory(null))
    api.tools().then(setTools).catch(() => setTools([]))
  }, [scope, refreshCaps])

  const escapeOneLevel = useCallback(() => {
    if (toolsOpen) setToolsOpen(false)
    else if (panel) setPanel(null)
    else onClose()
  }, [onClose, panel, toolsOpen])

  useDismiss(ref, true, { onAway: onClose, onEscape: escapeOneLevel })

  const toggleMemory = useCallback(async () => {
    setBusy('memory')
    try {
      const next = await api.toggleMemory(!memory?.enabled, scope)
      setMemory((m) => ({ ...m, enabled: next.enabled }))
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [memory, scope, toast])

  const pickFiles = useCallback(
    async (files) => {
      for (const file of files) {
        try {
          onAttach?.(await api.upload(file))
        } catch (err) {
          toast(`${file.name}: ${err.message}`, 'bad')
        }
      }
      onClose()
    },
    [onAttach, onClose, toast]
  )

  const skills = caps.skills ?? []
  const connectors = useMemo(() => caps.connectors ?? [], [caps.connectors])
  const live = connectors.filter((c) => c.live?.connected).length

  const CONNECTOR_PREVIEW = 4
  const ordered = useMemo(() => {
    const on = connectors.filter((c) => c.enabled)
    const off = connectors.filter((c) => !c.enabled)
    return [...on, ...off]
  }, [connectors])

  const shownConnectors = allConnectors ? ordered : ordered.slice(0, CONNECTOR_PREVIEW)
  const hiddenCount = Math.max(0, ordered.length - shownConnectors.length)
  const engaged = skills.filter((s) => s.enabled).length

  const byServer = useMemo(() => {
    const groups = new Map()
    for (const tool of tools) {
      const key = tool.server || 'builtin'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(tool)
    }
    return [...groups.entries()]
  }, [tools])

  useMenuFit(ref, [shownConnectors.length, skills.length, tools.length, memory, panel, toolsOpen])

  const flyouts = (
    <>
      {/* Workspace Selector Submenu */}
      {panel === 'workspace' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, x: -6 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.96, x: -6 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="pm-flyout pm-flyout--workspace"
        >
          <div className="pm-flyout-header">
            <div className="pm-flyout-title">
              <Icon name="folder" size={14} className="pm-flyout-icon" />
              <span>Workspace Directory</span>
            </div>
            <button
              type="button"
              className="pm-flyout-close"
              onClick={() => setPanel(null)}
              aria-label="Close"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
          <p className="pm-flyout-desc">
            File tools and terminal sessions will be confined to this folder path.
          </p>
          <div className="pm-flyout-body">
            <input
              autoFocus
              className="pm-input"
              value={draftWorkspace}
              placeholder="e.g. ~/projects/my-app"
              onChange={(e) => setDraftWorkspace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onWorkspace(draftWorkspace.trim())
                  onClose()
                }
              }}
            />
            <div className="pm-flyout-actions">
              <button
                type="button"
                className="pm-btn pm-btn--primary"
                onClick={() => {
                  onWorkspace(draftWorkspace.trim())
                  onClose()
                }}
              >
                Apply Directory
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Skills Flyout */}
      {panel === 'skills' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, x: -6 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.96, x: -6 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="pm-flyout pm-flyout--skills"
        >
          <div className="pm-flyout-header">
            <div className="pm-flyout-title">
              <Icon name="book" size={14} className="pm-flyout-icon" />
              <span>Active Skills ({engaged}/{skills.length})</span>
            </div>
            <button
              type="button"
              className="pm-flyout-close"
              onClick={() => setPanel(null)}
              aria-label="Close"
            >
              <Icon name="x" size={12} />
            </button>
          </div>

          <FadeScrollArea className="pm-flyout-scroll" fadeHeight={16}>
            {skills.length === 0 ? (
              <div className="pm-empty-text">No skills currently installed.</div>
            ) : (
              skills.map((skill) => (
                <button
                  key={skill.name}
                  type="button"
                  className={`pm-item-row${skill.enabled ? ' is-active' : ''}`}
                  onClick={() => setCapEnabled(skill, !skill.enabled)}
                >
                  <span className="pm-item-icon-box">
                    <Icon name="book" size={13} />
                  </span>
                  <span className="pm-item-label">{skill.name}</span>
                  {busyCap === `skill:${skill.name}` ? (
                    <span className="pm-item-busy">…</span>
                  ) : (
                    <MicroSwitch on={skill.enabled} />
                  )}
                </button>
              ))
            )}
          </FadeScrollArea>

          <div className="pm-flyout-footer">
            <button
              type="button"
              className="pm-footer-link"
              onClick={() => {
                setCapabilitiesTab('skills')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <Icon name="sliders" size={12} />
              <span>Manage all skills</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* Tools Flyout */}
      {toolsOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, x: -6 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.96, x: -6 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="pm-flyout pm-flyout--tools"
        >
          <div className="pm-flyout-header">
            <div className="pm-flyout-title">
              <Icon name="grid" size={14} className="pm-flyout-icon" />
              <span>Tool Access ({tools.length})</span>
            </div>
            <button
              type="button"
              className="pm-flyout-close"
              onClick={() => setToolsOpen(false)}
              aria-label="Close"
            >
              <Icon name="x" size={12} />
            </button>
          </div>

          <FadeScrollArea className="pm-flyout-scroll pm-flyout-scroll--tall" fadeHeight={16}>
            {byServer.map(([server, group]) => (
              <div key={server} className="pm-tool-group">
                <div className="pm-tool-group-name">{server}</div>
                {group.map((tool) => (
                  <div key={tool.name} className="pm-tool-item" title={tool.description}>
                    <span className="pm-tool-name">{tool.name}</span>
                    <span className={`pm-tool-risk pm-tool-risk--${tool.risk}`}>
                      {tool.risk}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </FadeScrollArea>
        </motion.div>
      )}
    </>
  )

  return (
    <div
      className={`pm-menu-container menu${placement === 'down' ? ' menu--down' : ''}`}
      ref={ref}
      role="menu"
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => pickFiles([...e.target.files])}
      />

      <FadeScrollArea className="menu-body pm-scroll-body" fadeHeight={18}>
        {/* Section 1: Primary Actions */}
        <div className="pm-section">
          {/* Add Files Action Card */}
          <button
            type="button"
            className="pm-action-card pm-action-card--primary"
            onClick={() => fileRef.current?.click()}
          >
            <div className="pm-action-icon-tile pm-action-icon-tile--accent">
              <Icon name="paperclip" size={16} />
            </div>
            <div className="pm-action-content">
              <span className="pm-action-title">Add files or photos</span>
              <span className="pm-action-desc">Upload documents, code, images</span>
            </div>
            <span className="pm-shortcut-pill">
              <kbd>{MOD_LABEL}</kbd>
              <kbd>U</kbd>
            </span>
          </button>

          {/* Working Directory Card */}
          <button
            type="button"
            className={`pm-action-card${panel === 'workspace' ? ' is-active' : ''}`}
            onClick={() => setPanel(panel === 'workspace' ? null : 'workspace')}
            aria-haspopup="dialog"
            aria-expanded={panel === 'workspace'}
          >
            <div className="pm-action-icon-tile">
              <Icon name="folder" size={16} />
            </div>
            <div className="pm-action-content">
              <span className="pm-action-title">Working directory</span>
              <span className="pm-action-desc pm-action-path">
                {workspace ? workspace.split('/').slice(-2).join('/') || workspace : 'Project root'}
              </span>
            </div>
            <Icon name="chevron" size={12} className="pm-action-chevron" />
          </button>
        </div>

        <div className="pm-divider" />

        {/* Section 2: Agent Capabilities & Memory */}
        <div className="pm-section">
          <div className="pm-section-label">Capabilities</div>

          {/* Skills Row */}
          <button
            type="button"
            className={`pm-nav-row${panel === 'skills' ? ' is-active' : ''}`}
            onClick={() => setPanel(panel === 'skills' ? null : 'skills')}
            aria-haspopup="dialog"
            aria-expanded={panel === 'skills'}
          >
            <div className="pm-row-lead">
              <Icon name="book" size={15} className="pm-row-icon" />
              <span className="pm-row-title">Skills</span>
            </div>
            <div className="pm-row-trail">
              <span className="pm-count-badge">
                {engaged} of {skills.length} engaged
              </span>
              <Icon name="chevron" size={12} className="pm-row-chevron" />
            </div>
          </button>

          {/* Tool Access Row */}
          <button
            type="button"
            className={`pm-nav-row${toolsOpen ? ' is-active' : ''}`}
            onClick={() => setToolsOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={toolsOpen}
          >
            <div className="pm-row-lead">
              <Icon name="grid" size={15} className="pm-row-icon" />
              <span className="pm-row-title">Tool access</span>
            </div>
            <div className="pm-row-trail">
              <span className="pm-count-badge">{tools.length} reachable</span>
              <Icon name="chevron" size={12} className="pm-row-chevron" />
            </div>
          </button>

          {/* Memory Row */}
          <button
            type="button"
            className={`pm-nav-row${memory?.enabled ? ' is-active' : ''}`}
            onClick={toggleMemory}
            disabled={!memory}
          >
            <div className="pm-row-lead">
              <Icon name="spark" size={15} className="pm-row-icon" />
              <span className="pm-row-title">Memory</span>
            </div>
            <div className="pm-row-trail">
              {busy === 'memory' ? (
                <span className="pm-item-busy">…</span>
              ) : (
                <>
                  <span className="pm-meta-text">
                    {memory ? `${memory.facts.length} facts` : 'Disabled'}
                  </span>
                  <MicroSwitch on={Boolean(memory?.enabled)} disabled={!memory} />
                </>
              )}
            </div>
          </button>
        </div>

        <div className="pm-divider" />

        {/* Section 3: Connectors Hub */}
        <div className="pm-section">
          <div className="pm-section-head-row">
            <span className="pm-section-label">Connectors</span>
            <div className="pm-connectors-meta">
              <span className="pm-live-pill">
                <span className="pm-live-dot" />
                {live} active
              </span>
              <button
                type="button"
                className="pm-manage-btn"
                onClick={() => {
                  setCapabilitiesTab('connectors')
                  onNavigate('capabilities')
                  onClose()
                }}
              >
                Manage
              </button>
            </div>
          </div>

          {connectors.length === 0 ? (
            <div className="pm-empty-text">No connectors configured.</div>
          ) : (
            <div className="pm-connectors-list">
              {shownConnectors.map((cap) => {
                const state = connectorState(cap, busyCap === `connector:${cap.name}`)
                const isRunning = state.tone === 'live' || Boolean(cap.enabled)
                return (
                  <button
                    key={cap.name}
                    type="button"
                    className={`pm-connector-row${isRunning ? ' is-on' : ''}`}
                    onClick={() => setCapEnabled(cap, !cap.enabled)}
                    title={state.detail ? `${state.label} — ${state.detail}` : state.label}
                  >
                    <div className="pm-connector-lead">
                      <div className="pm-connector-icon-wrap">
                        <ServiceIcon name={cap.name} size={15} />
                      </div>
                      <span className="pm-connector-name">{cap.title || cap.name}</span>
                    </div>

                    <div className="pm-connector-trail">
                      {(state.tone === 'busy' || state.tone === 'error') && (
                        <span className={`pm-dot pm-dot--${state.tone}`} />
                      )}
                      <MicroSwitch on={cap.enabled} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {(hiddenCount > 0 || allConnectors) && (
            <button
              type="button"
              className="pm-expand-btn"
              onClick={() => setAllConnectors((o) => !o)}
              aria-expanded={allConnectors}
            >
              <span>{allConnectors ? 'Show fewer' : `View ${hiddenCount} more`}</span>
              <Icon
                name="chevron"
                size={11}
                className={`pm-expand-chevron${allConnectors ? ' is-open' : ''}`}
              />
            </button>
          )}
        </div>

        <div className="pm-divider" />

        {/* Section 4: Audit & Activity */}
        <div className="pm-section pm-section--footer">
          <button
            type="button"
            className="pm-nav-row pm-nav-row--subtle"
            onClick={() => {
              onNavigate('logs')
              onClose()
            }}
          >
            <div className="pm-row-lead">
              <Icon name="logs" size={14} className="pm-row-icon" />
              <span className="pm-row-title">What it just did (Logs)</span>
            </div>
            <Icon name="arrow-up-right" size={12} className="pm-row-chevron" />
          </button>
        </div>
      </FadeScrollArea>

      <AnimatePresence>{flyouts}</AnimatePresence>
    </div>
  )
}
