import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
  ExternalLink,
  Plus,
  Key,
  ShieldCheck,
  Server,
  Layers,
  Globe,
  LogIn,
  Trash2,
} from 'lucide-react'
import { api } from '../../api.js'
import McpServersPanel from './McpServersPanel.jsx'
import '../../styles/connectors.css'

// Module-level cache so reopening the tab never flashes an empty state
let cachedConnectorStatus = null
let cachedConnectorStatusAt = 0
const CONNECTOR_STATUS_CACHE_MS = 30_000

export function reserveConnectionPage() {
  let page = null
  let navigated = false
  let cancelled = false
  try {
    page = window.open('', '_blank')
    if (page) page.opener = null
  } catch {
    page?.close()
    page = null
  }
  return {
    async open(url) {
      if (cancelled) return false
      if (!page || page.closed) {
        window.open(url, '_blank')
        return true
      }
      try {
        page.location.replace(url)
        navigated = true
        return true
      } catch {
        return false
      }
    },
    cancel() {
      cancelled = true
      if (!navigated && page && !page.closed) page.close()
    },
  }
}

function ServiceIcon({ card }) {
  // 0 = official logo, 1 = domain favicon, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2)

  if (stage === 0 && card.logo) {
    return (
      <div className="connector-service-icon-box">
        <img
          src={card.logo}
          alt=""
          loading="lazy"
          className="connector-service-icon-img"
          onError={() => setStage(card.domain ? 1 : 2)}
        />
      </div>
    )
  }

  if (stage === 1 && card.domain) {
    return (
      <div className="connector-service-icon-box">
        <img
          src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
          alt=""
          loading="lazy"
          className="connector-service-icon-img"
          onError={() => setStage(2)}
        />
      </div>
    )
  }

  const letter = (card.label || card.slug || '?').slice(0, 1).toUpperCase()
  return (
    <div className="connector-service-icon-box">
      <span className="connector-service-monogram">{letter}</span>
    </div>
  )
}

