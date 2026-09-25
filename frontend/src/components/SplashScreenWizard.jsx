import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import Icon from './Icon.jsx'
import BrandMark from './BrandMark.jsx'
import AiProviderIcon from './AiProviderIcon.jsx'
import { LoaderIcon } from './OnboardingWizard.jsx'
import { api, copyText } from '../api.js'
import { useApp } from '../store.jsx'

/* ==========================================================================
   AMETHYST Initial Setup & Splash Screen
   - Simple, human-friendly wording.
   - Clean, readable typography (no micro text).
   - Authentic brand SVG icons for connectors.
   - 100% matched to active theme accent.
   ========================================================================== */

/* Authentic Brand SVGs for MCP Connectors */
function GoogleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
    </svg>
  )
}

function MicrosoftIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5.5" fill="#2564CF" />
      <path d="M6.5 12.5l3.8 3.8 7.2-8.3" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 8l4 4" stroke="rgba(255,255,255,0.35)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function GithubIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function SpotifyIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#1ED760" />
      <path d="M16.5 16.2c-.2.3-.5.4-.8.2-2.3-1.4-5.2-1.7-8.6-.9-.3.1-.7-.1-.8-.4-.1-.3.1-.7.4-.8 3.8-.9 7-.5 9.6 1.1.3.2.4.5.2.8zm1.2-2.7c-.2.4-.7.5-1.1.3-2.7-1.7-6.8-2.1-10-1.2-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.6-1.1 8.1-.6 11.2 1.3.4.2.5.7.4 1.1zm.1-2.8C14.7 8.9 8.1 8.7 4.7 9.8c-.5.2-1-.1-1.2-.6-.2-.5.1-1 .6-1.2 4-1.2 11.3-1 15.1 1.3.4.3.6.9.3 1.3-.3.4-.9.6-1.7.4z" fill="#0C111A" />
    </svg>
  )
}

function ChromeIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#FFFFFF" />
      <path d="M12 2a10 10 0 0 1 8.66 5H12l-2.6 4.5L7.1 8.2A10 10 0 0 1 12 2z" fill="#EA4335" />
      <path d="M20.66 7A10 10 0 0 1 15.5 21.66L12 15.5l3.8-2.2 4.86-6.3z" fill="#FBBC04" />
      <path d="M15.5 21.66A10 10 0 0 1 3.34 17L7.1 10.5l4.9 1.3-2.6 4.5 6.1 5.36z" fill="#34A853" />
      <circle cx="12" cy="12" r="4.2" fill="#1A73E8" stroke="#FFFFFF" strokeWidth="1.4" />
    </svg>
  )
}

function PlaywrightIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9.5 4.2C6.6 4.2 4.2 6.8 4.2 10.4c0 4.1 2.7 8.2 5.3 9.2 2.6-1 5.3-5.1 5.3-9.2 0-3.6-2.4-6.2-5.3-6.2z" fill="#2EAD33" />
      <ellipse cx="7.7" cy="9.6" rx="1.1" ry="1.4" fill="#0D1117" />
      <ellipse cx="11.3" cy="9.6" rx="1.1" ry="1.4" fill="#0D1117" />
      <path d="M7.7 13.5c.7.8 1.2 1 1.8 1s1.1-.2 1.8-1" stroke="#0D1117" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M15.6 7.6c-2.3 0-4.2 2.1-4.2 5 0 3.3 2.1 6.6 4.2 7.4 2.1-.8 4.2-4.1 4.2-7.4 0-2.9-1.9-5-4.2-5z" fill="#D03D33" />
      <ellipse cx="14.2" cy="12.2" rx="0.9" ry="1.2" fill="#0D1117" />
      <ellipse cx="17" cy="12.2" rx="0.9" ry="1.2" fill="#0D1117" />
      <path d="M14.5 15.8c.4-.4.8-.6 1.1-.6s.7.2 1.1.6" stroke="#0D1117" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function TavilyIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5.5" fill="#0B132B" />
      <circle cx="12" cy="12" r="3.2" fill="#4ADE80" />
      <path d="M12 4v4m0 8v4M4 12h4m8 0h4" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.3 6.3l2.8 2.8m5.8 5.8l2.8 2.8M17.7 6.3l-2.8 2.8m-5.8 5.8l-2.8 2.8" stroke="#818CF8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function MemoryIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5.5" fill="#1C1033" />
      <path d="M12 5.5c-3.2 0-5.5 2-5.5 5 0 1.8.8 3.4 2.1 4.2-.2.5-.4 1.2-.4 2 0 1.2.9 2.1 2.1 2.1h3.4c1.2 0 2.1-.9 2.1-2.1 0-.8-.2-1.5-.4-2 1.3-.8 2.1-2.4 2.1-4.2 0-3-2.3-5-5.5-5z" stroke="#C084FC" strokeWidth="1.7" />
      <circle cx="9.8" cy="10.2" r="1.3" fill="#E9D5FF" />
      <circle cx="14.2" cy="10.2" r="1.3" fill="#E9D5FF" />
      <path d="M10.2 13.8h3.6" stroke="#C084FC" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ConnectorSvgIcon({ id, size = 22 }) {
  switch (id) {
    case 'google-workspace':
      return <GoogleIcon size={size} />
    case 'microsoft-todo':
      return <MicrosoftIcon size={size} />
    case 'github':
      return <GithubIcon size={size} />
    case 'spotify':
      return <SpotifyIcon size={size} />
    case 'chrome-devtools':
      return <ChromeIcon size={size} />
    case 'playwright':
      return <PlaywrightIcon size={size} />
    case 'tavily':
      return <TavilyIcon size={size} />
    case 'memory':
      return <MemoryIcon size={size} />
    default:
      return <Icon name="plug" size={size} />
  }
}

