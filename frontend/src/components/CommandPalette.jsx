import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { pretty } from '../keys.js'
import { connectorState } from './connectorState.js'
import { forPalette } from '../nav.js'
import { useFocusTrap } from '../hooks/useFocusTrap.js'

/* One list for everything the interface can do.

   Skills and connectors are commands here, not settings buried in a panel:
   "turn on the thing, then ask" is one gesture rather than a detour. The list
   is built from the same store the + menu reads, so a connector toggled from
   here and one toggled from there run the identical code path. */

/* The same three choices Settings offers, phrased as commands. `sun` for
   daylight, `cpu` for the console, `sliders` for "whatever the machine says". */
const THEMES = [
  { id: 'light', icon: 'sun', label: 'Switch to Paper', hint: 'the light palette' },
  { id: 'dark', icon: 'cpu', label: 'Switch to Graphite', hint: 'the dark palette' },
  { id: 'system', icon: 'sliders', label: 'Follow the system theme', hint: 'light or dark, as the machine is set' },
]

/* Which move each job state allows.

   `resume` from paused is the one that matters: a job a person stopped is the
   one a person has to start again. This only has to be right about the ordinary
   cases -- the daemon refuses an illegal transition with a reason, and the
   reason is what the toast says. */
const JOB_ACTIONS = {
  paused: { action: 'resume', label: 'Resume', icon: 'play' },
  queued: { action: 'pause', label: 'Pause', icon: 'stop' },
  running: { action: 'pause', label: 'Pause', icon: 'stop' },
  waiting: { action: 'pause', label: 'Pause', icon: 'stop' },
  failed: { action: 'retry', label: 'Retry', icon: 'refresh' },
}

const LIVE_JOB = new Set(['running', 'queued', 'waiting'])

/** Subsequence match: `gwt` finds `go with tools`. Returns a score, or -1. */
function score(haystack, needle) {
  if (!needle) return 0
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const direct = h.indexOf(n)
  if (direct !== -1) return 1000 - direct - (h.length - n.length) * 0.1
  let i = 0
  let hits = 0
  let last = -1
  let gaps = 0
  for (let c = 0; c < h.length && i < n.length; c++) {
    if (h[c] === n[i]) {
      if (last !== -1) gaps += c - last - 1
      last = c
      i++
      hits++
    }
  }
  if (i < n.length) return -1
  return 400 - gaps * 2 + hits
}

