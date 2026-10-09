import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ClipboardPaste,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  X,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { api } from '../../api.js'

export function parseMcpArguments(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function parseMcpEnvironment(value) {
  const env = {}
  for (const original of String(value || '').split(/\r?\n/)) {
    const line = original.trim()
    if (!line) continue
    const equals = line.indexOf('=')
    if (equals <= 0) return { ok: false, error: `Use KEY=value on line: "${line}"` }
    const key = line.slice(0, equals).trim()
    const secret = line.slice(equals + 1)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return { ok: false, error: `Invalid environment variable name: "${key}"` }
    }
    env[key] = secret
  }
  return { ok: true, env }
}

export function parseMcpHeaders(value) {
  const headers = {}
  for (const original of String(value || '').split(/\r?\n/)) {
    const line = original.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon <= 0) return { ok: false, error: `Use Header: value on line: "${line}"` }
    const key = line.slice(0, colon).trim()
    const secret = line.slice(colon + 1).trim()
    if (!key) return { ok: false, error: `Empty header name in "${line}"` }
    headers[key] = secret
  }
  return { ok: true, headers }
}

const EMPTY_DRAFT = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  type: 'http',
  url: '',
  headers: '',
}

export const MCP_PRESETS = [
  {
    name: 'filesystem',
    label: 'Filesystem',
    description: 'Local file read/write access',
    draft: {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-filesystem\n/home',
      env: '',
      type: 'http',
      url: '',
      headers: '',
    },
  },
  {
    name: 'fetch',
    label: 'Fetch (HTTP)',
    description: 'Web fetching & markdown extraction',
    draft: {
      name: 'fetch',
      transport: 'stdio',
      command: 'uvx',
      args: 'mcp-server-fetch',
      env: '',
      type: 'http',
      url: '',
      headers: '',
    },
  },
  {
    name: 'brave-search',
    label: 'Brave Search',
    description: 'Web search via Brave API',
    draft: {
      name: 'brave-search',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-brave-search',
      env: 'BRAVE_API_KEY=YOUR_BRAVE_API_KEY',
      type: 'http',
      url: '',
      headers: '',
    },
  },
  {
    name: 'playwright',
    label: 'Playwright',
    description: 'Browser automation via Playwright',
    draft: {
      name: 'playwright',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@playwright/mcp@latest',
      env: '',
      type: 'http',
      url: '',
      headers: '',
    },
  },
  {
    name: 'github',
    label: 'GitHub MCP',
    description: 'Inspect repositories, issues & PRs',
    draft: {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-github',
      env: 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...',
      type: 'http',
      url: '',
      headers: '',
    },
  },
  {
    name: 'postgres',
    label: 'PostgreSQL',
    description: 'Query database schema & rows',
    draft: {
      name: 'postgres',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-postgres\npostgresql://localhost/mydb',
      env: '',
      type: 'http',
      url: '',
      headers: '',
    },
  },
  {
    name: 'remote-endpoint',
    label: 'Remote SSE',
    description: 'Streamable SSE endpoint',
    draft: {
      name: 'remote-endpoint',
      transport: 'remote',
      command: '',
      args: '',
      env: '',
      type: 'sse',
      url: 'http://localhost:8080/sse',
      headers: 'Authorization: Bearer secret',
    },
  },
]

