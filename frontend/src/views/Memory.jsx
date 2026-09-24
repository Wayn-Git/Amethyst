import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api, fmtDate } from '../api.js'
import { SkeletonCard } from '../components/Skeleton.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import ErrorState from '../components/ui/ErrorState.jsx'

export default function Memory() {
  const rootRef = useRef(null)
  const { toast } = useApp()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState('')
  const [filter, setFilter] = useState('')
  const [newFact, setNewFact] = useState('')
  useViewEntrance(rootRef)

  const load = useCallback(async () => {
    setError(null)
    try {
      setState(await api.memory())
    } catch (err) {
      // A toast alone disappears in a few seconds, leaving the permanent
      // loading skeleton below as the only thing on screen -- indistinguishable
      // from "still loading" for as long as the page stays open.
      setError(err.message)
      toast(err.message, 'bad')
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const toggle = async () => {
    setBusy('toggle')
    try {
      const next = await api.toggleMemory(!state.enabled)
      toast(next.enabled ? 'Memory on' : 'Memory off — nothing new will be recorded', 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const addFact = async (e) => {
    e?.preventDefault()
    const trimmed = newFact.trim()
    if (!trimmed) return
    setBusy('add')
    try {
      await api.addMemory(trimmed)
      setNewFact('')
      toast('Memory recorded', 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const forget = async (fact) => {
    setBusy(`f${fact.id}`)
    try {
      await api.forgetMemory(fact.id)
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const facts = (state?.facts ?? []).filter(
    (f) => !filter.trim() || f.fact.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  const enabled = state?.enabled ?? false

  return (
    <div className="view" ref={rootRef}>
      <div className="view-inner view-inner--wide">
        <header className="vheader" data-enter>
          <div>
            <h1>What AMETHYST remembers</h1>
            <div className="vheader-sub">
              Standing facts, extracted after a turn and recalled in later conversations.
              Correcting one retires it rather than deleting it, so what AMETHYST believed —
              and when that changed — stays answerable.
            </div>
          </div>
          <div className="vheader-actions">
            <button
              type="button"
              className={`btn btn--small${enabled ? ' btn--primary' : ' btn--ghost'}`}
              disabled={busy === 'toggle' || !state}
              onClick={toggle}
            >
              {enabled ? 'Memory on' : 'Memory off'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={load}>
              <Icon name="refresh" size={15} /> Refresh
            </button>
          </div>
        </header>

        {!enabled && state && (
          <div className="msg-note msg-note--warning" style={{ marginBottom: 16 }} data-enter>
            <Icon name="info" size={14} />
            <span>
              Memory is switched off globally: nothing new is recorded and nothing below is
              recalled. Facts already held are kept, not deleted.
            </span>
          </div>
        )}

        {/* Direct manual memory entry */}
        <form
          className="mem-add-form"
          onSubmit={addFact}
          data-enter
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}
        >
          <div className="inline-search" style={{ flex: 1, maxWidth: 'none' }}>
            <Icon name="plus" size={13} style={{ opacity: 0.65 }} />
            <input
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="Add a fact for AMETHYST to remember (e.g. 'Prefers dark mode', 'Lives in Berlin')..."
              aria-label="Add a new fact"
              disabled={busy === 'add'}
            />
            {newFact && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setNewFact('')}
                aria-label="Clear input"
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="btn btn--primary btn--small"
            disabled={!newFact.trim() || busy === 'add'}
            style={{ flexShrink: 0 }}
          >
            <Icon name="spark" size={13} /> {busy === 'add' ? 'Saving…' : 'Remember'}
          </button>
        </form>

        {/* The filter used to be an `<input>` carrying its own hand-written
            colours and radius in a style attribute — a control that belonged
            to no design system and drifted from every other field on sight.
            This is the same one the log and the mailbox use. */}
        <div className="log-controls" data-enter>
          <span className="badge">{state?.facts?.length ?? 0} held</span>
          <div className="inline-search">
            <Icon name="search" size={13} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter facts"
              aria-label="Filter facts"
              onKeyDown={(e) => { if (e.key === 'Escape' && filter) { e.stopPropagation(); setFilter('') } }}
            />
            {filter && (
              <button type="button" className="icon-btn" onClick={() => setFilter('')} aria-label="Clear the filter">
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>

        {!state && !error && <SkeletonCard rows={5} controls={1} />}

        {!state && error && <ErrorState message={error} onRetry={load} />}

        {state && facts.length === 0 && (
          <EmptyState icon="spark">
            {state.facts.length === 0
              ? 'Nothing remembered yet. Tell AMETHYST something durable about you — a preference, a project, a constraint — and it will be recorded after the turn.'
              : 'No fact matches that filter.'}
          </EmptyState>
        )}

        {facts.length > 0 && (
          <div className="card card-pad mem-facts" data-enter>
            <div className="card-title">live facts</div>
            {facts.map((f) => (
              <div className="server-row" key={f.id}>
                {/* `flex: 1`, so every Forget lands in the same column instead
                    of wherever its own fact happens to end. */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="server-name" style={{ whiteSpace: 'normal' }}>{f.fact}</div>
                  <div className="server-target">
                    id {f.id} · learned {fmtDate(f.created_at)}
                    {f.conversation_id ? ` · in conversation ${f.conversation_id.slice(0, 8)}` : ''}
                  </div>
                </div>
                <div className="server-actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={busy === `f${f.id}`}
                    onClick={() => forget(f)}
                    title="Retire this fact — recall stops, the row is kept"
                  >
                    <Icon name="trash" size={13} /> {busy === `f${f.id}` ? '…' : 'Forget'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
