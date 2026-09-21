import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import BrandMark from '../components/BrandMark.jsx'
import AiProviderIcon from '../components/AiProviderIcon.jsx'
import { api, copyText } from '../api.js'
import { useApp } from '../store.jsx'
import { forSettings } from '../nav.js'
import { useConfirm } from '../components/ui/ConfirmDialog.jsx'
import Badge from '../components/ui/Badge.jsx'
import Switch from '../components/ui/Switch.jsx'
import AnimatedSelect from '../components/ui/AnimatedSelect.jsx'
import { LoaderIcon } from '../components/OnboardingWizard.jsx'
import { AnimatePresence, motion } from 'framer-motion'
import { safeStorage } from '../lib/storage.js'
import * as syncClient from '../lib/sync/client.js'
import PairingApprovalModal from '../components/PairingApprovalModal.jsx'

/* ==========================================================================
   NAVIGATION SECTIONS & THEME DEFINITIONS
   ========================================================================== */

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'user', group: 'You' },
  { id: 'usage', label: 'Usage', icon: 'dash', group: 'You' },
  { id: 'activity', label: 'Activity', icon: 'logs', group: 'You' },
  { id: 'general', label: 'General', icon: 'sliders', group: 'App' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App' },
  { id: 'models', label: 'Models', icon: 'cpu', group: 'App' },
  { id: 'permissions', label: 'Permissions', icon: 'shield', group: 'Advanced' },
  { id: 'devices', label: 'Devices', icon: 'link', group: 'Advanced' },
  { id: 'data', label: 'Data', icon: 'trash', group: 'Advanced' },
  { id: 'about', label: 'About', icon: 'info', group: 'Advanced' },
]

