import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './Icon.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { MOD_LABEL } from '../keys.js'
import { useDismiss } from '../hooks/useDismiss.js'
import './PlusMenu.css'

const THEME_OPTIONS = [
  { id: 'system', label: 'System' },
  { id: 'graphite', label: 'Graphite (Dark)' },
  { id: 'nocturne', label: 'Nocturne (OLED)' },
  { id: 'apple', label: 'Apple (Light)' },
  { id: 'anthropic', label: 'Anthropic (Warm)' },
  { id: 'cohere', label: 'Cohere' },
  { id: 'sunshine', label: 'Sunshine' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'ink', label: 'Ink' },
  { id: 'paper', label: 'Paper' },
  { id: 'sand', label: 'Sand' },
]

export default function PlusMenu({
  conversationId,
  workspace,
  onWorkspace,
  onClose,
  onNavigate,
  onAttach,
  onSelectSkill,
  placement = 'up',
  isHero = false,
}) {
  const {
    caps,
    refreshCaps,
    setCapEnabled,
    busyCap,
    setCapabilitiesTab,
    toast,
    health,
    theme,
    setTheme,
  } = useApp()

  const [panel, setPanel] = useState(null) // null | 'skills' | 'connectors' | 'design' | 'plugins'
  const [toolsOpen, setToolsOpen] = useState(false)
  const [memory, setMemory] = useState(null)
  const [tools, setTools] = useState([])
  const [busy, setBusy] = useState('')
  const [layoutState, setLayoutState] = useState({
    placement: isHero ? 'down' : placement,
    maxHeight: 480,
    flipHorizontal: false,
    leftOffset: isHero ? 0 : 24,
  })

  const ref = useRef(null)
  const fileRef = useRef(null)

  // Smart layout measurement: guarantees the menu never clips out
  useEffect(() => {
    const updateLayout = () => {
      if (!ref.current) return
      const parent = ref.current.parentElement
      const parentRect = parent ? parent.getBoundingClientRect() : ref.current.getBoundingClientRect()

      // Dynamically locate the trigger button to match exact horizontal alignment
      const triggerBtn = parent?.querySelector('[data-plus-trigger="true"]')
      let triggerLeft = isHero ? 0 : 24
      if (triggerBtn && parent) {
        const tRect = triggerBtn.getBoundingClientRect()
        triggerLeft = Math.max(0, Math.round(tRect.left - parentRect.left))
      }

      const spaceAbove = Math.max(120, Math.floor(parentRect.top - 12))
      const spaceBelow = Math.max(120, Math.floor(window.innerHeight - parentRect.bottom - 12))

      let resolvedPlacement = isHero ? 'down' : placement
      if (isHero) {
        // Hero mode: if spaceBelow is constrained (< 260px) and spaceAbove is larger, flip up
        if (spaceBelow < 260 && spaceAbove > spaceBelow) {
          resolvedPlacement = 'up'
        } else {
          resolvedPlacement = 'down'
        }
      } else {
        // Bottom docked composer: open upwards unless space above is cramped (< 160px)
        if (spaceAbove < 160 && spaceBelow > spaceAbove) {
          resolvedPlacement = 'down'
        } else {
          resolvedPlacement = 'up'
        }
      }

      const availableHeight = resolvedPlacement === 'down' ? spaceBelow : spaceAbove
      // Compact height capped at 330px, ensuring it never touches the screen edge
      const maxH = Math.min(330, Math.max(180, availableHeight))

      // Check if primary panel (224) + submenu (252) + gap (6) would clip beyond right edge of viewport
      const menuLeftViewport = parentRect.left + triggerLeft
      const flipH = menuLeftViewport + 488 > window.innerWidth - 16

      setLayoutState({
        placement: resolvedPlacement,
        maxHeight: maxH,
        flipHorizontal: flipH,
        leftOffset: triggerLeft,
      })
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    window.addEventListener('scroll', updateLayout, true)
    return () => {
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('scroll', updateLayout, true)
    }
  }, [isHero, placement])

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

  useDismiss(ref, true, {
    onAway: onClose,
    onEscape: escapeOneLevel,
    ignore: '.hero-plus-btn, .composer-tool-btn, [data-plus-trigger]',
  })

  const toggleMemory = useCallback(async () => {
    setBusy('memory')
    try {
      const next = await api.toggleMemory(!memory?.enabled, scope)
      setMemory((m) => ({ ...m, enabled: next.enabled }))
      toast(next.enabled ? 'Memory active' : 'Memory paused', 'info')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }, [memory, scope, toast])

  const pickFiles = useCallback(
    (files) => {
      for (const f of files) onAttach(f)
      onClose()
    },
    [onAttach, onClose]
  )

  const skills = useMemo(() => caps.skills || [], [caps.skills])
  const connectors = useMemo(() => caps.connectors || [], [caps.connectors])
  const connectorErrors = useMemo(() => health?.errors || [], [health?.errors])
  const awaitingSignIn = useMemo(() => health?.awaiting_signin || [], [health?.awaiting_signin])

  const warningCount = useMemo(() => {
    let count = 0
    for (const c of connectors) {
      if (c.live?.error || connectorErrors.some(([n]) => n === c.name) || awaitingSignIn.includes(c.name)) {
        count += 1
      }
    }
    return count
  }, [connectors, connectorErrors, awaitingSignIn])

  const byServer = useMemo(() => {
    const groups = new Map()
    for (const tool of tools) {
      const server = tool.server || 'builtin'
      if (!groups.has(server)) groups.set(server, [])
      groups.get(server).push(tool)
    }
    return [...groups.entries()]
  }, [tools])

  return (
    <div
      ref={ref}
      className={`pmenu-container ${layoutState.placement === 'down' ? 'pmenu-container--down' : 'pmenu-container--up'}${layoutState.flipHorizontal ? ' pmenu-container--flip-x' : ''}`}
      style={{
        '--menu-max-height': `${layoutState.maxHeight}px`,
        left: `${layoutState.leftOffset}px`,
        zIndex: 120,
      }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => pickFiles([...e.target.files])}
      />

      {/* Primary Cascade Menu */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: layoutState.placement === 'down' ? -6 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: layoutState.placement === 'down' ? -6 : 6 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        className="pmenu-primary-panel"
      >
        {/* 1. Add files or photos */}
        <button
          type="button"
          className="pmenu-item"
          onClick={() => fileRef.current?.click()}
          onMouseEnter={() => { setPanel(null); setToolsOpen(false) }}
        >
          <div className="pmenu-item-left">
            <Icon name="paperclip" size={15} className="pmenu-item-icon" />
            <span className="pmenu-item-label">Add files or photos</span>
          </div>
          <span className="pmenu-shortcut">{MOD_LABEL}+U</span>
        </button>

        {/* 2. Skills */}
        <button
          type="button"
          className={`pmenu-item${panel === 'skills' ? ' is-active' : ''}`}
          onClick={() => setPanel((p) => (p === 'skills' ? null : 'skills'))}
          onMouseEnter={() => { setPanel('skills'); setToolsOpen(false) }}
          aria-haspopup="menu"
          aria-expanded={panel === 'skills'}
        >
          <div className="pmenu-item-left">
            <Icon name="scroll" size={15} className="pmenu-item-icon" />
            <span className="pmenu-item-label">Skills</span>
          </div>
          <Icon name="caret-right" size={12} className="pmenu-chevron" />
        </button>

        {/* 3. Connectors */}
        <button
          type="button"
          className={`pmenu-item${panel === 'connectors' ? ' is-active' : ''}`}
          onClick={() => setPanel((p) => (p === 'connectors' ? null : 'connectors'))}
          onMouseEnter={() => { setPanel('connectors'); setToolsOpen(false) }}
          aria-haspopup="menu"
          aria-expanded={panel === 'connectors'}
        >
          <div className="pmenu-item-left">
            <Icon name="squares-four" size={15} className="pmenu-item-icon" />
            <span className="pmenu-item-label">Connectors</span>
          </div>
          <div className="pmenu-item-right">
            {warningCount > 0 && (
              <span className="pmenu-warning-pill">
                <Icon name="warning" size={11} weight="fill" />
                <span>{warningCount}</span>
              </span>
            )}
            <Icon name="caret-right" size={12} className="pmenu-chevron" />
          </div>
        </button>

        {/* 4. Design system */}
        <button
          type="button"
          className={`pmenu-item${panel === 'design' ? ' is-active' : ''}`}
          onClick={() => setPanel((p) => (p === 'design' ? null : 'design'))}
          onMouseEnter={() => { setPanel('design'); setToolsOpen(false) }}
          aria-haspopup="menu"
          aria-expanded={panel === 'design'}
        >
          <div className="pmenu-item-left">
            <Icon name="palette" size={15} className="pmenu-item-icon" />
            <span className="pmenu-item-label">Design system</span>
          </div>
          <Icon name="caret-right" size={12} className="pmenu-chevron" />
        </button>

        {/* 5. Plugins */}
        <button
          type="button"
          className={`pmenu-item${panel === 'plugins' ? ' is-active' : ''}`}
          onClick={() => setPanel((p) => (p === 'plugins' ? null : 'plugins'))}
          onMouseEnter={() => { setPanel('plugins'); setToolsOpen(false) }}
          aria-haspopup="menu"
          aria-expanded={panel === 'plugins'}
        >
          <div className="pmenu-item-left">
            <Icon name="plug" size={15} className="pmenu-item-icon" />
            <span className="pmenu-item-label">Plugins</span>
          </div>
          <Icon name="caret-right" size={12} className="pmenu-chevron" />
        </button>

        {/* 6. Memory */}
        <button
          type="button"
          className="pmenu-item"
          onClick={toggleMemory}
          onMouseEnter={() => { setPanel(null); setToolsOpen(false) }}
          disabled={busy === 'memory'}
        >
          <div className="pmenu-item-left">
            <Icon name="clock-counter-clockwise" size={15} className="pmenu-item-icon" />
            <span className="pmenu-item-label">Memory</span>
          </div>
          {memory?.enabled && (
            <Icon name="check-simple" size={14} weight="bold" className="pmenu-check-accent" />
          )}
        </button>
      </motion.div>

      {/* Flyout Submenus */}
      <AnimatePresence mode="wait">
        {/* Skills Submenu */}
        {panel === 'skills' && (
          <motion.div
            key="skills"
            initial={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="pmenu-submenu"
          >
            <div className="pmenu-submenu-scroll">
              {skills.length === 0 ? (
                <div className="pmenu-empty-item">No skills installed</div>
              ) : (
                skills.map((skill) => (
                  <button
                    key={skill.name}
                    type="button"
                    className="pmenu-item"
                    onClick={() => {
                      onSelectSkill?.(skill.name)
                      onClose()
                    }}
                    title={skill.description}
                  >
                    <div className="pmenu-item-left">
                      <Icon name="scroll" size={15} className="pmenu-item-icon" />
                      <span className="pmenu-item-label">{skill.name}</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="pmenu-divider" />

            <button
              type="button"
              className="pmenu-item"
              onClick={() => {
                setCapabilitiesTab('skills')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <div className="pmenu-item-left">
                <Icon name="tray" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Manage skills</span>
              </div>
            </button>

            <button
              type="button"
              className="pmenu-item"
              onClick={() => {
                setCapabilitiesTab('skills')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <div className="pmenu-item-left">
                <Icon name="plus" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Browse skills</span>
              </div>
            </button>
          </motion.div>
        )}

        {/* Connectors Submenu */}
        {panel === 'connectors' && (
          <motion.div
            key="connectors"
            initial={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="pmenu-submenu"
          >
            <button
              type="button"
              className="pmenu-item"
              onClick={() => {
                setCapabilitiesTab('connectors')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <div className="pmenu-item-left">
                <Icon name="plus" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Add connector</span>
              </div>
              <Icon name="caret-right" size={12} className="pmenu-chevron" />
            </button>

            <button
              type="button"
              className="pmenu-item"
              onClick={() => {
                setCapabilitiesTab('connectors')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <div className="pmenu-item-left">
                <Icon name="tray" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Manage connectors</span>
              </div>
            </button>

            <div className="pmenu-divider" />

            <div className="pmenu-submenu-scroll">
              {connectors.length === 0 ? (
                <div className="pmenu-empty-item">No connectors configured</div>
              ) : (
                connectors.map((cap) => {
                  const needsSignIn = awaitingSignIn.includes(cap.name)
                  const hasError = Boolean(
                    cap.live?.error || connectorErrors.some(([n]) => n === cap.name) || needsSignIn
                  )
                  const isBusy = busyCap === `connector:${cap.name}`
                  return (
                    <div
                      key={cap.name}
                      className="pmenu-item"
                      onClick={() => {
                        if (needsSignIn) {
                          setCapabilitiesTab('connectors')
                          onNavigate('capabilities')
                          onClose()
                        } else if (!hasError) {
                          setCapEnabled(cap, !cap.enabled)
                        }
                      }}
                      title={
                        needsSignIn
                          ? 'Sign-in required'
                          : cap.live?.error || cap.title || cap.name
                      }
                    >
                      <div className="pmenu-item-left">
                        <ServiceIcon name={cap.name} size={16} className="pmenu-service-icon" />
                        <span className="pmenu-item-label">{cap.title || cap.name}</span>
                      </div>
                      <div className="pmenu-item-right">
                        {hasError ? (
                          <span
                            className="pmenu-warning-icon-wrap"
                            title={needsSignIn ? 'Sign-in required' : cap.live?.error || 'Needs authorization'}
                          >
                            <Icon name="warning" size={14} className="pmenu-warning-icon" weight="fill" />
                          </span>
                        ) : isBusy ? (
                          <span className="pmenu-busy-spinner">…</span>
                        ) : (
                          <div
                            className={`pmenu-toggle-switch${cap.enabled ? ' is-on' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setCapEnabled(cap, !cap.enabled)
                            }}
                            role="switch"
                            aria-checked={Boolean(cap.enabled)}
                          >
                            <div className="pmenu-toggle-thumb" />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="pmenu-divider" />

            <button
              type="button"
              className={`pmenu-item${toolsOpen ? ' is-active' : ''}`}
              onClick={() => setToolsOpen((o) => !o)}
            >
              <div className="pmenu-item-left">
                <Icon name="wrench" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Tool access</span>
              </div>
              <Icon name="caret-right" size={12} className="pmenu-chevron" />
            </button>
          </motion.div>
        )}

        {/* Design System Submenu */}
        {panel === 'design' && (
          <motion.div
            key="design"
            initial={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="pmenu-submenu"
          >
            <div className="pmenu-submenu-scroll">
              {THEME_OPTIONS.map((t) => {
                const isCurrent = theme === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`pmenu-item${isCurrent ? ' is-active' : ''}`}
                    onClick={() => setTheme(t.id)}
                  >
                    <div className="pmenu-item-left">
                      <span className={`pmenu-theme-dot pmenu-theme-dot--${t.id}`} />
                      <span className="pmenu-item-label">{t.label}</span>
                    </div>
                    {isCurrent && (
                      <Icon name="check-simple" size={14} weight="bold" className="pmenu-check-accent" />
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* Plugins Submenu */}
        {panel === 'plugins' && (
          <motion.div
            key="plugins"
            initial={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="pmenu-submenu"
          >
            <button
              type="button"
              className="pmenu-item"
              onClick={() => {
                setCapabilitiesTab('connectors')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <div className="pmenu-item-left">
                <Icon name="plus" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Add plugin</span>
              </div>
              <Icon name="caret-right" size={12} className="pmenu-chevron" />
            </button>

            <button
              type="button"
              className="pmenu-item"
              onClick={() => {
                setCapabilitiesTab('connectors')
                onNavigate('capabilities')
                onClose()
              }}
            >
              <div className="pmenu-item-left">
                <Icon name="tray" size={15} className="pmenu-item-icon" />
                <span className="pmenu-item-label">Manage plugins</span>
              </div>
            </button>

            <div className="pmenu-divider" />

            <div className="pmenu-submenu-scroll">
              {byServer.length === 0 ? (
                <div className="pmenu-empty-item">No plugins detected</div>
              ) : (
                byServer.map(([server, group]) => (
                  <div key={server} className="pmenu-plugin-group">
                    <div className="pmenu-group-title">{server}</div>
                    {group.slice(0, 4).map((tool) => (
                      <div
                        key={tool.name}
                        className="pmenu-item pmenu-item--static"
                        title={tool.description}
                      >
                        <div className="pmenu-item-left">
                          <Icon name="plug" size={14} className="pmenu-item-icon" />
                          <span className="pmenu-item-label">{tool.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {/* Tool Access Sub-Flyout (Tertiary) */}
        {toolsOpen && (
          <motion.div
            key="tools"
            initial={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.97,
              x: layoutState.flipHorizontal ? 6 : -6,
              y: layoutState.placement === 'down' ? -4 : 4,
            }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="pmenu-submenu pmenu-submenu--tertiary"
          >
            <div className="pmenu-submenu-header">
              <span className="pmenu-header-title">Tool Access ({tools.length})</span>
              <button
                type="button"
                className="pmenu-close-btn"
                onClick={() => setToolsOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="pmenu-submenu-scroll">
              {byServer.map(([server, group]) => (
                <div key={server} className="pmenu-plugin-group">
                  <div className="pmenu-group-title">{server}</div>
                  {group.map((tool) => (
                    <div key={tool.name} className="pmenu-tool-item" title={tool.description}>
                      <span className="pmenu-tool-name">{tool.name}</span>
                      <span className={`pmenu-tool-risk pmenu-tool-risk--${tool.risk}`}>
                        {tool.risk}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