export default function McpServersPanel({ embedded = false, newOpen = false, setNewOpen, query = '' }) {
  const [servers, setServers] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | serverName
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [probe, setProbe] = useState({})
  const [expandedTools, setExpandedTools] = useState({})
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  useEffect(() => {
    if (newOpen) {
      setDraft(EMPTY_DRAFT)
      setEditing('new')
      setError(null)
      setNotice(null)
      if (setNewOpen) setNewOpen(false)
    }
  }, [newOpen, setNewOpen])

  const load = useCallback(async () => {
    setBusy('load')
    setError(null)
    try {
      const res = await api.mcpServersList()
      const list = Array.isArray(res) ? res : res?.servers || []
      setServers(list)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const closeEditor = () => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
  }

  const startEdit = (server) => {
    const isRemote = server.url || server.transport === 'sse' || server.transport === 'streamable-http'
    setDraft({
      name: server.name || '',
      transport: isRemote ? 'remote' : 'stdio',
      command: server.command || '',
      args: Array.isArray(server.args) ? server.args.join('\n') : '',
      env: (server.envKeys || []).map((k) => `${k}=`).join('\n'),
      type: server.type || (server.transport === 'sse' ? 'sse' : 'http'),
      url: server.url || '',
      headers: (server.headerKeys || []).map((k) => `${k}: `).join('\n'),
    })
    setEditing(server.name)
    setError(null)
    setNotice(null)
  }

  const save = async () => {
    const name = draft.name.trim().toLowerCase()
    if (!name || !/^[a-z0-9_-]+$/.test(name)) {
      setError('Server name must contain only lowercase letters, numbers, hyphens, and underscores.')
      return
    }

    let payload = { name }
    if (draft.transport === 'remote') {
      const url = draft.url.trim()
      if (!url || !/^https?:\/\//i.test(url)) {
        setError('A valid http:// or https:// URL is required.')
        return
      }
      const parsed = parseMcpHeaders(draft.headers)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      payload.type = draft.type
      payload.url = url
      payload.headers = parsed.headers
    } else {
      const command = draft.command.trim()
      if (!command) {
        setError('A command (e.g. npx or python3) is required for stdio servers.')
        return
      }
      const parsed = parseMcpEnvironment(draft.env)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      payload.command = command
      payload.args = parseMcpArguments(draft.args)
      payload.env = parsed.env
    }

    setBusy('save')
    setError(null)
    try {
      const isNew = editing === 'new'
      await api.mcpServerSave(name, payload, isNew)
      setNotice(isNew ? `Saved MCP server "${name}".` : `Updated MCP server "${name}".`)
      closeEditor()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (server) => {
    setBusy(`toggle:${server.name}`)
    setError(null)
    try {
      await api.mcpServerToggle(server.name, !server.enabled)
      setNotice(`Turned "${server.name}" ${server.enabled ? 'off' : 'on'}.`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const testServer = async (server) => {
    setBusy(`test:${server.name}`)
    setError(null)
    setProbe((prev) => {
      const next = { ...prev }
      delete next[server.name]
      return next
    })
    try {
      const res = await api.mcpServerTest(server.name)
      setProbe((prev) => ({ ...prev, [server.name]: res }))
    } catch (cause) {
      setProbe((prev) => ({
        ...prev,
        [server.name]: { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      }))
    } finally {
      setBusy(null)
    }
  }

  const removeServer = async (server) => {
    if (!window.confirm(`Delete MCP server "${server.name}"? This removes it from configuration.`)) {
      return
    }
    setBusy(`delete:${server.name}`)
    setError(null)
    try {
      await api.mcpServerDelete(server.name)
      setNotice(`Removed server "${server.name}".`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const importServers = async () => {
    if (!importText.trim()) return
    setBusy('import')
    setError(null)
    try {
      const res = await api.mcpServersImport(importText)
      const added = res.added || []
      setNotice(added.length > 0 ? `Imported ${added.length} server(s): ${added.join(', ')}.` : 'No new servers found to import.')
      setImportText('')
      setImportOpen(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mcp-panel-root">
      {/* Header bar */}
      <div className="mcp-panel-header">
        {!embedded ? (
          <div>
            <h3 className="mcp-panel-title">Custom MCP Servers</h3>
            <p className="mcp-panel-desc">
              Local stdio command tools or remote HTTP/SSE endpoints connected via Model Context Protocol.
            </p>
          </div>
        ) : (
          <div />
        )}
        <div className="mcp-panel-actions">
          <button
            type="button"
            className="mcp-btn mcp-btn-secondary"
            onClick={() => setImportOpen(true)}
            title="Import from Claude Desktop or Cursor JSON format"
          >
            <ClipboardPaste size={14} />
            <span>Import JSON</span>
          </button>
          <button
            type="button"
            className="mcp-btn mcp-btn-primary"
            onClick={() => {
              setDraft(EMPTY_DRAFT)
              setEditing('new')
              setError(null)
              setNotice(null)
            }}
          >
            <Plus size={14} />
            <span>Add Server</span>
          </button>
          <button
            type="button"
            className="mcp-icon-btn"
            onClick={load}
            disabled={busy === 'load'}
            title="Refresh servers"
          >
            <RefreshCw size={15} className={busy === 'load' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {notice && (
        <div className="mcp-notice mcp-notice-info">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="mcp-notice-close">
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="mcp-notice mcp-notice-error">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="mcp-notice-close">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Editor Drawer / Modal */}
      {editing !== null && (
        <div className="mcp-editor-card">
          <div className="mcp-editor-head">
            <h4 className="mcp-editor-title">
              {editing === 'new' ? 'Add Custom MCP Server' : `Edit Server "${editing}"`}
            </h4>
            <button type="button" onClick={closeEditor} className="mcp-icon-btn" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className="mcp-form-body">
            {/* Quick Presets selector */}
            {editing === 'new' && (
              <div className="mcp-field-row">
                <div className="flex items-center justify-between mb-1">
                  <label className="mcp-field-label">Quick Presets</label>
                  <span className="text-3xs text-dim">Click to autofill config</span>
                </div>
                <div className="mcp-presets-bar">
                  {MCP_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className="mcp-preset-chip"
                      onClick={() => {
                        setDraft({ ...p.draft })
                        setError(null)
                      }}
                      title={p.description}
                    >
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Transport type */}
            <div className="mcp-field-row">
              <label className="mcp-field-label">Transport Type</label>
              <div className="mcp-radio-pills">
                <button
                  type="button"
                  className={`mcp-pill-choice ${draft.transport === 'stdio' ? 'is-active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, transport: 'stdio' }))}
                >
                  <ServerCog size={13} />
                  <span>Local Command (stdio)</span>
                </button>
                <button
                  type="button"
                  className={`mcp-pill-choice ${draft.transport === 'remote' ? 'is-active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, transport: 'remote' }))}
                >
                  <Globe size={13} />
                  <span>Remote URL (HTTP / SSE)</span>
                </button>
              </div>
            </div>

            {/* Server name */}
            <div className="mcp-field-row">
              <label className="mcp-field-label">
                Server Name <span className="mcp-required">*</span>
              </label>
              <input
                className="mcp-input"
                placeholder="e.g. playwright, tavily, brave-search"
                value={draft.name}
                disabled={editing !== 'new'}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.toLowerCase() }))}
              />
              <span className="mcp-field-hint">Identifier used in tools/call prefix</span>
            </div>

            {draft.transport === 'stdio' ? (
              <>
                <div className="mcp-field-row">
                  <label className="mcp-field-label">
                    Command <span className="mcp-required">*</span>
                  </label>
                  <input
                    className="mcp-input font-mono"
                    placeholder="npx, python3, uvx, node"
                    value={draft.command}
                    onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
                  />
                </div>
                <div className="mcp-field-row">
                  <label className="mcp-field-label">Arguments (one per line)</label>
                  <textarea
                    className="mcp-textarea font-mono"
                    rows={3}
                    placeholder={`-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir`}
                    value={draft.args}
                    onChange={(e) => setDraft((d) => ({ ...d, args: e.target.value }))}
                  />
                </div>
                <div className="mcp-field-row">
                  <label className="mcp-field-label">Environment Variables (KEY=value per line)</label>
                  <textarea
                    className="mcp-textarea font-mono"
                    rows={3}
                    placeholder={`GITHUB_TOKEN=ghp_...\nTAVILY_API_KEY=tvly-...`}
                    value={draft.env}
                    onChange={(e) => setDraft((d) => ({ ...d, env: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="mcp-field-row">
                  <label className="mcp-field-label">Protocol</label>
                  <div className="mcp-radio-pills">
                    <button
                      type="button"
                      className={`mcp-pill-choice ${draft.type === 'http' ? 'is-active' : ''}`}
                      onClick={() => setDraft((d) => ({ ...d, type: 'http' }))}
                    >
                      HTTP (Streamable JSON-RPC)
                    </button>
                    <button
                      type="button"
                      className={`mcp-pill-choice ${draft.type === 'sse' ? 'is-active' : ''}`}
                      onClick={() => setDraft((d) => ({ ...d, type: 'sse' }))}
                    >
                      Server-Sent Events (SSE)
                    </button>
                  </div>
                </div>
                <div className="mcp-field-row">
                  <label className="mcp-field-label">
                    Server URL <span className="mcp-required">*</span>
                  </label>
                  <input
                    className="mcp-input font-mono"
                    placeholder="https://mcp.tavily.com/mcp/ or http://localhost:8080/sse"
                    value={draft.url}
                    onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                  />
                </div>
                <div className="mcp-field-row">
                  <label className="mcp-field-label">HTTP Headers (Header: value per line)</label>
                  <textarea
                    className="mcp-textarea font-mono"
                    rows={3}
                    placeholder={`Authorization: Bearer token...\nX-Custom-Key: secret...`}
                    value={draft.headers}
                    onChange={(e) => setDraft((d) => ({ ...d, headers: e.target.value }))}
                  />
                </div>
              </>
            )}

            <div className="mcp-form-footer">
              <button type="button" className="mcp-btn mcp-btn-secondary" onClick={closeEditor}>
                Cancel
              </button>
              <button
                type="button"
                className="mcp-btn mcp-btn-primary"
                onClick={save}
                disabled={busy === 'save'}
              >
                {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : null}
                <span>{editing === 'new' ? 'Save Server' : 'Update Server'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importOpen && (
        <div className="mcp-modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="mcp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="mcp-editor-head">
              <h4 className="mcp-editor-title">Import MCP Servers</h4>
              <button type="button" onClick={() => setImportOpen(false)} className="mcp-icon-btn">
                <X size={16} />
              </button>
            </div>
            <p className="mcp-modal-desc">
              Paste the <code className="font-mono">mcpServers</code> JSON configuration from Claude Desktop, Cursor, or VSCode:
            </p>
            <textarea
              className="mcp-textarea font-mono"
              rows={8}
              placeholder={`{\n  "mcpServers": {\n    "playwright": {\n      "command": "npx",\n      "args": ["-y", "@playwright/mcp@latest"]\n    }\n  }\n}`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="mcp-form-footer">
              <button type="button" className="mcp-btn mcp-btn-secondary" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="mcp-btn mcp-btn-primary"
                onClick={importServers}
                disabled={busy === 'import' || !importText.trim()}
              >
                {busy === 'import' ? <Loader2 size={13} className="animate-spin" /> : null}
                <span>Import Servers</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Servers List */}
      <div className="mcp-servers-grid">
        {servers === null ? (
          <div className="mcp-loading-state">
            <Loader2 size={18} className="animate-spin text-dim" />
            <span>Loading custom MCP servers…</span>
          </div>
        ) : servers.length === 0 ? (
          <div className="mcp-empty-state">
            <ServerCog size={28} className="text-dim opacity-40 mb-2" />
            <div className="font-medium text-ink">No Custom MCP Servers Configured</div>
            <div className="text-dim text-xs mt-1">
              Add a stdio command server or remote HTTP endpoint, or paste your Claude/Cursor JSON.
            </div>
            <button
              type="button"
              className="mcp-btn mcp-btn-primary mt-4"
              onClick={() => {
                setDraft(EMPTY_DRAFT)
                setEditing('new')
              }}
            >
              <Plus size={14} />
              <span>Add Your First Server</span>
            </button>

            <div className="mcp-empty-presets mt-4">
              <span className="text-3xs text-dim block mb-2 font-medium uppercase tracking-wider">
                Or start from a preset:
              </span>
              <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-lg">
                {MCP_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="mcp-preset-chip"
                    onClick={() => {
                      setDraft({ ...p.draft })
                      setEditing('new')
                      setError(null)
                    }}
                    title={p.description}
                  >
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          (() => {
            const displayList = (servers || []).filter((s) => {
              if (!query) return true
              const q = query.toLowerCase()
              return (
                s.name?.toLowerCase().includes(q) ||
                s.command?.toLowerCase().includes(q) ||
                s.url?.toLowerCase().includes(q) ||
                s.category?.toLowerCase().includes(q)
              )
            })

            if (displayList.length === 0) {
              return (
                <div className="mcp-empty-state col-span-full">
                  <div className="font-medium text-ink">No MCP servers match &ldquo;{query}&rdquo;</div>
                  <div className="text-dim text-xs mt-1">Try another search term.</div>
                </div>
              )
            }

            return displayList.map((server) => {
              const isRemote = Boolean(server.url || server.type === 'http' || server.type === 'sse')
              const isBusy = busy === `test:${server.name}` || busy === `toggle:${server.name}`
              const probeResult = probe[server.name]
              const isEnabled = Boolean(server.enabled)
              const showTools = Boolean(expandedTools[server.name])

              return (
                <div key={server.name} className={`mcp-server-card ${isEnabled ? 'is-enabled' : 'is-disabled'}`}>
                  <div className="mcp-card-top">
                    <div className="mcp-card-ident">
                      <span className={`mcp-type-badge ${isRemote ? 'is-remote' : 'is-stdio'}`}>
                        {isRemote ? (server.type || 'http').toUpperCase() : 'STDIO'}
                      </span>
                      <span className="mcp-card-name">{server.name}</span>
                    </div>

                    <div className="mcp-card-controls">
                      {/* Toggle switch */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        className={`mcp-switch ${isEnabled ? 'is-on' : ''}`}
                        disabled={isBusy}
                        onClick={() => toggle(server)}
                        title={isEnabled ? 'Click to disable' : 'Click to enable'}
                      >
                        <span className="mcp-switch-thumb" />
                      </button>
                    </div>
                  </div>

                  <div className="mcp-card-details">
                    {isRemote ? (
                      <div className="mcp-card-command font-mono" title={server.url}>
                        {server.url}
                      </div>
                    ) : (
                      <div className="mcp-card-command font-mono" title={`${server.command} ${(server.args || []).join(' ')}`}>
                        <span className="text-ink">{server.command}</span>
                        {server.args?.length > 0 && <span className="text-dim"> {server.args.join(' ')}</span>}
                      </div>
                    )}

                    <div className="mcp-card-tags">
                      {server.envKeys?.length > 0 && (
                        <span className="mcp-tag">
                          {server.envKeys.length} env var{server.envKeys.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {server.headerKeys?.length > 0 && (
                        <span className="mcp-tag">
                          {server.headerKeys.length} header{server.headerKeys.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Live probe test result with collapsible tools */}
                  {probeResult && (
                    <div className={`mcp-probe-banner ${probeResult.ok ? 'is-ok' : 'is-error'}`}>
                      {probeResult.ok ? (
                        <div className="w-full flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-medium">
                              <CheckCircle2 size={13} className="text-live shrink-0" />
                              <span>{probeResult.total || probeResult.tools?.length || 0} tools ready</span>
                            </div>
                            {probeResult.tools?.length > 0 && (
                              <button
                                type="button"
                                className="text-3xs underline text-accent cursor-pointer"
                                onClick={() =>
                                  setExpandedTools((prev) => ({
                                    ...prev,
                                    [server.name]: !prev[server.name],
                                  }))
                                }
                              >
                                {showTools ? 'Hide' : 'View tools'}
                              </button>
                            )}
                          </div>
                          {showTools && probeResult.tools?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 pt-1.5 border-t border-hairline/40">
                              {probeResult.tools.map((t) => (
                                <span
                                  key={t.name}
                                  className="font-mono text-3xs px-1.5 py-0.5 rounded bg-surface border border-hairline"
                                  title={t.description || t.name}
                                >
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle size={13} className="shrink-0 text-stop" />
                          <span className="truncate">{probeResult.error || 'Connection probe failed.'}</span>
                        </div>
                      )}
                    </div>
                  )}

                {/* Card footer actions */}
                <div className="mcp-card-footer">
                  <button
                    type="button"
                    className="mcp-action-link"
                    disabled={isBusy}
                    onClick={() => testServer(server)}
                    title="Probe server tools connection"
                  >
                    {busy === `test:${server.name}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    <span>Test Tools</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="mcp-icon-btn-sm"
                      onClick={() => startEdit(server)}
                      title="Edit server settings"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-btn-sm mcp-danger-hover"
                      onClick={() => removeServer(server)}
                      title="Delete server"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        })()
      )}
    </div>
  </div>
)
}