export default function CommandPalette({ bare = false }) {
  const app = useApp()
  const {
    overlay, conversations, activeId, caps,
    setCapEnabled, busyCap, chat, toast, refreshHealth, refreshCaps,
    setCapabilitiesTab, theme, setTheme,
  } = app

  /* In the floating bar, a command that is a *place* opens the application.

     Shadowing the two navigators rather than tagging thirty commands: anything
     that says `setView` or `setOverlay` is by definition somewhere to go, and
     everything else -- logging a link, resuming a job, running an automation --
     is an action that should leave the user exactly where they were. New
     commands get this for free, which is the point. */
  const openMain = useCallback(() => { window.pywebview?.api?.open_main?.() }, [])
  const hideBar = useCallback(() => { window.pywebview?.api?.hide?.() }, [])
  const setView = bare ? openMain : app.setView
  const setOverlay = bare ? openMain : app.setOverlay

  /* Ask, without going and watching it happen.

     The daemon owns the turn, so the bar can get out of the way the moment it
     is sent -- this window stays alive behind it to hold the stream, and the
     desktop notification is what says it finished. That is the whole flow the
     bar exists for: ask, carry on with what you were doing, get told. */
  const askInBackground = useCallback(async (question) => {
    const { id } = await api.createConversation('auto', '', question.slice(0, 56))
    api.turn({ conversationId: id, message: question, onEvent: () => {} })
      .catch(() => { /* the notification reports the end either way */ })
  }, [])

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [memory, setMemory] = useState(null)
  // What just happened, held on screen long enough to read before the bar goes.
  const [flash, setFlash] = useState(null)
  const [jobs, setJobs] = useState([])
  const [automations, setAutomations] = useState([])
  const listRef = useRef(null)
  const panelRef = useRef(null)
  const open = bare || overlay === 'palette'

  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    api.memory(activeId || null).then(setMemory).catch(() => setMemory(null))
    /* The daemon owns this work and its state. Read on every open rather
       than kept, because it changes while nothing is watching -- that is the
       whole point of it living in the daemon -- and a palette showing a
       remembered job list would be confidently out of date. */
    api.jobs('?limit=25').then((d) => setJobs(d.jobs || [])).catch(() => setJobs([]))
    api.automations().then((d) => setAutomations(d.automations || [])).catch(() => setAutomations([]))
  }, [open, activeId])

  const close = () => {
    if (bare) hideBar()
    else app.setOverlay(null)
  }

  const commands = useMemo(() => {
    const out = []

    out.push({
      id: 'new',
      group: 'Chat',
      icon: 'plus',
      label: 'New conversation',
      binding: 'mod+shift+o',
      run: () => { setView('chat'); chat.startFresh?.() },
    })
    if (chat.turnRunning) {
      out.push({
        id: 'stop',
        group: 'Chat',
        icon: 'stop',
        label: 'Stop this turn',
        hint: 'the loop is asked to stop; the stream closes itself',
        binding: 'escape',
        run: () => chat.stop?.(),
      })
    }
    if (activeId) {
      out.push({
        id: 'rename',
        group: 'Chat',
        icon: 'edit',
        label: 'Rename this conversation',
        binding: 'f2',
        run: () => { setView('chat'); chat.beginRename?.(activeId) },
      })
    }

    for (const view of forPalette(app.betaPages)) {
      out.push({
        id: `view:${view.id}`,
        group: 'Go to',
        icon: view.icon,
        label: view.label,
        binding: view.digit ? `mod+${view.digit}` : undefined,
        beta: view.beta,
        run: () => setView(view.id),
      })
    }

    for (const skill of caps.skills || []) {
      out.push({
        id: `skill:${skill.name}`,
        group: 'Skills',
        icon: 'book',
        label: `${skill.enabled ? 'Stand down' : 'Engage'} /${skill.name}`,
        hint: skill.description?.slice(0, 74),
        state: skill.enabled ? 'on' : 'off',
        run: () => setCapEnabled(skill, !skill.enabled),
      })
    }

    for (const connector of caps.connectors || []) {
      const state = connectorState(connector, busyCap === `connector:${connector.name}`)
      out.push({
        id: `connector:${connector.name}`,
        group: 'Connectors',
        icon: 'plug',
        label: `${connector.enabled ? 'Disconnect' : 'Connect'} ${connector.name}`,
        hint: state.detail ? state.detail.slice(0, 74) : state.label,
        state: state.tone === 'live' ? 'on' : state.tone === 'error' ? 'bad' : 'off',
        run: () => setCapEnabled(connector, !connector.enabled),
      })
    }
    out.push({
      id: 'skills:browse',
      group: 'Skills',
      icon: 'plus',
      label: 'New skill, or browse and install one',
      hint: 'write one from three fields, or paste a link to a SKILL.md',
      run: () => { setCapabilitiesTab('skills'); setView('capabilities') },
    })

    out.push({
      id: 'connector:add',
      group: 'Connectors',
      icon: 'plus',
      label: 'Add a connector',
      hint: 'GitHub, Google Workspace, a browser, or your own server',
      run: () => { setCapabilitiesTab('connectors'); setView('capabilities') },
    })

    if (memory) {
      out.push({
        id: 'memory:toggle',
        group: 'Memory',
        icon: 'spark',
        label: memory.enabled ? 'Stop remembering' : 'Start remembering',
        hint: `${memory.facts.length} fact${memory.facts.length === 1 ? '' : 's'} recalled each turn`,
        state: memory.enabled ? 'on' : 'off',
        binding: 'mod+m',
        run: async () => {
          const next = await api.toggleMemory(!memory.enabled, activeId || null)
          setMemory((m) => ({ ...m, enabled: next.enabled }))
          toast(next.enabled ? 'Memory on' : 'Memory off', next.enabled ? 'ok' : 'info')
        },
      })
    }

    /* What the daemon is doing, and how to take hold of it.

       These rows are most of the reason the palette is worth opening from a
       global hotkey: the work runs in the daemon whether or not a window is
       open, so "what is running" and "start that again" cannot live in the
       window's own state. They are read from the daemon and acted on there. */
    for (const job of jobs) {
      const move = JOB_ACTIONS[job.state]
      if (!move) continue
      out.push({
        id: `job:${job.id}`,
        group: 'Jobs',
        icon: move.icon,
        label: `${move.label} ${job.kind}`,
        hint: [job.state, `attempt ${job.attempts}/${job.max_attempts}`, job.last_error]
          .filter(Boolean).join(' · ').slice(0, 74),
        run: async () => {
          try {
            const next = await api.actOnJob(job.id, move.action)
            toast(`${job.kind} is ${next.state}`, 'ok')
          } catch (err) {
            toast(err.message, 'bad')
          }
        },
      })
    }
    if (jobs.length) {
      out.push({
        id: 'jobs:view',
        group: 'Jobs',
        icon: 'logs',
        label: 'View running jobs',
        hint: `${jobs.filter((j) => LIVE_JOB.has(j.state)).length} running, ${jobs.length} on the board`,
        run: () => setView('automations'),
      })
    }

    for (const automation of automations) {
      out.push({
        id: `automation:${automation.id}`,
        group: 'Automations',
        icon: 'play',
        label: `Run ${automation.name} now`,
        hint: automation.enabled
          ? `every ${automation.every_minutes} min · runs it now as well`
          : 'switched off — this runs it once',
        run: async () => {
          try {
            await api.runAutomation(automation.id)
            toast(`${automation.name} started`, 'ok')
          } catch (err) {
            toast(err.message, 'bad')
          }
        },
      })
    }

    /* Memory, searched rather than browsed.

       One row per fact and the palette's own matcher does the searching, so
       "search memory" needs no search field, no endpoint and no second list.
       They appear only once something is typed: two hundred facts in the resting
       list would bury every command in it. */
    if (query.trim() && memory) {
      for (const fact of memory.facts) {
        out.push({
          id: `fact:${fact.id}`,
          group: 'Memory',
          icon: 'spark',
          label: fact.fact,
          hint: 'open Memory to forget it or edit it',
          run: () => setView('memory'),
        })
      }
    }

    for (const conversation of conversations.slice(0, 40)) {
      if (conversation.id === activeId) continue
      out.push({
        id: `conv:${conversation.id}`,
        group: 'Conversations',
        icon: 'chat',
        label: conversation.title || 'untitled',
        hint: `${conversation.provider} · ${conversation.model}`,
        run: () => { setView('chat'); chat.selectConversation?.(conversation.id) },
      })
    }

    /* The palette is where this application does things, so the appearance
       switch belongs here too rather than only three clicks into Settings.
       The one currently in use is not offered — a command that does nothing
       is worse than a command that is missing. */
    for (const choice of THEMES) {
      if (choice.id === theme) continue
      out.push({
        id: `theme:${choice.id}`,
        group: 'Appearance',
        icon: choice.icon,
        label: choice.label,
        hint: choice.hint,
        run: () => setTheme(choice.id),
      })
    }

    out.push({
      id: 'settings',
      group: 'Help',
      icon: 'sliders',
      label: 'Settings',
      binding: 'mod+,',
      run: () => setOverlay('settings'),
    })
    out.push({
      id: 'attach',
      group: 'Chat',
      icon: 'paperclip',
      label: 'Attach a file',
      binding: 'mod+u',
      run: () => { setView('chat'); chat.attach?.() },
    })
    out.push({
      id: 'shortcuts',
      group: 'Help',
      icon: 'keyboard',
      label: 'Keyboard shortcuts',
      binding: 'shift+?',
      run: () => setOverlay('shortcuts'),
    })
    out.push({
      id: 'reconnect',
      group: 'Help',
      icon: 'refresh',
      label: 'Re-check the backend',
      hint: 'health, tool count and connector errors',
      run: () => { refreshHealth(); refreshCaps() },
    })

    return out
  }, [
    caps, conversations, activeId, memory, chat, setView, setCapEnabled,
    busyCap, setOverlay, toast, refreshHealth, refreshCaps, setCapabilitiesTab,
    theme, setTheme, jobs, automations, query, bare, askInBackground,
  ])

  /* Whatever was typed, offered as a question.

     First and never scored, because the palette is a text field and someone who
     typed a sentence into it wants an answer far more often than they want a
     command whose name happens to share letters with it. Filtering this one
     would mean the question had to match itself. */
  const askCommand = useMemo(() => {
    const question = query.trim()
    if (!question) return null
    return {
      id: 'ask',
      group: 'Ask',
      icon: 'send',
      label: `Ask AMETHYST — “${question}”`,
      hint: 'sends it as a turn, in the conversation that is open',
      done: 'Asked — you will be told when it is done',
      run: () => {
        if (bare) return askInBackground(question)
        setView('chat')
        // One more tick: opened from another view, Chat has to mount and
        // register its handle before it can be asked anything.
        setTimeout(() => chat.ask?.(question), 0)
      },
    }
  }, [query, setView, chat])

  /* Filing what was typed, for the same reason the ask is not filtered: it is a
     command *about* the text, not one whose name the text is searching for. A
     pasted URL matches the word "library" nowhere, so scoring it hid the one
     row that was worth offering. */
  const libraryCommand = useMemo(() => {
    const typed = query.trim()
    if (!typed) return null
    const isLink = /^https?:\/\//i.test(typed)
    return {
      id: 'library:add',
      group: 'Library',
      icon: 'bookmark',
      label: isLink ? 'Add this link to the library' : `Log “${typed}” in the library`,
      hint: isLink ? 'captures the page, then files it' : 'as a note',
      done: 'Added to the library',
      run: async () => {
        await api.addLibraryItem(isLink ? { url: typed } : { title: typed, kind: 'note' })
        if (!bare) toast('Added to the library', 'ok')
      },
    }
  }, [query, bare, toast])

  const results = useMemo(() => {
    if (!query.trim()) return commands
    const matched = commands
      .map((c) => ({ c, s: Math.max(score(c.label, query.trim()), score(`${c.group} ${c.label}`, query.trim()) - 60) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c)
    return [askCommand, libraryCommand, ...matched].filter(Boolean)
  }, [commands, query, askCommand, libraryCommand])

  /* Group headers are decided with the list, not while rendering it, so the
     header a row carries does not depend on the order React happens to render.
     Read from the previous entry rather than carried in a variable reassigned
     across the map -- same result, and nothing outside the row is mutated. */
  const rows = useMemo(() => results.map((command, i) => ({
    command,
    header: command.group === results[i - 1]?.group ? null : command.group,
  })), [results])

  useEffect(() => { setIndex(0) }, [query])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [index, open, results])

  if (!open) return null

  const run = async (command) => {
    if (!bare) {
      close()
      // Let the overlay unmount before focus moves, so the composer keeps it.
      setTimeout(() => command.run(), 0)
      return
    }
    /* The bar says what it did, then gets out of the way.

       Hiding first would make every action look like it did nothing, which on a
       thing summoned by a keystroke is indistinguishable from a hotkey that is
       broken. A failure keeps it up: an error nobody can see is worse than one
       that interrupts. */
    try {
      setFlash(command.done || 'Done')
      await command.run()
    } catch (err) {
      setFlash(err?.message || 'That did not work')
      return
    }
    setTimeout(() => { setFlash(null); hideBar() }, 900)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const command = results[index]
      if (command) run(command)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const card = (
      <div
        className={`palette${bare ? ' palette--bar' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Run anything — a skill, a connector, a conversation"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search commands"
          />
          {flash
            ? <span className="palette-flash">{flash}</span>
            : <kbd className="kbd">Esc</kbd>}
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
          {rows.map(({ command, header }, i) => {
            return (
              <div key={command.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  className={`palette-item${i === index ? ' active' : ''}`}
                  data-active={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(command)}
                >
                  <Icon name={command.icon} size={15} />
                  <span className="palette-label">
                    {command.label}
                    {command.beta && <span className="beta">beta</span>}
                    {command.hint && <span className="palette-hint">{command.hint}</span>}
                  </span>
                  {command.state && (
                    <span className={`state state--${command.state}`}>
                      {command.state === 'on' ? 'on' : command.state === 'bad' ? 'failed' : 'off'}
                    </span>
                  )}
                  {command.binding && (
                    <span className="palette-keys">
                      {pretty(command.binding).map((k, n) => <kbd key={n} className="kbd">{k}</kbd>)}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
  )

  /* The bar is its own window, so there is nothing to lay it over. */
  if (bare) return card
  return (
    <div
      className="modal-overlay palette-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      {card}
    </div>
  )
}