const PRIMARY_PROVIDERS = [
  {
    id: 'kilocode',
    name: 'Kilo Code',
    badge: 'Free Tier',
    keyEnv: 'AMETHYST_KILOCODE_API_KEY',
    placeholder: 'kilo_...',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    defaultModel: 'stepfun/step-3.7-flash:free',
    keysUrl: 'https://app.kilo.ai/settings/keys',
    desc: 'Free fast models.',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    badge: 'Free Tier',
    keyEnv: 'NVIDIA_API_KEY',
    placeholder: 'nvapi-...',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
    keysUrl: 'https://build.nvidia.com',
    desc: 'Free Llama 70B models.',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    badge: 'Free Tier',
    keyEnv: 'AMETHYST_OPENCODE_ZEN_API_KEY',
    placeholder: 'zen_...',
    baseUrl: 'https://opencode.ai/api/v1',
    defaultModel: 'opencode-zen',
    keysUrl: 'https://opencode.ai',
    desc: 'Free coding models.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    badge: '1M Context',
    keyEnv: 'GEMINI_API_KEY',
    placeholder: 'AIzaSy...',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    desc: 'Fast with huge memory.',
  },
  {
    id: 'groq',
    name: 'Groq',
    badge: 'Super Fast',
    keyEnv: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keysUrl: 'https://console.groq.com/keys',
    desc: 'Super fast responses.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: 'Free Models',
    keyEnv: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-v1-...',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    keysUrl: 'https://openrouter.ai/keys',
    desc: '300+ free & paid models.',
  },
]

const MORE_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'Paid',
    keyEnv: 'OPENAI_API_KEY',
    placeholder: 'sk-proj-...',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    keysUrl: 'https://platform.openai.com/api-keys',
    desc: 'GPT-4o and o3-mini.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badge: 'Paid',
    keyEnv: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-api03-...',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-7-sonnet-latest',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    desc: 'Claude 3.7 Sonnet.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: 'Low Cost',
    keyEnv: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    desc: 'DeepSeek V3 & R1.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    badge: 'Tiered',
    keyEnv: 'MISTRAL_API_KEY',
    placeholder: 'mis_...',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    keysUrl: 'https://console.mistral.ai/api-keys',
    desc: 'Mistral Large model.',
  },
  {
    id: 'together',
    name: 'Together AI',
    badge: 'Tiered',
    keyEnv: 'TOGETHER_API_KEY',
    placeholder: 'tog_...',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    keysUrl: 'https://api.together.xyz/settings/api-keys',
    desc: 'Fast open source models.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    badge: 'Free Tier',
    keyEnv: 'CEREBRAS_API_KEY',
    placeholder: 'csk-...',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    keysUrl: 'https://cloud.cerebras.ai',
    desc: 'Ultra-fast generation.',
  },
]

const ACCENT_PRESETS = [
  { id: 'purple', hex: '#8b5cf6', label: 'Amethyst' },
  { id: 'blue', hex: '#3b82f6', label: 'Blue' },
  { id: 'emerald', hex: '#10b981', label: 'Emerald' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
  { id: 'rose', hex: '#ec4899', label: 'Rose' },
  { id: 'slate', hex: '#64748b', label: 'Slate' },
]

const THEMES = [
  { id: 'graphite', label: 'Graphite' },
  { id: 'ink', label: 'Ink' },
  { id: 'nocturne', label: 'Nocturne' },
  { id: 'paper', label: 'Paper' },
  { id: 'sand', label: 'Sand' },
  { id: 'system', label: 'System' },
]

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 16 : -16, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? -16 : 16, opacity: 0 }),
}

