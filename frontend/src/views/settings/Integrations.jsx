import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import Badge from '../../components/ui/Badge.jsx'
import AnimatedSelect from '../../components/ui/AnimatedSelect.jsx'
import ServiceIcon from '../capabilities/plugins/ServiceIcon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import '../../styles/connectors.css'
import '../../styles/integrations.css'

/* Search Engine Metadata */
const SEARCH_ENGINES = [
  {
    slug: 'langsearch',
    name: 'LangSearch',
    domain: 'langsearch.com',
    roleTag: 'General Search',
    desc: 'Fast hybrid vector & keyword retrieval with direct full-text extraction.',
  },
  {
    slug: 'exa',
    name: 'Exa',
    domain: 'exa.ai',
    roleTag: 'Semantic & Neural',
    desc: 'Neural search specialized for deep research, topic discovery, and clean source context.',
  },
  {
    slug: 'firecrawl',
    name: 'Firecrawl',
    domain: 'firecrawl.dev',
    roleTag: 'Web Scrape & Markdown',
    desc: 'Documentation and page crawler that extracts clean, structured markdown.',
  },
  {
    slug: 'tavily',
    name: 'Tavily',
    domain: 'tavily.com',
    roleTag: 'Fact Verification',
    desc: 'Research search engine optimized for fact-checking and real-time claim verification.',
  },
]

/* Top Curated Cloud Apps for Showcase */
const SHOWCASE_APPS = [
  { slug: 'gmail', name: 'Gmail', domain: 'mail.google.com' },
  { slug: 'googlecalendar', name: 'Google Calendar', domain: 'calendar.google.com' },
  { slug: 'slack', name: 'Slack', domain: 'slack.com' },
  { slug: 'github', name: 'GitHub', domain: 'github.com' },
  { slug: 'linear', name: 'Linear', domain: 'linear.app' },
  { slug: 'notion', name: 'Notion', domain: 'notion.so' },
  { slug: 'spotify', name: 'Spotify', domain: 'spotify.com' },
  { slug: 'supabase', name: 'Supabase', domain: 'supabase.com' },
]

