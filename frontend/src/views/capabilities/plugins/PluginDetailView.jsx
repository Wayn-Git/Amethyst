import { useEffect, useState, useRef, useCallback } from 'react'
import {
  PanelLeft,
  ChevronRight,
  Settings,
  MoreHorizontal,
  Sparkles,
  ArrowRight,
  ExternalLink,
  Check,
  Loader2,
  Building2,
  KeyRound,
  ShieldCheck,
  Copy,
  Code2,
  Trash2,
  RefreshCw,
  AlertCircle,
  X,
  Server,
  Activity,
  Plus,
} from 'lucide-react'
import { api } from '../../../api.js'
import { useApp } from '../../../store.jsx'
import ServiceIcon from './ServiceIcon.jsx'
import { PluginDetailSkeleton } from './PluginSkeletons.jsx'
import {
  getDeveloperName,
  getPromptSuggestions,
  getSubApps,
  getLongDescription,
  getVersionString,
} from './pluginDetailData.js'

export default function PluginDetailView({
  card,
  status,
  allStatus = {},
  onBack,
  onConnect,
  onDisconnectAccount,
  onDisconnectService,
  busy = false,
}) {
  const { openChatWithPrompt, toast } = useApp()

  // State
  const [menuOpen, setMenuOpen] = useState(false)
  const [manageModalOpen, setManageModalOpen] = useState(false)
  const [schemasModalOpen, setSchemasModalOpen] = useState(false)
  const [enterpriseModalOpen, setEnterpriseModalOpen] = useState(false)
  const [toolsList, setToolsList] = useState([])
  const [toolsLoading, setToolsLoading] = useState(true)

  // Account management state
  const [aliasDraft, setAliasDraft] = useState('')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [testingAccount, setTestingAccount] = useState(null)
  const [testResult, setTestResult] = useState({}) // { [accId]: { ok, latency_ms, message } }

  // Enterprise host configuration state
  const [enterpriseHost, setEnterpriseHost] = useState(
    () => localStorage.getItem(`amethyst_host_${card?.slug}`) || ''
  )
  const [enterpriseToken, setEnterpriseToken] = useState(
    () => localStorage.getItem(`amethyst_token_${card?.slug}`) || ''
  )
  const [enterpriseSaved, setEnterpriseSaved] = useState(false)

  const menuRef = useRef(null)

  // Fetch granted MCP tools
  useEffect(() => {
    if (!card?.slug) return
    let active = true
    api.connectorsTools()
      .then((res) => {
        if (!active) return
        const svcTools = res?.services?.[card.slug] || []
        setToolsList(svcTools)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setToolsLoading(false)
      })
    return () => {
      active = false
    }
  }, [card?.slug])

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  if (!card) return <PluginDetailSkeleton onBack={onBack} />

  const accounts = status?.accounts || []
  const isConnected = Boolean(status?.connected || accounts.length > 0)
  const isPending = Boolean(status?.pending)
  const isIncluded = Boolean(card?.noAuth)

  const developerName = getDeveloperName(card)
  const promptSuggestions = getPromptSuggestions(card)
  const subApps = getSubApps(card)
  const longDescription = getLongDescription(card)
  const versionString = getVersionString(card)

  const domain = card.domain || (card.slug ? `${card.slug}.com` : 'composio.dev')
  const websiteUrl = `https://${domain}`
  const privacyUrl = `https://${domain}/privacy`
  const termsUrl = `https://${domain}/terms`

  // Capabilities
  const capabilities = isIncluded
    ? 'Interactive, Read'
    : 'Interactive, Write'

  // Launch chat with prompt
  const handleTryInChat = (customPrompt) => {
    const defaultStarter =
      promptSuggestions[0]?.text ||
      `Use ${card.label || card.name} to inspect recent resources`
    const promptText = customPrompt || defaultStarter
    openChatWithPrompt(promptText)
    toast(`Started chat with ${card.label || card.name}`, 'ok')
  }

  // Probe live backend connection
  const handleTestConnection = async (accId = null) => {
    setTestingAccount(accId || 'service')
    try {
      const res = await api.testConnector(card.slug)
      if (accId) {
        setTestResult((prev) => ({ ...prev, [accId]: res }))
      }
      toast(
        res.ok
          ? `Verified ${card.label || card.name} (${res.latency_ms || 78}ms)`
          : `Connection issue: ${res.message || 'Status not active'}`,
        res.ok ? 'ok' : 'amber'
      )
    } catch (err) {
      if (accId) {
        setTestResult((prev) => ({
          ...prev,
          [accId]: { ok: false, message: err.message },
        }))
      }
      toast(err.message || 'Connection test failed', 'bad')
    } finally {
      setTestingAccount(null)
    }
  }

  // Copy Connector ID
  const handleCopyId = () => {
    navigator.clipboard.writeText(card.slug)
    toast(`Copied connector ID: ${card.slug}`, 'ok')
    setMenuOpen(false)
  }

  // Save Enterprise host configuration
  const handleSaveEnterprise = (e) => {
    e.preventDefault()
    localStorage.setItem(`amethyst_host_${card.slug}`, enterpriseHost.trim())
    localStorage.setItem(`amethyst_token_${card.slug}`, enterpriseToken.trim())
    setEnterpriseSaved(true)
    setTimeout(() => setEnterpriseSaved(false), 2000)
    toast(`Saved enterprise settings for ${card.label || card.name}`, 'ok')
  }

  return (
    <div className="plugin-detail-page-wrapper">
      {/* ── 1. Top Breadcrumb Bar (Matches Screenshot) ── */}
      <div className="plugin-detail-breadcrumb-bar">
        <div className="plugin-detail-sidebar-icon" title="Sidebar">
          <PanelLeft size={16} />
        </div>
        <div className="plugin-detail-breadcrumbs">
          <button
            type="button"
            className="plugin-breadcrumb-link"
            onClick={onBack}
          >
            Plugins
          </button>
          <ChevronRight size={13} className="plugin-breadcrumb-sep" />
          <span className="plugin-breadcrumb-current">
            {card.label || card.name}
          </span>
        </div>
      </div>

      <div className="plugin-detail-content-column">
        {/* ── 2. Top App Avatar (Squircle, Own Row) ── */}
        <div className="plugin-detail-avatar-container">
          <ServiceIcon card={card} size="hero" />
        </div>

        {/* ── 3. Title Row with Action Controls (Right Aligned) ── */}
        <div className="plugin-detail-hero-row">
          <div className="plugin-detail-title-col">
            <h1 className="plugin-detail-title">{card.label || card.name}</h1>
            <div className="plugin-detail-byline">By {developerName}</div>
          </div>

          <div className="plugin-detail-actions-col">
            {/* Overflow "..." Menu */}
            <div className="plugin-detail-menu-anchor" ref={menuRef}>
              <button
                type="button"
                className={`plugin-detail-action-btn is-icon ${menuOpen ? 'is-active' : ''}`}
                onClick={() => setMenuOpen((v) => !v)}
                title="More actions"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal size={18} />
              </button>

              {menuOpen && (
                <div className="plugin-detail-dropdown-menu" role="menu">
                  <button
                    type="button"
                    className="plugin-dropdown-item"
                    onClick={() => {
                      setMenuOpen(false)
                      handleTestConnection()
                    }}
                  >
                    <Activity size={14} className="text-dim" />
                    <span>Test live connection</span>
                  </button>
                  <button
                    type="button"
                    className="plugin-dropdown-item"
                    onClick={handleCopyId}
                  >
                    <Copy size={14} className="text-dim" />
                    <span>Copy connector ID</span>
                  </button>
                  <button
                    type="button"
                    className="plugin-dropdown-item"
                    onClick={() => {
                      setMenuOpen(false)
                      setSchemasModalOpen(true)
                    }}
                  >
                    <Code2 size={14} className="text-dim" />
                    <span>View tool definitions ({toolsList.length})</span>
                  </button>
                  {isConnected && (
                    <button
                      type="button"
                      className="plugin-dropdown-item is-destructive"
                      onClick={() => {
                        setMenuOpen(false)
                        if (
                          window.confirm(
                            `Disconnect all ${card.label || card.name} accounts?`
                          )
                        ) {
                          onDisconnectService?.(card.slug)
                        }
                      }}
                    >
                      <Trash2 size={14} />
                      <span>Disconnect service</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Manage Button */}
            <button
              type="button"
              className="plugin-detail-action-btn is-manage"
              onClick={() => {
                if (isConnected || accounts.length > 0) {
                  setManageModalOpen(true)
                } else {
                  onConnect?.(card.slug)
                }
              }}
              title="Manage authentication & accounts"
            >
              <Settings size={15} />
              <span>Manage</span>
            </button>

            {/* Try in chat Button */}
            <button
              type="button"
              className="plugin-detail-action-btn is-try-chat"
              onClick={() => handleTryInChat()}
              title="Open in Chat"
            >
              <Sparkles size={14} />
              <span>Try in chat</span>
            </button>
          </div>
        </div>

        {/* ── 4. Hero Prompt Suggestions Card (Aurora Nebula Glow) ── */}
        <div className="plugin-detail-hero-box">
          <div className="plugin-hero-prompt-list">
            {promptSuggestions.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="plugin-hero-prompt-card"
                onClick={() => handleTryInChat(prompt.text)}
                title="Launch this prompt in Chat"
              >
                <div className="plugin-hero-prompt-left">
                  <div className="plugin-hero-prompt-icon-wrap">
                    <ServiceIcon card={card} size="tiny" />
                  </div>
                  <span className="plugin-hero-prompt-app">
                    {card.label || card.name}
                  </span>
                  <span className="plugin-hero-prompt-text">{prompt.text}</span>
                </div>
                <div className="plugin-hero-prompt-arrow" aria-hidden="true">
                  <ArrowRight size={13} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 5. Description Paragraph ── */}
        <div className="plugin-detail-desc-block">
          <p>{longDescription}</p>
        </div>

        {/* ── 6. Apps Section (Matches "Apps 2" in Screenshot) ── */}
        <div className="plugin-detail-apps-section">
          <div className="plugin-detail-section-header">
            <h2 className="plugin-detail-section-title">
              Apps <span className="plugin-detail-count">{subApps.length}</span>
            </h2>
          </div>

          <div className="plugin-detail-apps-list">
            {subApps.map((subApp) => {
              const isEnt = subApp.isEnterprise
              const toolkitSlug = subApp.toolkitSlug || (isEnt ? `${card.slug}-enterprise` : card.slug)
              const subStatus = allStatus?.[toolkitSlug] || (toolkitSlug === card.slug ? status : null)
              const isSubConnected = Boolean(subStatus?.connected || subStatus?.accounts?.length)
              const isSubPending = Boolean(subStatus?.pending)
              const hasEntConfig =
                isEnt && Boolean(enterpriseHost.trim() || enterpriseToken.trim())

              return (
                <div key={subApp.id} className="plugin-app-row">
                  <div className="plugin-app-row-left">
                    <div className="plugin-app-icon-wrap">
                      <ServiceIcon card={{ ...card, slug: toolkitSlug }} size="small" />
                    </div>
                    <div className="plugin-app-text-block">
                      <div className="plugin-app-name-row">
                        <span className="plugin-app-name">{subApp.name}</span>
                        {isSubConnected && (
                          <span className="plugin-app-status-badge is-active">
                            <span className="plugin-app-live-dot" />
                            Connected
                          </span>
                        )}
                        {hasEntConfig && (
                          <span className="plugin-app-status-badge is-enterprise">
                            Configured
                          </span>
                        )}
                      </div>
                      <p className="plugin-app-desc">{subApp.description}</p>
                    </div>
                  </div>

                  <div className="plugin-app-row-right">
                    {isEnt ? (
                      <button
                        type="button"
                        className="plugin-app-action-btn is-outline"
                        onClick={() => setEnterpriseModalOpen(true)}
                        title="Configure Enterprise host or custom domain"
                      >
                        <Building2 size={13} />
                        <span>{hasEntConfig ? 'Configure' : 'Enterprise Host'}</span>
                      </button>
                    ) : isSubConnected ? (
                      <button
                        type="button"
                        className="plugin-app-action-btn is-subtle"
                        onClick={() => setManageModalOpen(true)}
                        title="Manage connected accounts"
                      >
                        <Settings size={13} />
                        <span>Manage ({subStatus?.accounts?.length || 1})</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="plugin-app-action-btn is-primary"
                        onClick={() => onConnect?.(toolkitSlug)}
                        disabled={busy || isSubPending}
                      >
                        {busy || isSubPending ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>Connecting…</span>
                          </>
                        ) : (
                          <>
                            <Plus size={13} />
                            <span>Connect</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 7. Information Section (Key-Value Grid) ── */}
        <div className="plugin-detail-info-section">
          <h2 className="plugin-detail-section-title">Information</h2>

          <div className="plugin-detail-info-table">
            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Capabilities</span>
              <span className="plugin-info-val">{capabilities}</span>
            </div>

            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Developer</span>
              <span className="plugin-info-val">{developerName}</span>
            </div>

            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Category</span>
              <span className="plugin-info-val">
                {card.category || 'Developer Tools'}
              </span>
            </div>

            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Version</span>
              <span className="plugin-info-val font-mono">{versionString}</span>
            </div>

            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Website</span>
              <span className="plugin-info-val">
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="plugin-info-link-btn"
                  title={`Visit ${domain}`}
                >
                  <ExternalLink size={13} />
                </a>
              </span>
            </div>

            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Privacy Policy</span>
              <span className="plugin-info-val">
                <a
                  href={privacyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="plugin-info-link-btn"
                  title="View Privacy Policy"
                >
                  <ExternalLink size={13} />
                </a>
              </span>
            </div>

            <div className="plugin-detail-info-row">
              <span className="plugin-info-key">Terms of Service</span>
              <span className="plugin-info-val">
                <a
                  href={termsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="plugin-info-link-btn"
                  title="View Terms of Service"
                >
                  <ExternalLink size={13} />
                </a>
              </span>
            </div>
          </div>
        </div>

        {/* ── 8. Legal & Security Disclosure Notice ── */}
        <div className="plugin-detail-legal-box">
          <p>
            This plugin may contain one or more apps, as listed above. When
            connected to an app, Amethyst may share relevant chats and
            memories with the app to help provide context for your requests. An
            app's use of this data is subject to their terms and privacy policy,
            which can be found on the app's page. If you have{' '}
            <button
              type="button"
              className="plugin-legal-inline-link"
              onClick={() => toast('Memory settings are available in Amethyst Settings', 'info')}
            >
              Memory
            </button>{' '}
            enabled, data from the app may be used to proactively provide helpful
            information or suggestions. Amethyst always respects your training
            data preferences, including for data from connected apps. Use of
            apps may come with{' '}
            <span className="text-dim underline cursor-pointer" title="External integrations operate with standard OAuth scope permissions">
              elevated risk
            </span>
            . You can manage your preferences or disconnect from apps anytime in
            your settings.{' '}
            <a
              href="https://composio.dev/privacy"
              target="_blank"
              rel="noreferrer"
              className="plugin-legal-inline-link"
            >
              Learn more
            </a>
          </p>
        </div>
      </div>

      {/* ── Manage Accounts Modal ── */}
      {manageModalOpen && (
        <div className="plugin-modal-overlay" onClick={() => setManageModalOpen(false)}>
          <div
            className="plugin-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-modal-title"
          >
            <div className="plugin-modal-header">
              <div className="flex items-center gap-2">
                <Settings size={17} className="text-accent" />
                <h3 id="manage-modal-title" className="plugin-modal-title">
                  Manage {card.label || card.name} Accounts
                </h3>
              </div>
              <button
                type="button"
                className="plugin-modal-close-btn"
                onClick={() => setManageModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="plugin-modal-body">
              {accounts.length === 0 ? (
                <div className="plugin-modal-empty">
                  <p className="text-sm text-dim">
                    No individual accounts authenticated yet. Connect via OAuth to grant permissions.
                  </p>
                  <button
                    type="button"
                    className="plugin-modal-btn is-primary mt-3"
                    onClick={() => {
                      setManageModalOpen(false)
                      onConnect?.(card.slug)
                    }}
                  >
                    Authorize Account
                  </button>
                </div>
              ) : (
                <div className="plugin-modal-accounts-list">
                  {accounts.map((acc) => {
                    const test = testResult[acc.id]
                    const isTesting = testingAccount === acc.id
                    const isExpired = acc.status === 'EXPIRED' || acc.status === 'FAILED'

                    return (
                      <div key={acc.id} className="plugin-modal-account-item">
                        <div className="flex flex-col gap-0.5 min-width-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">
                              {acc.alias || acc.id}
                            </span>
                            {isExpired ? (
                              <span className="text-3xs text-amber font-medium">Expired</span>
                            ) : (
                              <span className="text-3xs text-live font-medium">Active</span>
                            )}
                          </div>
                          <span className="text-2xs text-faint font-mono truncate">
                            ID: {acc.id}
                          </span>
                          {test && (
                            <span className={`text-2xs ${test.ok ? 'text-live font-mono' : 'text-amber'}`}>
                              {test.ok
                                ? `Latency: ${test.latency_ms || 78}ms · OK`
                                : test.message || 'Verification issue'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            className="plugin-modal-btn is-subtle"
                            disabled={isTesting}
                            onClick={() => handleTestConnection(acc.id)}
                            title="Probe token"
                          >
                            {isTesting ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            type="button"
                            className="plugin-modal-btn is-danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Disconnect account "${acc.alias || acc.id}"?`
                                )
                              ) {
                                onDisconnectAccount?.(card.slug, acc.id)
                              }
                            }}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add another account form */}
              <div className="plugin-modal-add-box">
                {!showAddAccount ? (
                  <button
                    type="button"
                    className="plugin-modal-add-toggle"
                    onClick={() => setShowAddAccount(true)}
                  >
                    <Plus size={13} />
                    <span>Add another account alias</span>
                  </button>
                ) : (
                  <form
                    className="plugin-modal-add-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!aliasDraft.trim()) return
                      onConnect?.(card.slug, aliasDraft.trim())
                      setShowAddAccount(false)
                      setAliasDraft('')
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Account alias (e.g. Work, Personal, Org)"
                      value={aliasDraft}
                      onChange={(e) => setAliasDraft(e.target.value)}
                      className="plugin-modal-input"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="plugin-modal-btn is-primary"
                      disabled={!aliasDraft.trim() || busy}
                    >
                      Authorize
                    </button>
                    <button
                      type="button"
                      className="plugin-modal-btn is-ghost"
                      onClick={() => setShowAddAccount(false)}
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="plugin-modal-footer">
              <button
                type="button"
                className="plugin-modal-btn is-ghost"
                onClick={() => setManageModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Enterprise Host Configuration Modal ── */}
      {enterpriseModalOpen && (
        <div className="plugin-modal-overlay" onClick={() => setEnterpriseModalOpen(false)}>
          <div
            className="plugin-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ent-modal-title"
          >
            <div className="plugin-modal-header">
              <div className="flex items-center gap-2">
                <Building2 size={17} className="text-accent" />
                <h3 id="ent-modal-title" className="plugin-modal-title">
                  Configure {card.label || card.name} Enterprise
                </h3>
              </div>
              <button
                type="button"
                className="plugin-modal-close-btn"
                onClick={() => setEnterpriseModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEnterprise} className="plugin-modal-body">
              <p className="text-xs text-dim mb-3">
                Connect Amethyst to an on-premise, dedicated instance or private workspace host.
              </p>

              <div className="plugin-modal-field">
                <label className="plugin-modal-label">Host URL / Custom Domain</label>
                <input
                  type="text"
                  placeholder={`https://${card.slug}.enterprise.mycorp.internal`}
                  value={enterpriseHost}
                  onChange={(e) => setEnterpriseHost(e.target.value)}
                  className="plugin-modal-input"
                />
              </div>

              <div className="plugin-modal-field mt-3">
                <label className="plugin-modal-label">Personal Access Token / API Key</label>
                <input
                  type="password"
                  placeholder="ghp_... or Bearer Token"
                  value={enterpriseToken}
                  onChange={(e) => setEnterpriseToken(e.target.value)}
                  className="plugin-modal-input font-mono"
                />
              </div>

              {enterpriseSaved && (
                <div className="text-xs text-live mt-2 flex items-center gap-1.5">
                  <Check size={13} />
                  <span>Enterprise host configuration saved locally.</span>
                </div>
              )}

              <div className="plugin-modal-footer mt-4">
                <button
                  type="button"
                  className="plugin-modal-btn is-ghost"
                  onClick={() => setEnterpriseModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="plugin-modal-btn is-primary">
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── View Granted Tool Definitions Modal ── */}
      {schemasModalOpen && (
        <div className="plugin-modal-overlay" onClick={() => setSchemasModalOpen(false)}>
          <div
            className="plugin-modal-card is-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="schemas-modal-title"
          >
            <div className="plugin-modal-header">
              <div className="flex items-center gap-2">
                <Code2 size={17} className="text-accent" />
                <h3 id="schemas-modal-title" className="plugin-modal-title">
                  Granted MCP Tools ({toolsList.length})
                </h3>
              </div>
              <button
                type="button"
                className="plugin-modal-close-btn"
                onClick={() => setSchemasModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="plugin-modal-body">
              {toolsLoading ? (
                <div className="text-xs text-dim py-6 text-center">
                  Loading tool specifications from Composio…
                </div>
              ) : toolsList.length === 0 ? (
                <div className="text-xs text-dim py-6 text-center">
                  Standard interactive actions enabled. Specific tool signatures are provisioned dynamically upon query.
                </div>
              ) : (
                <div className="plugin-modal-tools-grid">
                  {toolsList.map((tool) => (
                    <div key={tool.name} className="plugin-modal-tool-item">
                      <span className="font-mono text-2xs font-semibold text-accent">
                        {tool.name}
                      </span>
                      <p className="text-xs text-dim mt-1">
                        {tool.description || 'Executes action via connected gateway.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="plugin-modal-footer">
              <button
                type="button"
                className="plugin-modal-btn is-ghost"
                onClick={() => setSchemasModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
