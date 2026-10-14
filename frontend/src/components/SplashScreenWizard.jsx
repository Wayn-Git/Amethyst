import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import Icon from './Icon.jsx'
import BrandMark from './BrandMark.jsx'
import AiProviderIcon from './AiProviderIcon.jsx'
import { LoaderIcon } from './LoaderIcon.jsx'
import ServiceIcon from '../views/capabilities/plugins/ServiceIcon.jsx'
import { api } from '../api.js'
import { useApp } from '../store.jsx'

/* ==========================================================================
   AMETHYST Initial Setup & Onboarding Wizard (Phase 1: Honest & Streamlined)
   - 4-step focused flow: Welcome -> Choose AI -> Connect Apps -> Ready
   - Single source of truth driven by GET /api/setup/status
   - Pre-save API key verification via POST /api/providers/{name}/verify
   - Dynamic catalogue presets with free-tier emphasis
   - Composio browser sign-in with 5-minute countdown and cancellation
   - Honest runtime indicators (e.g. Needs Node.js)
   - Persistent completion stored in SQLite app_settings
   ========================================================================== */

/* Authentic Brand SVGs for MCP Connectors */
function GoogleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
    </svg>
  )
}

function MicrosoftIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#2564CF" />
      <path d="M6.5 12.5l3.8 3.8 7.2-8.3" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 8l4 4" stroke="rgba(255,255,255,0.35)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function GithubIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function SlackIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#E01E5A" />
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.521h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#36C5F0" />
    </svg>
  )
}

function LinearIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#5E6AD2" strokeWidth="2.5" />
      <path d="M7 12h10M12 7l5 5-5 5" stroke="#5E6AD2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NotionIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.43-.812c1.073-.093 1.54.28 1.213 1.306l-2.613 13.805c-.233.933-.7 1.306-1.54 1.353l-11.897.746c-.98.047-1.4-.326-1.167-1.306l2.146-15.558zm3.266 2.659l-1.4 9.794c-.093.653.093.933.746.887l1.727-.14 1.4-9.793-2.473-.748zm5.507-.373l-1.4 9.793 2.053-.14 1.4-9.793-2.053.14z" />
    </svg>
  )
}

const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'ink', label: 'Ink' },
  { id: 'nocturne', label: 'Nocturne' },
  { id: 'nvidia', label: 'NVIDIA' },
  { id: 'paper', label: 'Paper' },
  { id: 'sand', label: 'Sand' },
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
]

const ACCENT_PRESETS = [
  { id: 'amethyst', hex: '#7132f5', label: 'Amethyst' },
  { id: 'blue', hex: '#2563eb', label: 'Cobalt' },
  { id: 'emerald', hex: '#10b981', label: 'Emerald' },
  { id: 'coral', hex: '#f43f5e', label: 'Coral' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
]

const CLOUD_APPS = [
  { slug: 'gmail', name: 'Gmail', desc: 'Read, search, and send emails.', IconComp: GoogleIcon },
  { slug: 'googlecalendar', name: 'Google Calendar', desc: 'Schedule and manage events.', IconComp: GoogleIcon },
  { slug: 'slack', name: 'Slack', desc: 'Team channels and direct messages.', IconComp: SlackIcon },
  { slug: 'github', name: 'GitHub', desc: 'Repos, PRs, and issues.', IconComp: GithubIcon },
  { slug: 'linear', name: 'Linear', desc: 'Issue tracking & tickets.', IconComp: LinearIcon },
  { slug: 'notion', name: 'Notion', desc: 'Docs, notes, and databases.', IconComp: NotionIcon },
]

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir < 0 ? 32 : -32, opacity: 0 }),
}

