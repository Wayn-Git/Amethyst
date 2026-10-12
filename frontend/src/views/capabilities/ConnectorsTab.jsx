import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2,
  TriangleAlert,
  X,
  ExternalLink,
  Key,
  Globe,
  Trash2,
} from 'lucide-react'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import PluginsDirectory from './plugins/PluginsDirectory.jsx'
import CategoryView from './plugins/CategoryView.jsx'
import PluginDetailView from './plugins/PluginDetailView.jsx'
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

export default function ConnectorsTab({ query = '', setQuery, newOpen, setNewOpen }) {
  const { openChatWithPrompt } = useApp()

  // Navigation hierarchy state
  const [viewMode, setViewMode] = useState('directory') // 'directory' | 'category' | 'detail'
  const [activeCategory, setActiveCategory] = useState(null)
  const [activeCardSlug, setActiveCardSlug] = useState(null)

  // Catalog and connection state
  const [cards, setCards] = useState(null)
  const [configured, setConfigured] = useState(false)
  const [status, setStatus] = useState(() => cachedConnectorStatus || {})
  const [stale, setStale] = useState(false)
  const [busySlug, setBusySlug] = useState(null)
  const [error, setError] = useState(null)
  const [pendingUrls, setPendingUrls] = useState({})

  // Composio connection & API key modal state
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

  // Dynamic search fetch
  useEffect(() => {
    if (!effectiveSearch || effectiveSearch.length < 2) return
    const timer = setTimeout(async () => {
      try {
        const res = await api.connectorsCatalog(effectiveSearch)
        if (res.cards && res.cards.length > 0) {
          setCards((prev) => {
            const map = new Map((prev || []).map((c) => [c.slug, c]))
            for (const c of res.cards) {
              map.set(c.slug, { ...map.get(c.slug), ...c })
            }
            return Array.from(map.values())
          })
        }
      } catch {
        // Keep local results on network error
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [effectiveSearch])

  // Load connected state
  const loadConnectedStatus = useCallback(async (force = false) => {
    if (
      !force &&
      cachedConnectorStatus &&
      Date.now() - cachedConnectorStatusAt < CONNECTOR_STATUS_CACHE_MS
    ) {
      setStatus(cachedConnectorStatus)
      return cachedConnectorStatus
    }

    try {
      const res = await api.connectorsConnected()
      const services = res.services || {}
      cachedConnectorStatus = services
      cachedConnectorStatusAt = Date.now()
      setStatus(services)
      setStale(res.credentialStore === 'unavailable')
      setConfigured(Boolean(res.configured))
      return services
    } catch {
      setStale(true)
      return {}
    }
  }, [])

  // Load catalog
  const loadCatalog = useCallback(async () => {
    try {
      const res = await api.connectorsCatalog()
      setCards(res.cards || [])
      setConfigured(Boolean(res.configured))
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
        if (
          ++tries >= 24 ||
          (s?.connected && !s.pending) ||
          (s?.status && /^(expired|failed)$/i.test(s.status))
        ) {
          clearInterval(timer)
          pollTimers.current.delete(slug)
          loadConnectedStatus(true)
        }
      })
    }, 4000)
    pollTimers.current.set(slug, timer)
  }

  // 1-Click Browser OAuth for Composio
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
            setError(
              'Composio browser login session expired or was rejected. Please try again.'
            )
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

  // Connect App via OAuth
  const connect = async (slug, alias) => {
    if (busySlug || opening.current) return

    if (!configured) {
      const card = (cards || []).find((c) => c.slug === slug)
      setModalPrompt(
        `Please log in to Composio first to connect ${card?.label || slug}.`
      )
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

      setPendingUrls((prev) => ({
        ...prev,
        [slug]: { url, createdAt: Date.now() },
      }))
      setStatus((prev) => ({
        ...prev,
        [slug]: {
          ...(prev[slug] || {}),
          connected: prev[slug]?.connected || false,
          pending: true,
          status: 'INITIATED',
        },
      }))
      startPolling(slug)

      const opened = await launch.open(url)
      if (!opened && opening.current === launch) {
        setError(
          'Popup was blocked by your browser. Please allow popups or check your browser bar.'
        )
      }
    } catch (cause) {
      launch.cancel()
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (opening.current === launch) opening.current = null
      setBusySlug(null)
    }
  }

  // Disconnect specific account
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

  // Disconnect entire service
  const disconnectService = async (slug) => {
    setBusySlug(slug)
    setError(null)
    try {
      await api.connectorsDisconnectService(slug)
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

  // Navigation handlers
  const handleOpenDetail = (card) => {
    setActiveCardSlug(card.slug)
    setViewMode('detail')
  }

  const handleOpenCategory = (cat) => {
    setActiveCategory(cat)
    setViewMode('category')
  }

  const handleBack = () => {
    if (viewMode === 'detail') {
      if (activeCategory) {
        setViewMode('category')
      } else {
        setViewMode('directory')
      }
      setActiveCardSlug(null)
    } else if (viewMode === 'category') {
      setViewMode('directory')
      setActiveCategory(null)
    }
  }

  // Launch Chat with prompt targeting this plugin
  const handleChat = (card) => {
    const label = card.label || card.name || card.slug
    const prompt = `Use ${label} to `
    openChatWithPrompt(prompt)
  }

  // Active card object for Detail view
  const activeCard = useMemo(() => {
    if (!activeCardSlug || !cards) return null
    return cards.find((c) => c.slug === activeCardSlug) || null
  }, [cards, activeCardSlug])

  // Category cards for Category view
  const categoryCards = useMemo(() => {
    if (!activeCategory || !cards) return []
    return cards.filter((c) => c.category === activeCategory)
  }, [cards, activeCategory])

  return (
    <div className="connectors-tab-orchestrator">
      {/* Notice & Error Banners */}
      {stale && (
        <div className="connector-status-banner is-warning mb-4">
          <div className="flex items-center gap-2">
            <TriangleAlert size={16} />
            <span>
              Cached status shown while connection status is confirming in the
              background.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mcp-notice mcp-notice-error mb-4">
          <div className="flex items-center gap-2">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mcp-notice-close"
          >
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
              <div className="connector-modal-prompt">{modalPrompt}</div>
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
                  Sign in with your Google or GitHub account on Composio. Amethyst
                  will link seamlessly without copying tokens.
                </p>

                {loginSession ? (
                  <div className="connector-browser-waiting-box">
                    <Loader2 size={24} className="animate-spin text-accent" />
                    <div>
                      <div className="font-semibold text-sm">
                        Awaiting authorization in browser…
                      </div>
                      <div className="text-xs text-dim mt-0.5">
                        Verify the authentication code on Composio:
                      </div>
                    </div>
                    {loginSession.code && (
                      <div className="connector-code-display">
                        <span className="text-3xs uppercase tracking-wider text-dim">
                          Verification Code
                        </span>
                        <span className="connector-code-value">
                          {loginSession.code}
                        </span>
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
                      Opens Composio&apos;s secure sign-in portal in a new tab.
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 py-1">
                <p className="mcp-modal-desc">
                  Paste your Composio API key (
                  <code className="font-mono">ak_...</code> or{' '}
                  <code className="font-mono">uak_...</code>) from{' '}
                  <a
                    href="https://app.composio.dev/settings"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline inline-flex items-center gap-1"
                  >
                    <span>app.composio.dev/settings</span>
                    <ExternalLink size={11} />
                  </a>
                  :
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
                    {savingKey ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : null}
                    <span>Save Key</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── View Hierarchy Transitions (Directory -> Category -> Detail) ── */}
      <AnimatePresence mode="wait">
        {viewMode === 'detail' && activeCard ? (
          <motion.div
            key={`detail-${activeCard.slug}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            <PluginDetailView
              card={activeCard}
              status={status[activeCard.slug]}
              onBack={handleBack}
              onConnect={connect}
              onDisconnectAccount={disconnectAccount}
              onDisconnectService={disconnectService}
              busy={busySlug === activeCard.slug}
            />
          </motion.div>
        ) : viewMode === 'category' && activeCategory ? (
          <motion.div
            key={`category-${activeCategory}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            <CategoryView
              category={activeCategory}
              cards={categoryCards}
              statusMap={status}
              onBack={handleBack}
              onOpenDetail={handleOpenDetail}
              onConnect={connect}
              onDisconnect={disconnectService}
              onChat={handleChat}
              busySlug={busySlug}
            />
          </motion.div>
        ) : (
          <motion.div
            key="directory-view"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            <PluginsDirectory
              cards={cards || []}
              statusMap={status}
              searchQuery={query}
              setSearchQuery={setQuery}
              onOpenDetail={handleOpenDetail}
              onOpenCategory={handleOpenCategory}
              onOpenAuthModal={() => {
                setModalPrompt(null)
                setLoginTab('browser')
                setKeyModalOpen(true)
              }}
              onConnect={connect}
              onDisconnect={disconnectService}
              onChat={handleChat}
              busySlug={busySlug}
              newOpen={newOpen}
              setNewOpen={setNewOpen}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
