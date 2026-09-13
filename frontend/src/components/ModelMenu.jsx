import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { useMenuFit } from '../hooks/useMenuFit.js'
import { FadeScrollArea, SmoothInput } from './ui/skiper/index.js'

/* Which model answers the next message.

   Providers come from providers.yaml, and each declares a default model. A
   model that is not the declared default is still legitimate -- any name the
   endpoint accepts works -- so the list is a shortcut, not a whitelist, and the
   field below it takes anything.

   Two columns, because the two questions are different sizes. Which provider is
   a short list a person reads; which model is a long one they search -- Nvidia
   alone answers with well over a hundred names, and asking someone to recognise
   one of those in a datalist attached to a text field is not asking a question,
   it is hoping. The provider list opens the model list beside it, the model
   list has a field at the top that filters it, and the free-text field stays at
   the bottom for the names the endpoint will accept but does not enumerate. */

export default function ModelMenu({ provider, model, onChange, onClose, scoped, placement = 'up' }) {
  const { health } = useApp()
  const ref = useRef(null)
  const [custom, setCustom] = useState(model || '')
  // The selected provider's live model list. Best-effort: an endpoint that will
  // not answer leaves the list empty and the free-text field working as before.
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  // Which provider's models are on screen. Distinct from `provider`: opening a
  // provider's list is not the same as having chosen it, and picking a model is
  // what commits both.
  const [openProvider, setOpenProvider] = useState(provider || null)
  const [query, setQuery] = useState('')

  const providers = health?.providers ?? []
  const defaults = health?.provider_defaults ?? {}
  /* The backbone this install leans on, and the ones Auto will not pick.
     A grouping and a caveat, not a restriction: every provider below is
     selectable by hand, including the ones Auto leaves alone. */
  const core = health?.provider_core ?? []
  const noAuto = health?.provider_no_auto ?? []
  const canRoute = health?.routing ?? false
  const groups = useMemo(() => {
    const filled = [
      { key: 'core', label: 'core', names: providers.filter((n) => core.includes(n)) },
      { key: 'mine', label: 'yours', names: providers.filter((n) => !core.includes(n)) },
    ].filter((g) => g.names.length > 0)
    // One group is not a grouping. A lone "yours" heading over the whole list
    // labels nothing and costs a row of the little vertical space this menu
    // has -- and it is what a machine with no core providers configured, or a
    // backend too old to report them, renders.
    return filled.length > 1 ? filled : [{ key: 'all', label: null, names: providers }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.join(','), core.join(',')])
  /* Configured and not answering. Having a key is not the same as being
     reachable: a local endpoint declares no key at all, so `has_key` called
     Ollama configured by definition and this menu offered it while nothing
     was listening on its port -- nine consecutive `All connection attempts
     failed` in the real database. Still listed, because the user configured
     it on purpose; picking one is what says why it will not work. */
  const unavailable = health?.providers_unavailable ?? {}

  useDismiss(ref, true, {
    onAway: onClose,
    onEscape: () => { if (openProvider && openProvider !== provider) setOpenProvider(provider); else onClose() },
  })

  useEffect(() => {
    let live = true
    if (!openProvider) { setModels([]); return undefined }
    setLoading(true)
    setModels([])
    api.providerModels(openProvider)
      .then((r) => { if (live) setModels(r.models || []) })
      .catch(() => { if (live) setModels([]) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [openProvider])

  // Reset the filter when the list underneath it changes.
  useEffect(() => { setQuery('') }, [openProvider])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => m.id.toLowerCase().includes(q))
  }, [models, query])

  useMenuFit(ref, [providers.length, openProvider, models.length, filtered.length, loading])

  const pick = (name) => {
    const suggested = defaults[name]
    onChange({ provider: name, ...(suggested ? { model: suggested } : {}) })
    setCustom(suggested || '')
  }

  const freeCount = models.filter((m) => m.free).length

  return (
    <div className={`menu menu--right${placement === "down" ? " menu--down" : ""}`} ref={ref} role="menu">
      <FadeScrollArea className="menu-body" fadeHeight={20}>
        <div className="menu-flyout-head">
          {scoped ? 'model for this conversation' : 'model for the next conversation'}
        </div>
        {providers.length === 0 && (
          <div className="menu-empty">
            No providers configured. Add one in Settings → Models.
          </div>
        )}
        {/* Auto first, and without a model flyout: choosing it is choosing not
            to name a model. Offered only when something is switched on, because
            on an empty machine it is a button that can only ever error. */}
        {canRoute && (
          <button
            type="button"
            className={`menu-row${provider === 'auto' ? ' active' : ''}`}
            onClick={() => { onChange({ provider: 'auto', model: '' }); onClose() }}
            onMouseEnter={() => setOpenProvider(null)}
          >
            <span className="menu-gutter" />
            <span className="menu-label">
              Auto
              <span className="menu-hint">picks by size, speed and what is answering</span>
            </span>
            {provider === 'auto' && <Icon name="check" size={14} />}
          </button>
        )}

        {groups.map((group) => (
          <div key={group.key}>
            {group.label && <div className="menu-group-head">{group.label}</div>}
            {group.names.map((name) => {
          const suggested = defaults[name]
          const current = name === provider
          const down = unavailable[name]
          return (
            <button
              key={name}
              type="button"
              className={`menu-row${current ? ' active' : ''}${down ? ' menu-row--down' : ''}`}
              title={down || undefined}
              aria-haspopup="menu"
              aria-expanded={openProvider === name}
              onClick={() => {
                pick(name)
                setOpenProvider(name)
              }}
              onMouseEnter={() => setOpenProvider(name)}
            >
              <span className="menu-gutter" />
              <span className="menu-label">
                {name}
                <span className="menu-hint">
                  {down
                    ? 'not answering'
                    : noAuto.includes(name)
                      ? `${suggested || 'no default model'} · Auto never picks this`
                      : (suggested || 'no default model')}
                </span>
              </span>
              {current && <Icon name="check" size={14} />}
              <Icon name="chevron" size={13} className="menu-caret" />
            </button>
          )
            })}
          </div>
        ))}

        <div className="menu-sep" />

        {/* Anything the endpoint takes but does not list. */}
        <div className="menu-pad">
          <label className="menu-field-label" htmlFor="model-name">
            or type any name
          </label>
          <input
            id="model-name"
            className="menu-input"
            value={custom}
            placeholder="any name the endpoint accepts"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) { onChange({ model: custom.trim() }); onClose() }
            }}
          />
          <button
            type="button"
            className="btn btn--primary btn--small"
            style={{ marginTop: 8 }}
            disabled={!custom.trim() || custom.trim() === model}
            onClick={() => { onChange({ model: custom.trim() }); onClose() }}
          >
            Use this model
          </button>
        </div>
      </FadeScrollArea>

      {openProvider && (
        <div className="menu-flyout menu-flyout--models">
          <div className="menu-flyout-head">
            {loading
              ? `asking ${openProvider}…`
              : `${models.length} from ${openProvider}${freeCount ? `, ${freeCount} free` : ''}`}
          </div>
          {models.length > 0 && (
            <div className="menu-pad menu-pad--search">
              <SmoothInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${openProvider} models…`}
                inputClassName="menu-input"
                aria-label={`Search ${openProvider} models`}
              />
            </div>
          )}
          <FadeScrollArea className="menu-scroll menu-scroll--tall" fadeHeight={18}>
            {!loading && models.length === 0 && (
              <div className="menu-empty">
                {unavailable[openProvider] ? 'Not answering.' : 'It lists no models — type a name below.'}
              </div>
            )}
            {!loading && models.length > 0 && filtered.length === 0 && (
              <div className="menu-empty">Nothing matches “{query}”.</div>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`menu-row menu-row--model${m.id === model ? ' active' : ''}`}
                onClick={() => {
                  onChange({ provider: openProvider, model: m.id })
                  onClose()
                }}
              >
                <span className="menu-label mono">{m.id}</span>
                {m.free && <span className="menu-free">free</span>}
                {m.id === model && <Icon name="check" size={14} />}
              </button>
            ))}
          </FadeScrollArea>
        </div>
      )}
    </div>
  )
}