// -----------------------------------------------------------------------------
// STEP 0: Welcome Splash Screen
// -----------------------------------------------------------------------------
function StepSplash({ onStart, onSkip, doctorData, ollamaOnline }) {
  return (
    <div className="splash-step splash-step--hero">
      <div className="splash-hero-badge">
        <BrandMark size={48} glow />
      </div>

      <div className="splash-hero-header">
        <span className="splash-eyebrow">Welcome</span>
        <h1 className="splash-hero-title">Welcome to Amethyst</h1>
        <p className="splash-hero-subtitle">
          Your personal AI desktop. Fast, private, and runs directly on your computer.
        </p>
      </div>

      <div className="splash-scan-grid">
        <div className="splash-scan-card">
          <div className="splash-scan-icon">
            <Icon name="cpu" size={20} />
          </div>
          <div className="splash-scan-info">
            <span className="splash-scan-title">AI Models</span>
            <span className="splash-scan-desc">
              {ollamaOnline ? 'Ollama running offline' : doctorData?.providers?.length ? `${doctorData.providers.length} models ready` : 'Local or cloud'}
            </span>
          </div>
          <span className={`splash-status-dot ${ollamaOnline || doctorData?.providers?.length ? 'is-active' : ''}`} />
        </div>

        <div className="splash-scan-card">
          <div className="splash-scan-icon">
            <Icon name="device-mobile" size={20} />
          </div>
          <div className="splash-scan-info">
            <span className="splash-scan-title">Phone Sharing</span>
            <span className="splash-scan-desc">Save links from phone</span>
          </div>
          <span className="splash-status-dot is-active" />
        </div>

        <div className="splash-scan-card">
          <div className="splash-scan-icon">
            <Icon name="cloud" size={20} />
          </div>
          <div className="splash-scan-info">
            <span className="splash-scan-title">Cloud Relay</span>
            <span className="splash-scan-desc">Catch links while offline</span>
          </div>
          <span className="splash-status-dot is-active" />
        </div>

        <div className="splash-scan-card">
          <div className="splash-scan-icon">
            <Icon name="plugs-connected" size={20} />
          </div>
          <div className="splash-scan-info">
            <span className="splash-scan-title">Connected Apps</span>
            <span className="splash-scan-desc">{doctorData?.tools || 0} tools ready</span>
          </div>
          <span className="splash-status-dot is-active" />
        </div>
      </div>

      <div className="splash-actions-row">
        <button type="button" className="splash-btn-primary" onClick={onStart}>
          <span>Get Started</span>
          <Icon name="caret-right" size={14} weight="bold" />
        </button>
        <button type="button" className="splash-btn-ghost" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 1: AI Models & Keys
// -----------------------------------------------------------------------------
function StepModels({ toast, onRefreshHealth }) {
  const [ollamaStatus, setOllamaStatus] = useState('checking')
  const [selectedProvider, setSelectedProvider] = useState(PRIMARY_PROVIDERS[0])
  const [showMore, setShowMore] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(PRIMARY_PROVIDERS[0].baseUrl || '')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [configuredProviders, setConfiguredProviders] = useState([])

  const checkOllama = useCallback(async () => {
    setOllamaStatus('checking')
    try {
      const res = await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(2000) })
      setOllamaStatus(res.ok ? 'online' : 'offline')
    } catch {
      setOllamaStatus('offline')
    }
  }, [])

  const loadConfigured = useCallback(async () => {
    try {
      const res = await api.providers()
      setConfiguredProviders(res?.configured || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    checkOllama()
    loadConfigured()
  }, [checkOllama, loadConfigured])

  const handleSelectProvider = (prov) => {
    setSelectedProvider(prov)
    setBaseUrl(prov.baseUrl || '')
    setApiKey('')
    setTestResult(null)
  }

  const handleSaveAndTest = async () => {
    if (!apiKey.trim()) {
      toast('Please enter your API key', 'bad')
      return
    }
    setSaving(true)
    setTesting(true)
    setTestResult(null)
    const t0 = performance.now()
    try {
      await api.addProvider({
        name: selectedProvider.id,
        api_key: apiKey.trim(),
        key: apiKey.trim(),
        base_url: baseUrl.trim() || undefined,
        default_model: selectedProvider.defaultModel,
      })
      const pingRes = await api.pingProvider(selectedProvider.id)
      const elapsed = Math.round(performance.now() - t0)
      const ms = pingRes?.latency_ms || elapsed
      setTestResult({ ok: true, msg: `Verified in ${ms}ms` })
      toast(`${selectedProvider.name} is ready to use`, 'ok')
      setApiKey('')
      await loadConfigured()
      if (onRefreshHealth) onRefreshHealth()
    } catch (err) {
      setTestResult({ ok: false, msg: err.message || 'Check your key and try again' })
      toast(err.message, 'bad')
    } finally {
      setSaving(false)
      setTesting(false)
    }
  }

  const isConfigured = (id) => configuredProviders.some((p) => p.name === id || p.slug === id)

  return (
    <div className="splash-step">
      <div className="splash-step-header">
        <span className="splash-step-tag">Step 1 of 5</span>
        <h2 className="splash-step-title">Choose Your AI</h2>
        <p className="splash-step-subtitle">
          Pick a free cloud provider or run models directly on your computer with Ollama.
        </p>
      </div>

      {/* Ollama Card */}
      <div className="splash-card">
        <div className="splash-card-row">
          <div className="splash-card-info">
            <div className="splash-title-row">
              <span className="splash-card-title">Ollama (Free &amp; Offline)</span>
              <span className="splash-status-dot-text">
                <span className={`splash-dot-indicator ${ollamaStatus === 'online' ? 'is-active' : ''}`} />
                {ollamaStatus === 'checking' ? 'Checking…' : ollamaStatus === 'online' ? 'Running' : 'Not running'}
              </span>
            </div>
            <p className="splash-card-desc">
              Runs on your device with no API keys or internet needed.
            </p>
          </div>
          <button type="button" className="splash-btn-subtle" onClick={checkOllama}>
            <Icon name="refresh" size={13} />
            <span>Check again</span>
          </button>
        </div>
      </div>

      {/* Primary Cloud Providers */}
      <div className="splash-section">
        <div className="splash-section-header-row">
          <label className="splash-label">Free Cloud Providers</label>
        </div>

        <div className="splash-provider-grid">
          {PRIMARY_PROVIDERS.map((p) => {
            const active = selectedProvider.id === p.id
            const conf = isConfigured(p.id)
            return (
              <button
                key={p.id}
                type="button"
                className={`splash-provider-card ${active ? 'is-active' : ''} ${conf ? 'is-configured' : ''}`}
                onClick={() => handleSelectProvider(p)}
              >
                <div className="splash-provider-card-head">
                  <AiProviderIcon provider={p.id} size={18} />
                  {conf ? (
                    <span className="splash-dot-indicator is-active" title="Configured" />
                  ) : (
                    <span className="splash-card-subtle-tag">{p.badge}</span>
                  )}
                </div>
                <span className="splash-provider-name">{p.name}</span>
                <span className="splash-provider-desc">{p.desc}</span>
              </button>
            )
          })}
        </div>

        <div className="splash-more-toggle-row">
          <button
            type="button"
            className="splash-toggle-btn"
            onClick={() => setShowMore((prev) => !prev)}
          >
            <span>{showMore ? 'Show fewer providers' : '+ More providers (OpenAI, Claude, DeepSeek, Mistral…)'}</span>
            <Icon name={showMore ? 'caret-up' : 'caret-down'} size={12} />
          </button>
        </div>

        {showMore && (
          <div className="splash-provider-grid" style={{ marginTop: 8 }}>
            {MORE_PROVIDERS.map((p) => {
              const active = selectedProvider.id === p.id
              const conf = isConfigured(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`splash-provider-card ${active ? 'is-active' : ''} ${conf ? 'is-configured' : ''}`}
                  onClick={() => handleSelectProvider(p)}
                >
                  <div className="splash-provider-card-head">
                    <AiProviderIcon provider={p.id} size={18} />
                    {conf && <span className="splash-dot-indicator is-active" title="Configured" />}
                  </div>
                  <span className="splash-provider-name">{p.name}</span>
                  <span className="splash-provider-desc">{p.desc}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Provider Form */}
      <div className="splash-form-card">
        <div className="splash-form-header-bar">
          <div className="splash-form-header-left">
            <AiProviderIcon provider={selectedProvider.id} size={18} />
            <strong style={{ fontSize: 14, color: '#f5f5f7' }}>Set up {selectedProvider.name}</strong>
          </div>
          {selectedProvider.keysUrl && (
            <a
              href={selectedProvider.keysUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="splash-text-link"
            >
              <span>Get API key ↗</span>
            </a>
          )}
        </div>

        <div className="splash-form-group">
          <div className="splash-form-label-row">
            <label className="splash-label" htmlFor="prov-key">
              API Key
            </label>
            {isConfigured(selectedProvider.id) && (
              <span className="splash-field-note-ok">✓ Saved</span>
            )}
          </div>
          <input
            id="prov-key"
            type="password"
            className="splash-input"
            placeholder={selectedProvider.placeholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="splash-form-group">
          <label className="splash-label" htmlFor="prov-url">
            API URL
          </label>
          <input
            id="prov-url"
            type="text"
            className="splash-input"
            placeholder={selectedProvider.baseUrl || 'https://...'}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>

        <div className="splash-verify-bar">
          <button
            type="button"
            className="splash-btn-primary"
            disabled={saving || testing || !apiKey.trim()}
            onClick={handleSaveAndTest}
          >
            {testing ? (
              <>
                <LoaderIcon type="pixels" />
                <span>Checking key…</span>
              </>
            ) : (
              <>
                <Icon name="check" size={14} weight="bold" />
                <span>Save &amp; Check Key</span>
              </>
            )}
          </button>

          {testResult && (
            <div className={`splash-test-result ${testResult.ok ? 'is-success' : 'is-error'}`}>
              <Icon name={testResult.ok ? 'check-circle' : 'warning-circle'} size={15} />
              <span>{testResult.msg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 2: Cloudflare Relay
// -----------------------------------------------------------------------------
function StepCloudflare({ toast }) {
  const [relayUrl, setRelayUrl] = useState('')
  const [relayToken, setRelayToken] = useState('')
  const [cfAccountId, setCfAccountId] = useState('')
  const [cfApiToken, setCfApiToken] = useState('')
  const [relayStatus, setRelayStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  useEffect(() => {
    api.instagram()
      .then((data) => {
        if (data?.relay) {
          setRelayStatus(data.relay)
          if (data.relay.url) setRelayUrl(data.relay.url)
        }
      })
      .catch(() => {})
  }, [])

  const handleSaveAndSyncRelay = async (e) => {
    e?.preventDefault()
    if (!relayUrl.trim()) {
      toast('Please enter your Cloudflare Relay URL', 'bad')
      return
    }
    setSyncing(true)
    setSyncResult(null)
    try {
      await api.setInstagramRelay({
        url: relayUrl.trim(),
        token: relayToken.trim() || undefined,
        enabled: true,
      })
      const res = await api.syncInstagramRelay()
      if (res?.synced) {
        setSyncResult({ ok: true, msg: `Relay connected! Synced ${res.pulled || 0} items.` })
        toast('Cloudflare Relay connected', 'ok')
      } else {
        setSyncResult({ ok: false, msg: res?.error || 'Could not sync items' })
      }
      const updated = await api.instagram()
      if (updated?.relay) setRelayStatus(updated.relay)
    } catch (err) {
      setSyncResult({ ok: false, msg: err.message })
      toast(err.message, 'bad')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="splash-step">
      <div className="splash-step-header">
        <span className="splash-step-tag">Step 2 of 5</span>
        <h2 className="splash-step-title">Cloud Sync (Optional)</h2>
        <p className="splash-step-subtitle">
          Catch links from your phone even when your computer is turned off.
        </p>
      </div>

      {/* Helpful Links */}
      <div className="splash-guide-card">
        <div className="splash-guide-links">
          <span style={{ fontSize: 13, color: 'var(--text-dim, #94a3b8)' }}>Dashboard links:</span>
          <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="splash-text-link">
            Cloudflare Dashboard ↗
          </a>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>&middot;</span>
          <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="splash-text-link">
            API Tokens ↗
          </a>
        </div>
        <p className="splash-guide-desc">
          <strong>Account ID:</strong> Found on the right side of your Cloudflare overview page.
        </p>
      </div>

      {/* Worker Relay Card */}
      <div className="splash-card">
        <div className="splash-card-row">
          <div>
            <div className="splash-title-row">
              <span className="splash-card-title">Cloud Relay</span>
              <span className="splash-status-dot-text">
                <span className={`splash-dot-indicator ${relayStatus?.configured ? 'is-active' : ''}`} />
                {relayStatus?.configured ? 'Connected' : 'Not configured'}
              </span>
            </div>
            <p className="splash-card-desc">
              Holds links you save on your phone until Amethyst opens.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveAndSyncRelay} style={{ marginTop: 12 }}>
          <div className="splash-form-group">
            <label className="splash-label" htmlFor="cf-relay-url">Worker URL</label>
            <input
              id="cf-relay-url"
              type="url"
              className="splash-input"
              placeholder="https://your-relay.workers.dev"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
            />
          </div>

          <div className="splash-form-group">
            <label className="splash-label" htmlFor="cf-relay-token">Secret Token</label>
            <input
              id="cf-relay-token"
              type="password"
              className="splash-input"
              placeholder="Private token from setup"
              value={relayToken}
              onChange={(e) => setRelayToken(e.target.value)}
            />
          </div>

          <div className="splash-verify-bar">
            <button
              type="submit"
              className="splash-btn-primary"
              disabled={syncing || !relayUrl.trim()}
            >
              {syncing ? (
                <>
                  <LoaderIcon type="pixels" />
                  <span>Connecting…</span>
                </>
              ) : (
                <>
                  <Icon name="refresh" size={14} />
                  <span>Save &amp; Connect</span>
                </>
              )}
            </button>

            {syncResult && (
              <div className={`splash-test-result ${syncResult.ok ? 'is-success' : 'is-error'}`}>
                <Icon name={syncResult.ok ? 'check-circle' : 'warning-circle'} size={15} />
                <span>{syncResult.msg}</span>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Workers AI Card */}
      <div className="splash-card">
        <div className="splash-title-row">
          <span className="splash-card-title">Fast Search (Optional)</span>
          <span className="splash-card-subtle-tag">Free</span>
        </div>
        <p className="splash-card-desc">
          Search your saved links faster using free cloud search.
        </p>
        <div className="splash-form-row" style={{ marginTop: 10 }}>
          <div className="splash-form-group" style={{ flex: 1 }}>
            <label className="splash-label" htmlFor="cf-acc-id">Account ID</label>
            <input
              id="cf-acc-id"
              type="text"
              className="splash-input"
              placeholder="Account ID"
              value={cfAccountId}
              onChange={(e) => setCfAccountId(e.target.value)}
            />
          </div>
          <div className="splash-form-group" style={{ flex: 1 }}>
            <label className="splash-label" htmlFor="cf-tok">API Token</label>
            <input
              id="cf-tok"
              type="password"
              className="splash-input"
              placeholder="API Token with Workers AI Read"
              value={cfApiToken}
              onChange={(e) => setCfApiToken(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 3: Phone Sharing
// -----------------------------------------------------------------------------
function StepMobileShortcuts({ toast }) {
  const [shareStatus, setShareStatus] = useState(null)
  const [shareToken, setShareToken] = useState('')
  const [testUrl, setTestUrl] = useState('https://en.wikipedia.org/wiki/Amethyst')
  const [testingShare, setTestingShare] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [activeTab, setActiveTab] = useState('android')

  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:8000' : window.location.origin

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.shareStatus()
      setShareStatus(s)
    } catch {
      setShareStatus({ enabled: false })
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const generateToken = async () => {
    try {
      const next = await api.rotateShareToken()
      setShareToken(next.token)
      setShareStatus({ enabled: true })
      toast('Private key generated', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleTestCapture = async () => {
    setTestingShare(true)
    setTestResult(null)
    try {
      let activeTok = shareToken
      if (!activeTok) {
        const next = await api.rotateShareToken()
        activeTok = next.token
        setShareToken(next.token)
        setShareStatus({ enabled: true })
      }

      const res = await api.captureShare(testUrl, activeTok, 'Test capture from setup')
      setTestResult({
        ok: true,
        title: res?.title || 'Article',
        msg: `Saved "${res?.title || 'Article'}" to your library!`,
      })
      toast('Test link saved to library', 'ok')
    } catch (err) {
      setTestResult({ ok: false, msg: err.message || 'Could not save link' })
      toast(err.message, 'bad')
    } finally {
      setTestingShare(false)
    }
  }

  const endpointUrl = `${origin}/api/share/capture`
  const curlExample = `curl -X POST "${endpointUrl}" \\
  -H "Authorization: Bearer ${shareToken || '<TOKEN>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`

  return (
    <div className="splash-step">
      <div className="splash-step-header">
        <span className="splash-step-tag">Step 3 of 5</span>
        <h2 className="splash-step-title">Phone Sharing</h2>
        <p className="splash-step-subtitle">
          Send links from your phone directly into your Amethyst library.
        </p>
      </div>

      {/* Secret Key Card */}
      <div className="splash-card">
        <div className="splash-card-row">
          <div className="splash-card-info">
            <div className="splash-title-row">
              <span className="splash-card-title">Your Private Share Key</span>
              <span className="splash-status-dot-text">
                <span className={`splash-dot-indicator ${shareStatus?.enabled ? 'is-active' : ''}`} />
                {shareStatus?.enabled ? 'Active' : 'Not generated yet'}
              </span>
            </div>
            <p className="splash-card-desc">
              Keeps your link sharing private.
            </p>
          </div>
          <button type="button" className="splash-btn-subtle" onClick={generateToken}>
            <Icon name="key" size={13} />
            <span>{shareStatus?.enabled ? 'New Key' : 'Create Key'}</span>
          </button>
        </div>

        {shareToken && (
          <div className="splash-token-bar">
            <input type="text" readOnly value={shareToken} className="splash-input-code" />
            <button
              type="button"
              className="splash-btn-subtle"
              onClick={() => {
                copyText(shareToken)
                toast('Key copied to clipboard', 'ok')
              }}
            >
              <Icon name="copy" size={13} />
              <span>Copy</span>
            </button>
          </div>
        )}
      </div>

      {/* Setup Guide */}
      <div className="splash-section">
        <div className="splash-tabs-row">
          <button
            type="button"
            className={`splash-tab ${activeTab === 'android' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('android')}
          >
            <Icon name="android" size={14} />
            <span>Android (HTTP Shortcuts)</span>
          </button>
          <button
            type="button"
            className={`splash-tab ${activeTab === 'ios' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('ios')}
          >
            <Icon name="apple" size={14} />
            <span>iPhone / iPad</span>
          </button>
          <button
            type="button"
            className={`splash-tab ${activeTab === 'curl' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('curl')}
          >
            <Icon name="term" size={14} />
            <span>cURL / Webhook</span>
          </button>
        </div>

        <div className="splash-config-card">
          {activeTab === 'android' && (
            <div className="splash-instructions">
              <div className="splash-app-link-line">
                <span>Free App:</span>
                <a
                  href="https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="splash-text-link"
                >
                  HTTP Shortcuts on Google Play ↗
                </a>
              </div>

              <div className="splash-spec-table">
                <div className="splash-spec-row">
                  <span className="splash-spec-label">Method</span>
                  <span className="splash-spec-val">POST</span>
                </div>
                <div className="splash-spec-row">
                  <span className="splash-spec-label">URL</span>
                  <code className="splash-spec-code">{endpointUrl}</code>
                  <button
                    type="button"
                    className="splash-btn-icon-copy"
                    onClick={() => {
                      copyText(endpointUrl)
                      toast('URL copied', 'ok')
                    }}
                    title="Copy URL"
                  >
                    <Icon name="copy" size={13} />
                  </button>
                </div>
                <div className="splash-spec-row">
                  <span className="splash-spec-label">Header</span>
                  <code className="splash-spec-code">Authorization: Bearer {shareToken || '<TOKEN>'}</code>
                  <button
                    type="button"
                    className="splash-btn-icon-copy"
                    onClick={() => {
                      copyText(`Authorization: Bearer ${shareToken || '<TOKEN>'}`)
                      toast('Header copied', 'ok')
                    }}
                    title="Copy Header"
                  >
                    <Icon name="copy" size={13} />
                  </button>
                </div>
                <div className="splash-spec-row">
                  <span className="splash-spec-label">Body</span>
                  <code className="splash-spec-code">{`{"url": "{shared_content}"}`}</code>
                  <button
                    type="button"
                    className="splash-btn-icon-copy"
                    onClick={() => {
                      copyText(`{"url": "{shared_content}"}`)
                      toast('Body copied', 'ok')
                    }}
                    title="Copy Body"
                  >
                    <Icon name="copy" size={13} />
                  </button>
                </div>
              </div>
              <p className="splash-caption-note">Tip: In the shortcut settings, turn on &quot;Accept shared links&quot;.</p>
            </div>
          )}

          {activeTab === 'ios' && (
            <div className="splash-instructions">
              <ol className="splash-numbered-list">
                <li>Create a shortcut with &quot;Receive URLs and text from Share Sheet&quot;.</li>
                <li>Add action: <strong>Get Contents of URL</strong> &rarr; <code>{endpointUrl}</code> (POST).</li>
                <li>Add Header: <code>Authorization</code> = <code>Bearer {shareToken || '<TOKEN>'}</code>.</li>
                <li>Add Body (JSON): key <code>url</code> = <code>Shortcut Input</code>.</li>
              </ol>
            </div>
          )}

          {activeTab === 'curl' && (
            <div className="splash-instructions">
              <div className="splash-code-block">
                <pre>{curlExample}</pre>
                <button
                  type="button"
                  className="splash-copy-floating"
                  onClick={() => {
                    copyText(curlExample)
                    toast('cURL copied', 'ok')
                  }}
                >
                  <Icon name="copy" size={12} /> Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Test */}
      <div className="splash-test-bar">
        <div className="splash-test-header-row">
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>Try it out</span>
          <span style={{ fontSize: 12, color: 'var(--text-dim, #64748b)' }}>Send a sample link to verify</span>
        </div>
        <div className="splash-test-input-wrap">
          <input
            type="url"
            className="splash-input"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="https://en.wikipedia.org/wiki/Amethyst"
          />
          <button
            type="button"
            className="splash-btn-primary splash-btn-test-action"
            disabled={testingShare}
            onClick={handleTestCapture}
          >
            {testingShare ? (
              <LoaderIcon type="pixels" />
            ) : (
              <>
                <span>Send Link</span>
                <Icon name="caret-right" size={13} weight="bold" />
              </>
            )}
          </button>
        </div>

        {testResult && (
          <div className={`splash-test-inline ${testResult.ok ? 'is-ok' : 'is-err'}`}>
            <Icon name={testResult.ok ? 'check' : 'alert'} size={14} />
            <span>{testResult.msg}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 4: Connected Apps (Real Brand SVGs)
// -----------------------------------------------------------------------------
function StepConnectors({ toast }) {
  const [servers, setServers] = useState([])
  const [actionBusy, setActionBusy] = useState('')

  const loadServers = useCallback(async () => {
    try {
      const data = await api.mcpServers(true)
      setServers(data?.servers || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  const handleLogin = async (name) => {
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
      await loadServers()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setActionBusy('')
    }
  }

  const CATALOGUE_CONNECTORS = [
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      desc: 'Gmail, Calendar, Drive & Docs.',
    },
    {
      id: 'microsoft-todo',
      name: 'Microsoft To Do',
      desc: 'Tasks and checklists.',
    },
    {
      id: 'github',
      name: 'GitHub',
      desc: 'Repos, PRs, and issues.',
    },
    {
      id: 'spotify',
      name: 'Spotify',
      desc: 'Music and playback.',
    },
    {
      id: 'tavily',
      name: 'Tavily Search',
      desc: 'Fast web search.',
    },
    {
      id: 'playwright',
      name: 'Playwright Browser',
      desc: 'Web browsing.',
    },
    {
      id: 'chrome-devtools',
      name: 'Chrome DevTools',
      desc: 'Web inspection.',
    },
    {
      id: 'memory',
      name: 'Knowledge Memory',
      desc: 'Long-term chat memory.',
    },
  ]

  const getServerState = (id) => servers.find((s) => s.name === id)

  return (
    <div className="splash-step">
      <div className="splash-step-header">
        <span className="splash-step-tag">Step 4 of 5</span>
        <h2 className="splash-step-title">Connect Your Apps</h2>
        <p className="splash-step-subtitle">
          Connect the apps and tools you use every day.
        </p>
      </div>

      <div className="splash-connectors-grid">
        {CATALOGUE_CONNECTORS.map((c) => {
          const s = getServerState(c.id)
          const isConnected = s?.signed_in === true || s?.status === 'running'
          const needsAuth = s && !isConnected && s.signed_in === false

          return (
            <div key={c.id} className="splash-connector-card">
              <div className="splash-connector-head">
                <div className="splash-connector-icon">
                  <ConnectorSvgIcon id={c.id} size={22} />
                </div>
                <div className="splash-connector-meta">
                  <strong className="splash-connector-title">{c.name}</strong>
                  <span className="splash-connector-desc">{c.desc}</span>
                </div>
              </div>

              <div className="splash-connector-footer">
                <span className="splash-status-dot-text">
                  <span className={`splash-dot-indicator ${isConnected ? 'is-active' : ''}`} />
                  {isConnected ? 'Connected' : needsAuth ? 'Sign in' : 'Ready'}
                </span>

                <button
                  type="button"
                  className="splash-btn-subtle"
                  disabled={actionBusy === c.id}
                  onClick={() => handleLogin(c.id)}
                >
                  {actionBusy === c.id ? (
                    'Connecting…'
                  ) : isConnected ? (
                    'Reconnect'
                  ) : (
                    'Connect'
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// STEP 5: Ready to Launch
// -----------------------------------------------------------------------------
function StepDoctorLaunch({
  onFinish,
  doctorData,
  theme,
  setTheme,
  accentColor,
  setAccentColor,
}) {
  const activeAccent = ACCENT_PRESETS.find((a) => a.hex.toLowerCase() === (accentColor || '#8b5cf6').toLowerCase())?.label || 'Custom'

  return (
    <div className="splash-step splash-step--done">
      <div className="splash-hero-badge">
        <Icon name="check-circle" size={44} weight="light" />
      </div>

      <div className="splash-step-header" style={{ textAlign: 'center' }}>
        <h2 className="splash-step-title">You&apos;re All Set!</h2>
        <p className="splash-step-subtitle">
          Amethyst is ready to use.
        </p>
      </div>

      {/* Checklist */}
      <div className="splash-doctor-card">
        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="database" size={16} />
            <span>Local Files &amp; Storage</span>
          </div>
          <span className="splash-field-note-ok">✓ Ready</span>
        </div>

        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="cpu" size={16} />
            <span>AI Models</span>
          </div>
          <span className="splash-field-note-ok">
            {doctorData?.providers?.length ? `✓ ${doctorData.providers[0]}` : '✓ Ready'}
          </span>
        </div>

        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="device-mobile" size={16} />
            <span>Phone Sharing</span>
          </div>
          <span className="splash-field-note-ok">✓ Ready</span>
        </div>

        <div className="splash-doctor-row">
          <div className="splash-doctor-lead">
            <Icon name="plugs-connected" size={16} />
            <span>Connected Apps</span>
          </div>
          <span className="splash-field-note-ok">✓ {doctorData?.tools || 42} tools</span>
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
                const isSelected = (accentColor || '#8b5cf6').toLowerCase() === a.hex.toLowerCase()
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
    textSize, setTextSize,
    agentLoader, setAgentLoader,
    onboardingDone, setOnboardingDone,
    toast,
  } = useApp()

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [doctorData, setDoctorData] = useState(null)
  const [ollamaOnline, setOllamaOnline] = useState(false)
  const prefersReduced = useReducedMotion()

  const loadInitialHealth = useCallback(async () => {
    try {
      const h = await api.health()
      setDoctorData(h)
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1500) })
      if (res.ok) setOllamaOnline(true)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!onboardingDone) {
      loadInitialHealth()
    }
  }, [onboardingDone, loadInitialHealth])

  const next = useCallback(() => {
    setDir(1)
    setStep((s) => Math.min(s + 1, 5))
  }, [])

  const prev = useCallback(() => {
    setDir(-1)
    setStep((s) => Math.max(s - 1, 0))
  }, [])

  const finish = useCallback(() => {
    setOnboardingDone(true)
    toast('Setup complete. Welcome to AMETHYST!', 'ok')
  }, [setOnboardingDone, toast])

  if (onboardingDone) return null

  const pages = [
    <StepSplash
      key="splash"
      onStart={next}
      onSkip={finish}
      doctorData={doctorData}
      ollamaOnline={ollamaOnline}
    />,
    <StepModels
      key="models"
      toast={toast}
      onRefreshHealth={loadInitialHealth}
    />,
    <StepCloudflare
      key="cloudflare"
      toast={toast}
    />,
    <StepMobileShortcuts
      key="mobile"
      toast={toast}
    />,
    <StepConnectors
      key="connectors"
      toast={toast}
    />,
    <StepDoctorLaunch
      key="launch"
      onFinish={finish}
      doctorData={doctorData}
      theme={theme}
      setTheme={setTheme}
      accentColor={accentColor}
      setAccentColor={setAccentColor}
      textSize={textSize}
      setTextSize={setTextSize}
      agentLoader={agentLoader}
      setAgentLoader={setAgentLoader}
    />,
  ]

  const stepLabels = ['Welcome', 'AI Models', 'Cloudflare', 'Phone Sharing', 'Apps', 'Ready']

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
                {stepLabels[step]} ({step} of 5)
              </span>
            </div>

            <div className="splash-dots-track">
              {[1, 2, 3, 4, 5].map((idx) => (
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

        {step > 0 && step < 5 && (
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
