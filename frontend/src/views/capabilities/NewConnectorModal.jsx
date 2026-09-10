import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import ServiceIcon from '../../components/ServiceIcon.jsx'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'

/* New Connector / Plugin modal matching Screenshot 4:
   - Icon preview with popover picker
   - Name input
   - Description input
   - Connection toggle (Server URL vs Command) with fluid sliding pill
   - Authentication select (None, OAuth, API Key / Secret)
   - Advanced settings collapsible with smooth height animation
   - Custom MCP risk warning card with acknowledgement checkbox
   - Create button that registers the connector, starts it, and opens its detail
*/

const BRAND_ICONS = [
  'thesvg',
  'apple',
  'github',
  'google',
  'vercel',
  'slack',
  'notion',
  'figma',
  'stripe',
  'tavily',
  'playwright',
  'linkedin',
  'dropbox',
  'spotify',
  'linear',
  'discord',
  'raycast',
  'supabase',
  'resend',
  'openai',
  'anthropic',
  'docker',
  'aws',
  'cloudflare',
]

const GENERIC_ICONS = ['plug', 'globe', 'cpu', 'term', 'spark', 'key', 'search', 'folder']

export default function NewConnectorModal({ open, onClose, onCreated }) {
  const { toast } = useApp()
  const modalRef = useRef(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [connectionMode, setConnectionMode] = useState('url') // 'url' | 'command'
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [argsStr, setArgsStr] = useState('')
  const [authType, setAuthType] = useState('none') // 'none' | 'oauth' | 'env'
  const [envKey, setEnvKey] = useState('')
  const [envValue, setEnvValue] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('plug')
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [scopesStr, setScopesStr] = useState('')
  const [allowLocal, setAllowLocal] = useState(false)
  const [riskAcknowledged, setRiskAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setConnectionMode('url')
      setUrl('')
      setCommand('')
      setArgsStr('')
      setAuthType('none')
      setEnvKey('')
      setEnvValue('')
      setSelectedIcon('plug')
      setShowIconPicker(false)
      setAdvancedOpen(false)
      setScopesStr('')
      setAllowLocal(false)
      setRiskAcknowledged(false)
      setBusy(false)
    }
  }, [open])

  // Escape key handler
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Validation
  const trimmedName = name.trim()
  const isUrlMode = connectionMode === 'url'
  const hasTarget = isUrlMode ? url.trim().length > 0 : command.trim().length > 0
  const canSubmit = trimmedName.length > 0 && hasTarget && riskAcknowledged && !busy

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    try {
      const sanitizedName = trimmedName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      const parsedArgs = argsStr.trim() ? argsStr.trim().split(/\s+/) : []
      const isOauth = authType === 'oauth'

      const payload = {
        name: sanitizedName,
        transport: isUrlMode ? 'streamable-http' : 'stdio',
        url: isUrlMode ? url.trim() : null,
        command: !isUrlMode ? command.trim() : null,
        args: !isUrlMode ? parsedArgs : [],
        oauth: isOauth,
        allow_local: allowLocal,
      }

      const res = await api.mcpAdd(payload)
      toast(`Added connector "${res.name}"`, 'ok')

      // If user supplied an environment variable / API key, set it immediately
      if (authType === 'env' && envKey.trim() && envValue.trim()) {
        try {
          await api.mcpSetEnv(sanitizedName, {
            key: envKey.trim().toUpperCase(),
            value: envValue.trim(),
            secret: true,
          })
          toast(`Stored ${envKey.trim().toUpperCase()} in keychain`, 'ok')
        } catch (envErr) {
          toast(`Failed to set variable: ${envErr.message}`, 'amber')
        }
      }

      onCreated(sanitizedName)
      onClose()
    } catch (err) {
      toast(err.message || 'Failed to add connector', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="mcp-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-connector-title"
        >
          <motion.div
            className="mcp-modal-shell"
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            <div className="mcp-modal" ref={modalRef}>
              <div className="mcp-modal-header">
                <h2 id="new-connector-title" className="mcp-modal-title">New Plugin</h2>
                <motion.button
                  type="button"
                  className="icon-btn mcp-modal-close"
                  onClick={onClose}
                  whileHover={{ rotate: 90, scale: 1.12 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  aria-label="Close"
                >
                  <Icon name="x" size={16} />
                </motion.button>
              </div>

              <form onSubmit={handleSubmit} className="mcp-modal-form">
                {/* Icon Section */}
                <div className="mcp-icon-row">
                  <motion.button
                    type="button"
                    className="mcp-icon-box"
                    onClick={() => setShowIconPicker((p) => !p)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    title="Change icon"
                  >
                    {BRAND_ICONS.includes(selectedIcon) ? (
                      <ServiceIcon name={selectedIcon} size={24} />
                    ) : (
                      <Icon name={selectedIcon} size={20} />
                    )}
                    <span className="mcp-icon-plus">
                      <Icon name="plus" size={10} />
                    </span>
                  </motion.button>
                  <div className="mcp-icon-meta">
                    <span className="mcp-icon-label">Icon <span className="mcp-opt">(optional)</span></span>
                    <span className="mcp-icon-hint">Pick an icon (supports 6,500+ theSVG icons & brands)</span>
                  </div>
                </div>

                <AnimatePresence>
                  {showIconPicker && (
                    <motion.div
                      className="mcp-icon-picker"
                      initial={{ opacity: 0, scale: 0.95, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 6 }}
                      transition={{ type: 'spring', stiffness: 450, damping: 28 }}
                    >
                      <div className="mcp-icon-picker-group">
                        <span className="mcp-icon-group-title">Brands (theSVG)</span>
                        <div className="mcp-icon-grid">
                          {BRAND_ICONS.map((ic) => (
                            <button
                              key={ic}
                              type="button"
                              className={`mcp-icon-picker-btn${selectedIcon === ic ? ' active' : ''}`}
                              onClick={() => {
                                setSelectedIcon(ic)
                                setShowIconPicker(false)
                              }}
                              title={ic}
                            >
                              <ServiceIcon name={ic} size={26} />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mcp-icon-picker-group">
                        <span className="mcp-icon-group-title">System</span>
                        <div className="mcp-icon-grid">
                          {GENERIC_ICONS.map((ic) => (
                            <button
                              key={ic}
                              type="button"
                              className={`mcp-icon-picker-btn${selectedIcon === ic ? ' active' : ''}`}
                              onClick={() => {
                                setSelectedIcon(ic)
                                setShowIconPicker(false)
                              }}
                              title={ic}
                            >
                              <Icon name={ic} size={18} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Name Field */}
                <div className="field">
                  <label htmlFor="connector-name">
                    Name <span className="mcp-req">*</span>
                  </label>
                  <input
                    id="connector-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Custom Tool"
                    autoFocus
                    required
                  />
                </div>

                {/* Description Field */}
                <div className="field">
                  <label htmlFor="connector-desc">
                    Description <span className="mcp-opt">(optional)</span>
                  </label>
                  <input
                    id="connector-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explain what it does in a few words"
                  />
                </div>

                {/* Connection Mode (Server URL vs Command) */}
                <div className="field">
                  <div className="mcp-field-header">
                    <label>Connection</label>
                    <div className="mcp-mode-toggle" role="radiogroup" aria-label="Connection mode">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={connectionMode === 'url'}
                        className={`mcp-mode-btn${connectionMode === 'url' ? ' active' : ''}`}
                        onClick={() => setConnectionMode('url')}
                      >
                        {connectionMode === 'url' && (
                          <motion.span
                            layoutId="activeModalMode"
                            className="mcp-mode-active-pill"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}
                        <span className="mcp-mode-label">Server URL</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={connectionMode === 'command'}
                        className={`mcp-mode-btn${connectionMode === 'command' ? ' active' : ''}`}
                        onClick={() => setConnectionMode('command')}
                      >
                        {connectionMode === 'command' && (
                          <motion.span
                            layoutId="activeModalMode"
                            className="mcp-mode-active-pill"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}
                        <span className="mcp-mode-label">Command (stdio)</span>
                      </button>
                    </div>
                  </div>

                  {connectionMode === 'url' ? (
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com/sse or https://api.example.com/mcp"
                      required
                    />
                  ) : (
                    <div className="mcp-command-inputs">
                      <input
                        type="text"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="npx or uvx or node"
                        required
                      />
                      <input
                        type="text"
                        value={argsStr}
                        onChange={(e) => setArgsStr(e.target.value)}
                        placeholder="Arguments e.g. -y @modelcontextprotocol/server-example"
                      />
                    </div>
                  )}
                </div>

                {/* Authentication Dropdown */}
                <div className="field">
                  <label htmlFor="connector-auth">Authentication</label>
                  <select
                    id="connector-auth"
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value)}
                    className="mcp-select"
                  >
                    <option value="none">None (No authentication needed)</option>
                    <option value="oauth">OAuth (OAuth 2.0 flow)</option>
                    <option value="env">API Key / Environment Variable</option>
                  </select>
                </div>

                {/* Env var credentials fields if authType is 'env' */}
                {authType === 'env' && (
                  <div className="mcp-env-section">
                    <div className="field-row">
                      <div className="field">
                        <label>Variable Name</label>
                        <input
                          type="text"
                          value={envKey}
                          onChange={(e) => setEnvKey(e.target.value.toUpperCase())}
                          placeholder="API_KEY or TOKEN"
                        />
                      </div>
                      <div className="field">
                        <label>Variable Value</label>
                        <input
                          type="password"
                          value={envValue}
                          onChange={(e) => setEnvValue(e.target.value)}
                          placeholder="Stored in OS keychain"
                        />
                      </div>
                    </div>
                    <span className="mcp-field-note">
                      Stored securely in the OS keychain and passed to the process environment.
                    </span>
                  </div>
                )}

                {/* Advanced Settings Collapsible with Animation */}
                <div className="mcp-advanced">
                  <button
                    type="button"
                    className="mcp-advanced-toggle"
                    onClick={() => setAdvancedOpen((o) => !o)}
                  >
                    <Icon name="chevron" size={13} className={`mcp-chevron${advancedOpen ? ' open' : ''}`} />
                    <span>Advanced settings</span>
                  </button>

                  <AnimatePresence>
                    {advancedOpen && (
                      <motion.div
                        className="mcp-advanced-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        {authType === 'oauth' && (
                          <div className="field">
                            <label>OAuth Scopes (space separated)</label>
                            <input
                              type="text"
                              value={scopesStr}
                              onChange={(e) => setScopesStr(e.target.value)}
                              placeholder="read write repo"
                            />
                          </div>
                        )}
                        <label className="mcp-checkbox-label">
                          <input
                            type="checkbox"
                            checked={allowLocal}
                            onChange={(e) => setAllowLocal(e.target.checked)}
                          />
                          <span>Allow local network requests (127.0.0.1, localhost)</span>
                        </label>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Risk Warning Box matching Screenshot 4 */}
                <div className="mcp-risk-card">
                  <div className="mcp-risk-head">
                    <Icon name="alert" size={16} className="mcp-risk-icon" />
                    <span className="mcp-risk-title">
                      Custom MCP servers introduce risk. <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" className="mcp-risk-link">Learn more</a>
                    </span>
                  </div>
                  <label className="mcp-risk-checkbox-label">
                    <input
                      type="checkbox"
                      checked={riskAcknowledged}
                      onChange={(e) => setRiskAcknowledged(e.target.checked)}
                      id="risk-consent-checkbox"
                    />
                    <span className="mcp-risk-text">
                      <strong>I understand and want to continue</strong>
                      <span className="mcp-risk-desc">
                        This MCP server runs outside AMETHYST&apos;s standard review. Ensure you trust the server source and authors before connecting.
                      </span>
                    </span>
                  </label>
                </div>

                {/* Footer Actions */}
                <div className="mcp-modal-footer">
                  <a
                    href="https://modelcontextprotocol.io"
                    target="_blank"
                    rel="noreferrer"
                    className="mcp-guide-link"
                  >
                    <Icon name="book" size={13} />
                    <span>Read the guide</span>
                  </a>
                  <motion.button
                    type="submit"
                    className="apple-action-btn apple-action-btn--primary mcp-create-btn"
                    disabled={!canSubmit}
                    whileHover={canSubmit ? { scale: 1.03 } : {}}
                    whileTap={canSubmit ? { scale: 0.96 } : {}}
                    transition={{ type: 'spring', stiffness: 450, damping: 25 }}
                  >
                    <span className="apple-btn-icon-wrap">
                      <Icon name={busy ? 'refresh' : 'plus'} size={12} />
                    </span>
                    <span>{busy ? 'Creating…' : 'Create'}</span>
                  </motion.button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