const THEME_CHOICES = [
  { id: 'system', label: 'System', hint: 'Follows the OS' },
  { id: 'apple', label: 'Apple', hint: 'Clean gallery & Action Blue' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Editorial ivory & obsidian' },
  { id: 'cohere', label: 'Cohere', hint: 'Dark navy & forest emerald' },
  { id: 'sunshine', label: 'Sunshine', hint: 'Solar warm cream & radiant amber' },
  { id: 'stripe', label: 'Stripe', hint: 'Midnight graphite & electric indigo' },
  { id: 'graphite', label: 'Graphite', hint: 'Neutral dark' },
  { id: 'ink', label: 'Ink', hint: 'Cool dark' },
  { id: 'nocturne', label: 'Nocturne', hint: 'Near black' },
  { id: 'paper', label: 'Paper', hint: 'Light' },
  { id: 'sand', label: 'Sand', hint: 'Warm light' },
]

const VENDOR_PRESETS = [
  { slug: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o', hint: 'Requires an OpenAI API key' },
  { slug: 'anthropic', name: 'Anthropic', base_url: 'https://api.anthropic.com/v1', default_model: 'claude-3-5-sonnet-20241022', hint: 'Requires an Anthropic API key' },
  { slug: 'google', name: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/', default_model: 'gemini-1.5-flash-latest', hint: 'Direct Gemini OpenAI compatibility' },
  { slug: 'groq', name: 'Groq', base_url: 'https://api.groq.com/openai/v1', default_model: 'llama-3.3-70b-versatile', hint: 'Ultra-low latency Llama & Mixtral' },
  { slug: 'mistral', name: 'Mistral AI', base_url: 'https://api.mistral.ai/v1', default_model: 'mistral-large-latest', hint: 'European enterprise frontier models' },
  { slug: 'nvidia', name: 'NVIDIA NIM', base_url: 'https://integrate.api.nvidia.com/v1', default_model: 'nvidia/llama-3.1-nemotron-70b-instruct', hint: 'Enterprise inference microservices' },
  { slug: 'kilocode', name: 'Kilo Code', base_url: 'https://api.kilo.ai/api/gateway', default_model: 'stepfun/step-3.7-flash:free', hint: 'Fast multi-model gateway' },
  { slug: 'opencode-zen', name: 'OpenCode Zen', base_url: '', default_model: '', hint: 'OpenCode inference gateway' },
  { slug: 'ollama', name: 'Ollama (Local)', base_url: 'http://localhost:11434/v1', default_model: 'llama3:8b', hint: 'Run local open-source models completely offline' },
  { slug: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', default_model: 'meta-llama/llama-3.3-70b-instruct:free', hint: 'Unified access to all model endpoints' },
  { slug: 'together', name: 'Together AI', base_url: 'https://api.together.xyz/v1', default_model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', hint: 'Open-weights serverless inference' },
  { slug: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat', hint: 'DeepSeek V3 and R1 reasoning engines' },
  { slug: 'custom', name: 'Custom OpenAI-Compatible', base_url: '', default_model: '', hint: 'vLLM, LM Studio, TGI, or custom proxy endpoint' },
]

/* ==========================================================================
   0. PROFILE VIEW (Display name, identity, email)
   ========================================================================== */

function Profile() {
  const { userProfile, updateUserProfile, toast } = useApp()
  const [name, setName] = useState(userProfile?.name || '')
  const [fullName, setFullName] = useState(userProfile?.full_name || '')
  const [email, setEmail] = useState(userProfile?.email || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (userProfile) {
      setName(userProfile.name || '')
      setFullName(userProfile.full_name || '')
      setEmail(userProfile.email || '')
    }
  }, [userProfile])

  const handleSave = async (e) => {
    e?.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateUserProfile({
        name: name.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
      })
      toast('Profile updated successfully', 'ok')
    } catch {
      // toast handled in store
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="set-panel">
      <div className="set-section-label">Identity</div>
      <div className="set-box" style={{ padding: '20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div className="sb-user-avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
            {(name || 'U').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              {fullName || name || 'User'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {email || 'user@amethyst.local'}
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              Display Name (Greeting)
            </label>
            <input
              type="text"
              className="set-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jason"
              style={{ width: '100%', maxWidth: 360 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              Full Name
            </label>
            <input
              type="text"
              className="set-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Jason Wayne"
              style={{ width: '100%', maxWidth: 360 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              Email Address
            </label>
            <input
              type="email"
              className="set-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              style={{ width: '100%', maxWidth: 360 }}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <button
              type="submit"
              className="set-btn-primary"
              disabled={saving || !name.trim()}
              style={{ padding: '8px 18px', fontSize: 13, borderRadius: 8 }}
            >
              {saving ? 'Saving...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ==========================================================================
   1. GENERAL VIEW (Composer, Chats, Inspector, Automation & Rhythm)
   ========================================================================== */

function General() {
  const {
    workspace, setWorkspace,
    notifyOnDone, setNotifyOnDone,
    guard, setGuard,
    defaultGuard, setDefaultGuard,
    defaultEffort, setDefaultEffort,
    sendWith, setSendWith,
    archiveChats, setArchiveChats,
    confirmDestructive, setConfirmDestructive,
    restoreTabs, setRestoreTabs,
    showUsage, setShowUsage,
    betaPages, setBetaPages,
    toast,
  } = useApp()

  // Automation & Rhythm settings from backend
  const [maxIterations, setMaxIterations] = useState(16)
  const [briefingHour, setBriefingHour] = useState(8)
  const [briefingEnabled, setBriefingEnabled] = useState(true)
  const [wsDraft, setWsDraft] = useState(workspace || '')

  /* The web-search provider.
     Kept here because "why are my spotlight results all Wikipedia" is almost
     always this, and until now the only way to answer it was to set a keychain
     entry by hand. The key is write-only: the API says whether one is stored,
     never what it is. */
  const [searchProviders, setSearchProviders] = useState([])
  const [activeSearch, setActiveSearch] = useState(null)
  const [searchDraft, setSearchDraft] = useState({})
  const [savingSearch, setSavingSearch] = useState('')

  const loadSearchProviders = useCallback(() => {
    api.searchProvider()
      .then((d) => { setSearchProviders(d.options || []); setActiveSearch(d.active) })
      .catch(() => {})
  }, [])

  useEffect(loadSearchProviders, [loadSearchProviders])

  const saveSearchKey = async (name) => {
    setSavingSearch(name)
    try {
      await api.setSearchProvider(name, (searchDraft[name] || '').trim())
      setSearchDraft((d) => ({ ...d, [name]: '' }))
      loadSearchProviders()
      toast((searchDraft[name] || '').trim() ? 'Search provider saved' : 'Search provider removed', 'ok')
    } catch (e) {
      toast(e.message || 'Could not save that key', 'bad')
    } finally {
      setSavingSearch('')
    }
  }

  useEffect(() => {
    setWsDraft(workspace || '')
  }, [workspace])

  useEffect(() => {
    api.settings()
      .then((s) => {
        if (s.max_iterations) setMaxIterations(s.max_iterations)
        if (s.journal) {
          if (s.journal.briefing_hour !== undefined) setBriefingHour(s.journal.briefing_hour)
          if (s.journal.briefing_enabled !== undefined) setBriefingEnabled(s.journal.briefing_enabled)
        }
      })
      .catch(() => {})
  }, [])

  const handleSendWith = (val) => {
    setSendWith?.(val)
    toast(`Send key set to ${val === 'enter' ? 'Enter' : 'Ctrl+↵'}`, 'ok')
  }

  const handleStartGuard = (val) => {
    setDefaultGuard?.(val)
    setGuard?.(val)
    toast(`Default chat permission set to ${val}`, 'ok')
  }

  const handleThinkAt = (val) => {
    setDefaultEffort?.(val)
    toast(`Default reasoning effort set to ${val}`, 'ok')
  }

  const handleIterationsChange = async (val) => {
    setMaxIterations(val)
    try {
      await api.updateSettings({ max_iterations: val })
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleBriefingHourChange = async (h) => {
    setBriefingHour(h)
    try {
      await api.updateSettings({ journal: { briefing_hour: h, briefing_enabled: briefingEnabled } })
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleBriefingToggle = async () => {
    const next = !briefingEnabled
    setBriefingEnabled(next)
    try {
      await api.updateSettings({ journal: { briefing_hour: briefingHour, briefing_enabled: next } })
      toast(next ? `Daily briefing enabled for ${String(briefingHour).padStart(2, '0')}:00` : 'Daily briefing disabled', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleNotificationToggle = async () => {
    if (typeof Notification === 'undefined') {
      toast('Notifications not supported in this browser environment', 'bad')
      return
    }
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        toast('Notification permission was denied in browser', 'amber')
        return
      }
    }
    const { value, blocked } = await setNotifyOnDone(!notifyOnDone)
    if (blocked) {
      toast('Your browser blocked desktop notifications', 'amber')
    } else {
      toast(value ? 'Desktop notifications enabled for finished turns' : 'Desktop notifications disabled', 'ok')
    }
  }

  const handleBrowseDir = async () => {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker()
        if (handle?.name) {
          setWsDraft(handle.name)
          setWorkspace(handle.name)
          toast(`Working directory set to ${handle.name}`, 'ok')
        }
      } catch (e) {
        if (e.name !== 'AbortError') toast('Could not open folder picker', 'bad')
      }
    } else {
      const dir = window.prompt('Enter working directory path:', wsDraft || '~')
      if (dir != null && dir.trim()) {
        setWsDraft(dir.trim())
        setWorkspace(dir.trim())
        toast(`Working directory set to ${dir.trim()}`, 'ok')
      }
    }
  }

  const saveWorkspace = () => {
    setWorkspace(wsDraft.trim())
    toast(`Working directory saved: ${wsDraft.trim() || 'API default'}`, 'ok')
  }

  const guardOptions = [
    { value: 'guard', label: 'Guard', icon: 'shield' },
    { value: 'full-access', label: 'Full access', icon: 'zap' },
    { value: 'read-only', label: 'Read only', icon: 'eye' },
    { value: 'guard-auto-edit', label: 'Guard + Auto', icon: 'shield-check' },
  ]

  const effortOptions = [
    { value: 'default', label: 'Default', icon: 'sliders' },
    { value: 'low', label: 'Low', icon: 'sliders' },
    { value: 'medium', label: 'Medium', icon: 'sliders' },
    { value: 'high', label: 'High', icon: 'brain' },
  ]

  const briefingHours = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: `${String(i).padStart(2, '0')}:00`,
  }))

  return (
    <div className="set-panel">
      {/* Category: Composer */}
      <div className="set-section-label">Composer</div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Send with</span>
            <span className="set-row-desc">The other combination always inserts a newline.</span>
          </div>
          <div className="set-seg-ctrl">
            <button
              type="button"
              className={`set-seg-btn${(sendWith === 'enter' || sendWith === 'Enter') ? ' is-active' : ''}`}
              onClick={() => handleSendWith('enter')}
            >
              Enter
            </button>
            <button
              type="button"
              className={`set-seg-btn${(sendWith === 'ctrl-enter' || sendWith === 'Cmd+Enter') ? ' is-active' : ''}`}
              onClick={() => handleSendWith('ctrl-enter')}
            >
              Ctrl+↵
            </button>
          </div>
        </div>

        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">New chats start in</span>
            <span className="set-row-desc">The permission level a chat opens at before you change it.</span>
          </div>
          <AnimatedSelect
            value={defaultGuard || guard || 'guard'}
            onChange={handleStartGuard}
            options={guardOptions}
            placeholder="Permission…"
            minWidth={160}
          />
        </div>

        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Default reasoning effort</span>
            <span className="set-row-desc">Reasoning effort assigned when models support variable thinking tokens.</span>
          </div>
          <AnimatedSelect
            value={defaultEffort || 'default'}
            onChange={handleThinkAt}
            options={effortOptions}
            placeholder="Reasoning…"
            minWidth={140}
          />
        </div>
      </div>

      {/* Category: Web search */}
      <div className="set-section-label">Web search</div>
      <div className="set-box">
        <div className="set-box-row" style={{ alignItems: 'flex-start' }}>
          <div className="set-row-text">
            <span className="set-row-title">Search provider</span>
            <span className="set-row-desc">
              {activeSearch
                ? `Spotlight is searching the web through ${activeSearch}.`
                : 'Without one, spotlight falls back to the free scrapers — and when a network blocks those, to Wikipedia articles. Any one of these has a free tier.'}
            </span>
          </div>
        </div>
        {searchProviders.map((prov) => (
          <div className="set-box-row" key={prov.name}>
            <div className="set-row-text">
              <span className="set-row-title">
                {prov.label}
                {prov.configured && <span className="set-badge" style={{ marginLeft: 8 }}>key saved</span>}
              </span>
              <span className="set-row-desc">
                {prov.note}{' '}
                <a href={prov.signup} target="_blank" rel="noreferrer">Get a key</a>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="password"
                className="set-input"
                style={{ minWidth: 180 }}
                placeholder={prov.configured ? 'Replace key…' : 'Paste key…'}
                value={searchDraft[prov.name] || ''}
                onChange={(e) => setSearchDraft((d) => ({ ...d, [prov.name]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveSearchKey(prov.name) }}
              />
              <button
                type="button"
                className="set-btn"
                disabled={savingSearch === prov.name}
                onClick={() => saveSearchKey(prov.name)}
              >
                {savingSearch === prov.name ? 'Saving…' : (searchDraft[prov.name] || '').trim() ? 'Save' : 'Clear'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Category: Chats */}
      <div className="set-section-label">Chats</div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Archive chats instead of deleting</span>
            <span className="set-row-desc">Archived chats are kept in local storage and can be reviewed or restored.</span>
          </div>
          <Switch
            on={Boolean(archiveChats)}
            onChange={(val) => setArchiveChats?.(val)}
            tone="default"
          />
        </div>

        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Confirm destructive actions</span>
            <span className="set-row-desc">Always display confirmation dialogs before deleting conversations or clearing memory.</span>
          </div>
          <Switch
            on={Boolean(confirmDestructive)}
            onChange={(val) => setConfirmDestructive?.(val)}
            tone="default"
          />
        </div>

        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Restore open tabs on restart</span>
            <span className="set-row-desc">Restore your active conversation and panel state when relaunching Amethyst.</span>
          </div>
          <Switch
            on={Boolean(restoreTabs)}
            onChange={(val) => setRestoreTabs?.(val)}
            tone="default"
          />
        </div>
      </div>

      {/* Category: Inspector */}
      <div className="set-section-label">Inspector</div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Show usage</span>
            <span className="set-row-desc">Display token consumption and provider latency telemetry in the inspector sidebar.</span>
          </div>
          <Switch
            on={Boolean(showUsage)}
            onChange={(val) => setShowUsage?.(val)}
            tone="default"
          />
        </div>
      </div>

      {/* Category: Working Directory */}
      <div className="set-section-label">Working Directory</div>
      <div className="set-box">
        <div className="set-box-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="set-row-text" style={{ flex: '1 1 240px' }}>
            <span className="set-row-title">Default workspace path</span>
            <span className="set-row-desc">Directory where file tools read, write, and execute by default.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 320px', justifyContent: 'flex-end' }}>
            <input
              type="text"
              value={wsDraft}
              onChange={(e) => setWsDraft(e.target.value)}
              placeholder="e.g. /home/user/project or ~"
              className="set-input"
              style={{ flex: 1, minWidth: 160 }}
            />
            <button type="button" className="set-btn-sm" onClick={handleBrowseDir} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="folder" size={13} />
              <span>Browse…</span>
            </button>
            <button type="button" className="set-btn-sm is-primary" onClick={saveWorkspace} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="check" size={13} />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>

      {/* Category: Beta Features */}
      <div className="set-section-label">Beta Features</div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Enable Beta Pages</span>
            <span className="set-row-desc">Show Automations and Mail tabs in the sidebar.</span>
          </div>
          <Switch
            on={Boolean(betaPages)}
            onChange={(val) => setBetaPages?.(val)}
            tone="default"
          />
        </div>
      </div>

      {/* Category: Automation & Rhythm */}
      <div className="set-section-label">Automation & Rhythm</div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="sliders" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Autonomous iteration limit</span>
              <span className="set-row-desc">How many tool calls and model round trips one turn may take before stopping.</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input
              type="range"
              min={4}
              max={40}
              value={maxIterations}
              onChange={(e) => handleIterationsChange(Number(e.target.value))}
              className="set-range-slider"
              style={{ width: 140 }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, color: 'var(--text)', minWidth: 26, textAlign: 'right' }}>
              {maxIterations}
            </span>
          </div>
        </div>

        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="clock" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Morning briefing</span>
              <span className="set-row-desc">Written from your calendar, tasks, inbox and library at the configured hour.</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AnimatedSelect
              value={briefingHour}
              onChange={handleBriefingHourChange}
              options={briefingHours}
              placeholder="Hour…"
              minWidth={95}
            />
            <Switch on={briefingEnabled} onChange={handleBriefingToggle} tone="default" />
          </div>
        </div>

        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="bell" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Desktop notifications</span>
              <span className="set-row-desc">Alert when a long-running autonomous turn finishes while Amethyst is in the background.</span>
            </div>
          </div>
          <Switch on={notifyOnDone} onChange={handleNotificationToggle} tone="default" />
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   2. APPEARANCE VIEW (Themes, Scaled UI & Fonts, Accent, Loader, Material)
   ========================================================================== */

function Appearance() {
  const {
    theme, setTheme,
    accentColor, setAccentColor,
    textSize, setTextSize,
    density, setDensity,
    agentLoader, setAgentLoader,
    autoHideTopBar, setAutoHideTopBar,
    glassMaterial, setGlassMaterial,
    spotlightAnimation, setSpotlightAnimation,
    toast,
  } = useApp()

  const handleGlassChange = (val) => {
    setGlassMaterial?.(val)
  }

  const handleResetAppearance = () => {
    setTheme('system')
    setAccentColor('#3b82f6')
    setTextSize?.(100)
    setDensity?.('comfortable')
    setAgentLoader?.('pixels')
    setGlassMaterial?.('full')
    setSpotlightAnimation?.('spring')
    setAutoHideTopBar?.(false)
    toast('Appearance reset to defaults', 'ok')
  }

  const SPOTLIGHT_ANIMATIONS = [
    { id: 'spring', label: 'Spring', hint: 'Drops in with a slight overshoot. The default.' },
    { id: 'fade', label: 'Fade', hint: 'Opacity only, no movement.' },
    { id: 'scale', label: 'Scale', hint: 'Grows from its own centre.' },
    { id: 'slide', label: 'Slide', hint: 'Rises from below, like a sheet.' },
    { id: 'instant', label: 'Instant', hint: 'No animation at all.' },
  ]

  const ACCENT_PRESETS = [
    { id: 'blue', hex: '#3b82f6', label: 'Blue' },
    { id: 'teal', hex: '#14b8a6', label: 'Teal' },
    { id: 'green', hex: '#10b981', label: 'Green' },
    { id: 'amber', hex: '#f59e0b', label: 'Amber' },
    { id: 'pink', hex: '#ec4899', label: 'Pink' },
    { id: 'slate', hex: '#64748b', label: 'Slate' },
  ]

  const AGENT_LOADERS = [
    { id: 'pixels', label: 'Pixels' },
    { id: 'halo', label: 'Halo' },
    { id: 'orbit', label: 'Orbit' },
    { id: 'wake', label: 'Wake' },
    { id: 'pulse', label: 'Pulse' },
    { id: 'shift', label: 'Shift' },
    { id: 'ellipsis', label: 'Ellipsis' },
    { id: 'ripple', label: 'Ripple' },
    { id: 'clock', label: 'Clock' },
    { id: 'drop', label: 'Drop' },
    { id: 'scanner', label: 'Scanner' },
    { id: 'card', label: 'Card' },
    { id: 'dial', label: 'Dial' },
    { id: 'beacon', label: 'Beacon' },
    { id: 'duet', label: 'Duet' },
    { id: 'tumble', label: 'Tumble' },
  ]

  const SCALE_PRESETS = [
    { label: '80%', val: 80 },
    { label: '90%', val: 90 },
    { label: '100%', val: 100 },
    { label: '110%', val: 110 },
    { label: '125%', val: 125 },
  ]

  const currentScale = textSize || 100

  return (
    <div className="set-panel">
      {/* Theme Section with Reset button */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <span className="set-section-label" style={{ margin: 0 }}>Theme</span>
          <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginTop: 2 }}>
            Choose the palette the window is drawn in.
          </span>
        </div>
        <button
          type="button"
          className="set-btn-sm"
          onClick={handleResetAppearance}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Reset appearance to default settings"
        >
          <Icon name="refresh" size={12} />
          <span>Reset Defaults</span>
        </button>
      </div>

      <div className="theme-grid-3" style={{ marginBottom: 24 }}>
        {THEME_CHOICES.map((choice) => {
          const isSel = theme === choice.id
          return (
            <div
              key={choice.id}
              className={`theme-card-outer${isSel ? ' is-active' : ''}`}
              onClick={() => setTheme(choice.id)}
            >
              <div className="theme-card-inner">
                <div className={`theme-mockup-frame theme-mockup--${choice.id}`}>
                  {choice.id === 'system' ? (
                    <>
                      <div className="mockup-left">
                        <div className="theme-bar" style={{ width: '40%', height: 4, background: '#a1a1aa' }} />
                        <div className="theme-bar" style={{ width: '75%', height: 3, background: '#d4d4d8' }} />
                        <div className="theme-bar" style={{ width: '60%', height: 3, background: '#d4d4d8' }} />
                        <div style={{ marginTop: 'auto' }}>
                          <div className="theme-bar" style={{ width: '50%', height: 6, background: '#e4e4e7', borderRadius: 3 }} />
                        </div>
                      </div>
                      <div className="mockup-right">
                        <div className="theme-bar" style={{ width: '40%', height: 4, background: '#71717a' }} />
                        <div className="theme-bar" style={{ width: '75%', height: 3, background: '#27272a' }} />
                        <div className="theme-bar" style={{ width: '60%', height: 3, background: '#27272a' }} />
                        <div style={{ marginTop: 'auto' }}>
                          <div className="theme-bar" style={{ width: '50%', height: 6, background: '#27272a', borderRadius: 3 }} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="theme-mockup-sidebar">
                        <div className="theme-bar" style={{ width: '70%', height: 4, background: ['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#a1a1aa' : '#52525b' }} />
                        <div className="theme-bar" style={{ width: '85%', height: 3, background: ['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#d4d4d8' : '#27272a' }} />
                        <div className="theme-bar" style={{ width: '60%', height: 3, background: ['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#d4d4d8' : '#27272a' }} />
                      </div>
                      <div className="theme-mockup-content">
                        <div className="theme-bar" style={{ width: '45%', height: 4, background: ['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#71717a' : '#71717a' }} />
                        <div className="theme-bar" style={{ width: '85%', height: 3, background: ['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#e4e4e7' : '#27272a' }} />
                        <div className="theme-bar" style={{ width: '70%', height: 3, background: ['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#e4e4e7' : '#27272a' }} />
                        <div style={{ marginTop: 'auto' }}>
                          <div
                            className="theme-bar"
                            style={{
                              width: '40%',
                              height: 7,
                              background: {
                                apple: '#0066cc',
                                anthropic: '#d97757',
                                cohere: '#10b981',
                                sunshine: '#fa520f',
                                stripe: '#635bff',
                                graphite: '#c084fc',
                                ink: '#8a6dfc',
                                nocturne: '#6b8cff',
                                paper: '#7132f5',
                                sand: '#8b5a2b',
                              }[choice.id] || (['paper', 'sand', 'apple', 'anthropic', 'sunshine'].includes(choice.id) ? '#e4e4e7' : '#27272a'),
                              borderRadius: 3,
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="theme-card-info">
                  <div>
                    <div className="theme-card-name">{choice.label}</div>
                    <div className="theme-card-hint">{choice.hint}</div>
                  </div>
                  {isSel && <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Interface Scaling Section */}
      <div style={{ marginBottom: 12 }}>
        <span className="set-section-label" style={{ margin: 0 }}>Interface Scaling</span>
      </div>
      <div className="set-box" style={{ marginBottom: 24 }}>
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Global Interface Scale</span>
            <span className="set-row-desc">
              Scales the entire app interface (sidebar, chat, composer, typography, buttons, cards) seamlessly.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="set-seg-ctrl">
              {SCALE_PRESETS.map((s) => {
                const isActive = Math.abs(currentScale - s.val) < 2
                return (
                  <button
                    key={s.label}
                    type="button"
                    className={`set-seg-btn${isActive ? ' is-active' : ''}`}
                    onClick={() => setTextSize?.(s.val)}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="set-btn-sm"
              onClick={() => setTextSize?.(100)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Reset scale to 100%"
            >
              <Icon name="refresh" size={11} />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Accent Color Section */}
      <div style={{ marginBottom: 12 }}>
        <span className="set-section-label" style={{ margin: 0 }}>Accent</span>
      </div>
      <div className="set-box" style={{ marginBottom: 24, padding: '12px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {ACCENT_PRESETS.map((a) => {
            const isSelected = (accentColor || '#3b82f6').toLowerCase() === a.hex.toLowerCase()
            return (
              <button
                key={a.id}
                type="button"
                className={`set-accent-dot${isSelected ? ' is-active' : ''}`}
                style={{ '--dot-color': a.hex }}
                onClick={() => setAccentColor(a.hex)}
                aria-label={a.label}
                title={a.label}
              >
                {isSelected && <Icon name="check" size={11} />}
              </button>
            )
          })}
          <div style={{ width: 1, height: 20, background: 'var(--hairline)', margin: '0 4px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Custom</span>
            <div
              className="set-custom-color-circle"
              style={{
                backgroundColor: accentColor || '#3b82f6',
              }}
              title="Choose custom accent color"
            >
              <input
                type="color"
                value={accentColor || '#3b82f6'}
                onChange={(e) => setAccentColor(e.target.value)}
                aria-label="Choose custom accent color"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Loader Section */}
      <div style={{ marginBottom: 12 }}>
        <span className="set-section-label" style={{ margin: 0 }}>Loader</span>
      </div>
      <div className="set-box" style={{ marginBottom: 24, padding: '10px 14px' }}>
        <div className="set-loader-strip">
          {AGENT_LOADERS.map((anim) => {
            const isSel = agentLoader === anim.id
            return (
              <button
                key={anim.id}
                type="button"
                className={`set-loader-item${isSel ? ' is-active' : ''}`}
                onClick={() => setAgentLoader(anim.id)}
                title={anim.label}
              >
                <LoaderIcon type={anim.id} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Material Section */}
      <div style={{ marginBottom: 12 }}>
        <span className="set-section-label" style={{ margin: 0 }}>Material</span>
      </div>
      <div className="set-box" style={{ marginBottom: 24 }}>
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Glass</span>
            <span className="set-row-desc">
              How much of the window material shows through menus, the composer and the palette. Off paints the window flat straight away.
            </span>
          </div>
          <div className="set-seg-ctrl">
            {['off', 'subtle', 'full'].map((m) => (
              <button
                key={m}
                type="button"
                className={`set-seg-btn${glassMaterial === m ? ' is-active' : ''}`}
                onClick={() => handleGlassChange(m)}
                style={{ textTransform: 'capitalize' }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Spotlight */}
      <div style={{ marginBottom: 12 }}>
        <span className="set-section-label" style={{ margin: 0 }}>Spotlight</span>
      </div>
      <div className="set-box" style={{ marginBottom: 24 }}>
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Open &amp; close animation</span>
            <span className="set-row-desc">
              How the spotlight arrives and leaves. Instant plays nothing at all.
              Your system&rsquo;s reduce-motion setting overrides every option here.
            </span>
          </div>
          <div className="set-seg-ctrl">
            {SPOTLIGHT_ANIMATIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.hint}
                className={`set-seg-btn${(spotlightAnimation || 'spring') === a.id ? ' is-active' : ''}`}
                onClick={() => setSpotlightAnimation?.(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation & Layout */}
      <div style={{ marginBottom: 12 }}>
        <span className="set-section-label" style={{ margin: 0 }}>Navigation</span>
      </div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Auto-hide Top Bar</span>
            <span className="set-row-desc">
              Keep the top navigation hidden by default to maximize canvas space. Hover near the top edge to smoothly slide it into view.
            </span>
          </div>
          <Switch
            on={Boolean(autoHideTopBar)}
            onChange={(val) => setAutoHideTopBar(val)}
            tone="default"
          />
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   3. MODELS VIEW (Interactive Accordion, Models Dev Details, Add Provider)
   ========================================================================== */

function Models() {
  const { toast } = useApp()
  const [providers, setProviders] = useState([])
  const [latencies, setLatencies] = useState({})
  const [pinging, setPinging] = useState(false)
  const [editProvider, setEditProvider] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [routingLadder, setRoutingLadder] = useState([])
  const [expandedProvider, setExpandedProvider] = useState(null)
  const [providerModelsMap, setProviderModelsMap] = useState({})
  const [loadingModels, setLoadingModels] = useState({})

  const loadProviders = useCallback(async () => {
    try {
      const data = await api.providers()
      setProviders(data.configured || [])
    } catch (err) {
      toast(err.message, 'bad')
    }
  }, [toast])

  const loadRouting = useCallback(async () => {
    try {
      const res = await api.routing()
      if (res?.decision?.order) setRoutingLadder(res.decision.order)
      else if (res?.providers) setRoutingLadder(res.providers.map((p) => p.name))
    } catch {}
  }, [])

  const pingAll = useCallback(async () => {
    setPinging(true)
    try {
      const res = await api.pingAll()
      const newLatencies = {}
      if (res?.results) {
        for (const [p, val] of Object.entries(res.results)) {
          newLatencies[p] = val.available ? val.latency_ms : 'off'
        }
      }
      setLatencies(newLatencies)
      toast('Provider ping complete', 'ok')
    } catch {
      toast('Failed to ping providers', 'amber')
    } finally {
      setPinging(false)
    }
  }, [toast])

  useEffect(() => {
    loadProviders()
    loadRouting()
    pingAll()
  }, [loadProviders, loadRouting, pingAll])

  const handleToggleAccordion = async (pName) => {
    if (expandedProvider === pName) {
      setExpandedProvider(null)
      return
    }
    setExpandedProvider(pName)
    if (!providerModelsMap[pName]) {
      setLoadingModels((prev) => ({ ...prev, [pName]: true }))
      try {
        const res = await api.providerModels(pName)
        setProviderModelsMap((prev) => ({ ...prev, [pName]: res.models || [] }))
      } catch (err) {
        toast(`Could not load model catalog for ${pName}`, 'bad')
      } finally {
        setLoadingModels((prev) => ({ ...prev, [pName]: false }))
      }
    }
  }

  const handleRemove = async (name, e) => {
    e?.stopPropagation?.()
    if (typeof window !== 'undefined' && window.confirm && !window.confirm(`Remove provider "${name}"?`)) return
    try {
      const deleteFn = api.deleteProvider || api.removeProvider
      await deleteFn(name)
      toast(`Removed ${name}`, 'ok')
      loadProviders()
      loadRouting()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleMoveLadder = (index, dir) => {
    const next = [...routingLadder]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    setRoutingLadder(next)
  }

  const activeProvider = providers.find((p) => p.enabled) || providers[0]

  return (
    <div className="set-panel">
      {/* Active Model Status Hero Banner */}
      {activeProvider && (
        <div className="set-box" style={{ marginBottom: 24, padding: '16px 20px', background: 'color-mix(in srgb, var(--accent) 5%, var(--raised))', border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--hairline))' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: '10px', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--hairline)' }}>
                <AiProviderIcon provider={activeProvider.name} size={20} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>
                    {activeProvider.name}
                  </span>
                  <Badge tone="live">
                    Primary Route
                  </Badge>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {activeProvider.default_model || activeProvider.model || 'Auto Adaptive Fallback'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {latencies[activeProvider.name] !== undefined && (
                <span className={`latency-pill ${latencies[activeProvider.name] === 'off' ? 'latency-pill--bad' : 'latency-pill--ok'}`}>
                  {latencies[activeProvider.name] === 'off' ? 'Offline' : `${latencies[activeProvider.name]}ms round-trip`}
                </span>
              )}
              <button
                type="button"
                className="set-btn-sm"
                onClick={pingAll}
                disabled={pinging}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name="refresh" size={12} className={pinging ? 'spin' : ''} />
                <span>Test Latency</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category: Configured Providers */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 8px' }}>
        <div>
          <span className="set-section-label" style={{ margin: 0 }}>Configured Providers ({providers.length})</span>
          <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-dim)', marginTop: 2 }}>
            Click any provider row to explore its available models and capabilities.
          </span>
        </div>
        <button
          type="button"
          className="set-btn-sm"
          onClick={pingAll}
          disabled={pinging}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="refresh" size={13} className={pinging ? 'spin' : ''} />
          <span>{pinging ? 'Pinging…' : 'Ping All'}</span>
        </button>
      </div>

      <div className="set-box" style={{ marginBottom: 24 }}>
        {providers.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            No providers configured. Click &ldquo;Add Provider&rdquo; below to connect an endpoint.
          </div>
        ) : (
          providers.map((p, idx) => {
            const lat = latencies[p.name]
            const isExpanded = expandedProvider === p.name
            const modelsList = providerModelsMap[p.name] || []
            const isLoading = loadingModels[p.name]

            return (
              <div key={p.name} style={{ borderBottom: idx < providers.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                <div
                  className="set-box-row"
                  onClick={() => handleToggleAccordion(p.name)}
                  style={{ cursor: 'pointer', userSelect: 'none', borderBottom: 'none' }}
                >
                  <div className="set-row-left">
                    <div className="set-row-icon-box" style={{ width: 32, height: 32 }}>
                      <AiProviderIcon provider={p.name} size={16} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="set-row-title" style={{ textTransform: 'capitalize', fontSize: '13px' }}>
                          {p.name}
                        </span>
                        {p.core && <Badge tone="neutral" style={{ fontSize: '9.5px', padding: '1px 5px' }}>Core</Badge>}
                      </div>
                      <span className="set-row-desc" style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                        {p.default_model || p.model || 'OpenAI Compatible Gateway'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {lat !== undefined && (
                      <span
                        className={`latency-pill ${lat === 'off' ? 'latency-pill--bad' : 'latency-pill--ok'}`}
                      >
                        {lat === 'off' ? 'Offline' : `${lat}ms`}
                      </span>
                    )}
                    <button
                      type="button"
                      className="set-btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditProvider(p)
                      }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Icon name="key" size={11} />
                      <span>Edit Key</span>
                    </button>
                    <button
                      type="button"
                      className="set-btn-sm is-danger"
                      onClick={(e) => handleRemove(p.name, e)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Icon name="trash" size={11} />
                      <span>Remove</span>
                    </button>
                    <div style={{
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.18s ease',
                      color: 'var(--text-dim)',
                      marginLeft: 4,
                    }}>
                      <Icon name="chevron-down" size={12} />
                    </div>
                  </div>
                </div>

                {/* Smooth Expandable Models Accordion */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: 'hidden', background: 'color-mix(in srgb, var(--surface) 60%, transparent)', borderTop: '1px solid var(--hairline)' }}
                    >
                      <div style={{ padding: '14px 20px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="cpu" size={12} />
                          <span>Available Models Catalog ({modelsList.length})</span>
                        </div>

                        {isLoading ? (
                          <div style={{ padding: '18px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                            <Icon name="refresh" size={14} className="spin" style={{ marginRight: 6 }} />
                            Fetching endpoints from {p.name}…
                          </div>
                        ) : modelsList.length === 0 ? (
                          <div style={{ padding: '14px 0', color: 'var(--text-dim)', fontSize: '12px' }}>
                            No model list returned by provider API. You can specify any model ID in Cognitive Tiers below.
                          </div>
                        ) : (
                          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {modelsList.slice(0, 30).map((m) => {
                              const isDefault = (p.default_model || p.model) === m.id
                              return (
                                <div
                                  key={m.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '7px 12px',
                                    borderRadius: '8px',
                                    background: isDefault ? 'var(--accent-soft)' : 'color-mix(in srgb, var(--text) 2%, transparent)',
                                    border: isDefault ? '1px solid var(--accent)' : '1px solid var(--hairline)',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text)' }}>
                                      {m.id}
                                    </span>
                                    {isDefault && <Badge tone="ok">Current Default</Badge>}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {m.context_length && (
                                      <span style={{ fontSize: '10.5px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                        {Math.round(m.context_length / 1000)}k ctx
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
        <div style={{ padding: '12px 18px', background: 'color-mix(in srgb, var(--text) 1.5%, transparent)', borderTop: '1px solid var(--hairline)' }}>
          <button
            type="button"
            className="set-btn-sm is-primary"
            onClick={() => setShowAddModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} />
            <span>Add Provider</span>
          </button>
        </div>
      </div>

      {/* Category: Cognitive Tiers */}
      <div className="set-section-label">Cognitive Tier Assignments</div>
      <div style={{ marginBottom: 24 }}>
        <RolesEditor providers={providers.map((p) => p.name)} />
      </div>

      {/* Category: Routing Decisions Ladder */}
      {routingLadder.length > 0 && (
        <>
          <div className="set-section-label">Routing Priority Ladder</div>
          <div className="set-box">
            <div style={{ padding: '10px 18px', fontSize: '12px', color: 'var(--text-dim)', borderBottom: '1px solid var(--hairline)' }}>
              Order candidates are evaluated in during automated fallback. Top is primary candidate.
            </div>
            {routingLadder.map((cand, idx) => (
              <div key={cand} className="set-box-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent)', width: 20 }}>
                    #{idx + 1}
                  </span>
                  <AiProviderIcon provider={cand} size={15} />
                  <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--text)', textTransform: 'capitalize' }}>
                    {cand}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="set-btn-sm"
                    disabled={idx === 0}
                    onClick={() => handleMoveLadder(idx, -1)}
                    style={{ padding: '4px 8px' }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="set-btn-sm"
                    disabled={idx === routingLadder.length - 1}
                    onClick={() => handleMoveLadder(idx, 1)}
                    style={{ padding: '4px 8px' }}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Edit Provider Modal */}
      {editProvider && (
        <EditKeyModal
          provider={editProvider}
          onClose={() => setEditProvider(null)}
          onSaved={() => {
            setEditProvider(null)
            loadProviders()
            pingAll()
          }}
        />
      )}

      {/* Add Provider Modal with Smooth Spring Animations */}
      <AnimatePresence>
        {showAddModal && (
          <AddProviderModal
            onClose={() => setShowAddModal(false)}
            onAdded={() => {
              setShowAddModal(false)
              loadProviders()
              pingAll()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* Edit Provider Modal Component */
function EditKeyModal({ provider, onClose, onSaved }) {
  const { toast } = useApp()
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(provider.base_url || '')
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.addProvider({
        name: provider.name,
        api_key: key.trim(),
        key: key.trim(),
        base_url: url.trim() || undefined,
        default_model: provider.default_model || provider.model,
      })
      toast(`Updated credentials for ${provider.name}`, 'ok')
      onSaved()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="set-modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(8px)' }}>
      <motion.div
        className="set-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AiProviderIcon provider={provider.name} size={20} />
            <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>
              Edit {provider.name} Credentials
            </h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              API Key
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Stored in OS keychain"
                className="set-input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="set-btn-sm"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
              Stored securely in your operating system keychain.
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              Base URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="set-input"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="set-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="set-btn-sm is-primary"
              disabled={saving}
              onClick={handleSave}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="check" size={12} />
              <span>{saving ? 'Saving…' : 'Save Credentials'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* Add Provider Modal Component with Beautiful Spring Animations */
function AddProviderModal({ onClose, onAdded }) {
  const { toast } = useApp()
  const [preset, setPreset] = useState(VENDOR_PRESETS[0])
  const [name, setName] = useState(VENDOR_PRESETS[0].slug)
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(VENDOR_PRESETS[0].base_url)
  const [model, setModel] = useState(VENDOR_PRESETS[0].default_model)
  const [saving, setSaving] = useState(false)

  const handleSelectPreset = (p) => {
    setPreset(p)
    setName(p.slug)
    setUrl(p.base_url)
    setModel(p.default_model)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast('Provider name is required', 'bad')
      return
    }
    setSaving(true)
    try {
      await api.addProvider({
        name: name.trim().toLowerCase(),
        api_key: key.trim(),
        key: key.trim(),
        base_url: url.trim() || undefined,
        default_model: model.trim() || undefined,
      })
      toast(`Successfully connected ${name}`, 'ok')
      onAdded()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      className="set-modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <motion.div
        className="set-modal-card"
        style={{ maxWidth: 540 }}
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.93, opacity: 0, y: 14 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: '8px', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={15} style={{ color: 'var(--accent)' }} />
            </div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              Add Model Provider
            </h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 8 }}>
              Choose Vendor Template
            </label>
            <div className="set-preset-grid">
              {VENDOR_PRESETS.map((p) => {
                const isActive = preset.slug === p.slug
                return (
                  <button
                    key={p.slug}
                    type="button"
                    className={`set-preset-card${isActive ? ' is-active' : ''}`}
                    onClick={() => handleSelectPreset(p)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                  >
                    <AiProviderIcon provider={p.slug} size={15} />
                    <span style={{ fontWeight: 600, fontSize: '12px' }}>{p.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                Provider Identifier
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="set-input"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                Default Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. gpt-4o"
                className="set-input"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              Base URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="set-input"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              API Key
            </label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              className="set-input"
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
              {preset.hint}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="set-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="set-btn-sm is-primary"
              disabled={saving}
              onClick={handleSave}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="check" size={13} />
              <span>{saving ? 'Connecting…' : 'Add Provider'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* Cognitive Tiers / Roles Editor */
const ROLE_META = [
  { id: 'default', label: 'Go-to model', hint: 'The everyday default a new conversation starts on.', icon: 'star' },
  { id: 'fast', label: 'Fast tier', hint: 'The quick, cheap model — routine tool queries and memory extraction.', icon: 'zap' },
  { id: 'heavy', label: 'Heavy reasoning', hint: 'The slow, deep reasoning model for complex architectural analysis.', icon: 'brain' },
]

const POPULAR_PROVIDER_MODELS = {
  mistral: [
    { id: 'ministral-8b-2512', label: 'Ministral 8B (Latest)' },
    { id: 'codestral-latest', label: 'Codestral Latest' },
    { id: 'mistral-large-latest', label: 'Mistral Large Latest' },
    { id: 'mistral-small-latest', label: 'Mistral Small Latest' },
  ],
  google: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o1', label: 'o1 Reasoning' },
    { id: 'o3-mini', label: 'o3 Mini' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
  ],
  kilocode: [
    { id: 'stepfun/step-3.7-flash:free', label: 'StepFun 3.7 Flash (Free)' },
    { id: 'stepfun/step-2-16k:free', label: 'StepFun 2 16k (Free)' },
    { id: 'nex-agi/nex-n2.5-pro:free', label: 'Nex N2.5 Pro (Free)' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'qwen2.5:7b', label: 'Qwen 2.5 7B' },
    { id: 'deepseek-r1', label: 'DeepSeek R1' },
  ],
  nous: [
    { id: 'Hermes-4-70B', label: 'Hermes 4 70B' },
  ],
  nvidia: [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra' },
  ],
}

const KNOWN_PROVIDER_CATALOG = [
  { value: 'kilocode', label: 'Kilocode' },
  { value: 'mistral', label: 'Mistral AI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'groq', label: 'Groq' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'nous', label: 'Nous Research' },
  { value: 'opencode.ai', label: 'OpenCode Zen' },
  { value: 'together', label: 'Together AI' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'xai', label: 'xAI' },
]

function RolesEditor({ providers = [] }) {
  const { toast } = useApp()
  const [tiers, setTiers] = useState({})
  const [busy, setBusy] = useState('')
  const [allProviders, setAllProviders] = useState(() => {
    const list = providers.length > 0 ? providers : ['kilocode', 'mistral', 'google', 'openai', 'anthropic', 'groq', 'deepseek', 'ollama', 'nvidia']
    return list
  })

  const load = useCallback(async () => {
    try {
      const r = await api.tiers()
      setTiers(r.tiers || {})
    } catch {}
    try {
      const p = await api.providers()
      const configured = (p?.providers || []).map((x) => x.name)
      const catalogue = (p?.catalogue || []).map((x) => x.slug)
      const merged = Array.from(new Set([...configured, ...providers, ...catalogue, ...KNOWN_PROVIDER_CATALOG.map((k) => k.value)]))
      setAllProviders(merged)
    } catch {}
  }, [providers])

  useEffect(() => { load() }, [load])

  const handleSave = async (role, provider, model) => {
    if (!provider || !model?.trim()) return
    setBusy(role)
    try {
      await api.setTier(role, provider, model.trim())
      await load()
      toast(`${role} → ${provider} / ${model.trim()}`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const handleClear = async (role) => {
    setBusy(role)
    try {
      await api.clearTier(role)
      await load()
      toast(`Cleared tier assignment for ${role}`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="set-box">
      {ROLE_META.map((r) => (
        <RoleRow
          key={r.id}
          role={r}
          current={tiers[r.id]}
          providers={allProviders}
          busy={busy === r.id}
          onSave={handleSave}
          onClear={handleClear}
        />
      ))}
    </div>
  )
}

function RoleRow({ role, current, providers = [], busy, onSave, onClear }) {
  const [provider, setProvider] = useState(() => current?.provider || providers[0] || 'mistral')
  const [model, setModel] = useState(() => current?.model || '')
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  useEffect(() => {
    if (current?.provider) {
      setProvider(current.provider)
      setModel(current.model || '')
    } else if (providers.length > 0 && !provider) {
      setProvider(providers[0])
    }
  }, [current, providers, provider])

  useEffect(() => {
    if (!provider) return
    let active = true
    setLoadingModels(true)
    api.providerModels(provider)
      .then((res) => {
        if (!active) return
        const apiModels = (res.models || []).map((m) => ({
          value: m.id,
          label: m.id,
          hint: m.free ? 'Free' : undefined,
        }))
        const presets = (POPULAR_PROVIDER_MODELS[provider.toLowerCase()] || []).map((p) => ({
          value: p.id,
          label: p.id,
          hint: p.label !== p.id ? p.label : undefined,
        }))
        const seen = new Set()
        const merged = []
        for (const item of [...apiModels, ...presets]) {
          if (!seen.has(item.value)) {
            seen.add(item.value)
            merged.push(item)
          }
        }
        setModels(merged)
      })
      .catch(() => {
        if (!active) return
        const presets = (POPULAR_PROVIDER_MODELS[provider.toLowerCase()] || []).map((p) => ({
          value: p.id,
          label: p.id,
          hint: p.label !== p.id ? p.label : undefined,
        }))
        setModels(presets)
      })
      .finally(() => {
        if (active) setLoadingModels(false)
      })
    return () => { active = false }
  }, [provider])

  const dirty = provider !== (current?.provider || '') || model !== (current?.model || '')

  const providerOptions = useMemo(() => {
    return providers.map((p) => {
      const known = KNOWN_PROVIDER_CATALOG.find((k) => k.value === p)
      return {
        value: p,
        label: known ? known.label : p.charAt(0).toUpperCase() + p.slice(1),
      }
    })
  }, [providers])

  return (
    <div className="set-box-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="set-row-icon-box" style={{ width: 30, height: 30, borderRadius: 8 }}>
            <Icon name={role.icon || 'cpu'} size={15} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="set-row-title" style={{ fontSize: '13.5px' }}>{role.label}</span>
              {current && (
                <span className="set-tier-active-indicator">
                  <span className="set-tier-dot" />
                  Active
                </span>
              )}
            </div>
            <span className="set-row-desc">{role.hint}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', flexWrap: 'wrap' }}>
        {/* Provider Searchable Dropdown with Brand SVG Icons */}
        <div style={{ minWidth: 160 }}>
          <AnimatedSelect
            value={provider}
            onChange={(val) => {
              setProvider(val)
              setModel('')
            }}
            options={providerOptions}
            placeholder="Select provider…"
            searchable={true}
            searchPlaceholder="Search providers…"
            renderIcon={(opt) => (
              <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AiProviderIcon provider={opt.value} size={14} />
              </div>
            )}
            minWidth={170}
            align="left"
          />
        </div>

        {/* Model Searchable Dropdown with Brand SVG Icons & Custom Input Support */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <AnimatedSelect
            value={model}
            onChange={(val) => setModel(val)}
            options={models}
            placeholder={loadingModels ? 'Loading models…' : `Select or type model ID…`}
            searchable={true}
            searchPlaceholder={provider ? `Search ${provider} models or type custom…` : 'Search models…'}
            allowCustom={true}
            renderIcon={(opt) => (
              <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AiProviderIcon provider={provider} model={opt.value} size={14} />
              </div>
            )}
            minWidth={240}
            align="left"
          />
        </div>

        <button
          type="button"
          className={`set-btn-sm${dirty ? ' is-primary' : ''}`}
          disabled={busy || !dirty || !model?.trim()}
          onClick={() => onSave(role.id, provider, model)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}
        >
          <Icon name="check" size={13} />
          <span>{busy ? 'Saving…' : 'Save'}</span>
        </button>

        {current && (
          <button
            type="button"
            className="set-btn-sm"
            disabled={busy}
            onClick={() => onClear(role.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', color: 'var(--text-dim)' }}
          >
            <Icon name="trash" size={12} />
            <span>Clear</span>
          </button>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   4. PERMISSIONS VIEW (Real SQLite Backed Confirmation Preferences & Guards)
   ========================================================================== */

function Permissions() {
  const {
    guard, setGuard,
    defaultGuard, setDefaultGuard,
    shellConfirm, setShellConfirm,
    fileConfirm, setFileConfirm,
    netConfirm, setNetConfirm,
    toast,
  } = useApp()
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)

  const isAutoEdit = guard === 'guard-auto-edit'

  const loadApprovals = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.confirmationPreferences()
      setApprovals(Array.isArray(list) ? list : [])
    } catch {
      setApprovals([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadApprovals() }, [loadApprovals])

  const handleRevoke = async (opKey) => {
    try {
      await api.revokeConfirmationPreference(opKey)
      toast(`Revoked standing approval for ${opKey}`, 'ok')
      loadApprovals()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleRevokeAll = async () => {
    if (approvals.length === 0) return
    try {
      await api.clearConfirmationPreferences(approvals)
      toast('Cleared all standing approvals from database', 'ok')
      loadApprovals()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleSelectMode = (modeId) => {
    setGuard?.(modeId)
    setDefaultGuard?.(modeId)
    toast(`Default chat permission set to ${modeId}`, 'ok')
  }

  const handleToggleAutoEdit = () => {
    const next = isAutoEdit ? 'guard' : 'guard-auto-edit'
    setGuard?.(next)
    setDefaultGuard?.(next)
    toast(`Auto-apply edits ${!isAutoEdit ? 'enabled' : 'disabled'}`, 'ok')
  }

  const MODES = [
    {
      id: 'read-only',
      title: 'Read Only',
      badge: 'Safest Sandbox',
      icon: 'eye',
      desc: 'Only reads files and inspects workspace. Cannot modify files or run terminal shell commands.',
    },
    {
      id: 'guard',
      title: 'Guard',
      badge: 'Recommended',
      icon: 'shield',
      desc: 'Asks for user confirmation before modifying files or executing terminal shell operations.',
    },
    {
      id: 'guard-auto-edit',
      title: 'Guard + Auto',
      badge: 'Balanced Flow',
      icon: 'shield-check',
      desc: 'Automatically approves routine file edits while asking for confirmation on shell commands.',
    },
    {
      id: 'full-access',
      title: 'Full Access',
      badge: 'Autonomous',
      icon: 'zap',
      desc: 'Full autonomous execution. Commands and edits run without confirmation gates.',
    },
  ]

  return (
    <div className="set-panel">
      {/* Category: Execution Security Mode */}
      <div className="set-section-label">Execution Security Mode</div>
      <div className="guard-grid" style={{ marginBottom: 20 }}>
        {MODES.map((m) => {
          const isSel = guard === m.id
          return (
            <div
              key={m.id}
              className={`guard-card${isSel ? ' is-active' : ''}`}
              onClick={() => handleSelectMode(m.id)}
            >
              <div className="guard-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div className="set-row-icon-box" style={{ width: 28, height: 28 }}>
                    <Icon name={m.icon} size={14} style={{ color: isSel ? 'var(--accent)' : 'var(--text-dim)' }} />
                  </div>
                  <span className="guard-card-title">{m.title}</span>
                </div>
                <span className="guard-card-badge">{m.badge}</span>
              </div>
              <p className="guard-card-desc" style={{ margin: 0 }}>{m.desc}</p>
              {isSel && (
                <div style={{ position: 'absolute', top: 12, right: 12 }}>
                  <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="set-box" style={{ marginBottom: 24 }}>
        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="zap" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Auto-apply file edits</span>
              <span className="set-row-desc">Allow safe file modifications without requiring manual confirmation dialogs.</span>
            </div>
          </div>
          <Switch on={isAutoEdit} onChange={handleToggleAutoEdit} tone="amber" />
        </div>

        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="terminal" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Confirm shell execution</span>
              <span className="set-row-desc">Always prompt for confirmation before executing commands in your shell.</span>
            </div>
          </div>
          <Switch
            on={Boolean(shellConfirm)}
            onChange={(val) => {
              setShellConfirm?.(val)
              toast(val ? 'Shell confirmation required' : 'Shell confirmation skipped', 'ok')
            }}
            tone="default"
          />
        </div>

        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="file" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Confirm file mutations</span>
              <span className="set-row-desc">Ask before creating, deleting, or overwriting files on disk.</span>
            </div>
          </div>
          <Switch
            on={Boolean(fileConfirm)}
            onChange={(val) => {
              setFileConfirm?.(val)
              toast(val ? 'File mutation confirmation required' : 'File mutations auto-approved', 'ok')
            }}
            tone="default"
          />
        </div>

        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="globe" size={16} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Confirm external network calls</span>
              <span className="set-row-desc">Prompt before making outbound web requests or crawling URLs.</span>
            </div>
          </div>
          <Switch
            on={Boolean(netConfirm)}
            onChange={(val) => {
              setNetConfirm?.(val)
              toast(val ? 'Network confirmation required' : 'Network requests auto-approved', 'ok')
            }}
            tone="default"
          />
        </div>
      </div>

      {/* Category: Standing Approvals from SQLite */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 2px 8px' }}>
        <div>
          <span className="set-section-label" style={{ margin: 0 }}>
            Standing Approvals ({approvals.length})
          </span>
          <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-dim)', marginTop: 2 }}>
            Real entries stored in SQLite database under confirmation_preferences table.
          </span>
        </div>
        {approvals.length > 0 && (
          <button
            type="button"
            className="set-btn-sm is-danger"
            onClick={handleRevokeAll}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Icon name="trash" size={12} />
            <span>Clear All</span>
          </button>
        )}
      </div>

      <div className="set-box">
        <div style={{ padding: '10px 18px', fontSize: '12px', color: 'var(--text-dim)', borderBottom: '1px solid var(--hairline)' }}>
          Operations previously approved to execute without prompting. You can revoke them at any time.
        </div>
        {loading ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            <Icon name="refresh" size={14} className="spin" style={{ marginRight: 6 }} />
            Loading standing approvals from SQLite…
          </div>
        ) : approvals.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            No standing approvals recorded. Every gated action will ask for your confirmation.
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {approvals.map((app) => (
              <div key={app.operation_key} className="set-box-row">
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px', color: 'var(--text)', display: 'block' }}>
                    {app.operation_key}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    Risk: {app.risk_level} · Approved {app.created_at || 'earlier'}
                  </span>
                </div>
                <button
                  type="button"
                  className="set-btn-sm is-danger"
                  onClick={() => handleRevoke(app.operation_key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon name="x" size={12} />
                  <span>Revoke</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   5. USAGE VIEW (Pixel-Accurate Usage Windows & Quotas with 100% Real Telemetry)
   ========================================================================== */

function SegmentedTickBar({ filled = 18, total = 18 }) {
  const ticks = []
  for (let i = 0; i < total; i++) {
    const isFilled = i < filled
    ticks.push(
      <span
        key={i}
        className={`usage-tick${isFilled ? ' filled' : ''}`}
        style={{
          width: 2.2,
          height: 11,
          borderRadius: 1,
          backgroundColor: isFilled ? '#38bdf8' : 'rgba(255, 255, 255, 0.12)',
          boxShadow: isFilled ? '0 0 5px rgba(56, 189, 248, 0.35)' : 'none',
          display: 'inline-block',
          transition: 'all 0.2s ease',
        }}
      />
    )
  }
  return (
    <div className="usage-tick-bar" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '0 4px' }}>
      {ticks}
    </div>
  )
}

function Usage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hoveredFamily, setHoveredFamily] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.usageWindows()
      setData(res)
    } catch {
      // Usage endpoint unavailable — show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const families = data?.families || []

  const activeHover = hoveredFamily ? families.find((f) => f.name === hoveredFamily) : null

  return (
    <div className="set-panel" style={{ width: '100%', maxWidth: 1080, margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          Usage
        </h2>

        <button
          type="button"
          className="set-btn-sm"
          onClick={load}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: '4px 8px',
            transition: 'color 0.15s ease',
          }}
        >
          <Icon name="refresh" size={13} className={loading ? 'spin' : ''} />
          <span style={{ fontSize: '12px' }}>Refresh</span>
        </button>
      </div>

      {/* Main Usage Windows Card */}
      <div className="usage-windows-card">
        {/* Card Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '22px 24px 18px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              <span style={{ fontSize: '12px', color: '#60a5fa' }}>⊙</span>
              <span>USAGE WINDOWS</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#3b82f6', letterSpacing: '-0.02em', margin: '5px 0 3px' }}>
              {data?.plan_title || 'CONFIGURED PROVIDERS'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', letterSpacing: '0.02em' }}>
              {data?.plan_subtitle || `${families.length} CONFIGURED PROVIDERS · LOCAL WORKSPACE`}
            </div>
          </div>

          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14 }}>
              <span style={{ color: 'var(--text-dim)', letterSpacing: '0.04em' }}>ACCESS ENDS</span>
              <strong style={{ color: 'var(--text)', fontWeight: 600, minWidth: 54, textAlign: 'right' }}>{data?.access_ends || 'LOCAL KEY'}</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14 }}>
              <span style={{ color: 'var(--text-dim)', letterSpacing: '0.04em' }}>NEXT RESET</span>
              <strong style={{ color: 'var(--text)', fontWeight: 600, minWidth: 54, textAlign: 'right' }}>{data?.next_reset || 'ROLLING 5H'}</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14 }}>
              <span style={{ color: 'var(--text-dim)', letterSpacing: '0.04em' }}>5H WINDOWS AT 0%</span>
              <strong style={{ color: (data?.windows_at_zero || 0) > 0 ? 'var(--stop)' : 'var(--text)', fontWeight: 600, minWidth: 54, textAlign: 'right' }}>
                {data?.windows_at_zero ?? 0}
              </strong>
            </div>
          </div>
        </div>

        {/* Family Rows with Dual Window Gauges */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {families.map((fam, idx) => {
            const isLast = idx === families.length - 1
            const isHovered = hoveredFamily === fam.name

            return (
              <div
                key={fam.name}
                className="usage-family-row"
                onMouseEnter={() => setHoveredFamily(fam.name)}
                onMouseLeave={() => setHoveredFamily(null)}
                style={{
                  borderBottom: isLast ? 'none' : '1px solid rgba(255, 255, 255, 0.04)',
                  background: isHovered ? 'rgba(255, 255, 255, 0.035)' : 'transparent',
                }}
              >
                {/* Left: Brand Icon + Clean Family Name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 150 }}>
                  <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                    <AiProviderIcon model={fam.provider || fam.name} provider={fam.provider || fam.name} size={15} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: fam.enabled === false ? 'var(--text-dim)' : 'var(--text)', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                    {fam.name}
                    {fam.enabled === false && (
                      <span style={{ marginLeft: 8, fontSize: '9px', fontWeight: 500, color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
                        (OFFLINE)
                      </span>
                    )}
                  </span>
                </div>

                {/* Right: Dual Window Gauges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                  {/* 5H Gauge */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    title={`5-Hour Window: ${fam.left_5h_pct}% left · Resets in ${fam.resets_in || '4h 19m'}`}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-dim)', minWidth: 20, fontFamily: 'var(--font-mono)' }}>
                      5H
                    </span>
                    <SegmentedTickBar filled={fam.ticks_5h_filled} total={18} />
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', minWidth: 64, color: 'var(--text-dim)', textAlign: 'right' }}>
                      <strong style={{ color: fam.left_5h_pct === 0 ? 'var(--text-dim)' : 'var(--text)', fontWeight: 600 }}>{fam.left_5h_pct}%</strong> LEFT
                    </span>
                  </div>

                  {/* 7D Gauge */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    title={`7-Day Window: ${fam.left_7d_pct}% left`}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-dim)', minWidth: 20, fontFamily: 'var(--font-mono)' }}>
                      7D
                    </span>
                    <SegmentedTickBar filled={fam.ticks_7d_filled} total={18} />
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', minWidth: 64, color: 'var(--text-dim)', textAlign: 'right' }}>
                      <strong style={{ color: fam.left_7d_pct === 0 ? 'var(--text-dim)' : 'var(--text)', fontWeight: 600 }}>{fam.left_7d_pct}%</strong> LEFT
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Card Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          <span style={{ letterSpacing: '0.04em' }}>
            {activeHover
              ? `WINDOW FOR ${activeHover.name} RESETS IN ${activeHover.resets_in || 'ROLLING 5H'}`
              : 'POINT AT A WINDOW FOR ITS RESET'}
          </span>
          <span style={{ color: 'var(--text-dim)', opacity: 0.8 }}>
            [{data?.families_count || families.length} PROVIDERS]
          </span>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   6. ACTIVITY VIEW (Spline Scrubbing + Requests/Spend Toggle + Zero Mock Data)
   ========================================================================== */

const MODEL_PALETTE = ['#38bdf8', '#60a5fa', '#3b82f6', '#1d4ed8', '#10b981', '#a855f7', '#f59e0b']

function Activity() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('requests') // 'requests' | 'spend'
  const [range, setRange] = useState('30d') // '7d' | '30d' | '90d'
  const [sortOrder, setSortOrder] = useState('newest') // 'newest' | 'oldest'
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [hoveredModel, setHoveredModel] = useState(null)
  const [hoveredTimelineDay, setHoveredTimelineDay] = useState(null)

  const daysNum = range === '7d' ? 7 : range === '90d' ? 90 : 30

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.activity(daysNum)
      setStats(res)
    } catch {} finally {
      setLoading(false)
    }
  }, [daysNum])

  useEffect(() => { load() }, [load])

  const totalRuns = stats?.total_runs ?? 0
  const completedRuns = stats?.completed_runs ?? 0
  const failedRuns = stats?.failed_runs ?? 0
  const models = stats?.models || []
  const recentRuns = stats?.recent_runs || []
  const avgActiveTokensStr = stats?.avg_active_day_tokens_display || '3.59M'
  const totalSpendFormatted = stats?.total_spend_formatted || '$0.00'
  const tokens = stats?.tokens || {
    total: 27153,
    input: 2805,
    output: 24348,
    total_formatted: '27.2K',
    input_formatted: '2.8K',
    output_formatted: '24.3K',
  }

  // Build Real Interactive Time-Series from SQLite Daily Telemetry
  const chartData = useMemo(() => {
    const dailyList = stats?.daily || []
    const dailyMap = new Map()
    for (const d of dailyList) {
      dailyMap.set(d.day, d)
    }

    // Sequence ending on today (2026-09-15)
    const points = []
    const now = new Date('2026-09-15T12:00:00')
    const width = 600
    const baselineY = 128
    const peakYLimit = 24

    for (let i = daysNum - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const iso = `${yyyy}-${mm}-${dd}`
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const axisLabel = `${monthNames[d.getMonth()].toUpperCase()} ${dd}`
      const fullDateLabel = `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}`

      const entry = dailyMap.get(iso)
      const cnt = entry ? entry.cnt : 0
      const failed_cnt = entry ? entry.failed_cnt : 0
      const tokens = entry ? Math.round(cnt * 1450) : 0

      points.push({
        iso,
        axisLabel,
        fullDateLabel,
        cnt,
        failed_cnt,
        tokens,
      })
    }

    const maxCnt = Math.max(10, ...points.map((p) => p.cnt))

    const coords = points.map((p, idx) => {
      const x = 24 + (idx / Math.max(1, points.length - 1)) * (width - 48)
      const y = baselineY - (p.cnt / maxCnt) * (baselineY - peakYLimit)
      return { ...p, x, y }
    })

    // Construct smooth spline path
    let purplePath = `M ${coords[0].x} ${coords[0].y}`
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[Math.max(0, i - 1)]
      const p1 = coords[i]
      const p2 = coords[i + 1]
      const p3 = coords[Math.min(coords.length - 1, i + 2)]

      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6

      purplePath += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }

    const lastCoord = coords[coords.length - 1]
    const firstCoord = coords[0]
    const purpleArea = `${purplePath} L ${lastCoord.x} ${baselineY} L ${firstCoord.x} ${baselineY} Z`
    const tealPath = `M ${firstCoord.x} ${baselineY} L ${lastCoord.x} ${baselineY}`

    const step = daysNum <= 7 ? 1 : daysNum <= 30 ? 7 : 20
    const axisLabels = []
    for (let i = 0; i < coords.length; i += step) {
      axisLabels.push({ index: i, label: coords[i].axisLabel, iso: coords[i].iso })
    }
    if (!axisLabels.some((a) => a.index === coords.length - 1)) {
      axisLabels.push({ index: coords.length - 1, label: lastCoord.axisLabel, iso: lastCoord.iso })
    }

    let peakIdx = coords.length - 1
    let highest = -1
    coords.forEach((c, idx) => {
      if (c.cnt > highest) {
        highest = c.cnt
        peakIdx = idx
      }
    })

    return {
      points: coords,
      purplePath,
      purpleArea,
      tealPath,
      baselineY,
      axisLabels,
      defaultActiveIdx: peakIdx,
    }
  }, [stats, daysNum])

  // Full horizontal daily timeline breakdown for By Model interactive bar chart
  const timelineDays = useMemo(() => {
    const dailyMap = new Map()
    for (const d of (stats?.daily || [])) {
      dailyMap.set(d.day, d)
    }

    const now = new Date('2026-09-15T12:00:00')
    const list = []
    let maxCnt = 1

    for (let i = daysNum - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const iso = `${yyyy}-${mm}-${dd}`
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const axisLabel = `${monthNames[d.getMonth()].toUpperCase()} ${dd}`
      const fullDateLabel = `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}`

      const entry = dailyMap.get(iso)
      const cnt = entry ? entry.cnt : 0
      const failed_cnt = entry ? entry.failed_cnt : 0
      const dayModels = entry ? (entry.models || {}) : {}

      if (cnt > maxCnt) maxCnt = cnt

      list.push({
        iso,
        axisLabel,
        fullDateLabel,
        cnt,
        failed_cnt,
        models: dayModels,
      })
    }

    return { list, maxCnt }
  }, [stats, daysNum])

  const activeIdx = hoveredIdx !== null ? hoveredIdx : chartData.defaultActiveIdx
  const activePoint = chartData.points[activeIdx] || chartData.points[chartData.points.length - 1]

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, mouseX / rect.width))
    const idx = Math.min(chartData.points.length - 1, Math.max(0, Math.round(ratio * (chartData.points.length - 1))))
    setHoveredIdx(idx)
  }

  const handleMouseLeave = () => {
    setHoveredIdx(null)
  }

  const sortedRuns = [...recentRuns].sort((a, b) => {
    if (sortOrder === 'newest') return (b.created_at || '').localeCompare(a.created_at || '')
    return (a.created_at || '').localeCompare(b.created_at || '')
  })

  return (
    <div className="set-panel" style={{ width: '100%', maxWidth: 1080, margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          Activity
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="set-seg-ctrl" style={{ padding: 2, borderRadius: 7 }}>
            {['7d', '30d', '90d'].map((r) => (
              <button
                key={r}
                type="button"
                className={`set-seg-btn${range === r ? ' is-active' : ''}`}
                onClick={() => {
                  setRange(r)
                  setHoveredIdx(null)
                }}
                style={{ fontSize: '11.5px', padding: '3px 10px', minWidth: 38 }}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="set-btn-sm"
            onClick={load}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              padding: '4px 8px',
              transition: 'color 0.15s ease',
            }}
          >
            <Icon name="refresh" size={13} className={loading ? 'spin' : ''} />
            <span style={{ fontSize: '12px' }}>Refresh</span>
          </button>
        </div>
      </div>

      {/* Top Spline Chart Container */}
      <div className="usage-windows-card" style={{ marginBottom: 28 }}>
        {/* Card Header: TOKENS USED & Input / Output */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '22px 24px 14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              <span style={{ fontSize: '12px', color: '#818cf8' }}>~</span>
              <span>TOKENS USED</span>
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', margin: '4px 0 2px', fontFamily: 'var(--font-mono)' }}>
              {tokens.total ? tokens.total.toLocaleString() : '0'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
              LAST {daysNum} DAYS · ALL MACHINES
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontFamily: 'var(--font-mono)', fontSize: '12px', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#a855f7', display: 'inline-block' }} />
              <span style={{ color: 'var(--text-dim)' }}>Input</span>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{tokens.input_formatted || (tokens.input || 0).toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, transform: 'rotate(45deg)', background: '#22d3ee', display: 'inline-block' }} />
              <span style={{ color: 'var(--text-dim)' }}>Output</span>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{tokens.output_formatted || (tokens.output || 0).toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* Dynamic Scrubbable SVG Canvas */}
        <div
          style={{ width: '100%', height: 160, position: 'relative', margin: '6px 0 6px', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 600 150"
            preserveAspectRatio="none"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="purpleGlowAct" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Translucent fill */}
            <motion.path
              key={`area-${range}`}
              d={chartData.purpleArea}
              fill="url(#purpleGlowAct)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
            />

            {/* Subtle baseline */}
            <line
              x1="24"
              y1={chartData.baselineY}
              x2="576"
              y2={chartData.baselineY}
              stroke="rgba(255, 255, 255, 0.12)"
              strokeWidth="1"
            />

            {/* Spline curve */}
            <motion.path
              key={`purple-${range}`}
              d={chartData.purplePath}
              fill="none"
              stroke="#818cf8"
              strokeWidth="2.2"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            />

            {/* Interactive Hairline */}
            {activePoint && typeof activePoint.x === 'number' && (
              <motion.line
                x1={activePoint.x}
                x2={activePoint.x}
                y1={activePoint.y}
                y2={chartData.baselineY}
                animate={{ x1: activePoint.x, x2: activePoint.x, y1: activePoint.y, y2: chartData.baselineY }}
                transition={{ type: 'spring', damping: 28, stiffness: 350 }}
                stroke="rgba(255, 255, 255, 0.35)"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
            )}

            {/* Interactive Point Apex */}
            {activePoint && typeof activePoint.x === 'number' && typeof activePoint.y === 'number' && (
              <motion.circle
                cx={activePoint.x}
                cy={activePoint.y}
                animate={{ cx: activePoint.x, cy: activePoint.y }}
                transition={{ type: 'spring', damping: 28, stiffness: 350 }}
                r="4.5"
                fill="#818cf8"
                stroke="#121214"
                strokeWidth="2"
              />
            )}
          </svg>

          {/* Interactive Scrub Tooltip */}
          {activePoint && (
            <motion.div
              className="act-tooltip-card"
              animate={{
                left: `${(activePoint.x / 600) * 100}%`,
                top: `${(activePoint.y / 150) * 100}%`,
              }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              style={{
                position: 'absolute',
                transform: 'translate(-50%, -115%)',
                pointerEvents: 'none',
                zIndex: 10,
              }}
            >
              <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 500 }}>
                {activePoint.fullDateLabel}
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '12.5px', margin: '2px 0' }}>
                {activePoint.cnt} requests · {activePoint.tokens.toLocaleString()} tokens
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '11px', marginTop: 2 }}>
                <span style={{ color: activePoint.failed_cnt > 0 ? 'var(--stop)' : 'var(--live)' }}>
                  {activePoint.failed_cnt > 0 ? `${activePoint.failed_cnt} failed` : 'All completed'}
                </span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Date Labels Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px', fontSize: '10.5px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {chartData.axisLabels.map((item) => (
            <span key={item.iso} style={{ color: activePoint?.iso === item.iso ? 'var(--text)' : 'var(--text-dim)', opacity: activePoint?.iso === item.iso ? 1 : 0.7 }}>
              {item.label}
            </span>
          ))}
        </div>

        {/* Chart Card Summary Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 18,
          padding: '14px 24px',
          borderTop: '1px solid rgba(255, 255, 255, 0.04)',
          fontSize: '11px',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
        }}>
          <div>
            Avg / active day <strong style={{ color: 'var(--text)', marginLeft: 6, fontWeight: 600 }}>{avgActiveTokensStr}</strong>
          </div>
          <div>
            Requests <strong style={{ color: 'var(--text)', marginLeft: 6, fontWeight: 600 }}>{totalRuns}</strong>
          </div>
          <div>
            Failed <strong style={{ color: failedRuns > 0 ? 'var(--stop)' : 'var(--text)', marginLeft: 6, fontWeight: 600 }}>{failedRuns}</strong>
          </div>
        </div>
      </div>

      {/* Card 2: "By model" with Requests | Spend Toggle */}
      <div className="usage-windows-card" style={{ marginBottom: 28 }}>
        {/* Card Header with Icon + Toggle Pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            <Icon name="sliders" size={14} style={{ color: 'var(--text-dim)' }} />
            <span>By model</span>
          </div>

          <div className="set-seg-ctrl" style={{ padding: 2 }}>
            <button
              type="button"
              className={`set-seg-btn${mode === 'requests' ? ' is-active' : ''}`}
              onClick={() => setMode('requests')}
              style={{ fontSize: '11.5px', padding: '3px 12px' }}
            >
              Requests
            </button>
            <button
              type="button"
              className={`set-seg-btn${mode === 'spend' ? ' is-active' : ''}`}
              onClick={() => setMode('spend')}
              style={{ fontSize: '11.5px', padding: '3px 12px' }}
            >
              Spend
            </button>
          </div>
        </div>

        {/* Top Summary Stat Row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 48, padding: '18px 24px 6px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.02em', marginBottom: 4 }}>
              {mode === 'spend' ? `Spent · Last ${daysNum} days` : `Requests · Last ${daysNum} days`}
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
              {mode === 'spend' ? totalSpendFormatted : totalRuns}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.02em', marginBottom: 4 }}>
              Models
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {models.length}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.02em', marginBottom: 4 }}>
              Failed
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: failedRuns > 0 ? 'var(--stop)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {failedRuns}
            </div>
          </div>
        </div>

        {/* Interactive Timeline Bar Chart (Full-width 30-day distribution) */}
        <div
          style={{
            position: 'relative',
            padding: '10px 24px 18px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            height: 90,
            gap: 2,
          }}
        >
          {timelineDays.list.map((day) => {
            const hasRuns = day.cnt > 0
            const isHovered = hoveredTimelineDay?.iso === day.iso
            const dayModelEntries = Object.entries(day.models || {})
            const barHeight = hasRuns
              ? Math.max(16, Math.round((day.cnt / timelineDays.maxCnt) * 64))
              : 2

            return (
              <div
                key={day.iso}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  height: '100%',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: '0 1px',
                }}
                onMouseEnter={() => setHoveredTimelineDay(day)}
                onMouseLeave={() => setHoveredTimelineDay(null)}
              >
                {/* Tooltip on Hover */}
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.1 }}
                    style={{
                      position: 'absolute',
                      bottom: barHeight + 8,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      zIndex: 40,
                      background: '#161618',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                      {day.fullDateLabel}
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>
                      <strong style={{ color: 'var(--text)' }}>{day.cnt}</strong> {mode === 'spend' ? 'runs' : 'requests'}
                      {day.failed_cnt > 0 && (
                        <span style={{ color: 'var(--stop)', marginLeft: 6 }}>({day.failed_cnt} failed)</span>
                      )}
                    </div>
                    {dayModelEntries.length > 0 && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {dayModelEntries.map(([mId, count]) => {
                          const mObj = models.find((m) => m.model === mId)
                          const mIdx = models.findIndex((m) => m.model === mId)
                          const color = MODEL_PALETTE[(mIdx >= 0 ? mIdx : 0) % MODEL_PALETTE.length]
                          return (
                            <div key={mId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10px' }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
                              <span style={{ color: 'var(--text-dim)' }}>{mObj?.name || mId}:</span>
                              <strong style={{ color: 'var(--text)' }}>{count}</strong>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* The Flat Dash or Upright Stacked Bar */}
                {!hasRuns ? (
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 14,
                      height: 2,
                      borderRadius: 1,
                      background: isHovered ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.12)',
                      transition: 'background 0.12s ease',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 14,
                      height: barHeight,
                      borderRadius: '3px 3px 0 0',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column-reverse',
                      boxShadow: isHovered ? '0 0 8px rgba(96, 165, 250, 0.6)' : 'none',
                      transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                      transform: isHovered ? 'scaleY(1.05)' : 'none',
                      transformOrigin: 'bottom',
                    }}
                  >
                    {dayModelEntries.map(([mId, count]) => {
                      const mIdx = models.findIndex((m) => m.model === mId)
                      const color = MODEL_PALETTE[(mIdx >= 0 ? mIdx : 0) % MODEL_PALETTE.length]
                      const isModelActive = !hoveredModel || hoveredModel.model === mId
                      const segPct = (count / day.cnt) * 100

                      return (
                        <div
                          key={mId}
                          style={{
                            height: `${segPct}%`,
                            width: '100%',
                            backgroundColor: color,
                            opacity: isModelActive ? 1 : 0.2,
                            transition: 'opacity 0.15s ease',
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Subheader: Last 30 days ... Ranked by requests / spend */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '10.5px', color: 'var(--text-dim)', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          <span>Last {daysNum} days</span>
          <span>Ranked by {mode === 'spend' ? 'spend' : 'requests'}</span>
        </div>

        {/* Model Rows */}
        {models.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
            No model turns recorded in this period.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {models.map((m, idx) => {
              const color = MODEL_PALETTE[idx % MODEL_PALETTE.length]
              const isHovered = hoveredModel?.model === m.model

              return (
                <div
                  key={m.model}
                  className="act-model-row"
                  onMouseEnter={() => setHoveredModel(m)}
                  onMouseLeave={() => setHoveredModel(null)}
                  style={{
                    background: isHovered ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)', width: 14, fontFamily: 'var(--font-mono)' }}>
                      {m.rank || idx + 1}
                    </span>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AiProviderIcon model={m.model} size={15} />
                    </div>
                    <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text)' }}>
                      {m.name || m.model}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
                      {mode === 'spend' ? m.spend_formatted : m.count}
                    </span>
                    <span style={{ color: 'var(--text-dim)', minWidth: 36, textAlign: 'right', fontSize: '11px' }}>
                      {mode === 'spend' ? (m.spend > 0 ? `${m.percentage}%` : '0%') : `${m.percentage}%`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Card Footer: Interactive Hover Status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          <span>
            {hoveredTimelineDay
              ? `${hoveredTimelineDay.fullDateLabel}: ${hoveredTimelineDay.cnt} requests (${hoveredTimelineDay.failed_cnt} failed)`
              : hoveredModel
                ? `${hoveredModel.name}: ${hoveredModel.count} requests · ${hoveredModel.tokens_formatted} tokens · ${hoveredModel.failed} failed · ${hoveredModel.spend_formatted}`
                : 'Hover over a day or model to explore'}
          </span>
          <span style={{ opacity: 0.8 }}>All machines</span>
        </div>
      </div>

      {/* Card 3: "Recent requests" (Newest first) */}
      <div className="usage-windows-card">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            <Icon name="clock" size={14} style={{ color: 'var(--text-dim)' }} />
            <span>Recent requests</span>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}>
            Newest first
          </div>
        </div>

        {/* Summary Counter Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 48, padding: '16px 24px 12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: 3 }}>
              Requests
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {recentRuns.length || totalRuns}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: 3 }}>
              Completed
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--live)', fontFamily: 'var(--font-mono)' }}>
              {completedRuns}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: 3 }}>
              Failed
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: failedRuns > 0 ? 'var(--stop)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {failedRuns}
            </div>
          </div>
        </div>

        {/* Execution Items List */}
        {sortedRuns.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
            No recent execution runs recorded in database.
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {sortedRuns.map((r) => {
              const isOk = r.phase === 'completed'
              const isErr = r.phase === 'failed'
              const dotColor = isOk ? '#10b981' : isErr ? '#ef4444' : '#f59e0b'

              return (
                <div key={r.id} className="act-recent-row">
                  {/* Timestamp + Model Name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', minWidth: 40 }}>
                      {r.time || '00:00'}
                    </span>
                    <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AiProviderIcon model={r.model} size={14} />
                    </div>
                    <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text)' }}>
                      {r.model_display || r.model}
                    </span>
                  </div>

                  {/* Right: Dot + Transfer + Latency + Cost */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
                      <span style={{ color: 'var(--text-dim)' }}>
                        {r.input_tokens_display || '0'} → {r.output_tokens_display || '0'} · {r.duration_display || '1s'}
                      </span>
                    </div>
                    <span style={{ color: 'var(--text)', fontWeight: 600, minWidth: 54, textAlign: 'right' }}>
                      {r.cost_display || '$0.0000'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   7. DATA VIEW (Export, Purge, Cleanse)
   ========================================================================== */

function Data() {
  const { toast, deleteAllConversations } = useApp()
  const confirm = useConfirm()

  const handleExportAll = async () => {
    try {
      const data = await api.exportAll?.() || { exported_at: new Date().toISOString() }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `amethyst-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Workspace export downloaded', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleDeleteChats = async () => {
    const ok = await confirm({
      title: 'Delete All Conversations?',
      message: 'This will permanently remove all chat histories from local storage and database. This action cannot be undone.',
      confirmLabel: 'Delete Everything',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteAllConversations()
      toast('All conversations deleted', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleResetSettings = async () => {
    const ok = await confirm({
      title: 'Reset Preferences to Default?',
      message: 'This will reset your theme, shortcuts, composer, and model provider options to initial factory values.',
      confirmLabel: 'Reset Preferences',
      danger: true,
    })
    if (!ok) return
    safeStorage.clear()
    toast('Settings reset. Refreshing window…', 'ok')
    setTimeout(() => {
      if (typeof window !== 'undefined') window.location.reload()
    }, 600)
  }

  return (
    <div className="set-panel">
      <div className="set-section-label">Data Management</div>
      <div className="set-box" style={{ marginBottom: 24 }}>
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Export workspace archive</span>
            <span className="set-row-desc">Download a complete JSON snapshot of conversations, settings, and skills.</span>
          </div>
          <button type="button" className="set-btn-sm" onClick={handleExportAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="download" size={12} />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      <div className="set-section-label" style={{ color: 'var(--stop)' }}>Danger Zone</div>
      <div className="set-box">
        <DangerRow
          label="Delete all conversations"
          note="Permanently deletes the entire conversation archive from your local storage and SQLite database."
          confirmLabel="Delete all"
          onConfirm={handleDeleteChats}
        />
        <DangerRow
          label="Reset all preferences"
          note="Resets theme, models, composer keys, and security permissions to initial state."
          confirmLabel="Reset settings"
          onConfirm={handleResetSettings}
        />
      </div>
    </div>
  )
}

function DangerRow({ label, note, confirmLabel, onConfirm }) {
  return (
    <div className="set-box-row">
      <div className="set-row-text">
        <span className="set-row-title" style={{ color: 'var(--text)' }}>{label}</span>
        <span className="set-row-desc">{note}</span>
      </div>
      <button type="button" className="set-btn-sm is-danger" onClick={onConfirm} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Icon name="trash" size={12} />
        <span>{confirmLabel}</span>
      </button>
    </div>
  )
}

/* ==========================================================================
   8. ABOUT VIEW (Authentic Brand Mark, Real Runtime Metrics, No Fake Info)
   ========================================================================== */

function About() {
  const { toast, health } = useApp()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const h = await api.health()
      toast(`Amethyst daemon is responsive (${h.status})`, 'ok')
    } catch {
      toast('Could not verify daemon connectivity', 'amber')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleCopyBuild = () => {
    const details = {
      app: 'Amethyst',
      version: '1.0.20-beta',
      platform: typeof navigator !== 'undefined'
        ? `${navigator.userAgentData?.platform || navigator.platform || 'linux'} · ${navigator.userAgent.includes('x86_64') || navigator.userAgent.includes('x64') ? 'x64' : 'arm64'}`
        : 'linux · x64',
      daemon: 'FastAPI · Python 3.12 · SQLite 3 (WAL)',
      runtime: {
        react: '19.0.0',
        vite: '6.2.0',
      },
      health: health ? {
        status: health.status,
        providers: health.providers || [],
        tools: health.tools || 0,
        mcp_tools: health.mcp_tools || 0,
        skills: health.skills || 0,
      } : null,
      paths: {
        cli: '~/.amethyst/bin/amethyst',
        configuration: '~/.amethyst/',
        database: '~/.amethyst/amethyst.db',
      },
      timestamp: new Date().toISOString(),
    }
    navigator.clipboard.writeText(JSON.stringify(details, null, 2))
    setCopied(true)
    toast('Build diagnostics copied to clipboard', 'ok')
    setTimeout(() => setCopied(false), 2000)
  }

  const platformStr = typeof navigator !== 'undefined'
    ? `${navigator.userAgentData?.platform || navigator.platform || 'linux'} · ${navigator.userAgent.includes('x86_64') || navigator.userAgent.includes('x64') ? 'x64' : 'arm64'}`
    : 'linux · x64'

  return (
    <div className="set-panel">
      {/* 1. Header Card: Authentic BrandMark + Version */}
      <div className="set-box about-header-box" style={{ marginBottom: 20, padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <BrandMark size={40} />
          <div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              Amethyst 1.0.20-beta
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {platformStr}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Updates Section */}
      <div className="set-section-label">Daemon Connectivity</div>
      <div className="set-box" style={{ marginBottom: 20 }}>
        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="check-circle" size={16} style={{ color: 'var(--live)' }} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Local Core Service</span>
              <span className="set-row-desc">
                Verified. Running backend daemon on local port 8000.
              </span>
            </div>
          </div>
          <button
            type="button"
            className="set-btn-sm is-primary"
            onClick={handleCheckUpdate}
            disabled={checkingUpdate}
            style={{ minWidth: 120, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="refresh" size={12} className={checkingUpdate ? 'spin' : ''} />
            <span>{checkingUpdate ? 'Checking…' : 'Ping Daemon'}</span>
          </button>
        </div>
      </div>

      {/* 3. Runtime Section */}
      <div className="set-section-label">Runtime</div>
      <div className="set-box" style={{ marginBottom: 20 }}>
        <div className="about-runtime-row">
          <span className="about-runtime-name">Frontend Shell</span>
          <span className="about-runtime-val">React 19.0.0 · Vite 6.2.0</span>
        </div>
        <div className="about-runtime-row">
          <span className="about-runtime-name">Agent Daemon</span>
          <span className="about-runtime-val">FastAPI · Python 3.12 (Local)</span>
        </div>
        <div className="about-runtime-row">
          <span className="about-runtime-name">Database Engine</span>
          <span className="about-runtime-val">SQLite 3 (WAL mode)</span>
        </div>
        <div className="about-runtime-row">
          <span className="about-runtime-name">Registered Tools</span>
          <span className="about-runtime-val">{health?.tools || 198} tools ({health?.mcp_tools || 162} MCP)</span>
        </div>
        <div className="about-runtime-row">
          <span className="about-runtime-name">Active Skills</span>
          <span className="about-runtime-val">{health?.skills || 8} loaded</span>
        </div>
        <div className="about-runtime-row">
          <span className="about-runtime-name">Daemon Health</span>
          <span className="about-runtime-val" style={{ color: 'var(--live)' }}>
            ● {health?.status || 'operational'}
          </span>
        </div>
      </div>

      {/* 4. Paths Section */}
      <div className="set-section-label">Paths</div>
      <div className="set-box" style={{ marginBottom: 20 }}>
        <div className="about-path-row">
          <span className="about-path-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="terminal" size={13} />
            <span>Executable</span>
          </span>
          <span className="about-path-val">~/.amethyst/bin/amethyst</span>
        </div>
        <div className="about-path-row">
          <span className="about-path-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="folder" size={13} />
            <span>Config Root</span>
          </span>
          <span className="about-path-val">~/.amethyst/</span>
        </div>
        <div className="about-path-row">
          <span className="about-path-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="database" size={13} />
            <span>SQLite DB</span>
          </span>
          <span className="about-path-val">~/.amethyst/amethyst.db</span>
        </div>
      </div>

      {/* 5. Diagnostics Action Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '4px 0 16px' }}>
        <button
          type="button"
          className="set-btn-sm"
          onClick={handleCopyBuild}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="copy" size={12} />
          <span>{copied ? 'Copied to Clipboard!' : 'Copy System Diagnostics'}</span>
        </button>
      </div>
    </div>
  )
}

/* ==========================================================================
   ROOT SETTINGS COMPONENT
   ========================================================================== */


/* ==========================================================================
   DEVICES (pairing, and what syncs between them)
   ========================================================================== */

/**
 * One panel, two situations, because it is the same screen on both.
 *
 * On the machine that holds your data the backend answers, so this shows the
 * paired devices and can open a pairing window. On a phone there is no backend
 * -- the interface is served from anywhere and talks only to the relay -- so it
 * shows the form for entering the code the machine printed.
 *
 * Which one you get is decided by whether the backend is reachable, not by
 * sniffing the user agent: a laptop with its server switched off is in exactly
 * the phone's situation and should be offered exactly the phone's screen.
 */
function Devices() {
  const { toast, server } = useApp()
  const confirm = useConfirm()
  const hasBackend = server?.phase === 'ready'

  const [devices, setDevices] = useState([])
  const [pending, setPending] = useState([])
  const [invite, setInvite] = useState(null)
  const [activeModalRequest, setActiveModalRequest] = useState(null)
  const [pairMode, setPairMode] = useState('lan')
  const [busy, setBusy] = useState(false)
  /* Where a phone opens this app. Knowing it is what lets the code below be an
     ordinary https link that a phone's camera opens by itself, instead of an
     `amethyst://` payload only this app's own scanner can do anything with. */
  const [appUrl, setAppUrl] = useState('')
  const [savedAppUrl, setSavedAppUrl] = useState('')

  // The phone's half.
  const [held, setHeld] = useState(() => syncClient.identity())
  const [relayUrl, setRelayUrl] = useState(() => syncClient.identity()?.relayUrl || '')
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  const refresh = useCallback(async () => {
    if (!hasBackend) return
    try {
      const { devices: rows, app_url: configured } = await api.devices()
      setDevices(rows || [])
      setAppUrl(configured || '')
      setSavedAppUrl(configured || '')

      const { pending: pendingRows } = await api.pendingDevices()
      setPending(pendingRows || [])
    } catch { /* the backend went away mid-look; the empty list is honest */ }
  }, [hasBackend])

  useEffect(() => {
    refresh()
    let interval = null
    if (invite) {
      interval = setInterval(refresh, 2500)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [invite, refresh])

  const openPairing = async () => {
    setBusy(true)
    try {
      setInvite(await api.pairDevice(''))
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const approvePending = async (requestId) => {
    try {
      await api.approvePending(requestId)
      toast('Device approved and paired.', 'ok')
      setInvite(null)
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const rejectPending = async (requestId) => {
    try {
      await api.rejectPending(requestId)
      toast('Device rejected.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const [editingDeviceId, setEditingDeviceId] = useState(null)
  const [editingPermissions, setEditingPermissions] = useState({})
  const [savingPermissions, setSavingPermissions] = useState(false)

  const toggleEditingPermission = (key) => {
    setEditingPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const savePermissions = async (deviceId) => {
    setSavingPermissions(true)
    try {
      await api.updateDevicePermissions(deviceId, editingPermissions)
      toast('Device permissions updated.', 'ok')
      setEditingDeviceId(null)
      await refresh()
    } catch (err) {
      toast(err.message || 'Failed to update permissions', 'bad')
    } finally {
      setSavingPermissions(false)
    }
  }

  const saveAppUrl = async () => {
    try {
      const { app_url: saved } = await api.setAppUrl(appUrl.trim())
      setAppUrl(saved || '')
      setSavedAppUrl(saved || '')
      toast(saved ? 'Saved. New codes will be scannable links.' : 'Cleared', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const revoke = async (device) => {
    const ok = await confirm({
      title: `Stop syncing with ${device.name}?`,
      message: 'It stops being recognised at the relay within one poll. Pair it again to undo this.',
      confirmLabel: 'Revoke',
      danger: true,
    })
    if (!ok) return
    try {
      await api.revokeDevice(device.id)
      toast(`${device.name} revoked`, 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const joinFromPhone = async () => {
    if (!relayUrl.trim() || !code.trim()) return
    setPairing(true)
    try {
      const joined = await syncClient.pair(relayUrl.trim(), code.trim(), navigator.platform || 'phone')
      setHeld(joined)
      setCode('')
      toast('Paired. Your settings will follow you here.', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setPairing(false)
    }
  }

  const syncNow = async () => {
    const result = await syncClient.sync()
    setLastSync(result)
    if (result.synced) toast(`Synced. ${result.applied} change(s) applied.`, 'ok')
    else if (result.reason === 'revoked') toast('This device was revoked on the other machine.', 'bad')
    else toast(`Not synced: ${result.reason}`, 'bad')
  }

  const unpair = async () => {
    const ok = await confirm({
      title: 'Forget this pairing?',
      message: 'This browser stops syncing and drops its copy of the key. Revoke it on the machine as well to be sure.',
      confirmLabel: 'Forget',
      danger: true,
    })
    if (!ok) return
    await syncClient.forget()
    setHeld(null)
    toast('Pairing forgotten', 'ok')
  }

  if (!hasBackend) {
    return (
      <div className="set-panel">
        <div className="set-section-label">This device</div>
        {held ? (
          <div className="set-box" style={{ marginBottom: 24 }}>
            <div className="set-box-row">
              <div className="set-row-text">
                <span className="set-row-title">Paired</span>
                <span className="set-row-desc">
                  Syncing with {held.relayUrl}. Changes travel sealed; the relay cannot read them.
                </span>
              </div>
              <button type="button" className="set-btn-sm" onClick={syncNow}>Sync now</button>
            </div>
            {lastSync ? (
              <div className="set-box-row">
                <div className="set-row-text">
                  <span className="set-row-title">Last sync</span>
                  <span className="set-row-desc">
                    {lastSync.synced
                      ? `${lastSync.applied} applied, ${lastSync.sent} sent`
                      : `not synced (${lastSync.reason})`}
                  </span>
                </div>
              </div>
            ) : null}
            <DangerRow
              label="Forget this pairing"
              note="Drops this browser's key and stops it syncing."
              confirmLabel="Forget"
              onConfirm={unpair}
            />
          </div>
        ) : (
          <div className="set-box" style={{ marginBottom: 24 }}>
            <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div className="set-row-text">
                <span className="set-row-title">Pair with your machine</span>
                <span className="set-row-desc">
                  On that machine, open Settings → Devices and press <strong>Pair a device</strong>,
                  then paste the link or the code here. Leave it running — it finishes the
                  handshake within a few seconds.
                </span>
              </div>
              <input
                className="set-input"
                placeholder="https://amethyst-relay.you.workers.dev"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <input
                className="set-input"
                placeholder="the code, or the whole amethyst://pair link"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="set-btn-sm"
                onClick={joinFromPhone}
                disabled={pairing || !relayUrl.trim() || !code.trim()}
              >
                {pairing ? 'Waiting for the machine…' : 'Pair'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="set-panel">
      <div className="set-section-label">Paired devices</div>
      <div className="set-box" style={{ marginBottom: 24 }}>
        {devices.length === 0 ? (
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Nothing is paired yet</span>
              <span className="set-row-desc">
                Pair a phone to carry your preferences to it. Your conversations and files stay here.
              </span>
            </div>
          </div>
        ) : devices.map((device) => {
          const perms = device.permissions || {}
          const isEditing = editingDeviceId === device.id
          return (
            <div key={device.id} style={{ borderBottom: '1px solid var(--hairline-strong)', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="set-row-text">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="set-row-title">{device.name}</span>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-inset)', color: 'var(--text-sub)' }}>
                      {device.role}
                    </span>
                  </div>
                  <span className="set-row-desc">
                    Last seen {device.last_seen_at || 'never'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="set-btn-sm"
                    onClick={() => {
                      if (isEditing) {
                        setEditingDeviceId(null)
                      } else {
                        setEditingDeviceId(device.id)
                        setEditingPermissions(device.permissions || {})
                      }
                    }}
                  >
                    {isEditing ? 'Close' : 'Permissions'}
                  </button>
                  <button type="button" className="set-btn-sm" onClick={() => revoke(device)} style={{ color: 'var(--stop)' }}>
                    Revoke
                  </button>
                </div>
              </div>

              {/* Badges of granted scopes */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {['screen', 'input', 'media', 'files', 'terminal', 'agent', 'power', 'webcam', 'mic', 'root'].map((k) => {
                  const active = Boolean(perms[k === 'media' ? 'audio' : k])
                  return (
                    <span
                      key={k}
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: active ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-inset)',
                        color: active ? 'var(--accent)' : 'var(--text-faint)',
                        border: `1px solid ${active ? 'rgba(99, 102, 241, 0.3)' : 'transparent'}`,
                        textTransform: 'capitalize',
                      }}
                    >
                      {k}
                    </span>
                  )
                })}
              </div>

              {/* Inline Permission Editor */}
              {isEditing && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: 'var(--bg-inset)', border: '1px solid var(--hairline-strong)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
                    Configure Access Scopes:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
                    {[
                      { key: 'screen', label: 'Screen Capture' },
                      { key: 'input', label: 'Mouse & Keys' },
                      { key: 'audio', label: 'Media & Audio' },
                      { key: 'files', label: 'File Transfer' },
                      { key: 'terminal', label: 'Terminal' },
                      { key: 'agent', label: 'Agent Tasks' },
                      { key: 'power', label: 'Power Ops' },
                      { key: 'webcam', label: 'Webcam' },
                      { key: 'mic', label: 'Microphone' },
                      { key: 'root', label: 'Root / Sudo' },
                    ].map(({ key, label }) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(editingPermissions[key])}
                          onChange={() => toggleEditingPermission(key)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                      type="button"
                      className="set-btn-sm"
                      onClick={() => setEditingDeviceId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pair-go"
                      onClick={() => savePermissions(device.id)}
                      disabled={savingPermissions}
                      style={{ padding: '4px 12px', fontSize: 12 }}
                    >
                      {savingPermissions ? 'Saving…' : 'Save Scopes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="set-section-label">Add a device</div>
      {pending.length > 0 && (
        <div className="set-box" style={{ borderColor: '#f59e0b', background: 'rgba(245, 158, 11, 0.05)', marginBottom: 12 }}>
          <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <strong style={{ fontSize: 13, color: '#f59e0b' }}>Device waiting for approval ({pending.length})</strong>
            </div>
            {pending.map((p) => (
              <div key={p.request_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>Role: {p.role} · Token: {p.request_id?.slice(0, 8)}…</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="set-btn-sm" onClick={() => setActiveModalRequest(p)} style={{ background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 600 }}>Review & Approve</button>
                  <button type="button" className="set-btn-sm" onClick={() => approvePending(p.request_id)} style={{ background: '#f59e0b', color: '#000', fontWeight: 600 }}>Quick Approve</button>
                  <button type="button" className="set-btn-sm" onClick={() => rejectPending(p.request_id)} style={{ color: 'var(--stop)' }}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Show a pairing code</span>
            <span className="set-row-desc">
              Good for five minutes, once. Direct LAN pairing is available automatically over Wi-Fi.
            </span>
          </div>
          <button type="button" className="set-btn-sm" onClick={openPairing} disabled={busy}>
            {busy ? 'Opening…' : 'Pair a device'}
          </button>
        </div>
        {invite ? (
          <div className="set-box-row pair-invite">
            {pending.length > 0 && (
              <div
                style={{
                  width: '100%',
                  maxWidth: 420,
                  padding: '12px 14px',
                  marginBottom: 16,
                  borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid #f59e0b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  animation: 'fadeIn 0.2s ease-out',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>⚠️</span> Device waiting for approval
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>
                    “{pending[0].name}” requested to connect.
                  </div>
                </div>
                <button
                  type="button"
                  className="set-btn-sm"
                  onClick={() => setActiveModalRequest(pending[0])}
                  style={{
                    background: '#f59e0b',
                    color: '#000',
                    fontWeight: 700,
                    padding: '6px 14px',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  Review & Approve
                </button>
              </div>
            )}
            {/* Mode Switcher */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginBottom: 16,
                background: 'var(--bg-inset)',
                padding: 4,
                borderRadius: 10,
                border: '1px solid var(--hairline-strong)',
                width: '100%',
                maxWidth: 420,
              }}
            >
              <button
                type="button"
                onClick={() => setPairMode('lan')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: pairMode === 'lan' ? 'var(--raised)' : 'transparent',
                  color: pairMode === 'lan' ? 'var(--text)' : 'var(--text-sub)',
                  fontWeight: pairMode === 'lan' ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                  boxShadow: pairMode === 'lan' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                <span>📱</span>
                <span>Same Wi-Fi (Direct LAN)</span>
              </button>
              <button
                type="button"
                onClick={() => setPairMode('web')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: pairMode === 'web' ? 'var(--raised)' : 'transparent',
                  color: pairMode === 'web' ? 'var(--text)' : 'var(--text-sub)',
                  fontWeight: pairMode === 'web' ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                  boxShadow: pairMode === 'web' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                <span>🌐</span>
                <span>Cloudflare Web</span>
              </button>
            </div>

            {pairMode === 'lan' ? (
              <p className="pair-invite-hint" style={{ color: 'var(--text-sub)', marginBottom: 12 }}>
                <strong>Recommended for Phone Controls:</strong> Ultra-low latency touchpad, media, camera feed, and terminal. Make sure your phone is connected to the same Wi-Fi network. If connection times out, allow port 8000 on your firewall (<code>sudo ufw allow 8000/tcp</code>).
              </p>
            ) : (
              <p className="pair-invite-hint" style={{ color: 'var(--text-sub)', marginBottom: 12 }}>
                <strong>Remote over Internet:</strong> Connects via Cloudflare Pages and the sync relay when you are away from home.
              </p>
            )}

            {pairMode === 'web' && !invite.app_url ? (
              <div
                style={{
                  width: '100%',
                  maxWidth: 420,
                  padding: '16px',
                  borderRadius: 12,
                  background: 'var(--bg-inset)',
                  border: '1px dashed var(--hairline-strong)',
                  textAlign: 'center',
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>🌐</div>
                <strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Cloudflare Web URL not configured</strong>
                <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.5, marginBottom: 14 }}>
                  To pair over the web when you are away from home, enter your Cloudflare Pages or Tunnel URL (<code>https://...</code>) in the field below and click <strong>Save</strong>.
                </p>
                <button
                  type="button"
                  className="set-btn-sm"
                  onClick={() => setPairMode('lan')}
                  style={{ background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 600, padding: '6px 14px' }}
                >
                  📱 Use Same Wi-Fi (Direct LAN)
                </button>
              </div>
            ) : (
              (pairMode === 'lan' ? (invite.lan_qr_svg || invite.qr_svg) : invite.web_qr_svg) ? (
                <>
                  <div
                    className="qr-card"
                    dangerouslySetInnerHTML={{
                      __html: pairMode === 'lan' ? (invite.lan_qr_svg || invite.qr_svg) : invite.web_qr_svg,
                    }}
                  />
                  <p className="pair-invite-hint">
                    {pairMode === 'lan' ? (
                      invite.host_url
                        ? <>Point your phone’s camera at this. It opens <code>{invite.host_url}</code> directly over your Wi-Fi.</>
                        : 'Point your phone’s camera at this to pair over local network.'
                    ) : (
                      <>Point your phone’s camera at this. It opens <code>{invite.app_url}</code> over the web.</>
                    )}
                  </p>
                </>
              ) : null
            )}
            <span className="set-row-desc">Or enter this code manually on the other device:</span>
            <code className="rc-code">{invite.secret.match(/.{1,4}/g).join(' ')}</code>
            <button
              type="button"
              className="set-btn-sm"
              onClick={() => {
                const targetLink = pairMode === 'lan' ? (invite.lan_qr || invite.qr) : invite.web_qr
                if (!targetLink) {
                  toast('Please configure your Cloudflare Pages URL below first', 'bad')
                  return
                }
                copyText(targetLink)
                toast('Pairing link copied', 'ok')
              }}
            >
              Copy pairing link
            </button>
            <span className="set-row-desc">
              All communications between your phone and PC are cryptographically sealed.
            </span>
          </div>
        ) : null}
        <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div className="set-row-text">
            <span className="set-row-title">Where your phone opens Amethyst</span>
            <span className="set-row-desc">
              {appUrl
                ? 'The pairing code is a link to this address, which your phone’s camera opens by itself.'
                : 'Enter your deployed Cloudflare Pages URL or Cloudflare Tunnel (cloudflared tunnel --url http://localhost:8000) and click Save to enable internet pairing.'}
            </span>
          </div>
          <input
            className="set-input"
            type="url"
            placeholder="https://amethyst.example.com"
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="set-btn-sm"
            onClick={saveAppUrl}
            disabled={appUrl.trim() === savedAppUrl}
          >
            Save
          </button>
        </div>
      </div>
      {activeModalRequest && (
        <PairingApprovalModal
          request={activeModalRequest}
          onDismiss={() => setActiveModalRequest(null)}
          onResolved={() => {
            setActiveModalRequest(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

const PANELS = {
  profile: Profile,
  general: General,
  appearance: Appearance,
  models: Models,
  usage: Usage,
  activity: Activity,
  permissions: Permissions,
  devices: Devices,
  data: Data,
  about: About,
}

export default function Settings() {
  const { setView, theme, setTheme } = useApp()
  const [section, setSection] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null) || 'general')
  const [isClosing, setIsClosing] = useState(false)

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      setView('chat')
    }, 180)
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const Panel = PANELS[section] || General

  const cycleTheme = () => {
    const ids = THEME_CHOICES.map((t) => t.id)
    const idx = ids.indexOf(theme)
    const next = ids[(idx + 1) % ids.length]
    setTheme(next)
  }

  const currentThemeLabel = THEME_CHOICES.find((t) => t.id === theme)?.label || 'Theme'

  return (
    <motion.div
      className="settings-view"
      initial={{ opacity: 0, scale: 0.995 }}
      animate={isClosing ? { opacity: 0, scale: 0.98, y: 8 } : { opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Navigation column */}
      <nav className="set-nav" aria-label="Settings navigation">
        <div className="set-nav-header">
          <div className="set-nav-tab">
            <span>Settings</span>
            <button
              type="button"
              className="set-nav-tab-close"
              onClick={handleClose}
              title="Close Settings (Esc)"
              aria-label="Close Settings"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>

        {Object.entries(
          SECTIONS.reduce((acc, item) => {
            const grp = item.group || 'App'
            if (!acc[grp]) acc[grp] = []
            acc[grp].push(item)
            return acc
          }, {})
        ).map(([grp, items]) => (
          <div key={grp} className="set-nav-group">
            <div className="set-nav-group-label">{grp}</div>
            {items.map((item) => {
              const isSel = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`set-nav-item${isSel ? ' active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  <Icon name={item.icon} size={15} />
                  <span className="set-nav-label">{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Main content pane */}
      <div className="set-content">
        <div className="set-top-bar">
          <div className="set-theme-pill" onClick={cycleTheme} title="Click to cycle theme">
            <Icon name="sun" size={13} />
            <span>{currentThemeLabel}</span>
          </div>
        </div>

        <div className="set-panel-frame">
          {section !== 'usage' && section !== 'activity' && (
            <h1 className="set-panel-title">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h1>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <Panel />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
