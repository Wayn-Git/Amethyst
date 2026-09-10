import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { MOD_LABEL } from '../keys.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { useMenuFit } from '../hooks/useMenuFit.js'
import { connectorState } from './connectorState.js'
import { FadeScrollArea } from './ui/skiper/index.js'

/* Everything the agent can be given for the next message, one keystroke from
   the composer.

   A row that changes what the agent can reach reports what is running, not what
   is switched on. Those are different facts: a row can say "on" while the
   process failed to start, died, or was never asked to. Switching a connector
   on starts it here and waits for the answer, so the row never claims a
   capability the agent does not have. */

function Row({ icon, customIcon, label, hint, tail, onClick, disabled, danger, submenu, active, className, title }) {
  return (
    <button
      type="button"
      className={`menu-row${danger ? ' danger' : ''}${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
      aria-haspopup={submenu ? 'menu' : undefined}
      aria-expanded={submenu ? Boolean(active) : undefined}
    >
      {customIcon ? customIcon : icon ? <Icon name={icon} size={15} /> : <span className="menu-gutter" />}
      <span className="menu-label">
        {label}
        {hint && <span className="menu-hint">{hint}</span>}
      </span>
      {tail}
      {submenu && <Icon name="chevron" size={13} className="menu-caret" />}
    </button>
  )
}

const Toggle = ({ on }) => <span className={`switch${on ? ' on' : ''}`}><span /></span>

export default function PlusMenu({ conversationId, workspace, onWorkspace, onClose, onNavigate, onAttach, placement = 'up' }) {
  const { caps, refreshCaps, setCapEnabled, busyCap, setCapabilitiesTab, toast } = useApp()
  const [panel, setPanel] = useState(null)      // which submenu is open
  const [tools_open, setToolsOpen] = useState(false)
  /* Seventeen connectors in a menu is a list, and a list is a thing you scroll
     past to reach the rows underneath. Six is a glance. The ones that are
     running come first, because those are the ones a person opens this menu to
     turn off; the rest are behind one click that does not move the menu. */
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
    if (tools_open) setToolsOpen(false)
    else if (panel) setPanel(null)
    else onClose()
  }, [onClose, panel, tools_open])

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

  const pickFiles = useCallback(async (files) => {
    for (const file of files) {
      try {
        onAttach?.(await api.upload(file))
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'bad')
      }
    }
    onClose()
  }, [onAttach, onClose, toast])

  const skills = caps.skills ?? []
  // Stable when the store has answered, so the ordering memo below is not
  // recomputed on every render by an empty array it just made up.
  const connectors = useMemo(() => caps.connectors ?? [], [caps.connectors])
  const live = connectors.filter((c) => c.live?.connected).length

  const CONNECTOR_PREVIEW = 4
  // Enabled first, then the rest, each half left in its original order so the
  // list does not reshuffle under the cursor every time one is switched.
  const ordered = useMemo(() => {
    const on = connectors.filter((c) => c.enabled)
    const off = connectors.filter((c) => !c.enabled)
    return [...on, ...off]
  }, [connectors])
  const shownConnectors = allConnectors ? ordered : ordered.slice(0, CONNECTOR_PREVIEW)
  const hiddenCount = ordered.length - shownConnectors.length
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

  useMenuFit(ref, [shownConnectors.length, skills.length, tools.length, memory, panel, tools_open])

  const submenu = (title, body, width = 250) => (
    <div className="menu-flyout" style={{ width }}>
      <div className="menu-flyout-head">{title}</div>
      {body}
    </div>
  )

  /* The rows scroll; the menu does not. A submenu is an absolutely positioned
     child of `.menu`, so making `.menu` itself the scroller clips every flyout
     into the menu it is supposed to open beside. Keeping the scroll one level
     in -- `.menu-body` holds the rows, the flyouts are its siblings -- lets the
     list be as long as it likes in a window of any height, which is what the
     connector list at the top level actually needs. */
  const flyouts = (
    <>
      {panel === 'workspace' && submenu('file and shell tools are confined here', (
        <div className="menu-pad">
          <input
            autoFocus
            className="menu-input"
            value={draftWorkspace}
            placeholder="~/notes"
            onChange={(e) => setDraftWorkspace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onWorkspace(draftWorkspace.trim()); onClose() }
            }}
          />
          <button
            type="button"
            className="btn btn--primary btn--small"
            style={{ marginTop: 8 }}
            onClick={() => { onWorkspace(draftWorkspace.trim()); onClose() }}
          >
            Use this directory
          </button>
        </div>
      ), 280)}

      {panel === 'skills' && submenu('engaged for this conversation', (
        <>
          <FadeScrollArea className="menu-scroll" fadeHeight={18}>
            {skills.length === 0 && <div className="menu-empty">Nothing installed yet.</div>}
            {skills.map((skill) => (
              <Row
                key={skill.name}
                icon="book"
                label={skill.name}
                tail={busyCap === `skill:${skill.name}`
                  ? <span className="menu-hint">…</span>
                  : <Toggle on={skill.enabled} />}
                onClick={() => setCapEnabled(skill, !skill.enabled)}
              />
            ))}
          </FadeScrollArea>
          <div className="menu-sep" />
          <Row
            icon="sliders"
            label="Manage and install skills"
            onClick={() => { setCapabilitiesTab('skills'); onNavigate('capabilities'); onClose() }}
          />
        </>
      ))}

      {tools_open && submenu('what the model can call right now', (
        <FadeScrollArea className="menu-scroll menu-scroll--tall" fadeHeight={18}>
          {byServer.map(([server, group]) => (
            <div key={server}>
              <div className="menu-group">{server === 'builtin' ? 'builtin' : server}</div>
              {group.map((tool) => (
                <div key={tool.name} className="menu-tool" title={tool.description}>
                  <span className="mono">{tool.name}</span>
                  <span className={`state state--risk-${tool.risk}`}>{tool.risk}</span>
                </div>
              ))}
            </div>
          ))}
        </FadeScrollArea>
      ), 300)}
    </>
  )

  return (
    <div className={`menu${placement === "down" ? " menu--down" : ""}`} ref={ref} role="menu">
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => pickFiles([...e.target.files])}
      />

      <FadeScrollArea className="menu-body" fadeHeight={20}>
        <Row
          icon="paperclip"
          label="Add files or photos"
          tail={<span className="menu-keys"><kbd className="kbd">{MOD_LABEL}</kbd><kbd className="kbd">U</kbd></span>}
          onClick={() => fileRef.current?.click()}
        />
        <Row
          icon="folder"
          label="Working directory"
          hint={workspace || 'where the API was started'}
          submenu
          active={panel === 'workspace'}
          onClick={() => setPanel(panel === 'workspace' ? null : 'workspace')}
        />

        <div className="menu-sep" />

        <Row
          icon="book"
          label="Skills"
          hint={`${engaged} of ${skills.length} engaged`}
          submenu
          active={panel === 'skills'}
          onClick={() => setPanel(panel === 'skills' ? null : 'skills')}
        />

        {/* Connectors are the reason this menu gets opened, so they are in it
            rather than one level inside it. They used to be a submenu, which
            was survivable while a strip above the composer showed the same
            list; that strip is gone, and burying the only remaining copy two
            clicks deep would have been a straight downgrade. */}
        <div className="menu-group menu-group--head">
          <span>Connectors</span>
          <span className="menu-group-count">{live} running of {connectors.length}</span>
        </div>
        {connectors.length === 0 && <div className="menu-empty">None configured.</div>}
        {/* One line each. The state used to be spelled out on a second line
            under every name, which doubled the height of the only part of this
            menu that is a list -- four connectors took as much room as the
            eight rows around them. It is a dot now, and the sentence it
            replaced is on the row's tooltip. */}
        {shownConnectors.map((cap) => {
          const state = connectorState(cap, busyCap === `connector:${cap.name}`)
          return (
            <Row
              key={cap.name}
              className="menu-row--connector"
              customIcon={<ServiceIcon name={cap.name} size={15} />}
              label={cap.title || cap.name}
              title={state.detail ? `${state.label} — ${state.detail}` : state.label}
              tail={
                <>
                  <span className={`menu-dot menu-dot--${state.tone || 'off'}`} />
                  <Toggle on={cap.enabled} />
                </>
              }
              onClick={() => setCapEnabled(cap, !cap.enabled)}
            />
          )
        })}
        {(hiddenCount > 0 || allConnectors) && (
          <button
            type="button"
            className="menu-more"
            onClick={() => setAllConnectors((o) => !o)}
            aria-expanded={allConnectors}
          >
            {allConnectors ? 'Show fewer' : `View ${hiddenCount} more`}
            <Icon name="chevron" size={12} className={allConnectors ? 'menu-more-caret is-open' : 'menu-more-caret'} />
          </button>
        )}
        <Row
          icon="grid"
          label="Tool access"
          hint={`${tools.length} reachable`}
          submenu
          active={tools_open}
          onClick={() => setToolsOpen((o) => !o)}
        />
        <Row
          icon="sliders"
          label="Manage and add connectors"
          onClick={() => { setCapabilitiesTab('connectors'); onNavigate('capabilities'); onClose() }}
        />

        <div className="menu-sep" />

        <Row
          icon="spark"
          label="Memory"
          hint={memory ? `${memory.facts.length} facts recalled each turn` : null}
          tail={busy === 'memory' ? <span className="menu-hint">…</span> : <Toggle on={Boolean(memory?.enabled)} />}
          onClick={toggleMemory}
          disabled={!memory}
        />
        <Row icon="logs" label="What it just did" onClick={() => { onNavigate('logs'); onClose() }} />
      </FadeScrollArea>

      {flyouts}
    </div>
  )
}