// -----------------------------------------------------------------------------
// STEP 1: Welcome & Environment Detection
// -----------------------------------------------------------------------------
function StepSplash({
  onStart,
  onSkip,
  setupStatus,
  browserEnabled,
  setBrowserEnabled,
  trayEnabled,
  setTrayEnabled,
}) {
  const ollama = setupStatus?.ollama
  const modelVerified = setupStatus?.model?.verified

  const statusLabel = useMemo(() => {
    if (ollama?.running && ollama?.models?.length) {
      return `Ollama is running offline with ${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'}`
    }
    if (modelVerified) {
      return `${setupStatus.model.provider || 'AI'} is connected & ready`
    }
    return 'Ready to connect local models or free cloud AI'
  }, [ollama, modelVerified, setupStatus])

  return (
    <div className="splash-step splash-step--hero">
      <div className="splash-hero-badge">
        <BrandMark size={48} glow />
      </div>

      <div className="splash-hero-header">
        <span className="splash-eyebrow">Amethyst Setup</span>
        <h1 className="splash-hero-title">Welcome to Amethyst</h1>
        <p className="splash-hero-subtitle">
          Your personal AI desktop. Fast, private, and runs directly on your computer.
        </p>
      </div>

      {/* Detection Banner */}
      <div className="splash-scan-card" style={{ maxWidth: 520, width: '100%', marginBottom: 12 }}>
        <div className="splash-scan-icon">
          <Icon name="cpu" size={20} />
        </div>
        <div className="splash-scan-info">
          <span className="splash-scan-title">System Readiness</span>
          <span className="splash-scan-desc">{statusLabel}</span>
        </div>
        <span className={`splash-status-dot ${ollama?.running || modelVerified ? 'is-active' : ''}`} />
      </div>

      {/* Privacy & Background Supervision Choices */}
      <div className="splash-consent-group">
        <label className="splash-consent-row" onClick={() => setBrowserEnabled(!browserEnabled)}>
          <div className="splash-consent-label">
            <span className="splash-consent-title">Firefox Bookmark Reading</span>
            <span className="splash-consent-desc">Search your browser bookmarks locally in Library. Never uploads data.</span>
          </div>
          <input
            type="checkbox"
            checked={browserEnabled}
            onChange={() => {}}
            style={{ accentColor: 'var(--accent, #7132f5)', cursor: 'pointer' }}
          />
        </label>

        <label
          className="splash-consent-row"
          onClick={() => {
            const next = !trayEnabled
            setTrayEnabled(next)
            window.amethystDesktop?.setTrayEnabled?.(next)
          }}
        >
          <div className="splash-consent-label">
            <span className="splash-consent-title">Keep Running in Background</span>
            <span className="splash-consent-desc">Keep automations and reminders alive in system tray when window closes.</span>
          </div>
          <input
            type="checkbox"
            checked={trayEnabled}
            onChange={() => {}}
            style={{ accentColor: 'var(--accent, #7132f5)', cursor: 'pointer' }}
          />
        </label>
      </div>

      <div className="splash-actions-row">
        <button type="button" className="splash-btn-primary" onClick={onStart}>
          <span>Get Started</span>
          <Icon name="caret-right" size={14} weight="bold" />
        </button>
        <button type="button" className="splash-btn-ghost" onClick={onSkip}>
          Skip Setup
        </button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 2: Choose Your AI (The Only Required Step)
// -----------------------------------------------------------------------------
function StepModels({ toast, setupStatus, onRefreshStatus }) {
  const [activeTab, setActiveTab] = useState('free')
  const [catalogue, setCatalogue] = useState([])
  const [configuredProviders, setConfiguredProviders] = useState([])
  const [selectedSlug, setSelectedSlug] = useState('groq')
  const [apiKey, setApiKey] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)

  const loadProviders = useCallback(async () => {
    try {
      const res = await api.providers()
      setCatalogue(res?.catalogue || [])
      setConfiguredProviders(res?.configured || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const freePresets = useMemo(
    () => catalogue.filter((p) => p.free && !p.local),
    [catalogue]
  )
  const allCloudPresets = useMemo(
    () => catalogue.filter((p) => !p.local),
    [catalogue]
  )
  const currentPreset = useMemo(
    () => catalogue.find((p) => p.slug === selectedSlug) || catalogue[0] || null,
    [catalogue, selectedSlug]
  )

  const ollama = setupStatus?.ollama

  const handleVerifyAndSave = async () => {
    if (!currentPreset) return
    const isLocal = currentPreset.local
    if (!apiKey.trim() && !isLocal) {
      toast('Please enter your API key', 'bad')
      return
    }

    setVerifying(true)
    setVerifyResult(null)

    try {
      const verifyRes = await api.verifyProvider(currentPreset.slug, {
        key: apiKey.trim(),
        base_url: customBaseUrl.trim() || undefined,
        default_model: customModel.trim() || undefined,
      })

      if (verifyRes.valid) {
        // Save provider only after verification succeeds
        await api.addProvider({
          name: currentPreset.slug,
          api_key: apiKey.trim(),
          key: apiKey.trim(),
          base_url: customBaseUrl.trim() || undefined,
          default_model: customModel.trim() || currentPreset.default_model,
        })
        await api.setPrimaryProvider(currentPreset.slug)

        setVerifyResult({
          ok: true,
          status: verifyRes.status,
          msg: verifyRes.message || 'Verified & ready to chat!',
        })
        toast(`${currentPreset.label} is verified and active!`, 'ok')
        setApiKey('')
        await loadProviders()
        if (onRefreshStatus) onRefreshStatus()
      } else {
        setVerifyResult({
          ok: false,
          status: verifyRes.status,
          msg: verifyRes.message || 'Key rejected by provider.',
        })
        toast(verifyRes.message || 'Verification failed. Nothing was saved.', 'bad')
      }
    } catch (err) {
      setVerifyResult({
        ok: false,
        status: 'error',
        msg: err.message || 'Network error during verification.',
      })
      toast(err.message, 'bad')
    } finally {
      setVerifying(false)
    }
  }

  const handleSelectOllamaModel = async (modelName) => {
    setVerifying(true)
    try {
      await api.addProvider({
        name: 'ollama',
        default_model: modelName,
      })
      await api.setPrimaryProvider('ollama')
      toast(`Ollama (${modelName}) set as default!`, 'ok')
      await loadProviders()
      if (onRefreshStatus) onRefreshStatus()
    } catch (e) {
      toast(e.message, 'bad')
    } finally {
      setVerifying(false)
    }
  }

  const [pullingModel, setPullingModel] = useState(false)
  const [pullProgress, setPullProgress] = useState(null)

  const handlePullModel = async (modelName = 'llama3.2') => {
    setPullingModel(true)
    setPullProgress({ status: 'Starting download...', percent: 0 })
    try {
      await api.pullOllamaModel(modelName, (prog) => {
        let percent = 0
        let detail = prog.status || 'Downloading...'
        if (prog.total && prog.completed) {
          percent = Math.min(100, Math.round((prog.completed / prog.total) * 100))
          const mbDone = (prog.completed / (1024 * 1024)).toFixed(0)
          const mbTotal = (prog.total / (1024 * 1024)).toFixed(0)
          detail = `${prog.status || 'Downloading'}: ${mbDone} MB / ${mbTotal} MB (${percent}%)`
        }
        setPullProgress({ status: detail, percent })
      })
      toast(`${modelName} downloaded and configured as default!`, 'ok')
      await loadProviders()
      if (onRefreshStatus) onRefreshStatus()
    } catch (e) {
      toast(e.message, 'bad')
    } finally {
      setPullingModel(false)
      setPullProgress(null)
    }
  }

  const isConfigured = (slug) => configuredProviders.some((p) => p.name === slug && p.enabled)

  return (
    <div className="splash-step">
      <div className="splash-step-header">
        <span className="splash-step-tag">Step 1 of 3</span>
        <h2 className="splash-step-title">Choose Where Your AI Runs</h2>
        <p className="splash-step-subtitle">
          Run private models locally on your machine with Ollama, or connect a high-speed cloud provider.
        </p>
      </div>

      {/* Keychain Fallback Banner if OS Keyring is unavailable (R9) */}
      {setupStatus?.keychain?.writable === false && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            marginBottom: 14,
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--confirm, #f59e0b)', fontWeight: 600, fontSize: 13 }}>
            <Icon name="warning" size={16} />
            <span>OS Keychain Unavailable on this System</span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-dim, #9ca3af)', lineHeight: 1.4 }}>
            No desktop SecretService daemon was detected. You can enable owner-only (0600) file storage (~/.amethyst/secrets.json) with your consent to save API keys reliably.
          </p>
          <div>
            <button
              type="button"
              className="splash-btn-subtle"
              style={{
                borderColor: 'rgba(245, 158, 11, 0.35)',
                color: 'var(--confirm, #f59e0b)',
                padding: '6px 12px',
                fontSize: 12,
              }}
              onClick={async () => {
                try {
                  await api.enableKeychainFallback()
                  toast('Secure file storage enabled!', 'ok')
                  if (onRefreshStatus) onRefreshStatus()
                } catch (e) {
                  toast(e.message, 'bad')
                }
              }}
            >
              <Icon name="check" size={13} />
              <span>Enable File Storage Fallback</span>
            </button>
          </div>
        </div>
      )}

      {/* Segmented Control */}
      <div className="splash-segmented-control">
        <button
          type="button"
          className={`splash-segment-btn ${activeTab === 'free' ? 'is-active' : ''}`}
          onClick={() => { setActiveTab('free'); setSelectedSlug('groq'); setVerifyResult(null) }}
        >
          <Icon name="sparkle" size={14} />
          <span>Free Cloud Model</span>
        </button>
        <button
          type="button"
          className={`splash-segment-btn ${activeTab === 'ollama' ? 'is-active' : ''}`}
          onClick={() => { setActiveTab('ollama'); setVerifyResult(null) }}
        >
          <Icon name="cpu" size={14} />
          <span>Local (Ollama)</span>
        </button>
        <button
          type="button"
          className={`splash-segment-btn ${activeTab === 'manual' ? 'is-active' : ''}`}
          onClick={() => { setActiveTab('manual'); setVerifyResult(null) }}
        >
          <Icon name="key" size={14} />
          <span>I Have a Key</span>
        </button>
      </div>

      {/* TAB 1: Free Cloud Model */}
      {activeTab === 'free' && (
        <div>
          <div className="splash-scan-grid" style={{ marginBottom: 14 }}>
            {freePresets.map((preset) => {
              const selected = selectedSlug === preset.slug
              const configured = isConfigured(preset.slug)
              return (
                <div
                  key={preset.slug}
                  className={`splash-scan-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => {
                    setSelectedSlug(preset.slug)
                    setVerifyResult(null)
                    setCustomBaseUrl('')
                    setCustomModel('')
                  }}
                  style={{
                    cursor: 'pointer',
                    borderColor: selected ? 'var(--accent, #7132f5)' : undefined,
                    background: selected ? 'rgba(113, 50, 245, 0.08)' : undefined,
                  }}
                >
                  <div className="splash-scan-icon">
                    <AiProviderIcon provider={preset.slug} size={20} />
                  </div>
                  <div className="splash-scan-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="splash-scan-title">{preset.label}</span>
                      <span className="splash-field-note-ok" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(20, 158, 97, 0.15)', color: '#34d399' }}>Free Tier</span>
                    </div>
                    <span className="splash-scan-desc">{preset.default_model}</span>
                  </div>
                  <span className={`splash-status-dot ${configured ? 'is-ok' : selected ? 'is-active' : ''}`} />
                </div>
              )
            })}
          </div>

          {currentPreset && (
            <div className="splash-card">
              <div className="splash-card-row">
                <div className="splash-card-info">
                  <div className="splash-title-row">
                    <span className="splash-card-title">{currentPreset.label} API Key</span>
                    {currentPreset.keys_url && (
                      <a
                        href={currentPreset.keys_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="splash-text-link"
                      >
                        Get free API key ↗
                      </a>
                    )}
                  </div>
                  <p className="splash-card-desc">{currentPreset.note || 'Fast response times with free no-card tier.'}</p>
                </div>
              </div>

              <div className="splash-input-row" style={{ marginTop: 10 }}>
                <input
                  type="password"
                  className="splash-input"
                  placeholder="Paste your API key here..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyAndSave() }}
                />
                <button
                  type="button"
                  className="splash-btn-primary"
                  disabled={verifying || !apiKey.trim()}
                  onClick={handleVerifyAndSave}
                >
                  {verifying ? (
                    <>
                      <LoaderIcon type="pixels" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify &amp; Save</span>
                      <Icon name="check" size={13} weight="bold" />
                    </>
                  )}
                </button>
              </div>

              {verifyResult && (
                <div
                  className={`splash-test-inline ${verifyResult.ok ? 'is-ok' : 'is-err'}`}
                  style={{ marginTop: 10 }}
                >
                  <Icon name={verifyResult.ok ? 'check' : 'warning-circle'} size={14} />
                  <span>{verifyResult.msg}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Local (Ollama) */}
      {activeTab === 'ollama' && (
        <div className="splash-card">
          <div className="splash-card-row">
            <div className="splash-card-icon">
              <Icon name="cpu" size={24} />
            </div>
            <div className="splash-card-info">
              <div className="splash-title-row">
                <span className="splash-card-title">Local Ollama Engine</span>
                <span className="splash-status-dot-text">
                  <span className={`splash-dot-indicator ${ollama?.running ? 'is-active' : ''}`} />
                  {ollama?.running ? 'Running' : ollama?.installed ? 'Installed (Offline)' : 'Not Found'}
                </span>
              </div>
              <p className="splash-card-desc">
                Execute open weights completely offline. Nothing leaves your machine.
              </p>
            </div>
            <button type="button" className="splash-btn-subtle" onClick={onRefreshStatus}>
              <Icon name="arrows-clockwise" size={13} />
              <span>Refresh</span>
            </button>
          </div>

          {ollama?.running ? (
            <div style={{ marginTop: 12 }}>
              {ollama.models?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-dim, #94a3b8)' }}>
                    Detected {ollama.models.length} model{ollama.models.length === 1 ? '' : 's'}. Choose one to activate:
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ollama.models.map((mod) => (
                      <button
                        key={mod}
                        type="button"
                        className="splash-btn-subtle"
                        style={{ padding: '6px 12px' }}
                        disabled={verifying}
                        onClick={() => handleSelectOllamaModel(mod)}
                      >
                        <Icon name="check" size={12} />
                        <span>{mod}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-dim, #94a3b8)' }}>
                    Ollama is running, but no models are installed yet.
                  </span>

                  {pullingModel ? (
                    <div
                      style={{
                        padding: '12px 14px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: 8,
                        border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                        <span style={{ color: 'var(--text, #fff)', fontWeight: 500 }}>
                          {pullProgress?.status || 'Downloading model...'}
                        </span>
                        <span style={{ color: 'var(--accent, #7132f5)', fontWeight: 600 }}>
                          {pullProgress?.percent || 0}%
                        </span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: 6,
                          background: 'rgba(255, 255, 255, 0.1)',
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pullProgress?.percent || 0}%`,
                            height: '100%',
                            background: 'var(--accent, #7132f5)',
                            transition: 'width 0.2s ease',
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className="splash-btn-primary"
                        style={{ padding: '8px 16px', fontSize: 13 }}
                        onClick={() => handlePullModel('llama3.2')}
                      >
                        <Icon name="arrow-down-tray" size={14} />
                        <span>Download Recommended Model (llama3.2)</span>
                      </button>
                    </div>
                  )}

                  <div className="splash-code-block" style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-faint, #64748b)', display: 'block', marginBottom: 4 }}>
                      Or install via terminal:
                    </span>
                    <pre>ollama run llama3.2</pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-dim, #94a3b8)' }}>
              Download and start Ollama to run offline models:
              <div style={{ marginTop: 8 }}>
                <a
                  href="https://ollama.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="splash-text-link"
                >
                  Download from ollama.com ↗
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: I Have an API Key */}
      {activeTab === 'manual' && (
        <div className="splash-card">
          <div className="splash-field-group">
            <label className="splash-field-label">Select Provider Preset</label>
            <select
              className="splash-input"
              value={selectedSlug}
              onChange={(e) => {
                setSelectedSlug(e.target.value)
                setVerifyResult(null)
              }}
            >
              {allCloudPresets.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label} ({p.default_model || p.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="splash-field-group" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <label className="splash-field-label">API Key</label>
              {currentPreset?.keys_url && (
                <a
                  href={currentPreset.keys_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="splash-text-link"
                >
                  Get Key ↗
                </a>
              )}
            </div>
            <div className="splash-input-row">
              <input
                type="password"
                className="splash-input"
                placeholder="Paste your API key here..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyAndSave() }}
              />
              <button
                type="button"
                className="splash-btn-primary"
                disabled={verifying || !apiKey.trim()}
                onClick={handleVerifyAndSave}
              >
                {verifying ? (
                  <>
                    <LoaderIcon type="pixels" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>Verify &amp; Save</span>
                    <Icon name="check" size={13} weight="bold" />
                  </>
                )}
              </button>
            </div>
          </div>

          {verifyResult && (
            <div
              className={`splash-test-inline ${verifyResult.ok ? 'is-ok' : 'is-err'}`}
              style={{ marginTop: 10 }}
            >
              <Icon name={verifyResult.ok ? 'check' : 'warning-circle'} size={14} />
              <span>{verifyResult.msg}</span>
            </div>
          )}

          {/* Advanced Accordion for Custom base_url / model */}
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="splash-btn-subtle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <Icon name={showAdvanced ? 'caret-up' : 'caret-down'} size={12} />
              <span>Advanced Configuration</span>
            </button>

            {showAdvanced && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label className="splash-field-label">Custom Base URL (optional)</label>
                  <input
                    type="text"
                    className="splash-input"
                    placeholder={currentPreset?.base_url || 'https://api.openai.com/v1'}
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="splash-field-label">Custom Default Model (optional)</label>
                  <input
                    type="text"
                    className="splash-input"
                    placeholder={currentPreset?.default_model || 'gpt-4o'}
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 3: Connect Apps (Optional)
// -----------------------------------------------------------------------------
function StepConnectors({ toast, setupStatus, onRefreshStatus }) {
  const [composioStatus, setComposioStatus] = useState(null)
  const [composioToolkits, setComposioToolkits] = useState([])
  const [actionBusy, setActionBusy] = useState('')
  const [connectingApps, setConnectingApps] = useState({})
  const [browserLoggingIn, setBrowserLoggingIn] = useState(false)
  const [pollCountdown, setPollCountdown] = useState(300)
  const [showLater, setShowLater] = useState(false)
  const [showGithubPat, setShowGithubPat] = useState(false)
  const [githubPatDraft, setGithubPatDraft] = useState('')
  const [githubPatSaved, setGithubPatSaved] = useState(false)
  const connectTimers = useRef({})
  const pollIdRef = useRef(null)

  const handleInstallUv = async () => {
    setActionBusy('install-uv')
    try {
      await api.installUv()
      toast('uv runtime installed successfully to ~/.amethyst/bin!', 'ok')
      if (onRefreshStatus) await onRefreshStatus()
    } catch (err) {
      toast(err.message || 'Failed to install uv', 'bad')
    } finally {
      setActionBusy('')
    }
  }

  const handleSaveGithubPat = async () => {
    const token = githubPatDraft.trim()
    if (!token) return
    setActionBusy('github-pat')
    try {
      await api.mcpSetApiKey('github', token)
      setGithubPatSaved(true)
      setGithubPatDraft('')
      setShowGithubPat(false)
      toast('GitHub Personal Access Token saved!', 'ok')
      if (onRefreshStatus) await onRefreshStatus()
    } catch (err) {
      toast(err.message || 'Failed to save GitHub token', 'bad')
    } finally {
      setActionBusy('')
    }
  }

  const loadData = useCallback(async () => {
    try {
      const [compStatus, compToolkits] = await Promise.all([
        api.composioStatus().catch(() => null),
        api.composioToolkits().catch(() => ({ toolkits: [] })),
      ])
      if (compStatus) setComposioStatus(compStatus)
      if (compToolkits?.toolkits) setComposioToolkits(compToolkits.toolkits)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    return () => {
      if (pollIdRef.current) clearInterval(pollIdRef.current)
      Object.values(connectTimers.current).forEach((id) => clearInterval(id))
    }
  }, [])

  const handleStartBrowserLogin = async () => {
    setActionBusy('composio-login')
    try {
      const res = await api.startComposioLogin()
      if (res?.redirect_url && res?.session_id) {
        window.open(res.redirect_url, '_blank')
        setBrowserLoggingIn(true)
        setPollCountdown(300)
        toast('Authorize Composio in your open browser tab', 'ok')

        const sid = res.session_id
        let remaining = 300
        const id = setInterval(async () => {
          remaining -= 3
          setPollCountdown((c) => Math.max(0, c - 3))
          if (remaining <= 0) {
            clearInterval(id)
            setBrowserLoggingIn(false)
            pollIdRef.current = null
            toast('Login session timed out', 'bad')
            return
          }
          try {
            const pollRes = await api.pollComposioLogin(sid)
            if (pollRes?.status === 'connected' || pollRes?.connected) {
              clearInterval(id)
              setBrowserLoggingIn(false)
              pollIdRef.current = null
              toast('Composio linked successfully!', 'ok')
              await loadData()
            }
          } catch {
            /* ignore polling error */
          }
        }, 3000)
        pollIdRef.current = id
      } else {
        toast('Could not start Composio browser login', 'bad')
      }
    } catch (e) {
      toast(e.message || 'Login failed', 'bad')
    } finally {
      setActionBusy('')
    }
  }

  const handleCancelLogin = () => {
    if (pollIdRef.current) clearInterval(pollIdRef.current)
    pollIdRef.current = null
    setBrowserLoggingIn(false)
    toast('Login cancelled', 'ok')
  }

  const stopConnecting = (slug) => {
    setConnectingApps((m) => {
      const next = { ...m }
      delete next[slug]
      return next
    })
  }

  const handleComposioAppConnect = async (slug, name) => {
    if (connectingApps[slug] || actionBusy === `comp:${slug}`) return
    setActionBusy(`comp:${slug}`)
    try {
      const res = await api.connectComposioToolkit(slug)
      if (res?.redirect_url) {
        window.open(res.redirect_url, '_blank')
        toast(`Complete ${name} authorization in your browser tab`, 'ok')
        setConnectingApps((m) => ({ ...m, [slug]: true }))
        let attempts = 0
        const interval = setInterval(async () => {
          attempts++
          try {
            const data = await api.composioToolkits()
            if (data?.toolkits) {
              setComposioToolkits(data.toolkits)
              const updated = data.toolkits.find((t) => t.slug === slug)
              if (updated?.connected) {
                clearInterval(interval)
                delete connectTimers.current[slug]
                stopConnecting(slug)
                toast(`${name} connected!`, 'ok')
                if (onRefreshStatus) await onRefreshStatus()
                return
              }
            }
          } catch {}
          if (attempts >= 25) {
            clearInterval(interval)
            delete connectTimers.current[slug]
            stopConnecting(slug)
            toast(`Still waiting on ${name}. Finish in the browser tab, or try Connect again.`, 'bad')
          }
        }, 3000)
        connectTimers.current[slug] = interval
      } else {
        toast(`Failed to start connection for ${name}`, 'bad')
      }
    } catch (err) {
      toast(err.message || `Failed to connect ${name}`, 'bad')
    } finally {
      setActionBusy('')
    }
  }

  const handleLocalLogin = async (name) => {
    setActionBusy(name)
    try {
      const res = await api.mcpLogin(name)
      if (res?.auth_url) {
        window.open(res.auth_url, '_blank')
        toast('Finish signing in in your browser', 'ok')
      } else if (res?.user_code) {
        toast(`Microsoft code: ${res.user_code}`, 'ok')
        if (res.verification_uri) window.open(res.verification_uri, '_blank')
      } else {
        toast(`Connecting ${name}`, 'ok')
      }
      await loadData()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setActionBusy('')
    }
  }

  const isComposioLinked = Boolean(composioStatus?.enabled || composioStatus?.has_key)
  const runtimes = setupStatus?.runtimes

  return (
    <div className="splash-step">
      <div className="splash-step-header">
        <span className="splash-step-tag">Step 2 of 3</span>
        <h2 className="splash-step-title">Connect Your Apps (Optional)</h2>
        <p className="splash-step-subtitle">
          Optional — Amethyst works fully without these. Sign in to Composio to link Gmail, Calendar, Slack, GitHub,
          Linear, and Notion with one click each. Everything else can wait.
        </p>
      </div>

      {/* Composio Cloud Apps Card */}
      <div className="splash-card" style={{ marginBottom: 16 }}>
        <div className="splash-card-row">
          <div style={{ marginRight: 8, flexShrink: 0 }}>
            <ServiceIcon card={{ slug: 'composio', name: 'Composio', domain: 'composio.dev' }} size="default" />
          </div>
          <div className="splash-card-info">
            <div className="splash-title-row">
              <span className="splash-card-title">Cloud Apps via Composio</span>
              <span className="splash-status-dot-text">
                <span className={`splash-dot-indicator ${isComposioLinked ? 'is-active' : ''}`} />
                {isComposioLinked ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <p className="splash-card-desc">
              Sign in once, then connect Gmail, Calendar, Slack, GitHub, Linear, and Notion with one click each.
            </p>
          </div>

          {!isComposioLinked && (
            <div>
              {browserLoggingIn ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="splash-countdown-badge">
                    {Math.floor(pollCountdown / 60)}:{(pollCountdown % 60).toString().padStart(2, '0')}
                  </span>
                  <button type="button" className="splash-btn-subtle" onClick={handleCancelLogin}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="splash-btn-primary"
                  disabled={actionBusy === 'composio-login'}
                  onClick={handleStartBrowserLogin}
                >
                  <span>Sign In in Browser</span>
                  <Icon name="arrow-up-right" size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Cloud Apps List — one click each, status flips on its own */}
        {isComposioLinked && (
          <div className="splash-connectors-grid" style={{ marginTop: 14 }}>
            {CLOUD_APPS.map(({ slug, name, desc, IconComp }) => {
              const item = composioToolkits.find((t) => t.slug === slug)
              const connected = Boolean(item?.connected)
              const connecting = Boolean(connectingApps[slug])
              return (
                <div key={slug} className="splash-connector-card">
                  <div className="splash-connector-head">
                    <div className="splash-connector-icon" style={{ background: 'none', padding: 0 }}>
                      <ServiceIcon card={{ slug, name }} size="small" />
                    </div>
                    <div className="splash-connector-meta">
                      <span className="splash-connector-title">{name}</span>
                      <span className="splash-connector-desc">{desc}</span>
                    </div>
                  </div>
                  <div className="splash-connector-footer">
                    {connected ? (
                      <span className="splash-field-note-ok" style={{ fontSize: 12 }}>✓ Connected</span>
                    ) : connecting ? (
                      <span className="splash-connecting-note">
                        <LoaderIcon type="pixels" />
                        <span>Connecting…</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="splash-btn-subtle"
                        disabled={actionBusy === `comp:${slug}`}
                        onClick={() => handleComposioAppConnect(slug, name)}
                      >
                        {actionBusy === `comp:${slug}` ? 'Opening…' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!isComposioLinked && (
          <p className="splash-card-desc" style={{ marginTop: 10 }}>
            After you sign in, each app connects straight from its card — no keys to paste anywhere.
          </p>
        )}
      </div>

      {/* Fine to skip — deferred, non-blocking shortcuts to Settings */}
      <div className="splash-card">
        <button
          type="button"
          className="splash-later-toggle"
          onClick={() => setShowLater(!showLater)}
          aria-expanded={showLater}
        >
          <Icon name={showLater ? 'caret-down' : 'caret-right'} size={13} />
          <span className="splash-later-title">Connect later — fine to skip</span>
          <span className="splash-later-note">Everything here is optional and stays available in Settings.</span>
        </button>

        {showLater && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>

            <p className="splash-card-desc">
              Live web search already works with no key at all. A premium provider (LangSearch, Exa, Tavily) can be
              added later under Settings → Integrations if you ever want richer results.
            </p>

            {runtimes && runtimes.uv && !runtimes.uv.available && (
              <div className="splash-card-row">
                <div className="splash-card-icon" style={{ background: 'var(--accent-soft, rgba(113, 50, 245, 0.12))' }}>
                  <Icon name="code" size={20} />
                </div>
                <div className="splash-card-info">
                  <div className="splash-title-row">
                    <span className="splash-card-title">Python Connector Runtime (uv)</span>
                    <span className="splash-badge-runtime">Needs uv</span>
                  </div>
                  <p className="splash-card-desc">
                    Only needed for standalone Python MCP connectors. Installs to ~/.amethyst/bin.
                  </p>
                </div>
                <button
                  type="button"
                  className="splash-btn-primary"
                  disabled={actionBusy === 'install-uv'}
                  onClick={handleInstallUv}
                >
                  <span>{actionBusy === 'install-uv' ? 'Installing…' : 'Install uv'}</span>
                  <Icon name="download" size={13} />
                </button>
              </div>
            )}

            <div className="splash-connector-card">
              <div className="splash-connector-head">
                <div className="splash-connector-icon">
                  <GithubIcon size={20} />
                </div>
                <div className="splash-connector-meta">
                  <span className="splash-connector-title">GitHub (Personal Access Token)</span>
                  <span className="splash-connector-desc">Direct repo access without cloud OAuth. The GitHub card above already covers it.</span>
                </div>
              </div>
              <div className="splash-connector-footer">
                {githubPatSaved ? (
                  <span className="splash-field-note-ok" style={{ fontSize: 12 }}>✓ Token Configured</span>
                ) : (
                  <button
                    type="button"
                    className="splash-btn-subtle"
                    onClick={() => setShowGithubPat(!showGithubPat)}
                  >
                    {showGithubPat ? 'Cancel' : 'Enter Token'}
                  </button>
                )}
              </div>
              {showGithubPat && !githubPatSaved && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                  <div className="splash-input-row">
                    <input
                      type="password"
                      className="splash-input"
                      placeholder="Paste ghp_... or github_pat_..."
                      value={githubPatDraft}
                      onChange={(e) => setGithubPatDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="splash-btn-subtle"
                      disabled={actionBusy === 'github-pat' || !githubPatDraft.trim()}
                      onClick={handleSaveGithubPat}
                    >
                      {actionBusy === 'github-pat' ? 'Saving…' : 'Save Token'}
                    </button>
                  </div>
                  <a
                    href="https://github.com/settings/tokens?scopes=repo,read:org,read:user,gist,notifications,workflow"
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--accent, #7132f5)', textDecoration: 'none' }}
                  >
                    Generate GitHub Token (repo, read:org, gist) ↗
                  </a>
                </div>
              )}
            </div>

            <div className="splash-connector-card">
              <div className="splash-connector-head">
                <div className="splash-connector-icon">
                  <MicrosoftIcon size={20} />
                </div>
                <div className="splash-connector-meta">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="splash-connector-title">Microsoft To Do</span>
                    {(!runtimes?.node?.available && !runtimes?.npx) && (
                      <a
                        href="https://nodejs.org"
                        target="_blank"
                        rel="noreferrer"
                        className="splash-badge-runtime"
                        style={{ textDecoration: 'none' }}
                        title="Node.js is required for npx tools. Click to download."
                      >
                        Needs Node.js ↗
                      </a>
                    )}
                  </div>
                  <span className="splash-connector-desc">Device code sign-in for tasks.</span>
                </div>
              </div>
              <div className="splash-connector-footer">
                <button
                  type="button"
                  className="splash-btn-subtle"
                  disabled={actionBusy === 'microsoft-todo' || (!runtimes?.node?.available && !runtimes?.npx)}
                  onClick={() => handleLocalLogin('microsoft-todo')}
                >
                  Sign In
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 4: Ready to Launch
// -----------------------------------------------------------------------------
function StepReady({
  onFinish,
  setupStatus,
  theme,
  setTheme,
  accentColor,
  setAccentColor,
  onPickPrompt,
}) {
  const verifiedModel = setupStatus?.model?.verified
  const providerName = setupStatus?.model?.provider || ''
  const modelName = setupStatus?.model?.model || ''
  const activeTools = setupStatus?.connectors?.active_tools || 0

  const activeAccent = ACCENT_PRESETS.find(
    (a) => a.hex.toLowerCase() === (accentColor || '#7132f5').toLowerCase()
  )?.label || 'Custom'

  const starterPrompts = [
    'Summarize recent activity in my library and notes',
    'Explain how subagent workers operate in Amethyst',
    'Draft a project roadmap for our next sprint',
  ]

  return (
    <div className="splash-step splash-step--done">
      <div className="splash-hero-badge">
        <Icon name="check-circle" size={44} weight="light" />
      </div>

      <div className="splash-step-header" style={{ textAlign: 'center' }}>
        <h2 className="splash-step-title">You&apos;re All Set!</h2>
        <p className="splash-step-subtitle">
          Amethyst is configured and ready to assist you.
        </p>
      </div>

      {/* Real Live Checklist */}
      <div className="splash-doctor-card">
        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="database" size={16} />
            <span>Local Database &amp; Storage</span>
          </div>
          <span className="splash-field-note-ok">✓ Ready</span>
        </div>

        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="cpu" size={16} />
            <span>AI Model</span>
          </div>
          {verifiedModel ? (
            <span className="splash-field-note-ok">
              ✓ {modelName} ({providerName})
            </span>
          ) : (
            <span style={{ fontSize: 12.5, color: '#fbbf24' }}>
              ⚠️ No model verified yet
            </span>
          )}
        </div>

        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="plugs-connected" size={16} />
            <span>Connected Tools</span>
          </div>
          <span className="splash-field-note-ok">
            ✓ {activeTools} active tool{activeTools === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Starter Prompts */}
      <div style={{ width: '100%', maxWidth: 480, marginBottom: 18 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8, textAlign: 'center' }}>
          Try a Starter Prompt
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {starterPrompts.map((p) => (
            <button
              key={p}
              type="button"
              className="splash-btn-subtle"
              style={{ textAlign: 'left', padding: '8px 12px', whiteSpace: 'normal', borderRadius: 8 }}
              onClick={() => {
                if (onPickPrompt) onPickPrompt(p)
                onFinish()
              }}
            >
              <span>&ldquo;{p}&rdquo;</span>
            </button>
          ))}
        </div>
      </div>

      {/* Visual Preferences */}
      <div className="splash-visual-box">
        <div className="splash-visual-header">
          <Icon name="palette" size={14} />
          <span>Appearance</span>
        </div>

        <div className="splash-visual-body">
          <div className="splash-visual-col">
            <label className="splash-mini-label">Theme</label>
            <div className="splash-theme-row">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`splash-mini-btn ${theme === t.id ? 'is-active' : ''}`}
                  onClick={() => setTheme(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="splash-visual-col">
            <label className="splash-mini-label">Accent ({activeAccent})</label>
            <div className="splash-accent-row">
              {ACCENT_PRESETS.map((a) => {
                const isSelected = (accentColor || '#7132f5').toLowerCase() === a.hex.toLowerCase()
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`splash-accent-dot ${isSelected ? 'is-active' : ''}`}
                    style={{ '--accent-dot': a.hex }}
                    onClick={() => setAccentColor(a.hex)}
                    aria-label={a.label}
                  >
                    {isSelected && <Icon name="check" size={12} weight="bold" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <button type="button" className="splash-btn-primary splash-btn-launch" onClick={onFinish}>
        <span>Open Amethyst</span>
        <Icon name="arrow-up-right" size={14} weight="bold" />
      </button>
    </div>
  )
}

// -----------------------------------------------------------------------------
// MAIN SPLASH SCREEN WIZARD COMPONENT
// -----------------------------------------------------------------------------
export default function SplashScreenWizard() {
  const {
    theme, setTheme,
    accentColor, setAccentColor,
    onboardingDone, setOnboardingDone,
    openChatWithPrompt,
    toast,
  } = useApp()

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [setupStatus, setSetupStatus] = useState(null)
  const [browserEnabled, setBrowserEnabled] = useState(false)
  const [trayEnabled, setTrayEnabled] = useState(true)
  const prefersReduced = useReducedMotion()

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.setupStatus()
      setSetupStatus(s)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!onboardingDone) {
      loadStatus()
    }
  }, [onboardingDone, loadStatus])

  const next = useCallback(() => {
    setDir(1)
    setStep((s) => Math.min(s + 1, 3))
  }, [])

  const prev = useCallback(() => {
    setDir(-1)
    setStep((s) => Math.max(s - 1, 0))
  }, [])

  const finish = useCallback(async () => {
    try {
      await api.completeSetup({
        browser_enabled: browserEnabled,
        tray_enabled: trayEnabled,
      })
    } catch {
      /* ignore */
    }
    setOnboardingDone(true)
    toast('Setup complete. Welcome to Amethyst!', 'ok')
  }, [browserEnabled, trayEnabled, setOnboardingDone, toast])

  if (onboardingDone) return null

  const stepLabels = ['Welcome', 'AI Engine', 'Connect Apps', 'Ready']

  const pages = [
    <StepSplash
      key="splash"
      onStart={next}
      onSkip={finish}
      setupStatus={setupStatus}
      browserEnabled={browserEnabled}
      setBrowserEnabled={setBrowserEnabled}
      trayEnabled={trayEnabled}
      setTrayEnabled={setTrayEnabled}
    />,
    <StepModels
      key="models"
      toast={toast}
      setupStatus={setupStatus}
      onRefreshStatus={loadStatus}
    />,
    <StepConnectors
      key="connectors"
      toast={toast}
      setupStatus={setupStatus}
      onRefreshStatus={loadStatus}
    />,
    <StepReady
      key="launch"
      onFinish={finish}
      setupStatus={setupStatus}
      theme={theme}
      setTheme={setTheme}
      accentColor={accentColor}
      setAccentColor={setAccentColor}
      onPickPrompt={openChatWithPrompt}
    />,
  ]

  return (
    <div className="splash-overlay">
      <div className="splash-backdrop" />
      <div className="splash-ambient-orb" />

      <div className="splash-surface">
        {step > 0 && (
          <div className="splash-stepper-bar">
            <div className="splash-stepper-left">
              <button type="button" className="splash-back-btn" onClick={prev} aria-label="Go back">
                <Icon name="caret-left" size={14} weight="bold" />
                <span>Back</span>
              </button>
              <span className="splash-step-indicator">
                {stepLabels[step]} ({step} of 3)
              </span>
            </div>

            <div className="splash-dots-track">
              {[1, 2, 3].map((idx) => (
                <span
                  key={idx}
                  className={`splash-dot ${idx === step ? 'is-active' : ''} ${idx < step ? 'is-done' : ''}`}
                />
              ))}
            </div>

            <button type="button" className="splash-skip-link" onClick={finish}>
              Skip
            </button>
          </div>
        )}

        <div className="splash-body-scroll">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={prefersReduced ? {} : slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="splash-page-frame"
            >
              {pages[step]}
            </motion.div>
          </AnimatePresence>
        </div>

        {step > 0 && step < 3 && (
          <div className="splash-footer-bar">
            <button type="button" className="splash-btn-ghost" onClick={prev}>
              Back
            </button>
            <button type="button" className="splash-btn-primary" onClick={next}>
              <span>Next</span>
              <Icon name="caret-right" size={13} weight="bold" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