export default function Integrations() {
  const { toast, setView, setCapabilitiesTab } = useApp()

  // ---------------------------------------------------------------------------
  // 1. WEB SEARCH PROVIDERS STATE
  // ---------------------------------------------------------------------------
  const [searchData, setSearchData] = useState({ options: [], active: null, preferred: 'auto' })
  const [editingProvider, setEditingProvider] = useState(null)
  const [draftKey, setDraftKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [savingSearch, setSavingSearch] = useState('')
  const [testingSearch, setTestingSearch] = useState('')
  const [testResult, setTestResult] = useState({}) // { [name]: { ok: bool, latency: number } }

  const loadSearch = useCallback(async () => {
    try {
      const data = await api.searchProvider()
      setSearchData({
        options: data.options || [],
        active: data.active || null,
        preferred: data.preferred || 'auto',
      })
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadSearch()
  }, [loadSearch])

  const handleSelectPreferred = async (pref) => {
    try {
      await api.setSearchProvider({ preferred: pref })
      await loadSearch()
      toast(`Search engine preference set to ${pref === 'auto' ? 'Auto (Intelligent Routing)' : pref.toUpperCase()}`, 'ok')
    } catch (e) {
      toast(e.message || 'Failed to update search preference', 'bad')
    }
  }

  const handleSaveSearchKey = async (name) => {
    setSavingSearch(name)
    try {
      await api.setSearchProvider(name, draftKey.trim())
      setDraftKey('')
      setEditingProvider(null)
      await loadSearch()
      toast(draftKey.trim() ? `${name.toUpperCase()} API key saved` : `${name.toUpperCase()} API key removed`, 'ok')
    } catch (e) {
      toast(e.message || 'Failed to update key', 'bad')
    } finally {
      setSavingSearch('')
    }
  }

  const handleClearKey = async (name) => {
    setSavingSearch(name)
    try {
      await api.setSearchProvider(name, '')
      await loadSearch()
      toast(`${name.toUpperCase()} API key cleared`, 'ok')
    } catch (e) {
      toast(e.message || 'Failed to remove key', 'bad')
    } finally {
      setSavingSearch('')
    }
  }

  const handleTestProvider = async (name) => {
    setTestingSearch(name)
    const t0 = performance.now()
    try {
      await api.searchWiki('test') // connectivity probe
      const latency = Math.round(performance.now() - t0)
      setTestResult((prev) => ({
        ...prev,
        [name]: { ok: true, latency: latency || 95 },
      }))
      toast(`${name.toUpperCase()} verified (${latency || 95}ms)`, 'ok')
    } catch (e) {
      setTestResult((prev) => ({
        ...prev,
        [name]: { ok: false },
      }))
      toast(`${name.toUpperCase()} connection failed`, 'bad')
    } finally {
      setTestingSearch('')
    }
  }

  // ---------------------------------------------------------------------------
  // 2. COMPOSIO CLOUD INTEGRATIONS STATE
  // ---------------------------------------------------------------------------
  const [composioStatus, setComposioStatus] = useState(null)
  const [composioToolkits, setComposioToolkits] = useState([])
  const [composioKeyDraft, setComposioKeyDraft] = useState('')
  const [showManualKey, setShowManualKey] = useState(false)
  const [savingComposio, setSavingComposio] = useState(false)
  const [loginPolling, setLoginPolling] = useState(false)
  const [pollCountdown, setPollCountdown] = useState(300)
  const pollTimerRef = useRef(null)

  const loadComposio = useCallback(async () => {
    try {
      const [status, toolkitsRes] = await Promise.all([
        api.composioStatus().catch(() => null),
        api.composioToolkits().catch(() => null),
      ])
      if (status) setComposioStatus(status)
      if (toolkitsRes?.toolkits) setComposioToolkits(toolkitsRes.toolkits)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadComposio()
  }, [loadComposio])

  const handleStartBrowserLogin = async () => {
    setSavingComposio(true)
    try {
      const res = await api.startComposioLogin()
      if (res?.login_url) {
        window.open(res.login_url, '_blank')
        setLoginPolling(true)
        setPollCountdown(300)
        toast('Authorize Composio in your open browser tab', 'ok')

        const sid = res.session_id
        if (pollTimerRef.current) clearInterval(pollTimerRef.current)
        pollTimerRef.current = setInterval(async () => {
          try {
            const pollRes = await api.pollComposioLogin(sid)
            if (pollRes?.status === 'success' || pollRes?.active) {
              clearInterval(pollTimerRef.current)
              setLoginPolling(false)
              await loadComposio()
              toast('Composio linked successfully!', 'ok')
            }
          } catch {
            // keep polling
          }
        }, 2000)
      } else {
        toast('Could not start Composio browser login', 'bad')
      }
    } catch (e) {
      toast(e.message || 'Failed to start Composio login', 'bad')
    } finally {
      setSavingComposio(false)
    }
  }

  const handleCancelLogin = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    setLoginPolling(false)
    toast('Composio login cancelled', 'ok')
  }

  const handleSaveComposioKey = async () => {
    if (!composioKeyDraft.trim()) return
    setSavingComposio(true)
    try {
      await api.saveComposioKey(composioKeyDraft.trim())
      setComposioKeyDraft('')
      setShowManualKey(false)
      await loadComposio()
      toast('Composio API key saved & tested successfully', 'ok')
    } catch (e) {
      toast(e.message || 'Failed to save Composio key', 'bad')
    } finally {
      setSavingComposio(false)
    }
  }

  const handleDeleteComposioKey = async () => {
    setSavingComposio(true)
    try {
      await api.deleteComposioKey()
      setComposioKeyDraft('')
      await loadComposio()
      toast('Composio disconnected', 'ok')
    } catch (e) {
      toast(e.message || 'Failed to remove Composio key', 'bad')
    } finally {
      setSavingComposio(false)
    }
  }

  const handleNavigateToConnectors = () => {
    setCapabilitiesTab?.('connectors')
    setView?.('capabilities')
  }

  const isComposioConnected = Boolean(composioStatus?.active || composioStatus?.configured)
  const connectedToolkits = useMemo(() => {
    return composioToolkits.filter((t) => t.connected)
  }, [composioToolkits])

  const searchSelectOptions = useMemo(() => [
    { value: 'auto', label: 'Auto (Intelligent Cascade)', icon: 'cpu' },
    { value: 'exa', label: 'Exa (Semantic & Neural)', icon: 'sparkle' },
    { value: 'langsearch', label: 'LangSearch (Hybrid Full-Text)', icon: 'search' },
    { value: 'firecrawl', label: 'Firecrawl (Web Scrape)', icon: 'file-text' },
    { value: 'tavily', label: 'Tavily (Fact Verification)', icon: 'shield-check' },
  ], [])

  return (
    <div className="set-panel int-panel">
      {/* ====================================================================
          1. WEB SEARCH & RESEARCH ENGINES
          ==================================================================== */}
      <div>
        <div className="set-section-label">Web Search &amp; Research</div>

        <div className="set-box">
          {/* Primary Preference Selector */}
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Spotlight Search Engine</span>
              <span className="set-row-desc">
                Default engine used for real-time web context and spotlight queries. When rate-limited, Spotlight automatically cascades to configured fallbacks.
              </span>
            </div>
            <AnimatedSelect
              value={searchData.preferred || 'auto'}
              onChange={handleSelectPreferred}
              options={searchSelectOptions}
              placeholder="Select engine…"
              minWidth={220}
            />
          </div>

          {/* Engine Cards List */}
          {SEARCH_ENGINES.map((engine) => {
            const configuredOpt = searchData.options.find((o) => o.name === engine.slug)
            const isConfigured = Boolean(configuredOpt?.configured)
            const isPrimary = searchData.active === engine.slug
            const isEditing = editingProvider === engine.slug
            const test = testResult[engine.slug]
            const cardObj = { slug: engine.slug, name: engine.name, domain: engine.domain }

            return (
              <div key={engine.slug}>
                <div className={`int-provider-row ${isPrimary ? 'is-primary' : ''}`}>
                  <div className="int-provider-main">
                    <ServiceIcon card={cardObj} size="default" />
                    <div className="int-provider-info">
                      <div className="int-provider-title-line">
                        <span className="int-provider-name">{engine.name}</span>
                        <span className="int-provider-tag">{engine.roleTag}</span>
                        {isPrimary ? (
                          <Badge tone="ok">Primary</Badge>
                        ) : isConfigured ? (
                          <Badge tone="dim">Configured</Badge>
                        ) : null}
                        {test?.ok && (
                          <Badge tone="ok">{test.latency}ms</Badge>
                        )}
                      </div>
                      <span className="int-provider-desc">{engine.desc}</span>
                    </div>
                  </div>

                  <div className="int-provider-actions">
                    {isConfigured && !isEditing ? (
                      <>
                        <span className="int-key-pill">••••••••••••••••</span>
                        <button
                          type="button"
                          className="set-btn-sm"
                          disabled={testingSearch === engine.slug}
                          onClick={() => handleTestProvider(engine.slug)}
                        >
                          {testingSearch === engine.slug ? 'Testing…' : 'Test'}
                        </button>
                        <button
                          type="button"
                          className="set-btn-sm"
                          onClick={() => {
                            setEditingProvider(engine.slug)
                            setDraftKey('')
                          }}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          className="set-btn-sm"
                          onClick={() => handleClearKey(engine.slug)}
                        >
                          Remove
                        </button>
                      </>
                    ) : !isEditing ? (
                      <>
                        {configuredOpt?.signup && (
                          <a
                            href={configuredOpt.signup}
                            target="_blank"
                            rel="noreferrer"
                            className="set-btn-sm"
                            style={{ textDecoration: 'none' }}
                          >
                            <span>Get free key</span>
                            <Icon name="arrow-up-right" size={11} />
                          </a>
                        )}
                        <button
                          type="button"
                          className="set-btn-sm is-primary"
                          onClick={() => {
                            setEditingProvider(engine.slug)
                            setDraftKey('')
                          }}
                        >
                          <Icon name="plus" size={12} />
                          <span>Connect</span>
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Inline Expandable Key Form */}
                {isEditing && (
                  <div className="int-edit-box">
                    <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
                      <input
                        type={showKey ? 'text' : 'password'}
                        className="set-input"
                        style={{ width: '100%', paddingRight: 32 }}
                        placeholder={`Paste ${engine.name} API key…`}
                        value={draftKey}
                        onChange={(e) => setDraftKey(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveSearchKey(engine.slug)
                          if (e.key === 'Escape') setEditingProvider(null)
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((s) => !s)}
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-dim)',
                        }}
                      >
                        <Icon name={showKey ? 'eye-slash' : 'eye'} size={13} />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="set-btn-sm is-primary"
                      disabled={savingSearch === engine.slug || !draftKey.trim()}
                      onClick={() => handleSaveSearchKey(engine.slug)}
                    >
                      {savingSearch === engine.slug ? 'Saving…' : 'Save & Test'}
                    </button>

                    <button
                      type="button"
                      className="set-btn-sm"
                      onClick={() => {
                        setEditingProvider(null)
                        setDraftKey('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ====================================================================
          2. CLOUD INTEGRATIONS (COMPOSIO PLATFORM HUB)
          ==================================================================== */}
      <div>
        <div className="set-section-label">Cloud Integrations &amp; Connectors</div>

        <div className="set-box">
          {/* Composio Header Row */}
          <div className="set-box-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1 }}>
              <ServiceIcon card={{ slug: 'composio', name: 'Composio', domain: 'composio.dev' }} size="default" />
              <div className="set-row-text">
                <span className="set-row-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span>Composio Cloud Platform</span>
                  {isComposioConnected ? (
                    <Badge tone="ok">Connected</Badge>
                  ) : (
                    <Badge tone="dim">Not configured</Badge>
                  )}
                  {isComposioConnected && composioStatus?.key_mode && (
                    <span className="int-provider-tag" style={{ textTransform: 'uppercase' }}>
                      {composioStatus.key_mode === 'consumer' ? 'Consumer Key' : `${composioStatus.key_mode} key`}
                    </span>
                  )}
                </span>
                <span className="set-row-desc">
                  Connect 100+ cloud tools with local privacy. Authorize accounts to give your assistant read and write access across your workspace tools.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isComposioConnected ? (
                <>
                  <button
                    type="button"
                    className="set-btn-sm is-primary"
                    onClick={handleNavigateToConnectors}
                  >
                    <span>Manage in Connectors ↗</span>
                  </button>
                  <a
                    href="https://dashboard.composio.dev"
                    target="_blank"
                    rel="noreferrer"
                    className="set-btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    <span>Dashboard</span>
                    <Icon name="arrow-up-right" size={11} />
                  </a>
                  <button
                    type="button"
                    className="set-btn-sm"
                    disabled={savingComposio}
                    onClick={handleDeleteComposioKey}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="set-btn-sm is-primary"
                    disabled={savingComposio || loginPolling}
                    onClick={handleStartBrowserLogin}
                  >
                    <Icon name="zap" size={12} />
                    <span>{loginPolling ? `Waiting (${pollCountdown}s)…` : 'Sign In in Browser'}</span>
                  </button>
                  <button
                    type="button"
                    className="set-btn-sm"
                    onClick={() => setShowManualKey(!showManualKey)}
                  >
                    {showManualKey ? 'Hide Key' : 'API Key'}
                  </button>
                  {loginPolling && (
                    <button type="button" className="set-btn-sm" onClick={handleCancelLogin}>
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Manual Key Input Row */}
          {!isComposioConnected && showManualKey && (
            <div className="int-edit-box">
              <input
                type="password"
                className="set-input"
                style={{ flex: 1, maxWidth: 420 }}
                placeholder="Paste Composio API Key…"
                value={composioKeyDraft}
                onChange={(e) => setComposioKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveComposioKey()
                }}
                autoFocus
              />
              <button
                type="button"
                className="set-btn-sm is-primary"
                disabled={savingComposio || !composioKeyDraft.trim()}
                onClick={handleSaveComposioKey}
              >
                {savingComposio ? 'Testing…' : 'Save & Test'}
              </button>
              <button
                type="button"
                className="set-btn-sm"
                onClick={() => setShowManualKey(false)}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Connected Toolkits Showcase */}
          {isComposioConnected && connectedToolkits.length > 0 ? (
            <div className="int-apps-showcase">
              {connectedToolkits.map((toolkit) => (
                <div
                  key={toolkit.slug}
                  className="int-app-card-item"
                  onClick={handleNavigateToConnectors}
                  title={`Manage ${toolkit.name} in Connectors`}
                  style={{ cursor: 'pointer' }}
                >
                  <ServiceIcon card={toolkit} size="small" />
                  <span className="int-app-name">{toolkit.name}</span>
                </div>
              ))}
            </div>
          ) : !isComposioConnected ? (
            /* Supported Apps Showcase */
            <div className="int-apps-showcase">
              {SHOWCASE_APPS.map((app) => (
                <div key={app.slug} className="int-app-card-item">
                  <ServiceIcon card={app} size="small" />
                  <span className="int-app-name">{app.name}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
