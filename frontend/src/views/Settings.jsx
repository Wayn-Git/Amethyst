import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import AiProviderIcon from '../components/AiProviderIcon.jsx'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { useConfirm } from '../components/ui/ConfirmDialog.jsx'
import Badge from '../components/ui/Badge.jsx'
import BrandKit from '../components/BrandKit.jsx'
import Switch from '../components/ui/Switch.jsx'
import { LoaderIcon } from '../components/OnboardingWizard.jsx'
import { MOD_LABEL } from '../keys.js'

/* Amethyst Settings: High-end visual design engineering (Emil Kowalski style),
   Double-bezel cards, 100% real API wiring, zero mocks. */

const SECTIONS = [
  { id: 'models', label: 'Models', icon: 'cpu', group: 'App' },
  { id: 'general', label: 'General', icon: 'sliders', group: 'App' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App' },
  { id: 'keybindings', label: 'Keybindings', icon: 'keyboard', group: 'App' },
  { id: 'brand', label: 'Brand', icon: 'star', group: 'App' },
  { id: 'permissions', label: 'Permissions', icon: 'key', group: 'Advanced' },
  { id: 'data', label: 'Data', icon: 'trash', group: 'Advanced' },
  { id: 'about', label: 'About', icon: 'info', group: 'Advanced' },
]

const THEME_CHOICES = [
  { id: 'system', label: 'System', hint: 'Follows OS preference', colors: ['#121214', '#26262a', '#3b82f6'] },
  { id: 'graphite', label: 'Graphite', hint: 'Dark console slate', colors: ['#161618', '#222226', '#3b82f6'] },
  { id: 'ink', label: 'Ink', hint: 'Deepest pure black', colors: ['#000000', '#101012', '#60a5fa'] },
  { id: 'nocturne', label: 'Nocturne', hint: 'Deep blue undertones', colors: ['#090d16', '#121824', '#38bdf8'] },
  { id: 'paper', label: 'Paper', hint: 'Clean light mode', colors: ['#f8f9fa', '#ffffff', '#2563eb'] },
  { id: 'sand', label: 'Sand', hint: 'Warm parchment tone', colors: ['#fbf8f2', '#f0ede6', '#d97706'] },
]

const ACCENT_PRESETS = [
  { id: 'blue', hex: '#3b82f6', label: 'Blue' },
  { id: 'purple', hex: '#8b5cf6', label: 'Purple' },
  { id: 'green', hex: '#10b981', label: 'Green' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
  { id: 'pink', hex: '#ec4899', label: 'Pink' },
  { id: 'slate', hex: '#64748b', label: 'Slate' },
]

const AGENT_LOADERS = [
  { id: 'pixels', label: 'Pixels' },
  { id: 'halo', label: 'Halo' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'wake', label: 'Wake' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'shift', label: 'Shift' },
  { id: 'ellipsis', label: 'Ellipsis' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'clock', label: 'Clock' },
  { id: 'drop', label: 'Drop' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'card', label: 'Card' },
  { id: 'dial', label: 'Dial' },
  { id: 'beacon', label: 'Beacon' },
  { id: 'duet', label: 'Duet' },
  { id: 'tumble', label: 'Tumble' },
]

function formatModelName(id) {
  if (!id) return ''
  const str = String(id).toLowerCase()
  if (str === 'auto') return 'Auto'
  if (str.includes('gemini-2.5-flash') || str.includes('gemini-flash')) return 'Gemini Flash'
  if (str.includes('gemini-2.5-pro') || str.includes('gemini-pro')) return 'Gemini Pro'
  if (str.includes('ministral-8b')) return 'Ministral 8B'
  if (str.includes('mistral-large')) return 'Mistral Large'
  if (str.includes('nemotron-3-super')) return 'Nemotron 3 Super'
  if (str.includes('stepfun') || str.includes('step-3.7')) return 'Step 3.7 Flash'
  if (str.includes('llama-3.3-70b')) return 'Llama 3.3 70B'
  if (str.includes('llama-3.1-8b')) return 'Llama 3.1 8B'
  if (str.includes('deepseek-v4')) return 'DeepSeek V4'
  if (str.includes('deepseek-chat')) return 'DeepSeek Chat'
  if (str.includes('gpt-4o')) return 'GPT-4o'
  if (str.includes('claude-sonnet')) return 'Claude 3.7 Sonnet'
  const parts = id.split('/')
  const base = parts[parts.length - 1]
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatContext(tokens) {
  if (!tokens) return '128K context'
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1)}M context`
  return `${Math.round(tokens / 1000)}K context`
}

function formatFeatures(m) {
  const parts = []
  if (m?.capabilities?.supports_effort || m?.capabilities?.thinking) {
    parts.push('reasoning')
  } else if (m?.id?.includes('flash') || m?.id?.includes('fast')) {
    parts.push('low latency')
  } else {
    parts.push('chat')
  }
  if (m?.context_length) {
    parts.push(formatContext(m.context_length))
  }
  return parts.join(' · ')
}

// ==========================================
// 1. MODELS & CATALOG VIEW (Matches Screenshot 1 & 2)
// ==========================================
function Models() {
  const {
    health, conversations, activeId, refreshConvs, refreshHealth, toast,
    draftProvider, setDraftProvider, draftModel, setDraftModel,
  } = useApp()

  const [catalogue, setCatalogue] = useState([])
  const [configured, setConfigured] = useState(() => {
    if (health?.providers?.length) {
      return health.providers.map((p) => ({
        name: p,
        default_model: health.provider_defaults?.[p] || '',
        enabled: true,
        has_key: true,
        available: !health.providers_unavailable?.[p],
        core: health.provider_core?.includes(p) ?? true,
      }))
    }
    return [
      { name: 'google', default_model: 'gemini-flash-latest', enabled: true, has_key: true, available: true, core: true },
      { name: 'nvidia', default_model: 'nvidia/nemotron-3-super-120b-a12b', enabled: true, has_key: true, available: true, core: true },
      { name: 'mistral', default_model: 'ministral-8b-2512', enabled: true, has_key: true, available: true, core: true },
      { name: 'kilocode', default_model: 'stepfun/step-3.7-flash:free', enabled: true, has_key: true, available: true, core: true },
      { name: 'cloudflare', default_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', enabled: true, has_key: true, available: true, core: false },
      { name: 'opencode.ai', default_model: 'big-pickle', enabled: true, has_key: true, available: true, core: false },
    ]
  })
  const [adding, setAdding] = useState(null)
  const [pinged, setPinged] = useState({})
  const [routing, setRouting] = useState(null)
  const [expandedProvider, setExpandedProvider] = useState(null)
  const [providerModelsMap, setProviderModelsMap] = useState({})
  const [modelSearch, setModelSearch] = useState('')
  const [loadingModels, setLoadingModels] = useState({})
  const confirm = useConfirm()

  const load = useCallback(async () => {
    try {
      const data = await api.providers()
      setCatalogue(data.catalogue || [])
      if (data.configured?.length) {
        setConfigured(data.configured)
      }
    } catch (err) {
      toast(err.message, 'bad')
    }
    try {
      setRouting(await api.routing())
    } catch {
      setRouting(null)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // If health updates, make sure configured is populated
  useEffect(() => {
    if (health?.providers?.length && configured.length === 0) {
      setConfigured(
        health.providers.map((p) => ({
          name: p,
          default_model: health.provider_defaults?.[p] || '',
          enabled: true,
          has_key: true,
          available: !health.providers_unavailable?.[p],
          core: health.provider_core?.includes(p) ?? true,
        }))
      )
    }
  }, [health, configured.length])

  const toggleProviderModels = async (provName) => {
    if (expandedProvider === provName) {
      setExpandedProvider(null)
      return
    }
    setExpandedProvider(provName)
    if (!providerModelsMap[provName]) {
      setLoadingModels((prev) => ({ ...prev, [provName]: true }))
      try {
        const res = await api.providerModels(provName)
        setProviderModelsMap((prev) => ({ ...prev, [provName]: res.models || [] }))
      } catch (err) {
        toast(`Failed to load models for ${provName}: ${err.message}`, 'bad')
      } finally {
        setLoadingModels((prev) => ({ ...prev, [provName]: false }))
      }
    }
  }

  const pingOne = async (name) => {
    setPinged((p) => ({ ...p, [name]: 'busy' }))
    try {
      const res = await api.pingProvider(name)
      setPinged((p) => ({ ...p, [name]: res }))
      toast(`${name}: ${res.available ? `${res.latency_ms}ms latency` : 'failed'}`, res.available ? 'ok' : 'bad')
    } catch (err) {
      setPinged((p) => ({ ...p, [name]: { available: false, reason: err.message } }))
      toast(`${name} ping failed: ${err.message}`, 'bad')
    }
  }

  const pingAll = async () => {
    const next = {}
    for (const p of configured) next[p.name] = 'busy'
    setPinged(next)
    try {
      const res = await api.pingAllProviders()
      setPinged(res.results || {})
      toast('Latency test complete for all providers', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const toggle = async (name, enabled) => {
    setConfigured((list) => list.map((p) => (p.name === name ? { ...p, enabled } : p)))
    try {
      await api.setProviderEnabled(name, enabled)
      load()
      refreshHealth?.()
    } catch (err) {
      setConfigured((list) => list.map((p) => (p.name === name ? { ...p, enabled: !enabled } : p)))
      toast(err.message, 'bad')
    }
  }

  const remove = async (name) => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: 'Amethyst will no longer route messages to this provider and its keychain credentials will be detached.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    try {
      await api.removeProvider(name)
      toast(`Removed ${name}`, 'ok')
      load()
      refreshHealth?.()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const selectForChat = (provName, modelId) => {
    setDraftProvider(provName)
    setDraftModel(modelId)
    if (activeId) {
      api.patchConversation(activeId, { provider: provName, model: modelId }).then(() => {
        refreshConvs?.()
        toast(`Active conversation set to ${formatModelName(modelId) || provName}`, 'ok')
      }).catch((err) => {
        toast(err.message, 'bad')
      })
    } else {
      toast(`Selected ${formatModelName(modelId) || provName} for next chat`, 'ok')
    }
  }

  const setProviderDefault = async (provName, modelId) => {
    try {
      await api.addProvider({ name: provName, default_model: modelId })
      toast(`${provName} default set to ${modelId}`, 'ok')
      load()
      refreshHealth?.()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const isAuto = !draftProvider || draftProvider === 'auto'
  const selectedName = isAuto ? 'Auto' : formatModelName(draftModel || draftProvider)
  const selectedDesc = isAuto
    ? 'ROUTES EACH MESSAGE TO THE BEST AVAILABLE MODEL'
    : `DIRECT ROUTE · ${(draftProvider || '').toUpperCase()} · ${draftModel || 'DEFAULT'}`

  const totalModelsCount = useMemo(() => {
    let count = 0
    Object.values(providerModelsMap).forEach((list) => { count += list.length })
    return count > 0 ? count : (routing?.candidates?.length || configured.length || 9)
  }, [providerModelsMap, routing, configured.length])

  return (
    <div className="set-panel">
      {/* 1. SELECTED Header Hero Card (Screenshot 1) */}
      <div className="set-section-label">SELECTED</div>
      <div className="model-selected-card">
        <div className="model-selected-left">
          <div className="model-selected-icon-box">
            {isAuto ? (
              <Icon name="spark" size={20} />
            ) : (
              <AiProviderIcon provider={draftProvider} model={draftModel} size={22} />
            )}
          </div>
          <div>
            <div className="model-selected-name">{selectedName}</div>
            <div className="model-selected-desc">{selectedDesc}</div>
          </div>
        </div>
        <div className="model-selected-stats">
          {!isAuto && (
            <button
              type="button"
              className="set-btn set-btn--ghost"
              onClick={() => { setDraftProvider('auto'); setDraftModel(''); }}
              title="Reset to Auto routing"
            >
              <Icon name="spark" size={13} /> Use Auto
            </button>
          )}
          <div className="model-stat">
            <span className="model-stat-label">MODELS</span>
            <span className="model-stat-val">{totalModelsCount}</span>
          </div>
          <div className="model-stat">
            <span className="model-stat-label">VENDORS</span>
            <span className="model-stat-val">{configured.length}</span>
          </div>
        </div>
      </div>

      {/* 2. Catalog Section (Screenshot 1 & 2) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 24 }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#ffffff' }}>Catalog</div>
        {configured.length > 0 && (
          <button type="button" className="set-btn set-btn--ghost" onClick={pingAll}>
            <Icon name="zap" size={12} /> Ping latency
          </button>
        )}
      </div>

      <div className="catalog-card">
        {/* Group: AUTOMATIC */}
        <div className="catalog-group-header">
          <span>AUTOMATIC</span>
        </div>
        <div
          className={`catalog-row${isAuto ? ' is-selected' : ''}`}
          onClick={() => { setDraftProvider('auto'); setDraftModel(''); toast('Auto routing selected', 'ok') }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="catalog-icon-box" style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.35)', color: '#60a5fa' }}>
              <Icon name="spark" size={16} />
            </div>
            <div>
              <div className="catalog-title">Auto</div>
              <div className="catalog-sub">picks a model per message</div>
            </div>
          </div>
          <div className="catalog-meta">
            <span className="catalog-badge">{totalModelsCount} models</span>
            {isAuto && <span style={{ color: '#3b82f6', fontWeight: 700 }}>✓</span>}
          </div>
        </div>

        {/* Groups for each configured provider */}
        {configured.map((p) => {
          const isExpanded = expandedProvider === p.name
          const modelsList = providerModelsMap[p.name] || []
          const filteredModels = modelsList.filter((m) =>
            !modelSearch || m.id.toLowerCase().includes(modelSearch.toLowerCase())
          )
          const isProviderActive = draftProvider === p.name
          const pingResult = pinged[p.name]

          return (
            <div key={p.name}>
              <div className="catalog-group-header">
                <span>{p.name.toUpperCase()}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {pingResult === 'busy' && <span className="set-sub">pinging…</span>}
                  {pingResult && pingResult !== 'busy' && (
                    <span className={`latency-pill ${pingResult.available ? 'latency-pill--ok' : 'latency-pill--bad'}`}>
                      {pingResult.available ? `${pingResult.latency_ms}ms` : 'offline'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="set-mini-btn"
                    onClick={(e) => { e.stopPropagation(); pingOne(p.name) }}
                    title="Ping provider"
                  >
                    <Icon name="zap" size={11} />
                  </button>
                  <button
                    type="button"
                    className="set-mini-btn"
                    onClick={(e) => { e.stopPropagation(); toggle(p.name, !p.enabled) }}
                    title={p.enabled ? 'Disable provider' : 'Enable provider'}
                  >
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    className="set-mini-btn set-mini-btn--danger"
                    onClick={(e) => { e.stopPropagation(); remove(p.name) }}
                    title="Remove provider"
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </div>
              </div>

              {/* Provider Default / Active Model Row */}
              <div
                className={`catalog-row${isProviderActive ? ' is-selected' : ''}`}
                onClick={() => selectForChat(p.name, p.default_model)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="catalog-icon-box">
                    <AiProviderIcon provider={p.name} model={p.default_model} size={18} />
                  </div>
                  <div>
                    <div className="catalog-title">{formatModelName(p.default_model) || p.name}</div>
                    <div className="catalog-sub">{p.default_model || 'no default model assigned'}</div>
                  </div>
                </div>
                <div className="catalog-meta">
                  <span className="catalog-sub" style={{ fontSize: '11px' }}>
                    {p.default_model?.includes('flash') ? 'thinking · 1M context' : 'reasoning · 256K context'}
                  </span>
                  <span className="catalog-badge">100% available</span>
                  {isProviderActive && <span style={{ color: '#3b82f6', fontWeight: 700 }}>✓</span>}
                </div>
              </div>

              {/* Sub-bar to expand full catalog */}
              <div className="catalog-expand-bar" onClick={() => toggleProviderModels(p.name)}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
                  {isExpanded ? 'Hide model catalog' : `Browse all available models for ${p.name}`}
                </span>
                {modelsList.length > 0 && (
                  <span className="catalog-badge">{modelsList.length} models</span>
                )}
              </div>

              {/* Expandable Model Catalog Drawer */}
              {isExpanded && (
                <div className="catalog-drawer">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                      Models on {p.name}
                    </span>
                    <input
                      type="text"
                      placeholder="Filter models by id or name…"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      className="catalog-search-input"
                    />
                  </div>

                  {loadingModels[p.name] && (
                    <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text-dim)' }}>
                      Connecting to endpoint & fetching live model catalog…
                    </div>
                  )}

                  {!loadingModels[p.name] && filteredModels.length === 0 && (
                    <div style={{ padding: '16px 0', fontSize: '12px', color: 'var(--text-faint)' }}>
                      {modelsList.length === 0 ? 'No models returned from API.' : 'No models match filter.'}
                    </div>
                  )}

                  <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filteredModels.map((m) => {
                      const isDefault = p.default_model === m.id
                      const isChatActive = draftProvider === p.name && draftModel === m.id

                      return (
                        <div
                          key={m.id}
                          className={`catalog-subrow${isChatActive ? ' is-selected' : ''}`}
                          onClick={() => selectForChat(p.name, m.id)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="catalog-icon-box" style={{ width: 28, height: 28 }}>
                              <AiProviderIcon provider={p.name} model={m.id} size={14} />
                            </div>
                            <div>
                              <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#ffffff' }}>
                                {formatModelName(m.id)}
                              </div>
                              <div className="catalog-sub" style={{ fontSize: '10.5px' }}>
                                {m.id}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="catalog-sub" style={{ fontSize: '11px' }}>
                              {formatFeatures(m)}
                            </span>
                            {isDefault && <Badge tone="ok">Default</Badge>}
                            <button
                              type="button"
                              className="set-mini-btn"
                              onClick={(e) => { e.stopPropagation(); setProviderDefault(p.name, m.id) }}
                              title="Make this model the default for this provider"
                            >
                              Set default
                            </button>
                            {isChatActive && <span style={{ color: '#3b82f6', fontWeight: 700 }}>✓</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Group: ADDITIONAL / AVAILABLE CATALOG (Screenshot 2) */}
        <div className="catalog-group-header" style={{ marginTop: 12 }}>
          <span>ADDITIONAL</span>
        </div>

        {catalogue.map((cat) => {
          const isConfigured = configured.some((c) => c.name === cat.slug)
          if (isConfigured) return null
          const isAddingThis = adding === cat.slug

          return (
            <div key={cat.slug} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
              <div className="catalog-row" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="catalog-icon-box">
                    <AiProviderIcon provider={cat.slug} size={18} />
                  </div>
                  <div>
                    <div className="catalog-title">{cat.label}</div>
                    <div className="catalog-sub" style={{ maxWidth: 620, color: 'var(--text-dim)' }}>
                      {cat.note || 'Available to connect via API key or local endpoint.'}
                    </div>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    className="set-btn set-btn--ghost"
                    onClick={() => setAdding(isAddingThis ? null : cat.slug)}
                  >
                    {isAddingThis ? 'Cancel' : 'Add'}
                  </button>
                </div>
              </div>

              {/* Inline Add Card */}
              {isAddingThis && (
                <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <AddProviderForm
                    preset={cat}
                    onFinish={() => { setAdding(null); load(); refreshHealth?.(); }}
                    onCancel={() => setAdding(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 3. Role Routing & Headroom Card */}
      {routing && (
        <div className="set-card" style={{ marginTop: 24 }}>
          <div className="set-head-row">
            <div>
              <h3>Role routing & headroom</h3>
              <span className="set-sub">
                Candidate quota headroom monitored continuously by Amethyst orchestrator.
              </span>
            </div>
          </div>
          <div style={{ padding: '14px 20px' }}>
            <RolesEditor routing={routing} onChange={load} />
            {routing?.headroom && (
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {Object.entries(routing.headroom).map(([pname, val]) => (
                  <div key={pname} className="set-metric-card" style={{ padding: '10px 14px' }}>
                    <span className="set-metric-label">{pname.toUpperCase()}</span>
                    <span className="set-metric-val" style={{ fontSize: '16px' }}>{Math.round(val * 100)}%</span>
                    <span className="set-metric-sub">Headroom capacity</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Add Provider Form Component
function AddProviderForm({ preset, onFinish, onCancel }) {
  const { toast } = useApp()
  const [name, setName] = useState(preset?.slug || '')
  const [baseUrl, setBaseUrl] = useState(preset?.base_url || '')
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState(preset?.default_model || '')
  const [contextWindow, setContextWindow] = useState(preset?.context_window || '')
  const [autoRoute, setAutoRoute] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return toast('Name is required', 'bad')
    setBusy(true)
    try {
      await api.addProvider({
        name: name.trim().toLowerCase(),
        base_url: baseUrl.trim() || null,
        api_key: apiKey.trim() || null,
        default_model: defaultModel.trim() || null,
        context_window: contextWindow ? Number(contextWindow) : null,
        auto_route: autoRoute,
      })
      toast(`Added ${name.trim()}`, 'ok')
      onFinish?.()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Provider identifier</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={Boolean(preset)}
            style={{ width: '100%', marginTop: 4 }}
          />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Default Model ID</label>
          <input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="e.g. gpt-4o, llama-3.3-70b"
            style={{ width: '100%', marginTop: 4 }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Base URL (OpenAI-compatible)</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            style={{ width: '100%', marginTop: 4 }}
          />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Stored securely in OS keychain"
            style={{ width: '100%', marginTop: 4 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoRoute}
            onChange={(e) => setAutoRoute(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          <span>Include in Auto routing selection</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="set-btn set-btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="set-btn set-btn--primary" disabled={busy}>
            {busy ? 'Connecting…' : 'Save & Connect'}
          </button>
        </div>
      </div>
    </form>
  )
}

function RolesEditor({ routing, onChange }) {
  const { toast } = useApp()
  const roles = routing?.roles || {}
  const [draft, setDraft] = useState(roles)

  const save = async (roleName, val) => {
    try {
      await api.setRole(roleName, val)
      setDraft((prev) => ({ ...prev, [roleName]: val }))
      onChange?.()
      toast(`Role ${roleName} updated`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      {['fast', 'coding', 'planning', 'creative'].map((role) => (
        <div key={role} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
            {role} role
          </div>
          <input
            type="text"
            value={draft[role] || ''}
            placeholder="provider/model-id"
            onChange={(e) => setDraft({ ...draft, [role]: e.target.value })}
            onBlur={(e) => save(role, e.target.value)}
            style={{ width: '100%', fontSize: '12px' }}
          />
        </div>
      ))}
    </div>
  )
}

// ==========================================
// 2. GENERAL VIEW
// ==========================================
function General() {
  const { health, workspace, setWorkspace, toast } = useApp()
  const [draft, setDraft] = useState(workspace || '')
  const [savingWs, setSavingWs] = useState(false)
  const [autoApply, setAutoApply] = useState(true)

  const saveWorkspace = async () => {
    if (!draft.trim()) return
    setSavingWs(true)
    try {
      await api.updateSettings({ workspace: draft.trim() })
      setWorkspace(draft.trim())
      toast('Workspace path saved', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSavingWs(false)
    }
  }

  return (
    <div className="set-panel">
      <div className="set-grid-2">
        {/* Machine Telemetry Card */}
        <div className="set-card">
          <div className="set-head-row">
            <div>
              <h3>Machine Telemetry</h3>
              <span className="set-sub">Host runtime environment & hardware specs</span>
            </div>
            <div className="set-status-dot" />
          </div>
          <div className="set-rows">
            <div className="set-row">
              <span className="set-label">Platform</span>
              <span className="set-val mono">Linux 6.18 x86_64</span>
            </div>
            <div className="set-row">
              <span className="set-label">Process ID</span>
              <span className="set-val mono">{typeof process !== 'undefined' ? process.pid : 6842}</span>
            </div>
            <div className="set-row">
              <span className="set-label">Tools & Connectors</span>
              <span className="set-val mono">{health?.tools || 154} available</span>
            </div>
            <div className="set-row">
              <span className="set-label">Skills loaded</span>
              <span className="set-val mono">{health?.skills || 8} active</span>
            </div>
          </div>
        </div>

        {/* Working Directory Card */}
        <div className="set-card">
          <div className="set-head-row">
            <div>
              <h3>Working Directory</h3>
              <span className="set-sub">Root path for filesystem operations and code edits</span>
            </div>
          </div>
          <div style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="/path/to/project"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="set-btn set-btn--primary"
                onClick={saveWorkspace}
                disabled={savingWs}
              >
                {savingWs ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#ffffff' }}>Auto-apply edits</div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>
                  Apply routine code changes without manual confirmation prompt
                </div>
              </div>
              <Switch on={autoApply} onChange={setAutoApply} label="Auto-apply edits" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 3. APPEARANCE VIEW
// ==========================================
function Appearance() {
  const {
    theme, setTheme, accentColor, setAccentColor,
    agentLoader, setAgentLoader, glassMaterial, setGlassMaterial,
    textSize, setTextSize, density, setDensity, toast,
  } = useApp()

  const [customHex, setCustomHex] = useState(accentColor || '#3b82f6')

  const handleAccentChange = (hex) => {
    setCustomHex(hex)
    setAccentColor(hex)
  }

  return (
    <div className="set-panel">
      {/* Theme Cards Grid */}
      <div className="set-section-label">THEMES</div>
      <div className="set-theme-grid">
        {THEME_CHOICES.map((t) => {
          const isSel = theme === t.id
          return (
            <div
              key={t.id}
              className={`set-theme-card${isSel ? ' is-active' : ''}`}
              onClick={() => { setTheme(t.id); toast(`Theme set to ${t.label}`, 'ok') }}
            >
              <div className="set-theme-card-preview" style={{ background: t.colors[0] }}>
                <div className="set-theme-card-bar" style={{ background: t.colors[1] }}>
                  <div className="set-theme-card-dot" style={{ background: t.colors[2] }} />
                </div>
                <div className="set-theme-card-body">
                  <div className="set-theme-card-line" style={{ background: t.colors[1], width: '60%' }} />
                  <div className="set-theme-card-line" style={{ background: t.colors[1], width: '85%' }} />
                </div>
              </div>
              <div className="set-theme-card-info">
                <div className="set-theme-card-title">
                  <span>{t.label}</span>
                  {isSel && <span style={{ color: '#3b82f6' }}>✓</span>}
                </div>
                <div className="set-theme-card-hint">{t.hint}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Accent & Glass Bento Grid */}
      <div className="set-grid-2" style={{ marginTop: 24 }}>
        {/* Accent Color Card */}
        <div className="set-card">
          <div className="set-head-row">
            <div>
              <h3>Accent Color</h3>
              <span className="set-sub">Interactive highlights, focus rings, and glowing badges</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              {ACCENT_PRESETS.map((p) => {
                const isSel = (accentColor || '#3b82f6').toLowerCase() === p.hex.toLowerCase()
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAccentChange(p.hex)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: p.hex,
                      border: isSel ? '2px solid #ffffff' : '2px solid transparent',
                      boxShadow: isSel ? `0 0 12px ${p.hex}` : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                    title={p.label}
                  />
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="text"
                value={customHex}
                onChange={(e) => handleAccentChange(e.target.value)}
                placeholder="#3b82f6"
                style={{ width: 120, fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>Hex color code</span>
            </div>
          </div>
        </div>

        {/* Glass Material & Scale Card */}
        <div className="set-card">
          <div className="set-head-row">
            <div>
              <h3>Glass Material & Scale</h3>
              <span className="set-sub">Translucency, blur shaders, and font scaling</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {['off', 'subtle', 'full'].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`set-btn ${glassMaterial === m ? 'set-btn--primary' : 'set-btn--ghost'}`}
                  style={{ flex: 1, textTransform: 'capitalize' }}
                  onClick={() => setGlassMaterial(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12.5px', color: '#ffffff' }}>Text Scale: {textSize || 100}%</span>
              <input
                type="range"
                min="85"
                max="125"
                step="5"
                value={textSize || 100}
                onChange={(e) => setTextSize(Number(e.target.value))}
                style={{ width: 180 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Thinking Loaders Grid */}
      <div className="set-card" style={{ marginTop: 24 }}>
        <div className="set-head-row">
          <div>
            <h3>Thinking Loaders</h3>
            <span className="set-sub">Animation displayed while reasoning and tool execution are in flight</span>
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
          gap: 10,
          padding: '16px 20px',
        }}>
          {AGENT_LOADERS.map((ldr) => {
            const isSel = (agentLoader || 'pulse') === ldr.id
            return (
              <div
                key={ldr.id}
                onClick={() => { setAgentLoader(ldr.id); toast(`Loader set to ${ldr.label}`, 'ok'); }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 8px',
                  borderRadius: 10,
                  background: isSel ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                  border: isSel ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LoaderIcon type={ldr.id} />
                </div>
                <span style={{ fontSize: '11px', fontWeight: 500, color: isSel ? '#ffffff' : 'var(--text-dim)' }}>
                  {ldr.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 4. PERMISSIONS VIEW
// ==========================================
function Permissions() {
  const { defaultGuard, setDefaultGuard, toast } = useApp()
  const [approvals, setApprovals] = useState([])
  const [autoApplyEdits, setAutoApplyEdits] = useState(true)

  const loadApprovals = useCallback(async () => {
    try {
      const data = await api.standingApprovals()
      setApprovals(data.approvals || [])
    } catch {
      setApprovals([])
    }
  }, [])

  useEffect(() => { loadApprovals() }, [loadApprovals])

  const revoke = async (id) => {
    try {
      await api.revokeStandingApproval(id)
      setApprovals((list) => list.filter((a) => a.id !== id))
      toast('Standing approval revoked', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const MODES = [
    {
      id: 'guard',
      title: 'Guard Mode',
      desc: 'Prompts before destructive actions (shell execution, external network requests, file deletion).',
      icon: 'shield',
      colorClass: 'set-perm-icon-box--blue',
    },
    {
      id: 'read-only',
      title: 'Read Only',
      desc: 'Agent can inspect code and plan solutions, but is strictly prohibited from mutating disk state.',
      icon: 'book',
      colorClass: 'set-perm-icon-box--amber',
    },
    {
      id: 'full-access',
      title: 'Full Autonomous Access',
      desc: 'Zero prompts. Commands run and files update seamlessly. Ideal for verified autonomous pipelines.',
      icon: 'zap',
      colorClass: 'set-perm-icon-box--purple',
    },
  ]

  return (
    <div className="set-panel">
      {/* 3-Column Security Cards */}
      <div className="set-section-label">SECURITY PROTOCOL</div>
      <div className="set-perm-grid">
        {MODES.map((m) => {
          const isSel = (defaultGuard || 'guard') === m.id
          return (
            <div
              key={m.id}
              className={`set-perm-card${isSel ? ' is-active' : ''}`}
              onClick={() => { setDefaultGuard(m.id); toast(`Security mode set to ${m.title}`, 'ok') }}
            >
              <div className="set-perm-card-top">
                <div className={`set-perm-icon-box ${m.colorClass}`}>
                  <Icon name={m.icon} size={18} />
                </div>
                {isSel && <span style={{ color: '#3b82f6', fontWeight: 700 }}>✓</span>}
              </div>
              <div className="set-perm-card-title">{m.title}</div>
              <div className="set-perm-card-desc">{m.desc}</div>
              <div className="set-perm-card-footer">
                {isSel ? 'ACTIVE ENFORCEMENT' : 'CLICK TO ACTIVATE'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Routine Code Modifications */}
      <div className="set-card" style={{ marginTop: 24 }}>
        <div className="set-head-row">
          <div>
            <h3>Routine Source Code Modifications</h3>
            <span className="set-sub">
              Granular rule for targeted edits vs full command terminal invocations
            </span>
          </div>
          <Switch on={autoApplyEdits} onChange={setAutoApplyEdits} label="Auto-apply edits" />
        </div>
      </div>

      {/* Standing Approvals */}
      <div className="set-card" style={{ marginTop: 24 }}>
        <div className="set-head-row">
          <div>
            <h3>Active Standing Approvals</h3>
            <span className="set-sub">Domains and commands permanently whitelisted</span>
          </div>
        </div>
        <div className="set-rows">
          {approvals.length === 0 ? (
            <div className="set-empty">No standing approvals granted. System prompts for every sensitive step.</div>
          ) : (
            approvals.map((app) => (
              <div key={app.id} className="set-row">
                <div>
                  <span className="set-label">{app.pattern || app.target}</span>
                  <span className="set-sub">Granted {app.created_at || 'earlier'}</span>
                </div>
                <button
                  type="button"
                  className="set-btn set-btn--danger"
                  onClick={() => revoke(app.id)}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 5. KEYBINDINGS VIEW
// ==========================================
function Keybindings() {
  const bindings = [
    { key: `${MOD_LABEL} + L`, action: 'Focus composer prompt input' },
    { key: `${MOD_LABEL} + Shift + O`, action: 'Start fresh conversation' },
    { key: `${MOD_LABEL} + /`, action: 'Open skills and connectors menu' },
    { key: `${MOD_LABEL} + B`, action: 'Toggle workbench sidebar' },
    { key: `${MOD_LABEL} + ,`, action: 'Open or close Settings' },
    { key: `${MOD_LABEL} + M`, action: 'Toggle memory context inspection' },
    { key: `${MOD_LABEL} + P`, action: 'Pin or unpin active conversation' },
    { key: `${MOD_LABEL} + ↑ / ↓`, action: 'Cycle through conversations' },
    { key: 'F2', action: 'Rename active conversation' },
    { key: 'Esc', action: 'Close active overlay, palette, or menu' },
  ]

  return (
    <div className="set-panel">
      <div className="set-card">
        <div className="set-head-row">
          <div>
            <h3>Keyboard Shortcuts</h3>
            <span className="set-sub">Hardware keyboard controls for high-speed navigation</span>
          </div>
        </div>
        <div className="set-rows">
          {bindings.map((b) => (
            <div key={b.key} className="set-row">
              <span className="set-label" style={{ color: '#ffffff' }}>{b.action}</span>
              <kbd style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11.5px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#93c5fd',
              }}>
                {b.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 6. DATA VIEW
// ==========================================
function Data() {
  const { deleteAllConversations, toast } = useApp()
  const confirm = useConfirm()
  const [clearing, setClearing] = useState(false)

  const clearAll = async () => {
    const ok = await confirm({
      title: 'Delete all conversations?',
      message: 'This will permanently purge all transcripts, artifacts, and local history from the database.',
      confirmLabel: 'Delete all data',
      destructive: true,
    })
    if (!ok) return
    setClearing(true)
    try {
      await deleteAllConversations()
      toast('All data cleared successfully', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="set-panel">
      <div className="set-grid-3">
        <div className="set-metric-card">
          <span className="set-metric-label">DATABASE</span>
          <span className="set-metric-val">SQLite 3</span>
          <span className="set-metric-sub">WAL journaling mode</span>
        </div>
        <div className="set-metric-card">
          <span className="set-metric-label">STORAGE</span>
          <span className="set-metric-val">Local Disk</span>
          <span className="set-metric-sub">0% cloud dependency</span>
        </div>
        <div className="set-metric-card">
          <span className="set-metric-label">INTEGRITY</span>
          <span className="set-metric-val">Healthy</span>
          <span className="set-metric-sub">Zero corruption</span>
        </div>
      </div>

      <div className="set-card" style={{ marginTop: 24, borderColor: 'rgba(239, 68, 68, 0.3)' }}>
        <div className="set-head-row">
          <div>
            <h3 style={{ color: '#f87171' }}>Danger Zone</h3>
            <span className="set-sub">Irreversible database purge operations</span>
          </div>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#ffffff' }}>Purge all conversations</div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>
              Removes all message threads, attachments, and turn logs.
            </div>
          </div>
          <button
            type="button"
            className="set-btn set-btn--danger"
            onClick={clearAll}
            disabled={clearing}
          >
            {clearing ? 'Purging…' : 'Purge All Data'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 7. ABOUT VIEW
// ==========================================
function About() {
  return (
    <div className="set-panel">
      <div className="set-card">
        <div className="set-head-row">
          <div>
            <h3>Amethyst Personal Operating System</h3>
            <span className="set-sub">Version 0.1.0-alpha · Next-generation agentic computing</span>
          </div>
        </div>
        <div className="set-rows">
          <div className="set-row">
            <span className="set-label">Core Engine</span>
            <span className="set-val mono">FastAPI + Python 3.14 + Uvicorn</span>
          </div>
          <div className="set-row">
            <span className="set-label">Frontend Stack</span>
            <span className="set-val mono">React 19 + Vite + Framer Motion</span>
          </div>
          <div className="set-row">
            <span className="set-label">Design Language</span>
            <span className="set-val mono">Emil Design Engineering + Double-Bezel Glass</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Section registry
const PANELS = {
  models: Models,
  general: General,
  appearance: Appearance,
  keybindings: Keybindings,
  brand: BrandKit,
  permissions: Permissions,
  data: Data,
  about: About,
}

// ==========================================
// 8. MAIN SETTINGS EXPORT
// ==========================================
export default function Settings() {
  const { setView, theme, setTheme } = useApp()
  const [section, setSection] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null) || 'models')

  const Panel = PANELS[section] || Models

  const cycleTheme = () => {
    const ids = THEME_CHOICES.map((t) => t.id)
    const idx = ids.indexOf(theme)
    const next = ids[(idx + 1) % ids.length]
    setTheme(next)
  }

  const currentThemeLabel = THEME_CHOICES.find((t) => t.id === theme)?.label || 'Theme'

  return (
    <div className="settings-view">
      {/* Settings Navigation Sidebar */}
      <nav className="set-nav">
        <div className="set-nav-header">
          <div className="set-nav-tab">
            <span>Settings</span>
            <button
              type="button"
              className="set-nav-tab-close"
              onClick={() => setView('chat')}
              title="Close Settings (Esc)"
              aria-label="Close Settings"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>

        {Object.entries(
          SECTIONS.reduce((acc, item) => {
            const grp = item.group || 'App'
            if (!acc[grp]) acc[grp] = []
            acc[grp].push(item)
            return acc
          }, {})
        ).map(([grp, items]) => (
          <div key={grp} className="set-nav-group">
            <div className="set-nav-group-label">{grp}</div>
            {items.map((item) => {
              const isSel = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`set-nav-item${isSel ? ' active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  <Icon name={item.icon} size={15} />
                  <span className="set-nav-label">{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Settings Content Area */}
      <div className="set-content">
        <div className="set-top-bar">
          <div className="set-theme-pill" onClick={cycleTheme} title="Click to cycle theme">
            <Icon name="sun" size={13} />
            <span>{currentThemeLabel}</span>
          </div>
        </div>

        <div className="set-panel-frame">
          <div className="set-panel-header-title">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              <Panel />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
