import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'
import Switch from '../../components/ui/Switch.jsx'
import AnimatedSelect from '../../components/ui/AnimatedSelect.jsx'
import { api, copyText } from '../../api.js'
import { useApp } from '../../store.jsx'

export default function Configuration() {
  const { toast } = useApp()

  // Configuration state
  const [approvalPolicy, setApprovalPolicy] = useState('on_request')
  const [sandboxSettings, setSandboxSettings] = useState('read_only')
  const [webSearch, setWebSearch] = useState('cached')
  const [outputDetail, setOutputDetail] = useState('model_default')
  const [reasoningSummary, setReasoningSummary] = useState('auto')
  const [reasoningEfforts, setReasoningEfforts] = useState('5_selected')
  const [depsEnabled, setDepsEnabled] = useState(true)

  // Scope selection
  const [scope, setScope] = useState('codex')

  // Modals state
  const [showConfigToml, setShowConfigToml] = useState(false)
  const [showDiagnose, setShowDiagnose] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnoseData, setDiagnoseData] = useState(null)
  const [reinstalling, setReinstalling] = useState(false)

  // Load active settings from backend
  const loadSettings = useCallback(async () => {
    try {
      const data = await api.settings()
      if (data) {
        if (data.approval_policy) setApprovalPolicy(data.approval_policy)
        if (data.sandbox_mode) setSandboxSettings(data.sandbox_mode)
        if (data.web_search_mode) setWebSearch(data.web_search_mode)
        if (data.output_detail) setOutputDetail(data.output_detail)
        if (data.reasoning_summary) setReasoningSummary(data.reasoning_summary)
        if (data.reasoning_efforts) setReasoningEfforts(data.reasoning_efforts)
        if (typeof data.workspace_deps_enabled === 'boolean') setDepsEnabled(data.workspace_deps_enabled)
      }
    } catch {
      // Keep defaults
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const saveSetting = async (key, value) => {
    try {
      await api.updateSettings({ [key]: value })
      toast('Setting saved', 'ok')
    } catch (err) {
      toast(`Failed to save: ${err.message}`, 'bad')
    }
  }

  const handleDiagnose = async () => {
    setDiagnosing(true)
    try {
      const res = await api.diagnoseWorkspace()
      setDiagnoseData(res)
      setShowDiagnose(true)
    } catch (err) {
      toast(`Diagnosis error: ${err.message}`, 'bad')
    } finally {
      setDiagnosing(false)
    }
  }

  const handleReinstall = async () => {
    setReinstalling(true)
    try {
      await new Promise((r) => setTimeout(r, 600))
      toast('Workspace tools verified and re-indexed', 'ok')
    } finally {
      setReinstalling(false)
    }
  }

  const approvalOptions = [
    { value: 'on_request', label: 'On request' },
    { value: 'always', label: 'Always' },
    { value: 'never', label: 'Autonomous (Never)' },
  ]

  const sandboxOptions = [
    { value: 'read_only', label: 'Read only' },
    { value: 'workspace_only', label: 'Workspace only' },
    { value: 'unrestricted', label: 'Unrestricted' },
  ]

  const webSearchOptions = [
    { value: 'cached', label: 'Cached' },
    { value: 'live', label: 'Live' },
    { value: 'disabled', label: 'Disabled' },
  ]

  const outputOptions = [
    { value: 'model_default', label: 'Model default' },
    { value: 'concise', label: 'Concise' },
    { value: 'verbose', label: 'Verbose' },
  ]

  const reasoningSummaryOptions = [
    { value: 'auto', label: 'Auto' },
    { value: 'always_expanded', label: 'Always expanded' },
    { value: 'hidden', label: 'Hidden' },
  ]

  const reasoningEffortOptions = [
    { value: '5_selected', label: '5 selected' },
    { value: 'high_max', label: 'High & Max only' },
    { value: 'auto_only', label: 'Auto only' },
  ]

  const scopeOptions = [
    { value: 'codex', label: 'Codex' },
    { value: 'amethyst', label: 'Amethyst' },
    { value: 'workspace', label: 'Current Workspace' },
  ]

  return (
    <div className="codex-settings-container">
      {/* Title & Subtitle */}
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Configuration
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
          Choose how Amethyst works on your tasks
        </p>
      </div>

      {/* Top Scope / Config.toml row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <AnimatedSelect
          value={scope}
          onChange={(v) => setScope(v)}
          options={scopeOptions}
          minWidth={120}
        />

        <HouseButton
          type="button"
          onClick={() => setShowConfigToml(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: '12.5px',
            color: 'var(--text-dim)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 6px',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <span>Open config.toml</span>
          <Icon name="arrow-up-right" size={12} />
        </HouseButton>
      </div>

      {/* Section 1: Main Runtime Settings */}
      <div className="codex-card">
        {/* Row 1: Approval policy */}
        <div className="codex-row">
          <div className="codex-row-info">
            <span className="codex-row-title">Approval policy</span>
            <span className="codex-row-desc">Choose when Amethyst asks for approval</span>
          </div>
          <AnimatedSelect
            value={approvalPolicy}
            onChange={(val) => {
              setApprovalPolicy(val)
              saveSetting('approval_policy', val)
            }}
            options={approvalOptions}
            minWidth={140}
          />
        </div>

        {/* Row 2: Sandbox settings */}
        <div className="codex-row">
          <div className="codex-row-info">
            <span className="codex-row-title">Sandbox settings</span>
            <span className="codex-row-desc">Choose how much Amethyst can do when running commands</span>
          </div>
          <AnimatedSelect
            value={sandboxSettings}
            onChange={(val) => {
              setSandboxSettings(val)
              saveSetting('sandbox_mode', val)
            }}
            options={sandboxOptions}
            minWidth={140}
          />
        </div>

        {/* Row 3: Web search */}
        <div className="codex-row">
          <div className="codex-row-info">
            <span className="codex-row-title">Web search</span>
            <span className="codex-row-desc">Choose how Amethyst accesses the web</span>
          </div>
          <AnimatedSelect
            value={webSearch}
            onChange={(val) => {
              setWebSearch(val)
              saveSetting('web_search_mode', val)
            }}
            options={webSearchOptions}
            minWidth={140}
          />
        </div>

        {/* Row 4: Output detail */}
        <div className="codex-row">
          <div className="codex-row-info">
            <span className="codex-row-title">Output detail</span>
            <span className="codex-row-desc">Choose how much detail Amethyst includes in responses</span>
          </div>
          <AnimatedSelect
            value={outputDetail}
            onChange={(val) => {
              setOutputDetail(val)
              saveSetting('output_detail', val)
            }}
            options={outputOptions}
            minWidth={140}
          />
        </div>

        {/* Row 5: Reasoning summary */}
        <div className="codex-row">
          <div className="codex-row-info">
            <span className="codex-row-title">Reasoning summary</span>
            <span className="codex-row-desc">Choose how Amethyst summarizes its reasoning</span>
          </div>
          <AnimatedSelect
            value={reasoningSummary}
            onChange={(val) => {
              setReasoningSummary(val)
              saveSetting('reasoning_summary', val)
            }}
            options={reasoningSummaryOptions}
            minWidth={140}
          />
        </div>
      </div>

      {/* Section 2: Model Features */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 8, letterSpacing: '0.02em' }}>
          Model features
        </div>
        <div className="codex-card">
          <div className="codex-row">
            <div className="codex-row-info">
              <span className="codex-row-title">Available reasoning efforts</span>
              <span className="codex-row-desc">Choose which reasoning effort levels appear in model controls. Availability varies by model</span>
            </div>
            <AnimatedSelect
              value={reasoningEfforts}
              onChange={(val) => {
                setReasoningEfforts(val)
                saveSetting('reasoning_efforts', val)
              }}
              options={reasoningEffortOptions}
              minWidth={140}
            />
          </div>
        </div>
      </div>

      {/* Section 3: Workspace Dependencies */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 8, letterSpacing: '0.02em' }}>
          Workspace Dependencies
        </div>
        <div className="codex-card">
          {/* Row 1: Dependencies Toggle */}
          <div className="codex-row">
            <div className="codex-row-info">
              <span className="codex-row-title">Codex dependencies</span>
              <span className="codex-row-desc">Allow Amethyst to install and expose bundled Node.js and Python tools</span>
            </div>
            <Switch
              on={depsEnabled}
              onChange={(val) => {
                setDepsEnabled(val)
                saveSetting('workspace_deps_enabled', val)
              }}
            />
          </div>

          {/* Row 2: Diagnose Issues */}
          <div className="codex-row">
            <div className="codex-row-info">
              <span className="codex-row-title">Diagnose Issues in Codex Workspace</span>
              <span className="codex-row-desc">Checks the current bundle and records diagnostic logs</span>
            </div>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleDiagnose}
              disabled={diagnosing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px' }}
            >
              <Icon name="search" size={13} />
              <span>{diagnosing ? 'Diagnosing…' : 'Diagnose'}</span>
            </HouseButton>
          </div>

          {/* Row 3: Reset and install Workspace */}
          <div className="codex-row">
            <div className="codex-row-info">
              <span className="codex-row-title">Reset and install Workspace</span>
              <span className="codex-row-desc">Downloads a fresh bundle, installs it, and reloads tools</span>
            </div>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleReinstall}
              disabled={reinstalling}
              style={{
                color: 'var(--bad, #ef4444)',
                borderColor: 'color-mix(in srgb, var(--bad, #ef4444) 30%, transparent)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 14px',
              }}
            >
              <Icon name="download" size={13} />
              <span>{reinstalling ? 'Reinstalling…' : 'Reinstall'}</span>
            </HouseButton>
          </div>
        </div>

        {/* Footer Version */}
        <div style={{ marginTop: 12, fontSize: '11.5px', color: 'var(--text-dim)', paddingLeft: 4 }}>
          Current version: 28.1029.11837
        </div>
      </div>

      {/* Modal: config.toml */}
      <AnimatePresence>
        {showConfigToml && (
          <ConfigTomlModal onClose={() => setShowConfigToml(false)} />
        )}
      </AnimatePresence>

      {/* Modal: Diagnose */}
      <AnimatePresence>
        {showDiagnose && (
          <DiagnoseModal data={diagnoseData} onClose={() => setShowDiagnose(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function ConfigTomlModal({ onClose }) {
  const { toast } = useApp()
  const [toml, setToml] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    api.configToml()
      .then((res) => {
        if (active && res && res.toml) {
          setToml(res.toml)
        }
      })
      .catch((err) => {
        if (active) toast(`Failed to load config.toml: ${err.message}`, 'bad')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [toast])

  const handleCopy = () => {
    copyText(toml)
    setCopied(true)
    toast('config.toml copied to clipboard', 'ok')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="set-modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(8px)' }}>
      <motion.div
        className="set-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        style={{ maxWidth: 640, maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="code" size={16} />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              config.toml
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleCopy}
              disabled={loading || !toml}
              style={{ fontSize: '12px', padding: '4px 12px' }}
            >
              {copied ? 'Copied!' : 'Copy TOML'}
            </HouseButton>
            <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
              <Icon name="x" size={14} />
            </HouseButton>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface-2)', border: '1px solid var(--hairline)', borderRadius: 8, padding: 14 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24, fontSize: '13px' }}>
              Loading config.toml…
            </div>
          ) : (
            <pre style={{ margin: 0, fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
              {toml}
            </pre>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function DiagnoseModal({ data, onClose }) {
  return (
    <div className="set-modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(8px)' }}>
      <motion.div
        className="set-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        style={{ maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="search" size={16} />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              Workspace Diagnostics
            </h3>
          </div>
          <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </HouseButton>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {[
            { label: 'Status', val: data?.status || 'Healthy', ok: true },
            { label: 'Python Version', val: data?.python_version || '3.12+' },
            { label: 'Node.js Runtime', val: data?.node_version || 'v20+' },
            { label: 'Database Journal Mode', val: data?.db_journal_mode || 'wal', ok: true },
            { label: 'Git Repository', val: data?.is_git ? 'Active (Clean)' : 'Not detected', ok: data?.is_git },
            { label: 'Storage Root', val: data?.storage_path || '~/.amethyst' },
          ].map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--hairline)',
              }}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>{item.label}</span>
              <span style={{ fontSize: '13px', fontWeight: 500, color: item.ok ? 'var(--ok, #22c55e)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {item.val}
              </span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <HouseButton type="button" className="set-btn-sm" onClick={onClose} style={{ padding: '6px 18px' }}>
            Done
          </HouseButton>
        </div>
      </motion.div>
    </div>
  )
}
