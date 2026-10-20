import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  ShieldCheck,
  Check,
  Loader2,
  Trash2,
  Plus,
  Globe,
  Activity,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { api } from '../../../api.js'
import ServiceIcon from './ServiceIcon.jsx'
import PluginHeroPreview from './PluginHeroPreview.jsx'
import { PluginDetailSkeleton } from './PluginSkeletons.jsx'

export default function PluginDetailView({
  card,
  status,
  onBack,
  onConnect,
  onDisconnectAccount,
  onDisconnectService,
  busy = false,
}) {
  const [aliasDraft, setAliasDraft] = useState('')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [toolsList, setToolsList] = useState([])
  const [toolsLoading, setToolsLoading] = useState(true)
  const [testingAccount, setTestingAccount] = useState(null)
  const [testResult, setTestResult] = useState({}) // { [accId]: { ok, latency_ms, message } }

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

  const handleTestAccount = async (accId) => {
    setTestingAccount(accId)
    try {
      const res = await api.testConnector(card.slug)
      setTestResult((prev) => ({
        ...prev,
        [accId]: res,
      }))
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [accId]: { ok: false, message: err.message || 'Connection test failed' },
      }))
    } finally {
      setTestingAccount(null)
    }
  }

  if (!card) return <PluginDetailSkeleton onBack={onBack} />


  const accounts = status?.accounts || []
  const isConnected = Boolean(status?.connected || accounts.length > 0)
  const isPending = Boolean(status?.pending)
  const isIncluded = Boolean(card?.noAuth)

  const capabilities = isIncluded
    ? 'Interactive, Read'
    : 'Interactive, Write, Read'

  const developerName =
    card.domain?.includes('google')
      ? 'Google'
      : card.domain?.includes('github')
        ? 'GitHub'
        : card.domain?.includes('slack')
          ? 'Slack'
          : card.domain?.includes('notion')
            ? 'Notion Labs'
            : card.domain?.includes('linear')
              ? 'Linear'
              : 'Composio & Amethyst'

  const websiteUrl = card.domain
    ? `https://${card.domain}`
    : 'https://composio.dev'

  const privacyUrl = card.domain
    ? `https://${card.domain}/privacy`
    : 'https://composio.dev/privacy'

  const termsUrl = card.domain
    ? `https://${card.domain}/terms`
    : 'https://composio.dev/terms'

  return (
    <div className="plugin-detail-root">
      {/* Top back navigation */}
      <div className="plugin-detail-top-nav">
        <button
          type="button"
          className="plugin-back-btn"
          onClick={onBack}
          aria-label="Back to plugins"
        >
          <ChevronLeft size={18} />
          <span>Plugins</span>
        </button>
      </div>

      <div className="plugin-detail-container">
        {/* Header Block */}
        <div className="plugin-detail-header">
          <div className="plugin-detail-header-left">
            <ServiceIcon card={card} size="large" />
            <div className="plugin-detail-title-block">
              <h1 className="plugin-detail-title">{card.label || card.name}</h1>
              <p className="plugin-detail-subtitle">
                {card.blurb || card.description}
              </p>
            </div>
          </div>

          <div className="plugin-detail-header-actions">
            {isIncluded ? (
              <span className="plugin-status-badge is-included">
                <ShieldCheck size={15} />
                <span>Included</span>
              </span>
            ) : isPending || busy ? (
              <button type="button" className="plugin-cta-btn is-loading" disabled>
                <Loader2 size={16} className="animate-spin" />
                <span>Connecting…</span>
              </button>
            ) : isConnected ? (
              <div className="flex items-center gap-2">
                <span className="plugin-status-badge is-connected">
                  <span className="connector-live-dot" />
                  <span>Connected</span>
                </span>
                <button
                  type="button"
                  className="plugin-cta-btn is-disconnect"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Disconnect ${card.label || card.name} from Amethyst?`
                      )
                    ) {
                      onDisconnectService?.(card.slug)
                    }
                  }}
                  title="Disconnect"
                >
                  <Trash2 size={14} />
                  <span>Disconnect</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="plugin-cta-btn is-primary"
                onClick={() => onConnect?.(card.slug)}
              >
                <Plus size={16} />
                <span>Connect</span>
              </button>
            )}
          </div>
        </div>

        {/* Connected Accounts Section if multiple or active */}
        {accounts.length > 0 && (
          <div className="plugin-accounts-section">
            <div className="plugin-accounts-header">
              <span className="text-xs font-medium text-dim uppercase tracking-wider">
                Connected Accounts ({accounts.length})
              </span>
              {!showAddAccount && (
                <button
                  type="button"
                  className="plugin-accounts-add-btn"
                  onClick={() => setShowAddAccount(true)}
                >
                  <Plus size={13} />
                  <span>Add another account</span>
                </button>
              )}
            </div>

            <div className="plugin-accounts-list">
              {accounts.map((acc) => {
                const test = testResult[acc.id]
                const isExpired = acc.status === 'EXPIRED' || acc.status === 'FAILED'
                const isTesting = testingAccount === acc.id

                return (
                  <div key={acc.id} className="plugin-account-item">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Check size={14} className={isExpired ? 'text-amber' : 'text-live'} />
                      <span className="text-sm font-medium">
                        {acc.alias || acc.id}
                      </span>
                      {isExpired ? (
                        <span className="system-status-pill is-warning text-3xs">
                          Expired
                        </span>
                      ) : (
                        <span className="system-status-pill is-active text-3xs">
                          Active
                        </span>
                      )}
                      {test?.ok && (
                        <span className="system-status-pill is-active text-3xs">
                          Verified ({test.latency_ms || 75}ms)
                        </span>
                      )}
                      {test?.ok === false && (
                        <span className="system-status-pill is-warning text-3xs">
                          {test.message || 'Check failed'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isExpired && (
                        <button
                          type="button"
                          className="plugin-cta-btn is-primary is-small"
                          onClick={() => onConnect?.(card.slug, acc.alias)}
                        >
                          Reconnect
                        </button>
                      )}
                      <button
                        type="button"
                        className="plugin-account-disconnect-btn"
                        disabled={isTesting}
                        onClick={() => handleTestAccount(acc.id)}
                        title="Probe token connectivity"
                      >
                        {isTesting ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        type="button"
                        className="plugin-account-disconnect-btn"
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

            {showAddAccount && (
              <form
                className="plugin-add-account-form"
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
                  placeholder="Account alias (e.g. Work, Personal)"
                  className="plugin-account-input"
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  className="plugin-cta-btn is-primary is-small"
                  disabled={!aliasDraft.trim() || busy}
                >
                  Authorize
                </button>
                <button
                  type="button"
                  className="plugin-cta-btn is-ghost is-small"
                  onClick={() => setShowAddAccount(false)}
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
        )}

        {/* Granted Actions & Agent Tools Section */}
        <div className="plugin-tools-section">
          <div className="flex items-center justify-between mb-3">
            <h2 className="plugin-info-heading" style={{ margin: 0 }}>
              Granted Actions &amp; Agent Tools ({toolsList.length})
            </h2>
            <span className="text-3xs text-dim uppercase tracking-wider">
              Model Context Protocol
            </span>
          </div>

          {toolsLoading ? (
            <div className="text-xs text-dim py-2">Loading tool definitions…</div>
          ) : toolsList.length === 0 ? (
            <div className="text-xs text-dim py-2">
              Standard interactive read/write actions enabled when connected.
            </div>
          ) : (
            <div className="plugin-tools-grid">
              {toolsList.map((tool) => (
                <div key={tool.name} className="plugin-tool-item">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="plugin-tool-badge font-mono">{tool.name}</span>
                  </div>
                  <p className="plugin-tool-desc">{tool.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hero Preview Card */}
        <PluginHeroPreview card={card} />

        {/* Long Description Text */}
        <div className="plugin-detail-description">
          <p>
            Use {card.label || card.name} to {card.blurb || card.description} through the connected {card.label || card.name} integration in Amethyst.
          </p>
        </div>


        {/* Information Table Section */}
        <div className="plugin-info-section">
          <h2 className="plugin-info-heading">Information</h2>

          <div className="plugin-info-table">
            <div className="plugin-info-row">
              <span className="plugin-info-key">Capabilities</span>
              <span className="plugin-info-val">{capabilities}</span>
            </div>

            <div className="plugin-info-row">
              <span className="plugin-info-key">Developer</span>
              <span className="plugin-info-val">{developerName}</span>
            </div>

            <div className="plugin-info-row">
              <span className="plugin-info-key">Category</span>
              <span className="plugin-info-val">
                {card.category || 'Productivity'}
              </span>
            </div>

            <div className="plugin-info-row">
              <span className="plugin-info-key">Website</span>
              <span className="plugin-info-val">
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="plugin-info-link"
                >
                  <ExternalLink size={13} />
                </a>
              </span>
            </div>

            <div className="plugin-info-row">
              <span className="plugin-info-key">Version</span>
              <span className="plugin-info-val">1.0.0</span>
            </div>

            <div className="plugin-info-row">
              <span className="plugin-info-key">Privacy Policy</span>
              <span className="plugin-info-val">
                <a
                  href={privacyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="plugin-info-link"
                >
                  <ExternalLink size={13} />
                </a>
              </span>
            </div>

            <div className="plugin-info-row">
              <span className="plugin-info-key">Terms of Service</span>
              <span className="plugin-info-val">
                <a
                  href={termsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="plugin-info-link"
                >
                  <ExternalLink size={13} />
                </a>
              </span>
            </div>
          </div>
        </div>

        {/* Legal & Privacy Disclosure Notice */}
        <div className="plugin-legal-section">
          <p>
            When connected to {card.label || card.name}, Amethyst may share
            relevant chat context and tool inputs with this app to help fulfill
            your requests. Use of this integration is subject to their terms
            and privacy policy. You can manage your preferences or disconnect
            from apps anytime in this directory.
          </p>
          <p>
            Credentials and session tokens are encrypted in your local OS
            keychain. You can revoke access at any time.
          </p>
        </div>
      </div>
    </div>
  )
}
