import { useEffect, useState } from 'react'

import Icon from './Icon.jsx'
import { api } from '../api.js'

function EnvironmentTab() {
  const [health, setHealth] = useState(null)
  const [caps, setCaps] = useState(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => {})
    api.capabilities?.().then(setCaps).catch(() => {})
  }, [])

  if (!health) {
    return <p className="artifact-empty-loading">Loading environment...</p>
  }

  const providers = health.providers || []
  const tools = health.tools || 0
  const skills = health.skills || 0
  const connectors = (caps?.connectors || []).filter((c) => c.enabled)
  const errors = health.connector_errors || {}
  const awaiting = health.connectors_awaiting_sign_in || []

  return (
    <div className="artifact-env">
      <section className="artifact-env-section">
        <h4 className="artifact-env-heading">Providers</h4>
        {providers.length === 0 ? (
          <p className="artifact-env-empty">No providers configured</p>
        ) : (
          <ul className="artifact-env-list">
            {providers.map((p) => (
              <li key={p} className="artifact-env-item">
                <Icon name="check" size={12} className="artifact-env-icon artifact-env-icon--ok" />
                <span>{p}</span>
                {health.providers_unavailable?.[p] && (
                  <span className="artifact-env-warn">{health.providers_unavailable[p]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="artifact-env-section">
        <h4 className="artifact-env-heading">Connectors</h4>
        {connectors.length === 0 ? (
          <p className="artifact-env-empty">No connectors active</p>
        ) : (
          <ul className="artifact-env-list">
            {connectors.map((c) => {
              const err = errors[c.name]
              const waiting = awaiting.includes(c.name)
              const status = err ? 'error' : waiting ? 'awaiting' : 'ok'
              return (
                <li key={c.name} className="artifact-env-item">
                  <Icon
                    name={status === 'ok' ? 'check' : status === 'awaiting' ? 'alert' : 'alert'}
                    size={12}
                    className={`artifact-env-icon artifact-env-icon--${status}`}
                  />
                  <span>{c.title || c.name}</span>
                  {c.live?.tools > 0 && <span className="artifact-env-badge">{c.live.tools} tools</span>}
                  {err && <span className="artifact-env-warn">{err}</span>}
                  {waiting && <span className="artifact-env-warn">Sign in required</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="artifact-env-section">
        <h4 className="artifact-env-heading">System</h4>
        <ul className="artifact-env-list">
          <li className="artifact-env-item">
            <span className="artifact-env-label">Tools</span>
            <span>{tools} ({tools - (health.mcp_tools || 0)} builtin + {health.mcp_tools || 0} MCP)</span>
          </li>
          <li className="artifact-env-item">
            <span className="artifact-env-label">Skills</span>
            <span>{skills}{health.skill_errors > 0 && <span className="artifact-env-warn"> ({health.skill_errors} failed)</span>}</span>
          </li>
          {health.tiers && Object.keys(health.tiers).length > 0 && (
            <li className="artifact-env-item">
              <span className="artifact-env-label">Tiers</span>
              <span>{Object.entries(health.tiers).map(([k, v]) => `${k}: ${v.provider}/${v.model}`).join(', ')}</span>
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}

function ChangesTab() {
  const [git, setGit] = useState(null)

  useEffect(() => {
    api.gitStatus().then(setGit).catch(() => {})
  }, [])

  if (!git) {
    return <p className="artifact-empty-loading">Loading changes...</p>
  }

  if (git.error) {
    return <p className="artifact-empty-note">Not a git repository or git unavailable.</p>
  }

  if (git.clean) {
    return (
      <div className="artifact-empty-clean">
        <Icon name="check" size={16} className="artifact-empty-clean-icon" />
        <p>Working tree clean</p>
        <span className="artifact-empty-path">{git.path}</span>
      </div>
    )
  }

  return (
    <div className="artifact-changes">
      <p className="artifact-changes-count">{git.changed_files} changed file{git.changed_files !== 1 ? 's' : ''}</p>
      <ul className="artifact-changes-list">
        {git.files.map((line, i) => {
          const status = line.substring(0, 2).trim()
          const file = line.substring(3)
          return (
            <li key={i} className="artifact-changes-item">
              <span className={`artifact-changes-badge artifact-changes-badge--${status === '??' ? 'new' : status.includes('D') ? 'del' : 'mod'}`}>
                {status}
              </span>
              <span className="artifact-changes-file">{file}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function WorkflowsTab() {
  const [automations, setAutomations] = useState([])

  useEffect(() => {
    api.automations?.().then((data) => setAutomations(data?.automations || [])).catch(() => {})
  }, [])

  if (automations.length === 0) {
    return (
      <div className="artifact-empty-clean">
        <Icon name="search" size={16} className="artifact-empty-clean-icon" />
        <p>No workflows configured</p>
        <span className="artifact-empty-path">Automations run on a schedule or on demand.</span>
      </div>
    )
  }

  return (
    <div className="artifact-workflows">
      <ul className="artifact-workflows-list">
        {automations.map((a) => (
          <li key={a.id} className="artifact-workflows-item">
            <div className="artifact-workflows-head">
              <span className="artifact-workflows-name">{a.name}</span>
              <span className={`artifact-workflows-status artifact-workflows-status--${a.enabled ? 'on' : 'off'}`}>
                {a.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {a.last_status && (
              <span className={`artifact-workflows-last artifact-workflows-last--${a.last_status}`}>
                Last: {a.last_status}{a.last_run_at ? ` ${new Date(a.last_run_at).toLocaleString()}` : ''}
              </span>
            )}
            {a.next_run_at && (
              <span className="artifact-workflows-next">Next: {new Date(a.next_run_at).toLocaleString()}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const TABS = [
  { id: 'environment', label: 'Environment', icon: 'search' },
  { id: 'changes', label: 'Changes', icon: 'page' },
  { id: 'workflows', label: 'Workflows', icon: 'search' },
]

export default function ArtifactEmptyState() {
  const [tab, setTab] = useState('environment')

  return (
    <div className="artifact-empty">
      <div className="artifact-empty-tabs" role="tablist" aria-label="Artifact panel info">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`artifact-empty-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="artifact-empty-body" role="tabpanel">
        {tab === 'environment' && <EnvironmentTab />}
        {tab === 'changes' && <ChangesTab />}
        {tab === 'workflows' && <WorkflowsTab />}
      </div>
    </div>
  )
}