export default function ConnectorsTab({ query = '', setQuery, newOpen, setNewOpen }) {
  const [cards, setCards] = useState(null)
  const [configured, setConfigured] = useState(false)
  const [mode, setMode] = useState('unavailable')
  const [status, setStatus] = useState(() => cachedConnectorStatus || {})
  const [stale, setStale] = useState(false)
  const [filter, setFilter] = useState('all') // 'all' | 'connected' | 'mcp'
  const [refreshing, setRefreshing] = useState(false)
  const [busySlug, setBusySlug] = useState(null)
  const [error, setError] = useState(null)
  const [aliasSlug, setAliasSlug] = useState(null)
  const [aliasDraft, setAliasDraft] = useState('')
  const [pendingUrls, setPendingUrls] = useState({})
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [modalPrompt, setModalPrompt] = useState(null)
  const [loginTab, setLoginTab] = useState('browser') // 'browser' | 'key'
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginSession, setLoginSession] = useState(null)
  const [loginPolling, setLoginPolling] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  const pollTimers = useRef(new Map())
  const opening = useRef(null)
  const browserPollTimer = useRef(null)

  const effectiveSearch = query.trim().toLowerCase()

  const loadConnectedStatus = useCallback(async (force = false) => {
    if (!force && cachedConnectorStatus && Date.now() - cachedConnectorStatusAt < CONNECTOR_STATUS_CACHE_MS) {
      setStatus(cachedConnectorStatus)
      return cachedConnectorStatus
    }

    setRefreshing(true)
    try {
      const res = await api.connectorsConnected()
      const services = res.services || {}
      cachedConnectorStatus = services
      cachedConnectorStatusAt = Date.now()
      setStatus(services)
      setStale(res.credentialStore === 'unavailable')
      setConfigured(Boolean(res.configured))
      return services
    } catch (cause) {
      setStale(true)
      return {}
    } finally {
      setRefreshing(false)
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    try {
      const res = await api.connectorsCatalog()
      setCards(res.cards || [])
      setConfigured(Boolean(res.configured))
      setMode(res.mode || 'unavailable')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    loadConnectedStatus()
    loadCatalog()
    return () => {
      opening.current?.cancel()
      opening.current = null
      for (const timer of pollTimers.current.values()) clearInterval(timer)
      pollTimers.current.clear()
      if (browserPollTimer.current) clearInterval(browserPollTimer.current)
    }
  }, [loadConnectedStatus, loadCatalog])

  useEffect(() => {
    if (newOpen) {
      setFilter('mcp')
    }
  }, [newOpen])

  const refreshStatus = useCallback(async (slugs) => {
    if (!slugs.length) return {}
    try {
      const res = await api.connectorsStatus(slugs.join(','))
      const incoming = res.services || {}
      setStatus((current) => ({ ...current, ...incoming }))
      return incoming
    } catch {
      return {}
    }
  }, [])

  const startPolling = (slug) => {
    const existing = pollTimers.current.get(slug)
    if (existing) clearInterval(existing)
    let tries = 0
    const timer = setInterval(() => {
      refreshStatus([slug]).then((services) => {
        const s = services[slug]
        if (++tries >= 24 || (s?.connected && !s.pending) || (s?.status && /^(expired|failed)$/i.test(s.status))) {
          clearInterval(timer)
          pollTimers.current.delete(slug)
          loadConnectedStatus(true)
        }
      })
    }, 4000)
    pollTimers.current.set(slug, timer)
  }

  const startBrowserLogin = async () => {
    setLoginLoading(true)
    setError(null)
    try {
      const res = await api.startComposioLogin()
      setLoginSession(res)
      setLoginPolling(true)
      window.open(res.login_url, '_blank')

      if (browserPollTimer.current) clearInterval(browserPollTimer.current)
      browserPollTimer.current = setInterval(async () => {
        try {
          const poll = await api.pollComposioLogin(res.session_id)
          if (poll.status === 'linked' && poll.configured) {
            clearInterval(browserPollTimer.current)
            browserPollTimer.current = null
            setLoginPolling(false)
            setLoginSession(null)
            setKeyModalOpen(false)
            setModalPrompt(null)
            setConfigured(true)
            await loadCatalog()
            await loadConnectedStatus(true)
          } else if (poll.status === 'expired' || poll.status === 'failed') {
            clearInterval(browserPollTimer.current)
            browserPollTimer.current = null
            setLoginPolling(false)
            setError('Composio browser login session expired or was rejected. Please try again.')
          }
        } catch {
          // keep polling
        }
      }, 2000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoginLoading(false)
    }
  }

  const cancelBrowserLogin = () => {
    if (browserPollTimer.current) {
      clearInterval(browserPollTimer.current)
      browserPollTimer.current = null
    }
    setLoginPolling(false)
    setLoginSession(null)
  }

  const disconnectComposio = async () => {
    if (!window.confirm('Are you sure you want to disconnect Composio?')) return
    setError(null)
    try {
      await api.deleteComposioKey()
      setConfigured(false)
      setKeyModalOpen(false)
      await loadCatalog()
      await loadConnectedStatus(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const connect = async (slug, alias) => {
    if (busySlug || opening.current) return

    if (!configured) {
      const card = (cards || []).find((c) => c.slug === slug)
      setModalPrompt(`Please log in to Composio first to connect ${card?.label || slug}.`)
      setLoginTab('browser')
      setKeyModalOpen(true)
      return
    }

    const launch = reserveConnectionPage()
    opening.current = launch
    setBusySlug(slug)
    setError(null)
    try {
      const res = await api.connectorsAuthorize(slug, alias)
      if (opening.current !== launch) return
      const url = res.url
      if (!url) throw new Error('Invalid authorization URL returned')

      setPendingUrls((prev) => ({ ...prev, [slug]: { url, createdAt: Date.now() } }))
      setStatus((prev) => ({
        ...prev,
        [slug]: {
          ...(prev[slug] || {}),
          connected: prev[slug]?.connected || false,
          pending: true,
          status: 'INITIATED',
        },
      }))
      setAliasSlug(null)
      setAliasDraft('')
      startPolling(slug)

      const opened = await launch.open(url)
      if (!opened && opening.current === launch) {
        setError('Popup was blocked by your browser. Click "Open authorization page" below.')
      }
    } catch (cause) {
      launch.cancel()
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (opening.current === launch) opening.current = null
      setBusySlug(null)
    }
  }

  const disconnectAccount = async (slug, accountId) => {
    setBusySlug(slug)
    setError(null)
    try {
      await api.connectorsDisconnectAccount(slug, accountId)
      await refreshStatus([slug])
      await loadConnectedStatus(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusySlug(null)
    }
  }

  const saveApiKey = async () => {
    if (!apiKeyDraft.trim()) return
    setSavingKey(true)
    setError(null)
    try {
      await api.saveComposioKey(apiKeyDraft.trim())
      setKeyModalOpen(false)
      setApiKeyDraft('')
      await loadCatalog()
      await loadConnectedStatus(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingKey(false)
    }
  }

  // Filter matching
  const matching = (cards || []).filter((c) => {
    if (!effectiveSearch) return true
    const haystack = `${c.label} ${c.slug} ${c.blurb || ''}`.toLowerCase()
    return haystack.includes(effectiveSearch)
  })

  const isConnected = (slug) => Boolean(status[slug]?.connected || status[slug]?.accounts?.length)

  const visible = (filter === 'connected' ? matching.filter((card) => isConnected(card.slug)) : matching)
    .sort((a, b) => Number(isConnected(b.slug)) - Number(isConnected(a.slug)))

  const connectedCount = Object.values(status).filter((s) => s.connected || s.accounts?.length).length

  return (
    <div className="connectors-view-root">
      {/* Top Filter and Actions Bar */}
      <div className="connectors-nav-bar">
        <div className="connectors-filter-pills" role="tablist">
          <button
            type="button"
            className={`connector-filter-btn ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <Layers size={14} />
            <span>All Apps</span>
          </button>
          <button
            type="button"
            className={`connector-filter-btn ${filter === 'connected' ? 'is-active' : ''}`}
            onClick={() => setFilter('connected')}
          >
            <Check size={14} />
            <span>Connected</span>
            {connectedCount > 0 && <span className="connector-filter-badge">{connectedCount}</span>}
          </button>
          <button
            type="button"
            className={`connector-filter-btn ${filter === 'mcp' ? 'is-active' : ''}`}
            onClick={() => setFilter('mcp')}
          >
            <Server size={14} />
            <span>MCP Servers</span>
          </button>
        </div>

        <div className="connectors-top-actions">
          {configured ? (
            <button
              type="button"
              className="connector-auth-status-btn is-connected"
              onClick={() => {
                setModalPrompt(null)
                setKeyModalOpen(true)
              }}
              title="Manage Composio Connection"
            >
              <span className="connector-live-dot" />
              <span>Composio Connected</span>
            </button>
          ) : (
            <button
              type="button"
              className="connector-btn-primary"
              onClick={() => {
                setModalPrompt(null)
                setLoginTab('browser')
                setKeyModalOpen(true)
              }}
              title="Sign in to Composio"
            >
              <Globe size={14} />
              <span>Log in to Composio</span>
            </button>
          )}

          <button
            type="button"
            className="connector-btn-ghost"
            onClick={() => {
              loadConnectedStatus(true)
              loadCatalog()
            }}
            disabled={refreshing}
            title="Refresh status"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stale Warning Banner */}
      {stale && (
        <div className="connector-status-banner is-warning">
          <div className="flex items-center gap-2">
            <TriangleAlert size={16} />
            <span>Cached status shown while connection status is confirming in the background.</span>
          </div>
        </div>
      )}

      {/* Not Configured Hero Callout Banner */}
      {!configured && filter !== 'mcp' && (
        <div className="connector-hero-banner">
          <div className="connector-hero-info">
            <div className="connector-hero-icon-box">
              <Globe size={22} className="text-accent" />
            </div>
            <div>
              <div className="connector-hero-title">Connect Composio Integration Hub</div>
              <div className="connector-hero-desc">
                Sign in to link GitHub, Slack, Gmail, Google Calendar, Notion, Linear, Spotify, and 100+ native connectors.
              </div>
            </div>
          </div>
          <div className="connector-hero-actions">
            <button
              type="button"
              className="connector-btn-primary"
              onClick={() => {
                setModalPrompt(null)
                setLoginTab('browser')
                setKeyModalOpen(true)
              }}
            >
              <Globe size={14} />
              <span>Sign in with Browser (1-Click)</span>
            </button>
            <button
              type="button"
              className="connector-btn-ghost"
              onClick={() => {
                setModalPrompt(null)
                setLoginTab('key')
                setKeyModalOpen(true)
              }}
            >
              <Key size={13} />
              <span>Enter API Key</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mcp-notice mcp-notice-error">
          <div className="flex items-center gap-2">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="mcp-notice-close">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Composio Login & API Key Modal */}
      {keyModalOpen && (
        <div
          className="mcp-modal-backdrop"
          onClick={() => {
            setKeyModalOpen(false)
            cancelBrowserLogin()
          }}
        >
          <div className="mcp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="mcp-editor-head">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-accent" />
                <h4 className="mcp-editor-title">Connect Composio</h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  setKeyModalOpen(false)
                  cancelBrowserLogin()
                }}
                className="mcp-icon-btn"
              >
                <X size={16} />
              </button>
            </div>

            {modalPrompt && (
              <div className="connector-modal-prompt">
                {modalPrompt}
              </div>
            )}

            <div className="connector-modal-tabs" role="tablist">
              <button
                type="button"
                className={`connector-modal-tab ${loginTab === 'browser' ? 'is-active' : ''}`}
                onClick={() => setLoginTab('browser')}
              >
                <Globe size={14} />
                <span>Browser Login</span>
              </button>
              <button
                type="button"
                className={`connector-modal-tab ${loginTab === 'key' ? 'is-active' : ''}`}
                onClick={() => setLoginTab('key')}
              >
                <Key size={14} />
                <span>API Key</span>
              </button>
            </div>

            {loginTab === 'browser' ? (
              <div className="flex flex-col gap-3 py-1">
                <p className="mcp-modal-desc">
                  Sign in with your Google or GitHub account on Composio. Amethyst will link seamlessly without copying tokens.
                </p>

                {loginSession ? (
                  <div className="connector-browser-waiting-box">
                    <Loader2 size={24} className="animate-spin text-accent" />
                    <div>
                      <div className="font-semibold text-sm">Awaiting authentication in browser…</div>
                      <div className="text-xs text-dim mt-0.5">
                        Complete sign-in on Composio and verify the code matches:
                      </div>
                    </div>
                    {loginSession.code && (
                      <div className="connector-code-display">
                        <span className="text-3xs uppercase tracking-wider text-dim">Verification Code</span>
                        <span className="connector-code-value">{loginSession.code}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <a
                        href={loginSession.login_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mcp-btn mcp-btn-secondary"
                      >
                        <ExternalLink size={13} />
                        <span>Re-open Login Tab</span>
                      </a>
                      <button
                        type="button"
                        className="mcp-btn mcp-btn-ghost text-dim"
                        onClick={cancelBrowserLogin}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 mt-1">
                    <button
                      type="button"
                      className="connector-browser-login-btn"
                      onClick={startBrowserLogin}
                      disabled={loginLoading}
                    >
                      {loginLoading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Globe size={16} />
                      )}
                      <span>Sign in with Composio (Google / GitHub)</span>
                    </button>
                    <div className="text-2xs text-center text-dim">
                      Opens Composio's secure sign-in portal in a new tab.
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 py-1">
                <p className="mcp-modal-desc">
                  Paste your Composio API key (<code className="font-mono">ak_...</code> or <code className="font-mono">uak_...</code>) from{' '}
                  <a
                    href="https://app.composio.dev/settings"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline inline-flex items-center gap-1"
                  >
                    <span>app.composio.dev/settings</span>
                    <ExternalLink size={11} />
                  </a>:
                </p>
                <input
                  className="mcp-input font-mono w-full"
                  placeholder="ak_... or uak_..."
                  type="password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  autoFocus
                />
                <div className="mcp-form-footer">
                  {configured && (
                    <button
                      type="button"
                      className="mcp-btn mcp-btn-danger text-xs mr-auto"
                      onClick={disconnectComposio}
                    >
                      <Trash2 size={13} />
                      <span>Disconnect Composio</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="mcp-btn mcp-btn-secondary"
                    onClick={() => setKeyModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="mcp-btn mcp-btn-primary"
                    onClick={saveApiKey}
                    disabled={savingKey || !apiKeyDraft.trim()}
                  >
                    {savingKey ? <Loader2 size={13} className="animate-spin" /> : null}
                    <span>Save Key</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter: All or Connected Grid */}
      {filter !== 'mcp' && (
        <section className="connectors-grid">
          {cards === null ? (
            <div className="col-span-full py-16 flex flex-col items-center justify-center gap-2 text-dim text-sm">
              <Loader2 size={20} className="animate-spin" />
              <span>Loading apps marketplace catalog…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="col-span-full py-16 flex flex-col items-center justify-center text-center text-dim text-sm">
              <div className="font-medium text-ink text-base">
                {filter === 'connected' ? 'No apps connected yet' : 'No apps match your search'}
              </div>
              <p className="text-xs text-dim mt-1">
                {filter === 'connected'
                  ? 'Switch to "All Apps" to connect your first tool.'
                  : 'Try searching for another service like Slack, GitHub, or Notion.'}
              </p>
            </div>
          ) : (
            visible.map((card) => {
              const serviceStatus = status[card.slug]
              const accounts = serviceStatus?.accounts || []
              const connected = Boolean(serviceStatus?.connected || accounts.length)
              const pending = serviceStatus?.pending
              const pendingAuth = pendingUrls[card.slug]
              const addingAccount = aliasSlug === card.slug
              const busy = busySlug === card.slug
              const included = card.noAuth === true

              return (
                <div
                  key={card.slug}
                  className={`connector-app-tile ${connected ? 'is-connected' : ''}`}
                >
                  <div className="connector-tile-header">
                    <ServiceIcon card={card} />
                    <div className="connector-tile-info">
                      <div className="connector-tile-name">{card.label}</div>
                      <div className="connector-tile-blurb">{card.blurb}</div>
                    </div>
                  </div>

                  {/* Accounts List */}
                  {accounts.length > 0 && (
                    <div className="connector-accounts-list">
                      {accounts.map((acc) => (
                        <div key={acc.id} className="connector-account-row">
                          <span className="connector-account-alias">
                            <Check size={11} className="text-live shrink-0" />
                            <span>{acc.alias || acc.id}</span>
                          </span>
                          <button
                            type="button"
                            className="connector-account-disconnect-btn"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Disconnect account "${acc.alias || acc.id}" from ${card.label}?`)) {
                                disconnectAccount(card.slug, acc.id)
                              }
                            }}
                          >
                            Disconnect
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline Add Account Form */}
                  {addingAccount && (
                    <form
                      className="connector-alias-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        connect(card.slug, aliasDraft.trim())
                      }}
                    >
                      <input
                        className="connector-alias-input"
                        placeholder="Account alias (e.g. Work)"
                        value={aliasDraft}
                        onChange={(e) => setAliasDraft(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="connector-btn-primary"
                        disabled={busy || !aliasDraft.trim()}
                      >
                        Continue
                      </button>
                    </form>
                  )}

                  {/* Tile Footer */}
                  <div className="connector-tile-footer">
                    <div>
                      {included ? (
                        <span className="connector-status-tag is-included">
                          <ShieldCheck size={12} /> Included
                        </span>
                      ) : connected ? (
                        <span className="connector-status-tag is-active">
                          <span className="connector-live-dot" />
                          <span>Connected</span>
                        </span>
                      ) : pending ? (
                        <span className="connector-status-tag is-pending">
                          <Loader2 size={12} className="animate-spin" /> Pending
                        </span>
                      ) : (
                        <span className="text-xs text-dim">Ready to connect</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {pendingAuth?.url && (
                        <a
                          href={pendingAuth.url}
                          target="_blank"
                          rel="noreferrer"
                          className="connector-action-btn"
                          title="Open authorization link"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}

                      {!included && (
                        <button
                          type="button"
                          className={`connector-action-btn ${accounts.length > 0 ? 'is-add-account' : 'is-connect'}`}
                          disabled={busy}
                          onClick={() => {
                            if (accounts.length > 0) {
                              setAliasSlug((prev) => (prev === card.slug ? null : card.slug))
                              setAliasDraft('')
                            } else {
                              connect(card.slug)
                            }
                          }}
                        >
                          {busy ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : accounts.length > 0 ? (
                            'Add Account'
                          ) : (
                            'Connect'
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </section>
      )}

      {/* Embedded or standalone MCP Servers section */}
      {(filter === 'all' || filter === 'mcp') && (
        <div className={filter === 'all' ? 'mt-8 border-t border-hairline/40 pt-6' : ''}>
          <McpServersPanel
            embedded={filter === 'all'}
            newOpen={newOpen}
            setNewOpen={setNewOpen}
            query={effectiveSearch}
          />
        </div>
      )}
    </div>
  )
}
