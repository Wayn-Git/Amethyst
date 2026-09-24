import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from './Icon.jsx'
import AiProviderIcon from './AiProviderIcon.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { useMenuFit } from '../hooks/useMenuFit.js'
import { FadeScrollArea, SmoothInput } from './ui/skiper/index.js'

/* Fallback model definitions for providers that don't serve a live GET /models endpoint */
const FALLBACK_MODELS = {
  cloudflare: [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', context_length: 131072 },
    { id: '@cf/meta/llama-3.1-8b-instruct-fast', context_length: 131072 },
    { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', context_length: 131072 },
    { id: '@cf/qwen/qwen2.5-coder-32b-instruct', context_length: 32768 },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', context_length: 131072 },
    { id: 'llama-3.1-8b-instant', context_length: 131072 },
    { id: 'mixtral-8x7b-32768', context_length: 32768 },
  ],
  deepseek: [
    { id: 'deepseek-chat', context_length: 65536 },
    { id: 'deepseek-reasoner', context_length: 65536 },
  ],
  mistral: [
    { id: 'mistral-large-3', context_length: 262144 },
    { id: 'codestral-latest', context_length: 262144 },
    { id: 'ministral-8b-2512', context_length: 131072 },
  ],
  moonshot: [
    { id: 'kimi-k2.7-code', context_length: 262144 },
    { id: 'moonshot-v1-128k', context_length: 131072 },
  ],
  minimax: [
    { id: 'minimax-m2.5', context_length: 262144 },
    { id: 'MiniMax-Text-01', context_length: 1048576 },
  ],
  nous: [
    { id: 'Hermes-4-70B', context_length: 131072 },
    { id: 'Hermes-3-Llama-3.1-8B', context_length: 131072 },
  ],
  google: [
    { id: 'gemini-2.5-pro', context_length: 1048576 },
    { id: 'gemini-2.5-flash', context_length: 1048576 },
    { id: 'gemini-flash-latest', context_length: 1048576 },
  ],
  openai: [
    { id: 'gpt-4o', context_length: 131072 },
    { id: 'gpt-4o-mini', context_length: 131072 },
    { id: 'o1', context_length: 200000 },
    { id: 'o3-mini', context_length: 200000 },
  ],
  anthropic: [
    { id: 'claude-3-7-sonnet-latest', context_length: 200000 },
    { id: 'claude-3-5-sonnet-latest', context_length: 200000 },
    { id: 'claude-3-5-haiku-latest', context_length: 200000 },
  ],
}

function fmtContext(bytes) {
  if (!bytes) return ''
  const k = Math.round(bytes / 1024)
  if (k >= 1000) return `${(k / 1000).toFixed(1).replace(/\.0$/, '')}M context`
  return `${k}K context`
}

export default function ModelMenu({
  provider,
  model,
  onChange,
  onClose,
  placement = 'down',
}) {
  const { health } = useApp()
  const ref = useRef(null)
  const [selectedProvider, setSelectedProvider] = useState('all')
  const [query, setQuery] = useState('')
  const [modelMap, setModelMap] = useState({})
  const [loading, setLoading] = useState(true)

  const providers = health?.providers ?? []
  const defaults = health?.provider_defaults ?? {}
  const canRoute = health?.routing ?? false

  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })
  useMenuFit(ref, [providers.length, selectedProvider, query, loading])

  // Concurrently fetch models for all configured providers
  useEffect(() => {
    let live = true
    setLoading(true)

    const fetchAll = async () => {
      const results = {}
      await Promise.allSettled(
        providers.map(async (p) => {
          try {
            const res = await api.providerModels(p)
            const list = res.models || []
            if (list.length > 0) {
              results[p] = list
            } else if (FALLBACK_MODELS[p]) {
              results[p] = FALLBACK_MODELS[p]
            } else if (defaults[p]) {
              results[p] = [{ id: defaults[p], context_length: 131072 }]
            } else {
              results[p] = []
            }
          } catch {
            if (FALLBACK_MODELS[p]) {
              results[p] = FALLBACK_MODELS[p]
            } else if (defaults[p]) {
              results[p] = [{ id: defaults[p], context_length: 131072 }]
            } else {
              results[p] = []
            }
          }

          // If currently selected model is from this provider, ensure it's present
          if (p === provider && model) {
            const hasIt = (results[p] || []).some((m) => m.id === model)
            if (!hasIt) {
              results[p] = [{ id: model, context_length: 131072 }, ...(results[p] || [])]
            }
          }
        })
      )

      if (live) {
        setModelMap(results)
        setLoading(false)
      }
    }

    if (providers.length > 0) {
      fetchAll()
    } else {
      setLoading(false)
    }

    return () => {
      live = false
    }
  }, [providers, defaults, provider, model])

  // Filter models by search query and active provider selection
  const groupedModels = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups = []

    for (const p of providers) {
      if (selectedProvider !== 'all' && selectedProvider !== p) continue

      let pModels = modelMap[p] || FALLBACK_MODELS[p] || []
      if (pModels.length === 0 && defaults[p]) {
        pModels = [{ id: defaults[p], context_length: 131072 }]
      }

      if (q) {
        pModels = pModels.filter(
          (m) => m.id.toLowerCase().includes(q) || p.toLowerCase().includes(q)
        )
      }

      if (pModels.length > 0) {
        groups.push({ provider: p, models: pModels })
      }
    }

    return groups
  }, [providers, selectedProvider, modelMap, defaults, query])

  const hasExactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    for (const g of groupedModels) {
      if (g.models.some((m) => m.id.toLowerCase() === q)) return true
    }
    return false
  }, [groupedModels, query])

  const handleSelectCustom = (customName) => {
    const clean = customName.trim()
    if (!clean) return
    // If selected provider is not all, assign to that provider; else keep current provider
    const targetProvider = selectedProvider !== 'all' ? selectedProvider : (provider || providers[0] || 'cloudflare')
    onChange({ provider: targetProvider, model: clean })
    onClose()
  }

  return (
    <motion.div
      className={`model-menu-v2 model-menu-v2--${placement}`}
      ref={ref}
      initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.97 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Search bar at top */}
      <div className="model-menu-search">
        <Icon name="search" size={15} className="model-menu-search-icon" />
        <SmoothInput
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all models..."
          inputClassName="model-menu-search-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim() && !hasExactMatch) {
              handleSelectCustom(query)
            }
          }}
          aria-label="Search all models"
        />
      </div>

      <div className="model-menu-body">
        {/* Left Provider Sidebar (matching Screenshot 2) */}
        <div className="model-menu-sidebar">
          {/* 1. All Providers button (≡) */}
          <button
            type="button"
            className={`model-menu-sidebar-btn${selectedProvider === 'all' ? ' is-active' : ''}`}
            onClick={() => setSelectedProvider('all')}
            title="All models"
            aria-label="All models"
          >
            <AiProviderIcon provider="all" size={15} />
          </button>

          {/* 2. Provider brand icons */}
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              className={`model-menu-sidebar-btn${selectedProvider === p ? ' is-active' : ''}`}
              onClick={() => setSelectedProvider(selectedProvider === p ? 'all' : p)}
              title={p}
              aria-label={p}
            >
              <AiProviderIcon provider={p} size={16} />
            </button>
          ))}
        </div>

        {/* Right Model List with Provider Groups (matching Screenshot 2) */}
        <div className="model-menu-main">
          <FadeScrollArea className="model-menu-list" fadeHeight={16}>
            {loading && Object.keys(modelMap).length === 0 && (
              <div className="model-menu-loading">Loading models…</div>
            )}

            {groupedModels.length === 0 && !loading && (
              <div className="model-menu-empty">
                {query ? 'No models match your search.' : 'No models available.'}
              </div>
            )}

            {groupedModels.map((group) => (
              <div key={group.provider} className="model-menu-group">
                <div className="model-menu-group-head">
                  <span className="model-menu-group-name">
                    {group.provider}
                  </span>
                  <span className="model-menu-group-count">{group.models.length}</span>
                </div>

                {group.models.map((m) => {
                  const isSelected = m.id === model && group.provider === provider
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`model-menu-item${isSelected ? ' is-active' : ''}`}
                      onClick={() => {
                        onChange({ provider: group.provider, model: m.id, capabilities: m.capabilities, context_length: m.context_length })
                        onClose()
                      }}
                    >
                      <span className="model-menu-item-icon">
                        <AiProviderIcon model={m.id} provider={group.provider} size={16} />
                      </span>
                      <span className="model-menu-item-text">
                        <span className="model-menu-item-name">{m.id}</span>
                        <span className="model-menu-item-meta">
                          {fmtContext(m.context_length)}
                          {m.free ? ' · free' : ''}
                        </span>
                      </span>
                      {isSelected && (
                        <Icon name="check" size={15} className="model-menu-check" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}

            {/* Custom model prompt if query has no exact match */}
            {query.trim() && !hasExactMatch && (
              <button
                type="button"
                className="model-menu-item model-menu-item--custom"
                onClick={() => handleSelectCustom(query)}
              >
                <span className="model-menu-item-icon">
                  <Icon name="plus" size={14} />
                </span>
                <span className="model-menu-item-text">
                  <span className="model-menu-item-name">Use custom: {query.trim()}</span>
                  <span className="model-menu-item-meta">Press Enter to select</span>
                </span>
              </button>
            )}
          </FadeScrollArea>

          {/* Pinned Auto option at the bottom (matching Screenshot 2) */}
          {canRoute && (
            <div className="model-menu-auto-row">
              <button
                type="button"
                className={`model-menu-item model-menu-item--auto${provider === 'auto' ? ' is-active' : ''}`}
                onClick={() => {
                  onChange({ provider: 'auto', model: '', capabilities: null })
                  onClose()
                }}
              >
                <span className="model-menu-item-icon model-menu-item-icon--auto">
                  <AiProviderIcon provider="auto" size={16} />
                </span>
                <span className="model-menu-item-text">
                  <span className="model-menu-item-name">Auto</span>
                  <span className="model-menu-item-meta">Let Amethyst choose for each message</span>
                </span>
                {provider === 'auto' && (
                  <Icon name="check" size={15} className="model-menu-check" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
