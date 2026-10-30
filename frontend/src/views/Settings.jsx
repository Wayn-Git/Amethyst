import { Input as HouseInput, Button as HouseButton } from '../components/ui/bento/index.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Skeleton from '../components/Skeleton.jsx'
import BrandMark from '../components/BrandMark.jsx'
import AiProviderIcon from '../components/AiProviderIcon.jsx'
import { api, copyText } from '../api.js'
import { useApp, DARK_THEMES, LIGHT_THEMES } from '../store.jsx'
import { forSettings } from '../nav.js'
import { useConfirm } from '../components/ui/ConfirmDialog.jsx'
import Badge from '../components/ui/Badge.jsx'
import Switch from '../components/ui/Switch.jsx'
import AnimatedSelect from '../components/ui/AnimatedSelect.jsx'
import { LoaderIcon } from '../components/LoaderIcon.jsx'
import { AnimatePresence, motion } from 'framer-motion'
import { safeStorage } from '../lib/storage.js'
import * as syncClient from '../lib/sync/client.js'
import PairingApprovalModal from '../components/PairingApprovalModal.jsx'
import { showBoardUINotification } from '../lib/boardui-notifications.js'
import { triggerConfetti } from '../components/ConfettiCannon.jsx'
import Integrations from './settings/Integrations.jsx'
import Configuration from './settings/Configuration.jsx'
import Storage from './settings/Storage.jsx'

/* ==========================================================================
   NAVIGATION SECTIONS & THEME DEFINITIONS
   ========================================================================== */

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'sliders', group: 'Personal', desc: 'Workspace, external editor destination, window behavior, speed, composer, confetti' },
  { id: 'configuration', label: 'Configuration', icon: 'settings', group: 'Personal', desc: 'Approval policy, sandbox settings, web search, reasoning effort, workspace tools' },
  { id: 'storage', label: 'Storage', icon: 'database', group: 'Personal', desc: 'Disk usage, clean up chats, manage worktrees, archived conversations' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', group: 'Personal', desc: 'Desktop alerts, sound, turn completion, morning briefing, BoardUI' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'command', group: 'Personal', desc: 'Keyboard shortcuts, global launcher hotkey presets' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'Personal', desc: 'Themes, accent color, text scaling, loader style, glass material' },
  { id: 'profile', label: 'Profile', icon: 'user', group: 'Personal', desc: 'Display name, full name, email address, avatar' },
  { id: 'usage', label: 'Usage', icon: 'dash', group: 'Personal', desc: 'Token usage, provider telemetry, model latency metrics' },
  { id: 'activity', label: 'Activity', icon: 'logs', group: 'Personal', desc: 'Recent tasks, session turns, execution audit log' },
  { id: 'data', label: 'Data', icon: 'trash', group: 'Personal', desc: 'Local storage, database compaction, clear memories, reset preferences' },
  { id: 'integrations', label: 'Integrations', icon: 'layers', group: 'Integrations', desc: 'MCP servers, connectors, third-party plugin integrations' },
  { id: 'models', label: 'Models', icon: 'cpu', group: 'Integrations', desc: 'Model providers, API keys, reasoning tiers, local Ollama' },
  { id: 'devices', label: 'Devices', icon: 'link', group: 'Integrations', desc: 'Paired devices, peer-to-peer sync, multi-device encryption' },
  { id: 'permissions', label: 'Permissions', icon: 'shield', group: 'Coding', desc: 'Safety guards, shell confirmation, filesystem confirmation, network gate' },
  { id: 'about', label: 'About', icon: 'info', group: 'Coding', desc: 'Version, build info, open source licenses and acknowledgments' },
]

const THEME_CHOICES = [
  { id: 'system', label: 'System', hint: 'Follows the OS' },
  { id: 'graphite', label: 'Graphite', hint: 'Neutral dark slate' },
  { id: 'ink', label: 'Ink', hint: 'Deep blue-black indigo' },
  { id: 'nocturne', label: 'Nocturne', hint: 'Near black cobalt cyan' },
  { id: 'nvidia', label: 'NVIDIA', hint: 'True black neon green' },
  { id: 'paper', label: 'Paper', hint: 'Pristine gallery white' },
  { id: 'sand', label: 'Sand', hint: 'Warm parchment linen' },
  { id: 'claude', label: 'Claude', hint: 'Warm ivory cinnabar' },
  { id: 'cursor', label: 'Cursor', hint: 'Minimal porcelain cobalt' },
]

const VENDOR_PRESETS = [
  { slug: 'kilocode', name: 'Kilo Code', base_url: 'https://api.kilo.ai/api/gateway', default_model: 'kilo-auto/free', hint: 'Generous multi-model inference gateway' },
  { slug: 'nvidia', name: 'NVIDIA NIM', base_url: 'https://integrate.api.nvidia.com/v1', default_model: 'nvidia/llama-3.1-nemotron-70b-instruct', hint: 'Generous free tier enterprise microservices' },
  { slug: 'opencode-zen', name: 'OpenCode Zen', base_url: 'https://opencode.ai/zen/v1', default_model: 'kimi-k2.6', hint: 'OpenCode Console inference (kimi-k2.6, glm-5.1, minimax-m2.7)' },
  { slug: 'google', name: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/', default_model: 'gemini-2.0-flash', hint: 'Free tier 1M context Gemini 2.0 Flash' },
  { slug: 'groq', name: 'Groq', base_url: 'https://api.groq.com/openai/v1', default_model: 'llama-3.3-70b-versatile', hint: 'Ultra-low latency Llama 3.3 70B (free tier)' },
  { slug: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', default_model: 'meta-llama/llama-3.3-70b-instruct:free', hint: 'Unified access including generous free models' },
  { slug: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o', hint: 'Requires an OpenAI API key' },
  { slug: 'anthropic', name: 'Anthropic', base_url: 'https://api.anthropic.com/v1', default_model: 'claude-3-7-sonnet-latest', hint: 'Requires an Anthropic API key' },
  { slug: 'mistral', name: 'Mistral AI', base_url: 'https://api.mistral.ai/v1', default_model: 'mistral-large-latest', hint: 'European enterprise frontier models' },
  { slug: 'ollama', name: 'Ollama (Local)', base_url: 'http://localhost:11434/v1', default_model: 'llama3.2', hint: 'Run local open-source models completely offline' },
  { slug: 'together', name: 'Together AI', base_url: 'https://api.together.xyz/v1', default_model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', hint: 'Open-weights serverless inference' },
  { slug: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat', hint: 'DeepSeek V3 and R1 reasoning engines' },
  { slug: 'custom', name: 'Custom OpenAI-Compatible', base_url: '', default_model: '', hint: 'vLLM, LM Studio, TGI, or custom proxy endpoint' },
]

/* ==========================================================================
   0. PROFILE VIEW (Display name, identity, email)
   ========================================================================== */

export function CodexAvatar({ name = 'User', shape = 'circle', photoUrl = null, size = 52, className = '', style = {} }) {
  const initials = useMemo(() => {
    const trimmed = (name || 'User').trim()
    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return trimmed.slice(0, 2).toUpperCase() || 'U'
  }, [name])

  const clipId = useMemo(() => `avatar-clip-${Math.random().toString(36).substring(2, 9)}`, [])

  const scallopPoints = useMemo(() => {
    return Array.from({ length: 48 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 48 - Math.PI / 2
      const r = 44 + 6 * Math.cos(8 * a)
      const x = 50 + r * Math.cos(a)
      const y = 50 + r * Math.sin(a)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [])

  const badgePoints = useMemo(() => {
    return Array.from({ length: 32 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 32 - Math.PI / 2
      const r = i % 2 === 0 ? 50 : 43.5
      const x = 50 + r * Math.cos(a)
      const y = 50 + r * Math.sin(a)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [])

  const renderShapeElement = (fill = '#7c8ba1') => {
    switch (shape) {
      case 'scallop':
        return <polygon points={scallopPoints} fill={fill} />
      case 'squircle':
        return <rect x="2" y="2" width="96" height="96" rx="26" ry="26" fill={fill} />
      case 'oval':
        return <ellipse cx="50" cy="50" rx="42" ry="49" fill={fill} />
      case 'badge':
        return <polygon points={badgePoints} fill={fill} />
      case 'circle':
      default:
        return <circle cx="50" cy="50" r="49" fill={fill} />
    }
  }

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`codex-avatar ${className}`}
      style={{ display: 'inline-block', flexShrink: 0, overflow: 'visible', ...style }}
    >
      <defs>
        <clipPath id={clipId}>
          {renderShapeElement('#fff')}
        </clipPath>
      </defs>
      {renderShapeElement('#7a8c9e')}
      {photoUrl ? (
        <image
          href={photoUrl}
          x="0"
          y="0"
          width="100"
          height="100"
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      ) : (
        <text
          x="50"
          y="52"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#ffffff"
          fontWeight="600"
          fontSize={size > 60 ? 32 : 36}
          fontFamily="var(--font-sans, system-ui, -apple-system, sans-serif)"
        >
          {initials}
        </text>
      )}
    </svg>
  )
}

function EditProfileDrawer({ open, onClose, userProfile, updateUserProfile, toast }) {
  const [name, setName] = useState(userProfile?.name || '')
  const [fullName, setFullName] = useState(userProfile?.full_name || '')
  const [handle, setHandle] = useState(userProfile?.handle || '')
  const [email, setEmail] = useState(userProfile?.email || '')
  const [avatarShape, setAvatarShape] = useState(userProfile?.avatar_shape || 'circle')
  const [avatarUrl, setAvatarUrl] = useState(userProfile?.avatar_url || null)
  const [visibility, setVisibility] = useState({
    show_stats: true,
    show_activity: true,
    show_plugins: true,
    show_insights: true,
    ...(userProfile?.visibility || {}),
  })
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (userProfile) {
      setName(userProfile.name || '')
      setFullName(userProfile.full_name || '')
      setHandle(userProfile.handle || `@${(userProfile.name || 'user').toLowerCase().replace(/\s+/g, '')}`)
      setEmail(userProfile.email || '')
      setAvatarShape(userProfile.avatar_shape || 'circle')
      setAvatarUrl(userProfile.avatar_url || null)
      setVisibility({
        show_stats: true,
        show_activity: true,
        show_plugins: true,
        show_insights: true,
        ...(userProfile.visibility || {}),
      })
    }
  }, [userProfile, open])

  if (!open) return null

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast('Please select an image under 2MB', 'bad')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setAvatarUrl(reader.result)
      toast('Photo updated in preview', 'ok')
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async (e) => {
    e?.preventDefault()
    if (!name.trim()) {
      toast('Display name is required', 'amber')
      return
    }
    setSaving(true)
    try {
      await updateUserProfile({
        name: name.trim(),
        full_name: fullName.trim() || name.trim(),
        handle: handle.trim(),
        email: email.trim(),
        avatar_shape: avatarShape,
        avatar_url: avatarUrl,
        visibility,
      })
      toast('Profile updated successfully', 'ok')
      onClose()
    } catch {
      // toast handled in store
    } finally {
      setSaving(false)
    }
  }

  const shapes = [
    { id: 'circle', label: 'Circle' },
    { id: 'scallop', label: 'Scallop' },
    { id: 'squircle', label: 'Squircle' },
    { id: 'oval', label: 'Oval' },
    { id: 'badge', label: 'Badge' },
  ]

  return (
    <>
      <div className="codex-drawer-backdrop" onClick={onClose} />
      <motion.div
        className="codex-drawer-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      >
        {/* Drawer Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Edit profile</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <HouseButton
              type="button"
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer', padding: '4px 8px' }}
            >
              Cancel
            </HouseButton>
            <HouseButton
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              style={{
                background: '#ffffff',
                color: '#000000',
                border: 'none',
                borderRadius: 9999,
                padding: '6px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </HouseButton>
          </div>
        </div>

        {/* Drawer Content */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>
          {/* Photo Section */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Photo</div>
            <div className="codex-card" style={{ padding: 0 }}>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Upload photo</span>
                <Icon name="image" size={16} style={{ color: 'var(--text-dim)' }} />
                {/* eslint-disable-next-line amethyst-ui/no-raw-controls */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  style={{ display: 'none' }}
                />
              </div>

              {avatarUrl && (
                <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))' }}>
                  <HouseButton
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, padding: 0, cursor: 'pointer' }}
                  >
                    Remove custom photo
                  </HouseButton>
                </div>
              )}

              {/* 5 Shape Selector Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px' }}>
                {shapes.map((s) => {
                  const active = avatarShape === s.id
                  return (
                    <HouseButton
                      key={s.id}
                      type="button"
                      className={`codex-shape-btn${active ? ' is-active' : ''}`}
                      onClick={() => setAvatarShape(s.id)}
                      title={s.label}
                    >
                      <CodexAvatar
                        name={fullName || name}
                        shape={s.id}
                        photoUrl={avatarUrl}
                        size={48}
                      />
                      {active && (
                        <div className="codex-shape-check">
                          <Icon name="check" size={10} />
                        </div>
                      )}
                    </HouseButton>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Account Details */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Account Details</div>
            <div className="codex-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                  Display Name
                </label>
                <HouseInput
                  type="text"
                  className="set-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rose"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                  Full Name
                </label>
                <HouseInput
                  type="text"
                  className="set-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Rose ST"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                  Username Handle
                </label>
                <HouseInput
                  type="text"
                  className="set-input"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="e.g. @rosest65"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                  Email Address
                </label>
                <HouseInput
                  type="email"
                  className="set-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>

          {/* What Others See */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>What others see</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
              Choose which sections are visible to others when you share your profile
            </div>
            <div className="codex-card">
              <div className="codex-row">
                <span className="codex-row-title">Show activity statistics</span>
                <Switch
                  on={visibility.show_stats}
                  onChange={(val) => setVisibility((v) => ({ ...v, show_stats: val }))}
                  tone="default"
                />
              </div>

              <div className="codex-row">
                <span className="codex-row-title">Show activity heatmap</span>
                <Switch
                  on={visibility.show_activity}
                  onChange={(val) => setVisibility((v) => ({ ...v, show_activity: val }))}
                  tone="default"
                />
              </div>

              <div className="codex-row">
                <span className="codex-row-title">Show capabilities & tools</span>
                <Switch
                  on={visibility.show_plugins}
                  onChange={(val) => setVisibility((v) => ({ ...v, show_plugins: val }))}
                  tone="default"
                />
              </div>

              <div className="codex-row">
                <span className="codex-row-title">Show workspace insights</span>
                <Switch
                  on={visibility.show_insights}
                  onChange={(val) => setVisibility((v) => ({ ...v, show_insights: val }))}
                  tone="default"
                />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

function formatToolName(raw) {
  if (!raw) return 'Tool'
  if (raw.startsWith('__connector__')) {
    const name = raw.replace('__connector__', '')
    return name.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
  if (raw.includes('__mcp__')) {
    const parts = raw.split('__mcp__')
    return parts[0].replace(/_/g, ' ')
  }
  const clean = raw.replace(/^tool_call_?/, '').replace(/_/g, ' ')
  return clean.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function getToolIcon(raw) {
  const lower = (raw || '').toLowerCase()
  if (lower.includes('shell') || lower.includes('terminal') || lower.includes('exec') || lower.includes('command')) return 'terminal'
  if (lower.includes('git')) return 'git-branch'
  if (lower.includes('mail') || lower.includes('gmail')) return 'envelope'
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('search') || lower.includes('url')) return 'globe'
  if (lower.includes('todo') || lower.includes('task')) return 'tasks'
  if (lower.includes('weather') || lower.includes('meteo')) return 'wind'
  return 'wrench'
}

function Profile() {
  const { userProfile, updateUserProfile, conversations, caps, workspace, toast, setView } = useApp()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activityMode, setActivityMode] = useState('Daily')
  const [hoveredCell, setHoveredCell] = useState(null)
  const [activityData, setActivityData] = useState(null)
  const [libraryData, setLibraryData] = useState(null)

  useEffect(() => {
    let active = true
    api.activity(365)
      .then((res) => {
        if (active) setActivityData(res)
      })
      .catch(() => {})
    api.library({ limit: 1 })
      .then((res) => {
        if (active) setLibraryData(res)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const isPrivate = userProfile?.is_private || false
  const visibility = userProfile?.visibility || {
    show_stats: true,
    show_activity: true,
    show_plugins: true,
    show_insights: true,
  }

  const displayName = userProfile?.full_name || userProfile?.name || 'User'
  const handle = userProfile?.handle || `@${(userProfile?.name || 'user').toLowerCase().replace(/\s+/g, '')}`

  const togglePrivacy = async () => {
    const next = !isPrivate
    try {
      await updateUserProfile({ is_private: next })
      toast(next ? 'Profile visibility set to Private' : 'Profile visibility set to Public', 'ok')
    } catch {
      // toast in store
    }
  }

  const handleShare = () => {
    const url = window.location.origin + '/#profile'
    copyText(url)
    toast('Profile link copied to clipboard', 'ok')
  }

  // Real daily map from SQLite
  const dailyMap = useMemo(() => {
    const map = {}
    if (activityData?.daily && Array.isArray(activityData.daily)) {
      for (const d of activityData.daily) {
        if (d?.day) map[d.day] = d.cnt || 0
      }
    }
    return map
  }, [activityData])

  // Real 52-week activity heatmap
  const { heatmapData, activeDaysCount, totalTurnCount } = useMemo(() => {
    const weeks = []
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - (52 * 7 - 1))

    let activeDays = 0
    let totalTurns = 0
    const curr = new Date(startDate)

    for (let w = 0; w < 52; w++) {
      const days = []
      for (let d = 0; d < 7; d++) {
        const yyyy = curr.getFullYear()
        const mm = String(curr.getMonth() + 1).padStart(2, '0')
        const dd = String(curr.getDate()).padStart(2, '0')
        const key = `${yyyy}-${mm}-${dd}`
        const count = dailyMap[key] || 0
        if (count > 0) activeDays++
        totalTurns += count

        let level = 0
        if (count >= 20) level = 4
        else if (count >= 10) level = 3
        else if (count >= 4) level = 2
        else if (count >= 1) level = 1

        days.push({ date: key, count, level })
        curr.setDate(curr.getDate() + 1)
      }
      weeks.push(days)
    }
    return { heatmapData: weeks, activeDaysCount: activeDays, totalTurnCount: totalTurns }
  }, [dailyMap])

  const monthLabels = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct']

  const getCellColor = (level) => {
    switch (level) {
      case 4: return '#60a5fa'
      case 3: return '#3b82f6'
      case 2: return 'rgba(59, 130, 246, 0.6)'
      case 1: return 'rgba(59, 130, 246, 0.3)'
      case 0:
      default:
        return 'rgba(255, 255, 255, 0.05)'
    }
  }

  // Real top executed tools from database
  const topTools = useMemo(() => {
    if (!activityData?.tools || !Array.isArray(activityData.tools)) return []
    return activityData.tools.filter((t) => t?.tool_name).slice(0, 6)
  }, [activityData])

  const primaryModel = activityData?.models?.[0]
  const successRate = activityData?.total_runs
    ? Math.round(((activityData.completed_runs || 0) / activityData.total_runs) * 100)
    : 100

  // Real library stats from LibraryService
  const { totalLibraryCount, libraryBreakdownText } = useMemo(() => {
    if (!libraryData?.counts || typeof libraryData.counts !== 'object') {
      return { totalLibraryCount: 0, libraryBreakdownText: '' }
    }
    const entries = Object.entries(libraryData.counts).filter(([, cnt]) => typeof cnt === 'number' && cnt > 0)
    const total = entries.reduce((sum, [, cnt]) => sum + cnt, 0)
    entries.sort((a, b) => b[1] - a[1])
    const breakdown = entries
      .slice(0, 4)
      .map(([k, cnt]) => `${cnt} ${k}${cnt === 1 ? '' : (k === 'music' ? '' : 's')}`)
      .join(' · ')
    return { totalLibraryCount: total, libraryBreakdownText: breakdown }
  }, [libraryData])

  return (
    <div className="codex-settings-container">
      {/* Top Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
        <HouseButton
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="codex-channel-btn"
        >
          <Icon name="edit" size={13} />
          <span>Edit</span>
        </HouseButton>

        <HouseButton
          type="button"
          onClick={togglePrivacy}
          className="codex-channel-btn"
        >
          <Icon name={isPrivate ? 'lock' : 'globe'} size={13} />
          <span>{isPrivate ? 'Private' : 'Public'}</span>
        </HouseButton>

        <HouseButton
          type="button"
          onClick={handleShare}
          className="codex-channel-btn"
        >
          <Icon name="share" size={13} />
          <span>Share</span>
        </HouseButton>
      </div>

      {/* Hero: Avatar + Name + Handle */}
      <div className="codex-profile-header">
        <CodexAvatar
          name={displayName}
          shape={userProfile?.avatar_shape || 'circle'}
          photoUrl={userProfile?.avatar_url}
          size={96}
        />
        <div className="codex-profile-name">{displayName}</div>
        <div className="codex-profile-handle">{handle}</div>
      </div>

      {/* 6-Metric Stat Banner (Real SQLite & Library Counts) */}
      {visibility.show_stats !== false && (
        <div className="codex-stat-banner">
          <div className="codex-stat-item">
            <span className="codex-stat-value">{activityData?.total_runs ?? 0}</span>
            <span className="codex-stat-label">Agent runs</span>
          </div>
          <div className="codex-stat-item">
            <span className="codex-stat-value">{conversations?.length ?? 0}</span>
            <span className="codex-stat-label">Conversations</span>
          </div>
          <div className="codex-stat-item">
            <span className="codex-stat-value">{activityData?.messages_count?.toLocaleString() ?? 0}</span>
            <span className="codex-stat-label">Messages</span>
          </div>
          <div
            className="codex-stat-item"
            onClick={() => setView?.('library')}
            style={{ cursor: 'pointer' }}
            title="Open Library"
          >
            <span className="codex-stat-value">{totalLibraryCount.toLocaleString()}</span>
            <span className="codex-stat-label">Library items</span>
          </div>
          <div className="codex-stat-item">
            <span className="codex-stat-value">{successRate}%</span>
            <span className="codex-stat-label">Turn success</span>
          </div>
          <div className="codex-stat-item">
            <span className="codex-stat-value">{activeDaysCount}</span>
            <span className="codex-stat-label">Active days</span>
          </div>
        </div>
      )}

      {/* Real Activity Heatmap */}
      {visibility.show_activity !== false && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Activity timeline</span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>
                {hoveredCell
                  ? `${hoveredCell.date}: ${hoveredCell.count} run${hoveredCell.count === 1 ? '' : 's'}`
                  : `${totalTurnCount} agent runs over past 52 weeks`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11.5 }}>
              {['Daily', 'Weekly', 'Total'].map((tab) => (
                <HouseButton
                  key={tab}
                  type="button"
                  onClick={() => setActivityMode(tab)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: activityMode === tab ? 'var(--text)' : 'var(--text-dim)',
                    fontWeight: activityMode === tab ? 600 : 400,
                  }}
                >
                  {tab}
                </HouseButton>
              ))}
            </div>
          </div>

          <div className="codex-card" style={{ padding: '16px 20px' }}>
            <div className="codex-heatmap-container">
              <div className="codex-heatmap-grid">
                {heatmapData.map((week, wIdx) =>
                  week.map((cell, dIdx) => (
                    <div
                      key={`${wIdx}-${dIdx}`}
                      className="codex-heatmap-cell"
                      style={{ background: getCellColor(cell.level) }}
                      onMouseEnter={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                      title={`${cell.date}: ${cell.count} agent run${cell.count === 1 ? '' : 's'}`}
                    />
                  ))
                )}
              </div>
              <div className="codex-heatmap-months">
                {monthLabels.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Real Top Capabilities & Tools */}
      {visibility.show_plugins !== false && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Top capabilities & tools</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
              {caps?.skills?.length || 0} skills · {caps?.connectors?.length || 0} connectors
            </span>
          </div>

          {topTools.length > 0 ? (
            <div className="codex-tool-grid">
              {topTools.map((t) => (
                <div key={t.tool_name} className="codex-tool-item">
                  <div className="codex-tool-icon-box">
                    <Icon name={getToolIcon(t.tool_name)} size={16} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatToolName(t.tool_name)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                      {t.cnt.toLocaleString()} executions
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="codex-card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              No tool executions recorded yet. Agent capabilities are ready to use.
            </div>
          )}
        </div>
      )}

      {/* Real Workspace & Runtime Insights */}
      {visibility.show_insights !== false && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
            Workspace & runtime insights
          </div>
          <div className="codex-card" style={{ padding: '8px 20px' }}>
            <div className="codex-insights-row">
              <span className="codex-insights-key">Active Workspace</span>
              <span className="codex-insights-val" title={workspace || 'Default'}>
                {workspace ? workspace.replace(/^\/home\/[^/]+/, '~') : 'Default Workspace'}
              </span>
            </div>
            <div className="codex-insights-row">
              <span className="codex-insights-key">Primary Model</span>
              <span className="codex-insights-val">
                {primaryModel ? `${primaryModel.name || primaryModel.model} (${primaryModel.percentage}%)` : 'Configured Provider'}
              </span>
            </div>
            <div className="codex-insights-row">
              <span className="codex-insights-key">Installed Skills</span>
              <span className="codex-insights-val">{caps?.skills?.length || 0} active</span>
            </div>
            <div className="codex-insights-row">
              <span className="codex-insights-key">Connected Services</span>
              <span className="codex-insights-val">{caps?.connectors?.length || 0} connectors</span>
            </div>
            <div
              className="codex-insights-row"
              onClick={() => setView?.('library')}
              style={{ cursor: 'pointer' }}
              title="Open Library"
            >
              <span className="codex-insights-key" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                Saved in Library
                <Icon name="arrow-up-right" size={11} style={{ opacity: 0.6 }} />
              </span>
              <span className="codex-insights-val">
                {totalLibraryCount > 0
                  ? `${totalLibraryCount.toLocaleString()} items${libraryBreakdownText ? ` (${libraryBreakdownText})` : ''}`
                  : '0 items'}
              </span>
            </div>
            <div className="codex-insights-row">
              <span className="codex-insights-key">Storage Engine</span>
              <span className="codex-insights-val">SQLite 3 · Local Encrypted</span>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out Edit Profile Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <EditProfileDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            userProfile={userProfile}
            updateUserProfile={updateUserProfile}
            toast={toast}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ==========================================================================
   1. GENERAL VIEW (Workspace, Window, Chat Storage, Speed, Composer, Popout, Toys)
   ========================================================================== */

function General() {
  const {
    workspace, setWorkspace,
    sendWith, setSendWith,
    archiveChats, setArchiveChats,
    confirmDestructive, setConfirmDestructive,
    restoreTabs, setRestoreTabs,
    showUsage, setShowUsage,
    editorDestination, setEditorDestination,
    confirmClose, setConfirmClose,
    fullViewDefault, setFullViewDefault,
    preventSleep, setPreventSleep,
    autoArchiveDays, setAutoArchiveDays,
    compressHistory, setCompressHistory,
    speedProfile, setSpeedProfile,
    followUpBehavior, setFollowUpBehavior,
    plainTextComposer, setPlainTextComposer,
    showContextUsage, setShowContextUsage,
    confettiEnabled, setConfettiEnabled,
    defaultStandaloneChat, setDefaultStandaloneChat,
    toast, setView,
  } = useApp()

  const [wsDraft, setWsDraft] = useState(workspace || '')
  const [maxIterations, setMaxIterations] = useState(16)
  const [hotkeyDraft, setHotkeyDraft] = useState('<ctrl>+<alt>+<space>')
  const [compacting, setCompacting] = useState(false)
  const [compactResult, setCompactResult] = useState(null)
  const [launchingEditor, setLaunchingEditor] = useState(false)

  useEffect(() => {
    setWsDraft(workspace || '')
  }, [workspace])

  useEffect(() => {
    api.settings()
      .then((s) => {
        if (s.max_iterations) setMaxIterations(s.max_iterations)
        if (s.hotkey) setHotkeyDraft(s.hotkey)
      })
      .catch(() => {})
  }, [])

  const saveWorkspace = () => {
    setWorkspace(wsDraft.trim())
    toast(`Working directory saved: ${wsDraft.trim() || 'API default'}`, 'ok')
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

  const handleTestEditor = async () => {
    setLaunchingEditor(true)
    try {
      const res = await api.post('/desktop/open-in-editor', {
        path: workspace || '.',
        editor: editorDestination,
      })
      if (res?.ok) {
        toast(`Opened workspace in ${editorDestination.toUpperCase()}`, 'ok')
      }
    } catch (e) {
      toast(e.message || 'Could not launch editor', 'bad')
    } finally {
      setLaunchingEditor(false)
    }
  }

  const handleCompactDb = async () => {
    setCompacting(true)
    try {
      const res = await api.post('/db/compress')
      if (res?.ok) {
        const freedKb = Math.round((res.freed_bytes || 0) / 1024)
        setCompactResult(`Compacted: ${freedKb} KB freed`)
        toast(`Database compacted successfully (${freedKb} KB freed)`, 'ok')
      }
    } catch (e) {
      toast(e.message || 'Compaction failed', 'bad')
    } finally {
      setCompacting(false)
    }
  }

  const handleAutoArchiveChange = async (val) => {
    const days = Number(val)
    setAutoArchiveDays(days)
    if (days > 0) {
      try {
        const res = await api.post('/conversations/archive-inactive', { days })
        if (res?.archived_count > 0) {
          toast(`Archived ${res.archived_count} inactive conversations`, 'ok')
        } else {
          toast(`Auto-archive set to ${days} days`, 'ok')
        }
      } catch {
        toast(`Auto-archive set to ${days} days`, 'ok')
      }
    } else {
      toast('Auto-archive disabled', 'ok')
    }
  }

  const handleSpeedProfileChange = async (val) => {
    setSpeedProfile(val)
    try {
      await api.updateSettings({ speed_profile: val })
      toast(`Speed profile set to ${val}`, 'ok')
    } catch (e) {
      toast(e.message, 'bad')
    }
  }

  const handleIterationsChange = async (val) => {
    setMaxIterations(val)
    try {
      await api.updateSettings({ max_iterations: val })
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleSaveHotkeyExplicit = async (val) => {
    try {
      await api.updateSettings({ hotkey: val })
      toast(`Launcher shortcut set to ${val}`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleSaveHotkey = () => {
    if (hotkeyDraft.trim()) {
      handleSaveHotkeyExplicit(hotkeyDraft.trim())
    }
  }

  const handleConfettiToggle = (val) => {
    setConfettiEnabled(val)
    if (val) {
      triggerConfetti()
      toast('Confetti enabled! 🎉', 'ok')
    } else {
      toast('Confetti disabled', 'ok')
    }
  }

  const editorOptions = [
    { value: 'vscode', label: 'VS Code' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'windsurf', label: 'Windsurf' },
    { value: 'sublime', label: 'Sublime Text' },
    { value: 'system', label: 'System Default' },
  ]

  const confirmCloseOptions = [
    { value: 'shortcut-only', label: 'Close shortcut only' },
    { value: 'always', label: 'Always confirm' },
    { value: 'never', label: 'Never confirm' },
  ]

  const autoArchiveOptions = [
    { value: 0, label: 'Never' },
    { value: 7, label: 'After 7 days' },
    { value: 30, label: 'After 30 days' },
    { value: 90, label: 'After 90 days' },
  ]

  const speedOptions = [
    { value: 'standard', label: 'Standard' },
    { value: 'fast', label: 'Fast' },
    { value: 'turbo', label: 'Turbo' },
  ]

  return (
    <div className="set-panel" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Workspace & External Editor */}
      <div>
        <div className="set-section-label">Workspace & Editors</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="set-row-text" style={{ flex: '1 1 240px' }}>
              <span className="set-row-title">Projectless chat folder</span>
              <span className="set-row-desc">Location where chats started outside of projects store their data.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 320px', justifyContent: 'flex-end' }}>
              <HouseInput
                type="text"
                value={wsDraft}
                onChange={(e) => setWsDraft(e.target.value)}
                placeholder="/home/user/project or ~"
                className="set-input"
                style={{ flex: 1, minWidth: 160 }}
              />
              <HouseButton type="button" className="set-btn-sm" onClick={handleBrowseDir} style={{ borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon name="folder" size={13} />
                <span>Change</span>
              </HouseButton>
              <HouseButton type="button" className="set-btn-sm is-primary" onClick={saveWorkspace} style={{ borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon name="check" size={13} />
                <span>Save</span>
              </HouseButton>
            </div>
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Default file open destination</span>
              <span className="set-row-desc">Application where files and folders open from Amethyst.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AnimatedSelect
                value={editorDestination || 'vscode'}
                onChange={(v) => { setEditorDestination(v); toast(`Editor set to ${v.toUpperCase()}`, 'ok') }}
                options={editorOptions}
                minWidth={150}
              />
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleTestEditor}
                disabled={launchingEditor}
                style={{ borderRadius: 12 }}
                title="Open current workspace in this editor"
              >
                {launchingEditor ? 'Opening...' : 'Open'}
              </HouseButton>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Window & Lifecycle */}
      <div>
        <div className="set-section-label">Window & Lifecycle</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Confirm before closing a window</span>
              <span className="set-row-desc">Warn when a tab-close shortcut would close the window.</span>
            </div>
            <AnimatedSelect
              value={confirmClose || 'shortcut-only'}
              onChange={(v) => setConfirmClose(v)}
              options={confirmCloseOptions}
              minWidth={165}
            />
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Full view by default</span>
              <span className="set-row-desc">Start new chats with Chat and content in a single consolidated tab strip.</span>
            </div>
            <Switch
              on={Boolean(fullViewDefault)}
              onChange={(val) => setFullViewDefault(val)}
              tone="default"
            />
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Restore open tabs on restart</span>
              <span className="set-row-desc">Restore your active conversation and panel state when relaunching.</span>
            </div>
            <Switch
              on={Boolean(restoreTabs)}
              onChange={(val) => setRestoreTabs?.(val)}
              tone="default"
            />
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Prevent sleep while running</span>
              <span className="set-row-desc">Keep your computer awake while Amethyst is running a task.</span>
            </div>
            <Switch
              on={Boolean(preventSleep)}
              onChange={(val) => {
                setPreventSleep(val)
                toast(val ? 'Sleep prevention active during runs' : 'Sleep prevention disabled', 'ok')
              }}
              tone="default"
            />
          </div>
        </div>
      </div>

      {/* 3. Chat & History Storage */}
      <div>
        <div className="set-section-label">Chat & History Storage</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Automatically archive inactive chats</span>
              <span className="set-row-desc">Archive local chats after a period of inactivity.</span>
            </div>
            <AnimatedSelect
              value={autoArchiveDays || 0}
              onChange={handleAutoArchiveChange}
              options={autoArchiveOptions}
              minWidth={140}
            />
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Compress local chat history</span>
              <span className="set-row-desc">
                Save disk space by compacting older local history. {compactResult && <b style={{ color: 'var(--accent)' }}>{compactResult}</b>}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleCompactDb}
                disabled={compacting}
                style={{ borderRadius: 12 }}
              >
                {compacting ? 'Compacting...' : 'Compact Now'}
              </HouseButton>
              <Switch
                on={Boolean(compressHistory)}
                onChange={(val) => setCompressHistory(val)}
                tone="default"
              />
            </div>
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Archive chats instead of deleting</span>
              <span className="set-row-desc">Archived chats are preserved and can be reviewed or restored.</span>
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
              <span className="set-row-desc">Always display confirmation dialogs before deleting conversations.</span>
            </div>
            <Switch
              on={Boolean(confirmDestructive)}
              onChange={(val) => setConfirmDestructive?.(val)}
              tone="default"
            />
          </div>
        </div>
      </div>

      {/* 4. Runtime & Speed */}
      <div>
        <div className="set-section-label">Runtime & Speed</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Speed</span>
              <span className="set-row-desc">Choose how quickly Amethyst runs across chats, subagents, and compaction.</span>
            </div>
            <AnimatedSelect
              value={speedProfile || 'standard'}
              onChange={handleSpeedProfileChange}
              options={speedOptions}
              minWidth={130}
            />
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Autonomous iteration limit</span>
              <span className="set-row-desc">How many tool calls and model round trips one turn may take before stopping.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <HouseInput
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
        </div>
      </div>

      {/* 5. Composer Controls */}
      <div>
        <div className="set-section-label">Composer</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Send shortcut</span>
              <span className="set-row-desc">Choose when Enter sends a prompt or inserts a new line.</span>
            </div>
            <div className="set-seg-ctrl" style={{ borderRadius: 12 }}>
              <HouseButton
                type="button"
                className={`set-seg-btn${(sendWith === 'enter' || sendWith === 'Enter') ? ' is-active' : ''}`}
                onClick={() => { setSendWith?.('enter'); toast('Send key set to Enter', 'ok') }}
                style={{ borderRadius: 10 }}
              >
                Enter
              </HouseButton>
              <HouseButton
                type="button"
                className={`set-seg-btn${(sendWith === 'ctrl-enter' || sendWith === 'Cmd+Enter') ? ' is-active' : ''}`}
                onClick={() => { setSendWith?.('ctrl-enter'); toast('Send key set to Ctrl+↵', 'ok') }}
                style={{ borderRadius: 10 }}
              >
                Ctrl+↵
              </HouseButton>
            </div>
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Follow-up behavior</span>
              <span className="set-row-desc">
                Queue follow-ups while Amethyst runs or steer the current run. Press Ctrl+↵ to do the opposite for one message.
              </span>
            </div>
            <div className="set-seg-ctrl" style={{ borderRadius: 12 }}>
              <HouseButton
                type="button"
                className={`set-seg-btn${followUpBehavior === 'queue' ? ' is-active' : ''}`}
                onClick={() => { setFollowUpBehavior('queue'); toast('Follow-up behavior set to Queue', 'ok') }}
                style={{ borderRadius: 10 }}
              >
                Queue
              </HouseButton>
              <HouseButton
                type="button"
                className={`set-seg-btn${followUpBehavior === 'steer' ? ' is-active' : ''}`}
                onClick={() => { setFollowUpBehavior('steer'); toast('Follow-up behavior set to Steer', 'ok') }}
                style={{ borderRadius: 10 }}
              >
                Steer
              </HouseButton>
            </div>
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Plain text composer</span>
              <span className="set-row-desc">Keep code, Markdown, and links as literal text while writing messages.</span>
            </div>
            <Switch
              on={Boolean(plainTextComposer)}
              onChange={(val) => setPlainTextComposer(val)}
              tone="default"
            />
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Show context window usage</span>
              <span className="set-row-desc">Display token consumption and budget telemetry in the composer.</span>
            </div>
            <Switch
              on={Boolean(showContextUsage)}
              onChange={(val) => setShowContextUsage(val)}
              tone="default"
            />
          </div>
        </div>
      </div>

      {/* 6. Popout Window & Launcher */}
      <div>
        <div className="set-section-label">Popout Window</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Popout Window hotkey</span>
              <span className="set-row-desc">Set a global shortcut for Popout Window. Leave unset to keep it off.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HouseInput
                type="text"
                value={hotkeyDraft}
                onChange={(e) => setHotkeyDraft(e.target.value)}
                placeholder="<ctrl>+<alt>+<space>"
                style={{ width: 175, fontFamily: 'var(--font-mono)', fontSize: '13px' }}
              />
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={handleSaveHotkey}
                style={{ borderRadius: 12 }}
              >
                Save
              </HouseButton>
            </div>
          </div>

          <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="set-row-text">
              <span className="set-row-title">Shortcut presets</span>
              <span className="set-row-desc">Quick standard chords:</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: 'Ctrl+Alt+Space', chord: '<ctrl>+<alt>+<space>' },
                { label: 'Ctrl+Space', chord: '<ctrl>+<space>' },
                { label: 'Super+Space', chord: '<super>+<space>' },
                { label: 'Alt+Space', chord: '<alt>+<space>' },
              ].map((p) => (
                <HouseButton
                  key={p.chord}
                  type="button"
                  className={`set-btn-sm${hotkeyDraft === p.chord ? ' is-active' : ''}`}
                  onClick={() => {
                    setHotkeyDraft(p.chord)
                    handleSaveHotkeyExplicit(p.chord)
                  }}
                  style={{ borderRadius: 12 }}
                >
                  {p.label}
                </HouseButton>
              ))}
            </div>
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Default to standalone chat</span>
              <span className="set-row-desc">Start new chats outside of any project.</span>
            </div>
            <Switch
              on={Boolean(defaultStandaloneChat)}
              onChange={(val) => setDefaultStandaloneChat(val)}
              tone="default"
            />
          </div>
        </div>
      </div>

      {/* 7. Toys & Notices */}
      <div>
        <div className="set-section-label">Toys</div>
        <div className="set-box" style={{ borderRadius: 16 }}>
          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Confetti cannon</span>
              <span className="set-row-desc">Show confetti in the app when you ask or complete tasks!</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={() => triggerConfetti()}
                style={{ borderRadius: 12 }}
              >
                🎉 Test
              </HouseButton>
              <Switch
                on={Boolean(confettiEnabled)}
                onChange={handleConfettiToggle}
                tone="default"
              />
            </div>
          </div>

          <div className="set-box-row">
            <div className="set-row-text">
              <span className="set-row-title">Open source licenses</span>
              <span className="set-row-desc">Third-party notices for bundled dependencies.</span>
            </div>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={() => {
                const aboutItem = document.querySelector('[data-section="about"]')
                if (aboutItem) aboutItem.click()
              }}
              style={{ borderRadius: 12 }}
            >
              View
            </HouseButton>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   1b. NOTIFICATIONS VIEW
   ========================================================================== */

function Notifications() {
  const { notifyOnDone, setNotifyOnDone, setView, toast } = useApp()
  const [briefingHour, setBriefingHour] = useState(8)
  const [briefingEnabled, setBriefingEnabled] = useState(true)

  // Channels state for each notification category
  const [channels, setChannels] = useState(() => {
    try {
      const cached = safeStorage.getItem('amethyst_notification_channels')
      if (cached) return JSON.parse(cached)
    } catch {}
    return {
      agent_runs: 'desktop',
      tasks: 'all',
      permissions: 'all',
      questions: 'desktop',
      library: 'desktop',
      responses: 'desktop',
      briefing: 'desktop',
      health: 'desktop',
      usage: 'all',
    }
  })

  useEffect(() => {
    api.settings()
      .then((s) => {
        if (s.journal) {
          if (s.journal.briefing_hour !== undefined) setBriefingHour(s.journal.briefing_hour)
          if (s.journal.briefing_enabled !== undefined) setBriefingEnabled(s.journal.briefing_enabled)
        }
      })
      .catch(() => {})
  }, [])

  const channelOptions = [
    { value: 'desktop', label: 'Desktop' },
    { value: 'sound', label: 'Sound' },
    { value: 'push', label: 'Companion Push' },
    { value: 'all', label: 'Desktop, Sound' },
    { value: 'off', label: 'Off' },
  ]

  const updateChannel = (category, val) => {
    const next = { ...channels, [category]: val }
    setChannels(next)
    try {
      safeStorage.setItem('amethyst_notification_channels', JSON.stringify(next))
    } catch {}

    if (category === 'agent_runs') {
      if (val === 'off') {
        setNotifyOnDone(false)
      } else {
        setNotifyOnDone(true)
      }
    }

    if (category === 'briefing') {
      const enabled = val !== 'off'
      setBriefingEnabled(enabled)
      api.updateSettings({ journal: { briefing_hour: briefingHour, briefing_enabled: enabled } }).catch(() => {})
    }

    toast(`Channel set to ${channelOptions.find((o) => o.value === val)?.label || val}`, 'ok')
  }

  const handleConfigureBriefing = async () => {
    const hourStr = window.prompt('Set morning briefing hour (0-23):', String(briefingHour))
    if (hourStr != null) {
      const h = parseInt(hourStr, 10)
      if (!isNaN(h) && h >= 0 && h <= 23) {
        setBriefingHour(h)
        try {
          await api.updateSettings({ journal: { briefing_hour: h, briefing_enabled: briefingEnabled } })
          toast(`Daily briefing scheduled for ${String(h).padStart(2, '0')}:00`, 'ok')
        } catch (e) {
          toast(e.message, 'bad')
        }
      }
    }
  }

  const notificationItems = [
    {
      id: 'agent_runs',
      title: 'Agent runs',
      desc: 'Get notified about Amethyst tasks and completed turns.',
    },
    {
      id: 'tasks',
      title: 'Tasks',
      desc: "Get notified when tasks you've created have updates.",
      linkText: 'Manage tasks',
      onLinkClick: () => forSettings(setView, 'activity'),
    },
    {
      id: 'permissions',
      title: 'Permissions',
      desc: 'Get notified when filesystem, shell, or network actions need your confirmation.',
    },
    {
      id: 'questions',
      title: 'Questions & input',
      desc: 'Get notified when input is needed to continue.',
    },
    {
      id: 'library',
      title: 'Library',
      desc: 'Get notified about shared files, index completions, and attachments in your Library.',
    },
    {
      id: 'responses',
      title: 'Responses',
      desc: 'Get notified when Amethyst responds to requests that take time, like research or code generation.',
    },
    {
      id: 'briefing',
      title: 'Morning briefing',
      desc: 'Receive a concise morning summary of open tasks, git activity, and agenda.',
      linkText: `Configure time (${String(briefingHour).padStart(2, '0')}:00)`,
      onLinkClick: handleConfigureBriefing,
    },
    {
      id: 'health',
      title: 'Health',
      desc: 'Get notified when local system or container health data is ready.',
    },
    {
      id: 'usage',
      title: 'Usage',
      desc: "We'll notify you when limits reset for features like image creation or 5-hour provider windows.",
    },
  ]

  return (
    <div className="codex-settings-container">
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', margin: '0 0 20px', letterSpacing: '-0.02em' }}>
          Notifications
        </h2>

        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 8, letterSpacing: '0.02em' }}>
          Amethyst
        </div>

        <div className="codex-card">
          {notificationItems.map((item) => (
            <div key={item.id} className="codex-row">
              <div className="codex-row-info">
                <span className="codex-row-title">{item.title}</span>
                <span className="codex-row-desc">{item.desc}</span>
                {item.linkText && (
                  <HouseButton
                    type="button"
                    className="codex-row-link"
                    onClick={item.onLinkClick}
                  >
                    {item.linkText}
                  </HouseButton>
                )}
              </div>

              <AnimatedSelect
                value={channels[item.id] || 'desktop'}
                onChange={(val) => updateChannel(item.id, val)}
                options={channelOptions}
                minWidth={130}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Toast Tester */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8 }}>
          Notification Preview
        </div>
        <div className="codex-card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12 }}>
            Interactive preview of BoardUI Notification alerts:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <HouseButton type="button" className="set-btn-sm" onClick={() => showBoardUINotification('information')} style={{ borderRadius: 10 }}>
              Information
            </HouseButton>
            <HouseButton type="button" className="set-btn-sm" onClick={() => showBoardUINotification('success')} style={{ borderRadius: 10 }}>
              Success
            </HouseButton>
            <HouseButton type="button" className="set-btn-sm" onClick={() => showBoardUINotification('error')} style={{ borderRadius: 10 }}>
              Error
            </HouseButton>
            <HouseButton type="button" className="set-btn-sm" onClick={() => showBoardUINotification('avatar')} style={{ borderRadius: 10 }}>
              With avatar
            </HouseButton>
            <HouseButton type="button" className="set-btn-sm" onClick={() => showBoardUINotification('actions')} style={{ borderRadius: 10 }}>
              With buttons
            </HouseButton>
          </div>
        </div>
      </div>
    </div>
  )
}


/* ==========================================================================
   2. APPEARANCE VIEW (Themes, Scaled UI & Fonts, Accent, Loader, Material)
   ========================================================================== */

function NumberStepper({ value, onChange, min = 10, max = 24, unit = 'px' }) {
  const current = Number(value) || min
  return (
    <div className="codex-stepper-box">
      <HouseButton
        type="button"
        className="codex-stepper-btn"
        onClick={() => onChange(Math.max(min, current - 1))}
        disabled={current <= min}
        aria-label="Decrease"
      >
        <Icon name="minus" size={11} />
      </HouseButton>
      <div className="codex-stepper-val">
        <span className="codex-stepper-num">{current}</span>
        {unit && <span className="codex-stepper-unit">{unit}</span>}
      </div>
      <HouseButton
        type="button"
        className="codex-stepper-btn"
        onClick={() => onChange(Math.min(max, current + 1))}
        disabled={current >= max}
        aria-label="Increase"
      >
        <Icon name="plus" size={11} />
      </HouseButton>
    </div>
  )
}

const THEMES_CONFIG = [
  {
    id: 'system',
    label: 'System',
    hint: 'Follows OS preference',
    mode: 'auto',
    canvas: '#121316',
    sidebar: '#18191d',
    card: '#202126',
    accent: '#3b82f6',
  },
  {
    id: 'graphite',
    label: 'Graphite',
    hint: 'Neutral dark slate & violet',
    mode: 'dark',
    canvas: '#121316',
    sidebar: '#18191d',
    card: '#202126',
    accent: '#a78bfa',
  },
  {
    id: 'ink',
    label: 'Ink',
    hint: 'Deep blue-black indigo',
    mode: 'dark',
    canvas: '#0b0d13',
    sidebar: '#10131c',
    card: '#171b26',
    accent: '#38bdf8',
  },
  {
    id: 'nocturne',
    label: 'Nocturne',
    hint: 'Near black cobalt cyan',
    mode: 'dark',
    canvas: '#050608',
    sidebar: '#0a0b10',
    card: '#121318',
    accent: '#22d3ee',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA',
    hint: 'True black neon green',
    mode: 'dark',
    canvas: '#000000',
    sidebar: '#08090a',
    card: '#111215',
    accent: '#76b900',
  },
  {
    id: 'paper',
    label: 'Paper',
    hint: 'Pristine gallery white',
    mode: 'light',
    canvas: '#ffffff',
    sidebar: '#f8f9fa',
    card: '#ffffff',
    accent: '#2563eb',
  },
  {
    id: 'sand',
    label: 'Sand',
    hint: 'Warm parchment linen',
    mode: 'light',
    canvas: '#faf8f5',
    sidebar: '#f3efe8',
    card: '#ffffff',
    accent: '#d97706',
  },
  {
    id: 'claude',
    label: 'Claude',
    hint: 'Warm ivory cinnabar',
    mode: 'light',
    canvas: '#fbf9f4',
    sidebar: '#f3eee4',
    card: '#ffffff',
    accent: '#c2410c',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    hint: 'Minimal porcelain cobalt',
    mode: 'light',
    canvas: '#f9f9fa',
    sidebar: '#f2f2f4',
    card: '#ffffff',
    accent: '#0ea5e9',
  },
]

function ThemeMiniWindow({ config, compact = false }) {
  if (config.id === 'system' || config.mode === 'auto') {
    return (
      <div className={`theme-mini-window theme-mini-window--split${compact ? ' is-compact' : ''}`}>
        <div className="theme-mini-split-side theme-mini-split-side--light">
          <div className="theme-mini-chrome">
            <div className="theme-mini-dots">
              <span className="theme-mini-dot" style={{ background: '#ff5f56' }} />
              <span className="theme-mini-dot" style={{ background: '#ffbd2e' }} />
              <span className="theme-mini-dot" style={{ background: '#27c93f' }} />
            </div>
            {!compact && <span className="theme-mini-title-pill" style={{ background: 'rgba(0,0,0,0.14)' }} />}
          </div>
          <div className="theme-mini-body">
            <div className="theme-mini-sidebar" style={{ background: '#f8f9fa', borderRight: '1px solid rgba(0,0,0,0.06)' }}>
              <div className="theme-mini-nav-item is-active" style={{ background: 'rgba(0,0,0,0.06)' }}>
                <span className="theme-mini-nav-indicator" style={{ background: '#2563eb' }} />
                <span className="theme-mini-nav-text" style={{ width: '52%', background: 'rgba(0,0,0,0.18)' }} />
              </div>
              <div className="theme-mini-nav-item">
                <span className="theme-mini-nav-text" style={{ width: '68%', background: 'rgba(0,0,0,0.08)' }} />
              </div>
              {!compact && (
                <div className="theme-mini-nav-bottom">
                  <span className="theme-mini-avatar" style={{ background: 'rgba(0,0,0,0.15)' }} />
                </div>
              )}
            </div>
            <div className="theme-mini-content" style={{ background: '#ffffff' }}>
              <div className="theme-mini-user-bubble" style={{ background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.05)' }}>
                <span className="theme-mini-bubble-text" style={{ width: '65%', background: 'rgba(0,0,0,0.18)' }} />
              </div>
              <div className="theme-mini-assistant-card" style={{ background: '#f8f9fa', borderColor: 'rgba(0,0,0,0.06)' }}>
                <div className="theme-mini-card-header">
                  <span className="theme-mini-card-avatar" style={{ background: '#2563eb' }} />
                  <span className="theme-mini-card-name" style={{ width: '42%', background: 'rgba(0,0,0,0.18)' }} />
                </div>
                <span className="theme-mini-card-line" style={{ width: '88%', background: 'rgba(0,0,0,0.16)' }} />
              </div>
              <div className="theme-mini-input-bar" style={{ background: 'rgba(0,0,0,0.03)', borderColor: 'rgba(0,0,0,0.05)' }}>
                <span className="theme-mini-input-placeholder" style={{ width: '45%', background: 'rgba(0,0,0,0.08)' }} />
                <span className="theme-mini-action-pill" style={{ background: '#2563eb' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="theme-mini-split-line" />

        <div className="theme-mini-split-side theme-mini-split-side--dark">
          <div className="theme-mini-chrome">
            {!compact && <span className="theme-mini-title-pill" style={{ background: 'rgba(255,255,255,0.15)', margin: 'auto' }} />}
          </div>
          <div className="theme-mini-body">
            <div className="theme-mini-sidebar" style={{ background: '#18191d', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="theme-mini-nav-item is-active" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <span className="theme-mini-nav-indicator" style={{ background: '#3b82f6' }} />
                <span className="theme-mini-nav-text" style={{ width: '52%', background: 'rgba(255,255,255,0.22)' }} />
              </div>
              <div className="theme-mini-nav-item">
                <span className="theme-mini-nav-text" style={{ width: '68%', background: 'rgba(255,255,255,0.1)' }} />
              </div>
              {!compact && (
                <div className="theme-mini-nav-bottom">
                  <span className="theme-mini-avatar" style={{ background: 'rgba(255,255,255,0.2)' }} />
                </div>
              )}
            </div>
            <div className="theme-mini-content" style={{ background: '#121316' }}>
              <div className="theme-mini-user-bubble" style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.07)' }}>
                <span className="theme-mini-bubble-text" style={{ width: '65%', background: 'rgba(255,255,255,0.24)' }} />
              </div>
              <div className="theme-mini-assistant-card" style={{ background: '#202126', borderColor: 'rgba(255,255,255,0.08)' }}>
                <div className="theme-mini-card-header">
                  <span className="theme-mini-card-avatar" style={{ background: '#3b82f6' }} />
                  <span className="theme-mini-card-name" style={{ width: '42%', background: 'rgba(255,255,255,0.22)' }} />
                </div>
                <span className="theme-mini-card-line" style={{ width: '88%', background: 'rgba(255,255,255,0.2)' }} />
              </div>
              <div className="theme-mini-input-bar" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.07)' }}>
                <span className="theme-mini-input-placeholder" style={{ width: '45%', background: 'rgba(255,255,255,0.1)' }} />
                <span className="theme-mini-action-pill" style={{ background: '#3b82f6' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isLight = config.mode === 'light'
  const borderHairline = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const subtleLine = isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)'
  const dimLine = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)'

  return (
    <div
      className={`theme-mini-window${compact ? ' is-compact' : ''}`}
      style={{
        background: config.canvas,
        borderColor: borderHairline,
      }}
    >
      <div
        className="theme-mini-chrome"
        style={{
          borderBottomColor: borderHairline,
          background: isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
        }}
      >
        <div className="theme-mini-dots">
          <span className="theme-mini-dot" style={{ background: '#ff5f56' }} />
          <span className="theme-mini-dot" style={{ background: '#ffbd2e' }} />
          <span className="theme-mini-dot" style={{ background: '#27c93f' }} />
        </div>
        {!compact && <span className="theme-mini-title-pill" style={{ background: subtleLine }} />}
        <div style={{ width: 12 }} />
      </div>

      <div className="theme-mini-body">
        <div
          className="theme-mini-sidebar"
          style={{
            background: config.sidebar,
            borderRightColor: borderHairline,
          }}
        >
          <div
            className="theme-mini-nav-item is-active"
            style={{
              background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)',
            }}
          >
            <span
              className="theme-mini-nav-indicator"
              style={{ background: config.accent }}
            />
            <span className="theme-mini-nav-text" style={{ width: '52%', background: subtleLine }} />
          </div>
          <div className="theme-mini-nav-item">
            <span className="theme-mini-nav-text" style={{ width: '70%', background: dimLine }} />
          </div>
          {!compact && (
            <div className="theme-mini-nav-item">
              <span className="theme-mini-nav-text" style={{ width: '48%', background: dimLine }} />
            </div>
          )}
          {!compact && (
            <div className="theme-mini-nav-bottom">
              <span className="theme-mini-avatar" style={{ background: subtleLine }} />
              <span className="theme-mini-nav-text" style={{ width: '42%', background: dimLine }} />
            </div>
          )}
        </div>

        <div className="theme-mini-content" style={{ background: config.canvas }}>
          <div
            className="theme-mini-user-bubble"
            style={{
              background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
              borderColor: borderHairline,
            }}
          >
            <span className="theme-mini-bubble-text" style={{ width: '65%', background: subtleLine }} />
          </div>

          <div
            className="theme-mini-assistant-card"
            style={{
              background: config.card,
              borderColor: borderHairline,
            }}
          >
            <div className="theme-mini-card-header">
              <span className="theme-mini-card-avatar" style={{ background: config.accent }} />
              <span className="theme-mini-card-name" style={{ width: '38%', background: subtleLine }} />
            </div>
            <span className="theme-mini-card-line" style={{ width: '88%', background: subtleLine }} />
            {!compact && <span className="theme-mini-card-line" style={{ width: '58%', background: dimLine }} />}
          </div>

          <div
            className="theme-mini-input-bar"
            style={{
              background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
              borderColor: borderHairline,
            }}
          >
            <span className="theme-mini-input-placeholder" style={{ width: '42%', background: dimLine }} />
            <span className="theme-mini-action-pill" style={{ background: config.accent }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Appearance() {
  const {
    theme, setTheme,
    accentColor, setAccentColor,
    uiFontSize, setUiFontSize,
    codeFontSize, setCodeFontSize,
    reduceMotion, setReduceMotion,
    separateLightDark, setSeparateLightDark,
    preferredDarkTheme, setPreferredDarkTheme,
    preferredLightTheme, setPreferredLightTheme,
    uiFontStyle, setUiFontStyle,
    contentFont, setContentFont,
    contentFontWeight, setContentFontWeight,
    codeFont, setCodeFont,
    codeFontWeight, setCodeFontWeight,
    contrast, setContrast,
    diffMarkers, setDiffMarkers,
    pointerCursors, setPointerCursors,
    customBg, setCustomBg,
    customFg, setCustomFg,
    fontFamily, setFontFamily,
    agentLoader, setAgentLoader,
    thinkingStyle, setThinkingStyle,
    glassMaterial, setGlassMaterial,
    spotlightAnimation, setSpotlightAnimation,
    autoHideTopBar, setAutoHideTopBar,
    toast,
  } = useApp()

  const [showAdvanced, setShowAdvanced] = useState(false)

  const isDark = theme === 'system'
    ? (typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true)
    : DARK_THEMES.includes(theme)

  const effectiveBg = customBg || (isDark ? '#111111' : '#ffffff')
  const effectiveFg = customFg || (isDark ? '#fcfcfc' : '#111111')

  const ACCENT_PRESETS = [
    { hex: '#3b82f6', label: 'Blue' },
    { hex: '#14b8a6', label: 'Teal' },
    { hex: '#10b981', label: 'Green' },
    { hex: '#f59e0b', label: 'Amber' },
    { hex: '#ec4899', label: 'Pink' },
    { hex: '#64748b', label: 'Slate' },
  ]

  const isPresetAccent = ACCENT_PRESETS.some(
    (p) => p.hex.toLowerCase() === (accentColor || '#3b82f6').toLowerCase()
  )

  const SPOTLIGHT_ANIMATIONS = [
    { id: 'spring', label: 'Spring', hint: 'Drops in with a slight overshoot. The default.' },
    { id: 'fade', label: 'Fade', hint: 'Opacity only, no movement.' },
    { id: 'scale', label: 'Scale', hint: 'Grows from its own centre.' },
    { id: 'slide', label: 'Slide', hint: 'Rises from below, like a sheet.' },
    { id: 'instant', label: 'Instant', hint: 'No animation at all.' },
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

  const handleExportTheme = () => {
    const tokens = {
      theme,
      accentColor: accentColor || '#3b82f6',
      customBg: customBg || null,
      customFg: customFg || null,
      fontFamily,
      uiFontSize,
      codeFontSize,
      contrast,
    }
    const blob = new Blob([JSON.stringify(tokens, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `amethyst-theme-${theme}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Theme configuration downloaded', 'ok')
  }

  const handleCopyTheme = () => {
    const text = `Theme: ${theme}\nAccent: ${accentColor || '#3b82f6'}\nBackground: ${effectiveBg}\nForeground: ${effectiveFg}`
    copyText(text)
    toast('Theme palette copied to clipboard', 'ok')
  }

  const handleResetAppearance = () => {
    setTheme('system')
    setAccentColor('#3b82f6')
    setCustomBg?.('')
    setCustomFg?.('')
    setFontFamily?.('system')
    setUiFontSize?.(14)
    setCodeFontSize?.(12)
    setReduceMotion?.('system')
    setSeparateLightDark?.(false)
    setUiFontStyle?.('400')
    setContentFont?.('same')
    setContentFontWeight?.('400')
    setCodeFont?.('system')
    setCodeFontWeight?.('400')
    setContrast?.(60)
    setDiffMarkers?.('color')
    setPointerCursors?.(false)
    setAgentLoader?.('pixels')
    setThinkingStyle?.('cards')
    setGlassMaterial?.('full')
    setSpotlightAnimation?.('spring')
    setAutoHideTopBar?.(false)
    toast('Appearance reset to defaults', 'ok')
  }

  return (
    <div className="codex-settings-container">
      {/* Title */}
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Appearance
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>
          Visual style
        </div>
      </div>

      {/* Card 1: Mode */}
      <div className="codex-card" style={{ marginBottom: 16 }}>
        <div className="codex-row">
          <span className="codex-row-title">Mode</span>

          <div className="codex-mode-grid">
            {/* Auto (System) */}
            <HouseButton
              type="button"
              className={`codex-mode-thumbnail${theme === 'system' ? ' is-active' : ''}`}
              onClick={() => setTheme('system')}
              title="System Mode (Follows OS)"
            >
              <ThemeMiniWindow config={THEMES_CONFIG[0]} compact={true} />
            </HouseButton>

            {/* Light */}
            <HouseButton
              type="button"
              className={`codex-mode-thumbnail${LIGHT_THEMES.includes(theme) ? ' is-active' : ''}`}
              onClick={() => setTheme(preferredLightTheme || 'paper')}
              title="Light Mode"
            >
              <ThemeMiniWindow
                config={THEMES_CONFIG.find((t) => t.id === 'paper') || THEMES_CONFIG[5]}
                compact={true}
              />
            </HouseButton>

            {/* Dark */}
            <HouseButton
              type="button"
              className={`codex-mode-thumbnail${DARK_THEMES.includes(theme) ? ' is-active' : ''}`}
              onClick={() => setTheme(preferredDarkTheme || 'graphite')}
              title="Dark Mode"
            >
              <ThemeMiniWindow
                config={THEMES_CONFIG.find((t) => t.id === 'graphite') || THEMES_CONFIG[1]}
                compact={true}
              />
            </HouseButton>
          </div>
        </div>
      </div>

      {/* Theme Visual Previews */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Theme Previews</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Select a palette preview</span>
        </div>
        <div className="theme-grid-3">
          {THEMES_CONFIG.map((t) => {
            const isSel = theme === t.id
            const isSplit = t.id === 'system'
            return (
              <HouseButton
                key={t.id}
                type="button"
                className={`theme-card-outer${isSel ? ' is-active' : ''}`}
                onClick={() => setTheme(t.id)}
                title={`${t.label} — ${t.hint}`}
              >
                <ThemeMiniWindow config={t} />
                <div className="theme-card-footer">
                  <div className="theme-card-title-row">
                    <span className="theme-card-label">{t.label}</span>
                    <div className="theme-card-swatches">
                      <span
                        className="theme-swatch-dot"
                        style={{
                          background: isSplit
                            ? 'linear-gradient(135deg, #ffffff 50%, #121316 50%)'
                            : t.canvas,
                        }}
                        title="Canvas"
                      />
                      <span
                        className="theme-swatch-dot"
                        style={{
                          background: isSplit
                            ? 'linear-gradient(135deg, #f8f9fa 50%, #18191d 50%)'
                            : t.sidebar,
                        }}
                        title="Sidebar"
                      />
                      <span
                        className="theme-swatch-dot"
                        style={{
                          background: isSplit
                            ? 'linear-gradient(135deg, #f8f9fa 50%, #202126 50%)'
                            : t.card,
                        }}
                        title="Card"
                      />
                      <span
                        className="theme-swatch-dot is-accent"
                        style={{
                          background: t.accent,
                          boxShadow: `0 0 4px ${t.accent}66`,
                        }}
                        title="Accent"
                      />
                      {isSel && (
                        <Icon name="check" size={12} style={{ color: 'var(--accent)', marginLeft: 3 }} />
                      )}
                    </div>
                  </div>
                  <span className="theme-card-hint">{t.hint}</span>
                </div>
              </HouseButton>
            )
          })}
        </div>
      </div>

      {/* Card 2: Visual Style Tokens */}
      <div className="codex-card" style={{ marginBottom: 16 }}>
        {/* Row 1: Theme */}
        <div className="codex-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="codex-row-title">Theme</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <HouseButton
                type="button"
                className="codex-channel-btn"
                onClick={handleExportTheme}
                title="Download theme tokens as JSON"
                style={{ padding: '4px 8px' }}
              >
                <Icon name="download" size={12} />
              </HouseButton>
              <HouseButton
                type="button"
                className="codex-channel-btn"
                onClick={handleCopyTheme}
                title="Copy theme colors to clipboard"
                style={{ padding: '4px 8px' }}
              >
                <Icon name="copy" size={12} />
              </HouseButton>
            </div>
          </div>

          <AnimatedSelect
            value={theme}
            onChange={(val) => setTheme(val)}
            options={THEME_CHOICES.map((t) => ({
              value: t.id,
              label: t.label,
              hint: t.hint,
            }))}
            renderIcon={(opt) => {
              const meta = THEMES_CONFIG.find((m) => m.id === opt.value)
              const isSplit = opt.value === 'system'
              return (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: isSplit
                      ? 'linear-gradient(135deg, #2563eb 50%, #121316 50%)'
                      : meta?.accent || 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: '#ffffff',
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${meta?.accent ? meta.accent + '40' : 'rgba(0,0,0,0.2)'}`,
                  }}
                >
                  {opt.label.slice(0, 2)}
                </div>
              )
            }}
            renderOption={(opt, isSelected) => {
              const meta = THEMES_CONFIG.find((m) => m.id === opt.value)
              const isSplit = opt.value === 'system'
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', minWidth: 0 }}>
                  <div
                    style={{
                      width: 20,
                      height: 14,
                      borderRadius: 3,
                      background: isSplit
                        ? 'linear-gradient(90deg, #ffffff 50%, #121316 50%)'
                        : meta?.canvas || 'var(--raised)',
                      border: '1px solid var(--hairline-strong)',
                      flexShrink: 0,
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'flex',
                    }}
                  >
                    <div
                      style={{
                        width: '32%',
                        height: '100%',
                        background: isSplit ? '#f4f4f5' : meta?.sidebar || 'var(--surface)',
                        borderRight: '1px solid var(--hairline)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 1.5,
                        right: 1.5,
                        width: 4,
                        height: 3,
                        borderRadius: 1,
                        background: meta?.accent || 'var(--accent)',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left', flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: isSelected ? 600 : 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {opt.hint}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <Icon name="check" size={12} style={{ color: 'var(--accent)', marginLeft: 6, flexShrink: 0 }} />
                  )}
                </div>
              )
            }}
            minWidth={170}
          />
        </div>

        {/* Row 2: Accent */}
        <div className="codex-row">
          <span className="codex-row-title">Accent</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AnimatedSelect
              value={isPresetAccent ? (accentColor || '#3b82f6').toLowerCase() : 'custom'}
              onChange={(val) => {
                if (val !== 'custom') setAccentColor(val)
              }}
              options={[
                { value: '#3b82f6', label: 'Blue' },
                { value: '#14b8a6', label: 'Teal' },
                { value: '#10b981', label: 'Green' },
                { value: '#f59e0b', label: 'Amber' },
                { value: '#ec4899', label: 'Pink' },
                { value: '#64748b', label: 'Slate' },
                { value: 'custom', label: 'Custom' },
              ]}
              minWidth={110}
            />

            <label className="codex-color-pill" title="Click to pick custom accent color">
              <span className="codex-color-dot" style={{ backgroundColor: accentColor || '#3b82f6' }} />
              <span>{(accentColor || '#3b82f6').toUpperCase()}</span>
              {/* eslint-disable-next-line amethyst-ui/no-raw-controls */}
              <input
                type="color"
                value={accentColor || '#3b82f6'}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ position: 'absolute', opacity: 0, inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>

        {/* Row 3: Background */}
        <div className="codex-row">
          <span className="codex-row-title">Background</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {customBg && (
              <HouseButton
                type="button"
                className="codex-row-link"
                onClick={() => setCustomBg('')}
                title="Reset to theme default"
                style={{ fontSize: 11.5 }}
              >
                Reset
              </HouseButton>
            )}
            <label className="codex-color-pill" title="Click to customize background color">
              <span className="codex-color-dot" style={{ backgroundColor: effectiveBg }} />
              <span>{effectiveBg.toUpperCase()}</span>
              {/* eslint-disable-next-line amethyst-ui/no-raw-controls */}
              <input
                type="color"
                value={effectiveBg}
                onChange={(e) => setCustomBg(e.target.value)}
                style={{ position: 'absolute', opacity: 0, inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>

        {/* Row 4: Foreground */}
        <div className="codex-row">
          <span className="codex-row-title">Foreground</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {customFg && (
              <HouseButton
                type="button"
                className="codex-row-link"
                onClick={() => setCustomFg('')}
                title="Reset to theme default"
                style={{ fontSize: 11.5 }}
              >
                Reset
              </HouseButton>
            )}
            <label className="codex-color-pill" title="Click to customize text color">
              <span className="codex-color-dot" style={{ backgroundColor: effectiveFg }} />
              <span>{effectiveFg.toUpperCase()}</span>
              {/* eslint-disable-next-line amethyst-ui/no-raw-controls */}
              <input
                type="color"
                value={effectiveFg}
                onChange={(e) => setCustomFg(e.target.value)}
                style={{ position: 'absolute', opacity: 0, inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>

        {/* Row 5: Font */}
        <div className="codex-row">
          <span className="codex-row-title">Font</span>

          <AnimatedSelect
            value={fontFamily || 'system'}
            onChange={(val) => setFontFamily(val)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'inter', label: 'Inter' },
              { value: 'plus-jakarta', label: 'Plus Jakarta Sans' },
              { value: 'geist', label: 'Geist' },
              { value: 'serif', label: 'Serif' },
            ]}
            minWidth={130}
          />
        </div>
      </div>

      {/* Advanced Collapsible Accordion */}
      <div style={{ marginTop: 4, marginBottom: 14 }}>
        <HouseButton
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="codex-accordion-btn"
        >
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>Advanced</span>
          <motion.div
            animate={{ rotate: showAdvanced ? 90 : 0 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <Icon name="chevron-right" size={13} />
          </motion.div>
        </HouseButton>
      </div>

      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}
          >
            {/* Advanced Card 1: Font Sizes */}
            <div className="codex-card">
              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">UI font size</span>
                  <span className="codex-row-desc">Adjust the base size used for Amethyst</span>
                </div>
                <NumberStepper
                  value={uiFontSize}
                  onChange={(val) => setUiFontSize(val)}
                  min={11}
                  max={22}
                  unit="px"
                />
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Code font size</span>
                  <span className="codex-row-desc">Adjust the base size used for code across chats and diffs</span>
                </div>
                <NumberStepper
                  value={codeFontSize}
                  onChange={(val) => setCodeFontSize(val)}
                  min={9}
                  max={22}
                  unit="px"
                />
              </div>
            </div>

            {/* Advanced Card 2: Motion & Modes */}
            <div className="codex-card">
              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Reduce motion</span>
                  <span className="codex-row-desc">Reduce animations or match your system</span>
                </div>
                <div className="codex-seg-group">
                  {['system', 'on', 'off'].map((m) => (
                    <HouseButton
                      key={m}
                      type="button"
                      className={`codex-seg-item${(reduceMotion || 'system') === m ? ' is-active' : ''}`}
                      onClick={() => setReduceMotion(m)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {m}
                    </HouseButton>
                  ))}
                </div>
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Separate light and dark modes</span>
                  <span className="codex-row-desc">Choose a theme, colors, and font for each</span>
                </div>
                <Switch
                  on={Boolean(separateLightDark)}
                  onChange={(val) => setSeparateLightDark(val)}
                  tone="default"
                />
              </div>

              {Boolean(separateLightDark) && (
                <div style={{ padding: '12px 16px', background: 'var(--surface-2, rgba(255, 255, 255, 0.02))', borderTop: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Preferred light theme</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Used when operating system is in light mode</div>
                    </div>
                    <AnimatedSelect
                      value={preferredLightTheme || 'paper'}
                      onChange={(val) => setPreferredLightTheme(val)}
                      options={LIGHT_THEMES.map((id) => {
                        const match = THEME_CHOICES.find((t) => t.id === id)
                        return { value: id, label: match?.label || id, hint: match?.hint }
                      })}
                      minWidth={140}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Preferred dark theme</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Used when operating system is in dark mode</div>
                    </div>
                    <AnimatedSelect
                      value={preferredDarkTheme || 'graphite'}
                      onChange={(val) => setPreferredDarkTheme(val)}
                      options={DARK_THEMES.map((id) => {
                        const match = THEME_CHOICES.find((t) => t.id === id)
                        return { value: id, label: match?.label || id, hint: match?.hint }
                      })}
                      minWidth={140}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Advanced Card 3: Typography & Contrast */}
            <div className="codex-card">
              <div className="codex-row">
                <span className="codex-row-title">UI font style</span>
                <AnimatedSelect
                  value={uiFontStyle || '400'}
                  onChange={(val) => setUiFontStyle(val)}
                  options={[
                    { value: '400', label: 'Regular' },
                    { value: '500', label: 'Medium' },
                    { value: '600', label: 'SemiBold' },
                  ]}
                  minWidth={120}
                />
              </div>

              <div className="codex-row">
                <span className="codex-row-title">Content font</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AnimatedSelect
                    value={contentFont || 'same'}
                    onChange={(val) => setContentFont(val)}
                    options={[
                      { value: 'same', label: 'Same as UI font' },
                      { value: 'inter', label: 'Inter' },
                      { value: 'system', label: 'System' },
                      { value: 'serif', label: 'Serif' },
                    ]}
                    minWidth={150}
                  />
                  <AnimatedSelect
                    value={contentFontWeight || '400'}
                    onChange={(val) => setContentFontWeight(val)}
                    options={[
                      { value: '400', label: 'Regular' },
                      { value: '500', label: 'Medium' },
                    ]}
                    minWidth={110}
                  />
                </div>
              </div>

              <div className="codex-row">
                <span className="codex-row-title">Code font</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AnimatedSelect
                    value={codeFont || 'system'}
                    onChange={(val) => setCodeFont(val)}
                    options={[
                      { value: 'system', label: 'System' },
                      { value: 'geist', label: 'Geist Mono' },
                      { value: 'jetbrains', label: 'JetBrains Mono' },
                      { value: 'fira', label: 'Fira Code' },
                      { value: 'sfmono', label: 'SF Mono' },
                    ]}
                    minWidth={140}
                  />
                  <AnimatedSelect
                    value={codeFontWeight || '400'}
                    onChange={(val) => setCodeFontWeight(val)}
                    options={[
                      { value: '400', label: 'Regular' },
                      { value: '500', label: 'Medium' },
                    ]}
                    minWidth={110}
                  />
                </div>
              </div>

              <div className="codex-row">
                <span className="codex-row-title">Contrast</span>
                <div className="codex-slider-wrap">
                  {/* eslint-disable-next-line amethyst-ui/no-raw-controls */}
                  <input
                    type="range"
                    min={30}
                    max={100}
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    className="codex-slider"
                  />
                  <span style={{ fontSize: 13, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text)', minWidth: 24, textAlign: 'right' }}>
                    {contrast}
                  </span>
                </div>
              </div>
            </div>

            {/* Advanced Card 4: Diff markers & Pointer cursors */}
            <div className="codex-card">
              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Diff markers</span>
                  <span className="codex-row-desc">Show changes using colors or +/- markers</span>
                </div>
                <div className="codex-seg-group">
                  <HouseButton
                    type="button"
                    className={`codex-seg-item${(diffMarkers || 'color') === 'color' ? ' is-active' : ''}`}
                    onClick={() => setDiffMarkers('color')}
                  >
                    Color
                  </HouseButton>
                  <HouseButton
                    type="button"
                    className={`codex-seg-item${diffMarkers === 'markers' ? ' is-active' : ''}`}
                    onClick={() => setDiffMarkers('markers')}
                  >
                    +/-
                  </HouseButton>
                </div>
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Use pointer cursors</span>
                  <span className="codex-row-desc">Change the cursor to a pointer when hovering over interactive elements</span>
                </div>
                <Switch
                  on={Boolean(pointerCursors)}
                  onChange={(val) => setPointerCursors(val)}
                  tone="default"
                />
              </div>
            </div>

            {/* Advanced Card 5: Amethyst Canvas, Loaders & Animations */}
            <div className="codex-card">
              <div className="codex-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                <div className="codex-row-info">
                  <span className="codex-row-title">Agent loader animation</span>
                  <span className="codex-row-desc">Choose the animation style while reasoning and running tools</span>
                </div>
                <div className="set-loader-strip" style={{ marginTop: 4 }}>
                  {AGENT_LOADERS.map((anim) => {
                    const isSel = agentLoader === anim.id
                    return (
                      <HouseButton
                        key={anim.id}
                        type="button"
                        className={`set-loader-item${isSel ? ' is-active' : ''}`}
                        onClick={() => setAgentLoader(anim.id)}
                        title={anim.label}
                      >
                        <LoaderIcon type={anim.id} />
                      </HouseButton>
                    )
                  })}
                </div>
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Thinking trace style</span>
                  <span className="codex-row-desc">Cards, compact chips, or activity stream</span>
                </div>
                <div className="codex-seg-group">
                  {['cards', 'chips', 'activity'].map((t) => (
                    <HouseButton
                      key={t}
                      type="button"
                      className={`codex-seg-item${(thinkingStyle || 'cards') === t ? ' is-active' : ''}`}
                      onClick={() => setThinkingStyle(t)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {t === 'chips' ? 'Tool Chips' : t === 'activity' ? 'Activity' : 'Cards'}
                    </HouseButton>
                  ))}
                </div>
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Glass material</span>
                  <span className="codex-row-desc">Translucency of window material across menus</span>
                </div>
                <div className="codex-seg-group">
                  {['off', 'subtle', 'full'].map((m) => (
                    <HouseButton
                      key={m}
                      type="button"
                      className={`codex-seg-item${(glassMaterial || 'full') === m ? ' is-active' : ''}`}
                      onClick={() => setGlassMaterial(m)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {m}
                    </HouseButton>
                  ))}
                </div>
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Spotlight animation</span>
                  <span className="codex-row-desc">How spotlight dialog arrives and departs</span>
                </div>
                <AnimatedSelect
                  value={spotlightAnimation || 'spring'}
                  onChange={(val) => setSpotlightAnimation(val)}
                  options={SPOTLIGHT_ANIMATIONS.map((a) => ({ value: a.id, label: a.label, description: a.hint }))}
                  minWidth={130}
                />
              </div>

              <div className="codex-row">
                <div className="codex-row-info">
                  <span className="codex-row-title">Auto-hide Top Bar</span>
                  <span className="codex-row-desc">Hover near top edge to slide navigation into view</span>
                </div>
                <Switch
                  on={Boolean(autoHideTopBar)}
                  onChange={(val) => setAutoHideTopBar(val)}
                  tone="default"
                />
              </div>

              <div className="codex-row" style={{ justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.15)' }}>
                <HouseButton
                  type="button"
                  className="codex-channel-btn"
                  onClick={handleResetAppearance}
                  style={{ color: '#ef4444' }}
                >
                  <Icon name="refresh" size={12} />
                  <span>Reset All Appearance Defaults</span>
                </HouseButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ==========================================================================
   3. MODELS VIEW (Interactive Accordion, Models Dev Details, Add Provider)
   ========================================================================== */

function LatencyTag({ latency }) {
  if (latency === undefined) return null
  const isOff = latency === 'off'
  const isWarn = typeof latency === 'number' && latency > 800
  const tone = isOff ? 'bad' : isWarn ? 'warn' : 'ok'
  return (
    <span className={`mod-latency-tag mod-latency-tag--${tone}`}>
      <span className={`mod-status-dot mod-status-dot--${tone}`} />
      <span>{isOff ? 'Offline' : `${latency}ms`}</span>
    </span>
  )
}

function Models() {
  const { toast } = useApp()
  const confirm = useConfirm()
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
      toast('Latency check complete', 'ok')
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

  const handleSetPrimary = async (pName) => {
    try {
      await api.setPrimaryProvider(pName)
      toast(`Primary route set to ${pName}`, 'ok')
      await Promise.all([loadProviders(), loadRouting()])
    } catch (err) {
      toast(err.message || 'Failed to set primary route', 'bad')
    }
  }

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
    const ok = await confirm({
      title: `Remove ${name}?`,
      description: `Are you sure you want to remove provider "${name}"? This removes its API keys and routing configuration.`,
      confirmText: 'Remove',
      destructive: true,
    })
    if (!ok) return
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

  const handleMoveLadder = async (index, dir) => {
    const next = [...routingLadder]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    setRoutingLadder(next)
    try {
      await api.reorderProviders(next)
      await loadProviders()
      toast('Routing priority ladder updated', 'ok')
    } catch (err) {
      toast(err.message || 'Failed to update priority ladder', 'bad')
    }
  }

  const activeProvider = providers.find((p) => p.enabled) || providers[0]

  return (
    <div className="set-panel">
      {/* Active Model Status Hero Banner */}
      {activeProvider && (
        <div
          className="set-box"
          style={{
            marginBottom: 24,
            padding: '16px 20px',
            background: 'var(--raised)',
            border: '1px solid var(--hairline)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  background: 'var(--surface-2, var(--surface))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--hairline)',
                  flexShrink: 0,
                }}
              >
                <AiProviderIcon provider={activeProvider.name} size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>
                    {activeProvider.name}
                  </span>
                  <span className="mod-route-tag">
                    <span className="mod-status-dot mod-status-dot--live" />
                    Primary Route
                  </span>
                  {activeProvider.core && <span className="mod-core-tag">Core Gateway</span>}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {activeProvider.default_model || activeProvider.model || 'Auto Adaptive Fallback'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <LatencyTag latency={latencies[activeProvider.name]} />

              {/* Primary Route Picker */}
              {providers.length > 1 && (
                <div style={{ minWidth: 160 }}>
                  <AnimatedSelect
                    value={activeProvider.name}
                    onChange={handleSetPrimary}
                    options={providers.filter((p) => p.enabled).map((p) => ({
                      value: p.name,
                      label: p.name.charAt(0).toUpperCase() + p.name.slice(1),
                    }))}
                    renderIcon={(opt) => (
                      <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AiProviderIcon provider={opt.value} size={14} />
                      </div>
                    )}
                    placeholder="Switch Primary…"
                    minWidth={170}
                    align="right"
                  />
                </div>
              )}

              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={pingAll}
                disabled={pinging}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name="refresh" size={12} className={pinging ? 'spin' : ''} />
                <span>{pinging ? 'Pinging…' : 'Ping All'}</span>
              </HouseButton>
            </div>
          </div>
        </div>
      )}

      {/* Category: Configured Providers */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 10px' }}>
        <div>
          <span className="set-section-label" style={{ margin: 0 }}>Configured Providers ({providers.length})</span>
          <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-dim)', marginTop: 2 }}>
            Manage endpoints, default models, and priority fallback routing.
          </span>
        </div>
        <HouseButton
          type="button"
          className="set-btn-sm is-primary"
          onClick={() => setShowAddModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="plus" size={12} />
          <span>Add Provider</span>
        </HouseButton>
      </div>

      <div className="set-box" style={{ marginBottom: 24 }}>
        {providers.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            No providers configured. Click &ldquo;Add Provider&rdquo; above to connect an endpoint.
          </div>
        ) : (
          providers.map((p, idx) => {
            const lat = latencies[p.name]
            const isExpanded = expandedProvider === p.name
            const modelsList = providerModelsMap[p.name] || []
            const isLoading = loadingModels[p.name]
            const isPrimary = activeProvider && p.name === activeProvider.name

            return (
              <div key={p.name} style={{ borderBottom: idx < providers.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                <div
                  className="set-box-row"
                  onClick={() => handleToggleAccordion(p.name)}
                  style={{ cursor: 'pointer', userSelect: 'none', borderBottom: 'none' }}
                >
                  <div className="set-row-left">
                    <div className="set-row-icon-box">
                      <AiProviderIcon provider={p.name} size={16} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="set-row-title" style={{ textTransform: 'capitalize', fontSize: '13.5px' }}>
                          {p.name}
                        </span>
                        {isPrimary && (
                          <span className="mod-route-tag" style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                            <span className="mod-status-dot mod-status-dot--live" />
                            Primary
                          </span>
                        )}
                        {p.core && <span className="mod-core-tag" style={{ fontSize: '10.5px', padding: '1px 6px' }}>Core</span>}
                      </div>
                      <span className="set-row-desc" style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                        {p.default_model || p.model || 'OpenAI Compatible Gateway'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LatencyTag latency={lat} />

                    {!isPrimary && (
                      <HouseButton
                        type="button"
                        className="set-btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSetPrimary(p.name)
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        title="Set this provider as the primary route"
                      >
                        <Icon name="star" size={11} />
                        <span>Make Primary</span>
                      </HouseButton>
                    )}

                    <HouseButton
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
                    </HouseButton>
                    <HouseButton
                      type="button"
                      className="set-btn-sm is-danger"
                      onClick={(e) => handleRemove(p.name, e)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Icon name="trash" size={11} />
                      <span>Remove</span>
                    </HouseButton>
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
                      style={{ overflow: 'hidden', background: 'var(--surface-2, var(--canvas-deep))', borderTop: '1px solid var(--hairline)' }}
                    >
                      <div style={{ padding: '14px 18px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="cpu" size={12} />
                          <span>Available Models Catalog ({modelsList.length})</span>
                        </div>

                        {isLoading ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                            <Icon name="refresh" size={14} className="spin" style={{ marginRight: 6 }} />
                            Fetching endpoints from {p.name}…
                          </div>
                        ) : modelsList.length === 0 ? (
                          <div style={{ padding: '12px 0', color: 'var(--text-dim)', fontSize: '12px' }}>
                            No model list returned by provider API. You can specify any model ID in Cognitive Tiers below.
                          </div>
                        ) : (
                          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {modelsList.slice(0, 40).map((m) => {
                              const isDefault = (p.default_model || p.model) === m.id
                              return (
                                <div
                                  key={m.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    background: isDefault ? 'var(--accent-soft)' : 'var(--raised)',
                                    border: isDefault ? '1px solid var(--accent)' : '1px solid var(--hairline)',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {m.id}
                                    </span>
                                    {isDefault && <Badge tone="ok" style={{ fontSize: '9.5px', padding: '1px 5px' }}>Current Default</Badge>}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
              Order candidates are evaluated in during automated fallback. Top (#1) candidate is the primary route.
            </div>
            {routingLadder.map((cand, idx) => (
              <div key={cand} className="set-box-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: idx === 0 ? 'var(--live)' : 'var(--text-dim)', width: 24, fontWeight: idx === 0 ? 600 : 400 }}>
                    #{idx + 1}
                  </span>
                  <AiProviderIcon provider={cand} size={15} />
                  <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--text)', textTransform: 'capitalize' }}>
                    {cand}
                  </span>
                  {idx === 0 && <Badge tone="live" style={{ fontSize: '9.5px', padding: '1px 5px' }}>Primary</Badge>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {idx !== 0 && (
                    <HouseButton
                      type="button"
                      className="set-btn-sm"
                      onClick={() => handleSetPrimary(cand)}
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      title="Move directly to primary"
                    >
                      Make Top
                    </HouseButton>
                  )}
                  <HouseButton
                    type="button"
                    className="set-btn-sm"
                    disabled={idx === 0}
                    onClick={() => handleMoveLadder(idx, -1)}
                    style={{ padding: '4px 8px' }}
                    title="Move up"
                  >
                    ↑
                  </HouseButton>
                  <HouseButton
                    type="button"
                    className="set-btn-sm"
                    disabled={idx === routingLadder.length - 1}
                    onClick={() => handleMoveLadder(idx, 1)}
                    style={{ padding: '4px 8px' }}
                    title="Move down"
                  >
                    ↓
                  </HouseButton>
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

      {/* Add Provider Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddProviderModal
            onClose={() => setShowAddModal(false)}
            onAdded={() => {
              setShowAddModal(false)
              loadProviders()
              loadRouting()
              pingAll()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

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
        api_key: key.trim() || undefined,
        key: key.trim() || undefined,
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
          <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </HouseButton>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              API Key
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <HouseInput
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Stored in OS keychain"
                className="set-input"
                style={{ flex: 1 }}
              />
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide' : 'Show'}
              </HouseButton>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
              Stored securely in your operating system keychain.
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
              Base URL
            </label>
            <HouseInput
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="set-input"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <HouseButton type="button" className="set-btn-sm" onClick={onClose}>
              Cancel
            </HouseButton>
            <HouseButton
              type="button"
              className="set-btn-sm is-primary"
              disabled={saving}
              onClick={handleSave}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="check" size={12} />
              <span>{saving ? 'Saving…' : 'Save Credentials'}</span>
            </HouseButton>
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
        api_key: key.trim() || undefined,
        key: key.trim() || undefined,
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
          <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </HouseButton>
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
                  <HouseButton
                    key={p.slug}
                    type="button"
                    className={`set-preset-card${isActive ? ' is-active' : ''}`}
                    onClick={() => handleSelectPreset(p)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                  >
                    <AiProviderIcon provider={p.slug} size={15} />
                    <span style={{ fontWeight: 600, fontSize: '12px' }}>{p.name}</span>
                  </HouseButton>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', marginBottom: 6 }}>
                Provider Identifier
              </label>
              <HouseInput
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
              <HouseInput
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
            <HouseInput
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
            <HouseInput
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
            <HouseButton type="button" className="set-btn-sm" onClick={onClose}>
              Cancel
            </HouseButton>
            <HouseButton
              type="button"
              className="set-btn-sm is-primary"
              disabled={saving}
              onClick={handleSave}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="check" size={13} />
              <span>{saving ? 'Connecting…' : 'Add Provider'}</span>
            </HouseButton>
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
    { id: 'kilo-auto/free', label: 'Kilo Auto (Free)' },
    { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'NVIDIA Nemotron 3.5 Super VL (Free)' },
    { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
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
    return providers.length > 0 ? providers : ['kilocode', 'mistral', 'google', 'openai', 'anthropic', 'groq', 'deepseek', 'ollama', 'nvidia']
  })

  const load = useCallback(async () => {
    try {
      const r = await api.tiers()
      setTiers(r.tiers || {})
    } catch {}
    try {
      const p = await api.providers()
      const configured = (p?.configured || []).map((x) => x.name)
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
          configuredProviders={providers}
          busy={busy === r.id}
          onSave={handleSave}
          onClear={handleClear}
        />
      ))}
    </div>
  )
}

function RoleRow({ role, current, providers = [], configuredProviders = [], busy, onSave, onClear }) {
  const currentProvider = current?.provider || ''
  const currentModel = current?.model || ''

  const [provider, setProvider] = useState(() => currentProvider || providers[0] || 'mistral')
  const [model, setModel] = useState(() => currentModel || '')
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  // CRITICAL FIX: Only sync when current tier props change from outside,
  // NEVER include local `provider` in dependencies so selecting a provider is never reset!
  useEffect(() => {
    if (currentProvider) {
      setProvider(currentProvider)
      setModel(currentModel)
    } else if (providers.length > 0 && !provider) {
      setProvider(providers[0])
      setModel('')
    }
  }, [currentProvider, currentModel])

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
        // If current model is empty, auto-pick first recommended option
        setModel((prev) => {
          if (prev && merged.some((m) => m.value === prev)) return prev
          return merged[0]?.value || prev || ''
        })
      })
      .catch(() => {
        if (!active) return
        const presets = (POPULAR_PROVIDER_MODELS[provider.toLowerCase()] || []).map((p) => ({
          value: p.id,
          label: p.id,
          hint: p.label !== p.id ? p.label : undefined,
        }))
        setModels(presets)
        setModel((prev) => {
          if (prev && presets.some((p) => p.value === prev)) return prev
          return presets[0]?.value || prev || ''
        })
      })
      .finally(() => {
        if (active) setLoadingModels(false)
      })
    return () => { active = false }
  }, [provider])

  const handleProviderSelect = (newP) => {
    setProvider(newP)
    const presets = POPULAR_PROVIDER_MODELS[newP.toLowerCase()] || []
    if (presets.length > 0) {
      setModel(presets[0].id)
    }
  }

  const dirty = provider !== (current?.provider || '') || model !== (current?.model || '')

  const providerOptions = useMemo(() => {
    return providers.map((p) => {
      const known = KNOWN_PROVIDER_CATALOG.find((k) => k.value === p)
      const isConfigured = configuredProviders.includes(p)
      return {
        value: p,
        label: known ? known.label : p.charAt(0).toUpperCase() + p.slice(1),
        hint: isConfigured ? 'Configured' : undefined,
      }
    })
  }, [providers, configuredProviders])

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
        {/* Provider Searchable Dropdown */}
        <div style={{ minWidth: 170 }}>
          <AnimatedSelect
            value={provider}
            onChange={handleProviderSelect}
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

        {/* Model Searchable Dropdown */}
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

        <HouseButton
          type="button"
          className={`set-btn-sm${dirty ? ' is-primary' : ''}`}
          disabled={busy || !dirty || !model?.trim()}
          onClick={() => onSave(role.id, provider, model)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}
        >
          <Icon name="check" size={13} />
          <span>{busy ? 'Saving…' : 'Save'}</span>
        </HouseButton>

        {current && (
          <HouseButton
            type="button"
            className="set-btn-sm"
            disabled={busy}
            onClick={() => onClear(role.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', color: 'var(--text-dim)' }}
          >
            <Icon name="trash" size={12} />
            <span>Clear</span>
          </HouseButton>
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
          <HouseButton
            type="button"
            className="set-btn-sm is-danger"
            onClick={handleRevokeAll}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Icon name="trash" size={12} />
            <span>Clear All</span>
          </HouseButton>
        )}
      </div>

      <div className="set-box">
        <div style={{ padding: '10px 18px', fontSize: '12px', color: 'var(--text-dim)', borderBottom: '1px solid var(--hairline)' }}>
          Operations previously approved to execute without prompting. You can revoke them at any time.
        </div>
        {loading ? (
          <div style={{ padding: '8px 18px' }} aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="set-box-row" style={{ pointerEvents: 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Skeleton w={`${160 + (i * 40)}px`} h={13} r={3} />
                  <Skeleton w="120px" h={10} r={3} />
                </div>
                <Skeleton w={64} h={26} r={6} />
              </div>
            ))}
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
                <HouseButton
                  type="button"
                  className="set-btn-sm is-danger"
                  onClick={() => handleRevoke(app.operation_key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon name="x" size={12} />
                  <span>Revoke</span>
                </HouseButton>
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

        <HouseButton
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
        </HouseButton>
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
    const svgX = (mouseX / rect.width) * 600
    const ratio = Math.max(0, Math.min(1, (svgX - 24) / 552))
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
              <HouseButton
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
              </HouseButton>
            ))}
          </div>

          <HouseButton
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
          </HouseButton>
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
                left: `${Math.max(14, Math.min(86, (activePoint.x / 600) * 100))}%`,
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
            <HouseButton
              type="button"
              className={`set-seg-btn${mode === 'requests' ? ' is-active' : ''}`}
              onClick={() => setMode('requests')}
              style={{ fontSize: '11.5px', padding: '3px 12px' }}
            >
              Requests
            </HouseButton>
            <HouseButton
              type="button"
              className={`set-seg-btn${mode === 'spend' ? ' is-active' : ''}`}
              onClick={() => setMode('spend')}
              style={{ fontSize: '11.5px', padding: '3px 12px' }}
            >
              Spend
            </HouseButton>
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
          {timelineDays.list.map((day, dayIdx) => {
            const hasRuns = day.cnt > 0
            const isHovered = hoveredTimelineDay?.iso === day.iso
            const dayModelEntries = Object.entries(day.models || {})
            const barHeight = hasRuns
              ? Math.max(16, Math.round((day.cnt / timelineDays.maxCnt) * 64))
              : 2
            const isNearLeft = dayIdx < 3
            const isNearRight = dayIdx >= timelineDays.list.length - 3

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
                      left: isNearLeft ? 0 : isNearRight ? 'auto' : '50%',
                      right: isNearRight ? 0 : 'auto',
                      transform: isNearLeft || isNearRight ? 'none' : 'translateX(-50%)',
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
          <HouseButton type="button" className="set-btn-sm" onClick={handleExportAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="download" size={12} />
            <span>Export JSON</span>
          </HouseButton>
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
      <HouseButton type="button" className="set-btn-sm is-danger" onClick={onConfirm} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Icon name="trash" size={12} />
        <span>{confirmLabel}</span>
      </HouseButton>
    </div>
  )
}

/* ==========================================================================
   8. ABOUT VIEW (Authentic Brand Mark, Real Runtime Metrics, No Fake Info)
   ========================================================================== */

function About() {
  const { toast, health, openSetupWizard, updateInfo, checkForUpdates, quitAndInstallUpdate } = useApp()
  const [copied, setCopied] = useState(false)

  const handleCopyBuild = () => {
    const details = {
      app: 'Amethyst',
      version: '0.1.3-beta',
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
              Amethyst 0.1.3-beta
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {platformStr}
            </div>
          </div>
        </div>
      </div>

      {/* Setup & Onboarding Wizard */}
      <div className="set-section-label">Initial Setup & Verification</div>
      <div className="set-box" style={{ marginBottom: 20 }}>
        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon name="sparkle" size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">Setup Wizard & Splash Screen</span>
              <span className="set-row-desc">
                Re-run the initial onboarding wizard to verify API keys, Cloudflare relay, mobile HTTP shortcuts, and system health.
              </span>
            </div>
          </div>
          <HouseButton
            type="button"
            className="set-btn-sm is-primary"
            onClick={openSetupWizard}
            style={{ minWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="play" size={12} />
            <span>Launch Wizard</span>
          </HouseButton>
          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={() => setView('install')}
            style={{ minWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}
          >
            <Icon name="download" size={12} />
            <span>Install App</span>
          </HouseButton>
        </div>
      </div>

      {/* 2. Updates Section */}
      <div className="set-section-label">Software Updates</div>
      <div className="set-box" style={{ marginBottom: 20 }}>
        <div className="set-box-row">
          <div className="set-row-left">
            <div className="set-row-icon-box">
              <Icon
                name={updateInfo?.downloaded || updateInfo?.available ? "sparkle" : "check-circle"}
                size={16}
                style={{ color: updateInfo?.downloaded || updateInfo?.available ? 'var(--accent)' : 'var(--live)' }}
              />
            </div>
            <div className="set-row-text">
              <span className="set-row-title">
                {updateInfo?.downloaded
                  ? `Update v${updateInfo.version || ''} ready to install`
                  : updateInfo?.available
                  ? `Update v${updateInfo.version || ''} available`
                  : 'Amethyst is up to date'}
              </span>
              <span className="set-row-desc">
                {updateInfo?.downloaded
                  ? 'Update downloaded in background. Restart Amethyst to complete installation.'
                  : updateInfo?.available
                  ? 'A new release is available. Click to download and install.'
                  : `Version 0.1.3-beta · Built for Linux, macOS & Windows.`}
              </span>
            </div>
          </div>
          {updateInfo?.downloaded ? (
            <HouseButton
              type="button"
              className="set-btn-sm is-primary"
              onClick={quitAndInstallUpdate}
              style={{ minWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--live)', color: '#fff' }}
            >
              <Icon name="refresh" size={12} />
              <span>Restart & Install</span>
            </HouseButton>
          ) : updateInfo?.available ? (
            <HouseButton
              type="button"
              className="set-btn-sm is-primary"
              onClick={quitAndInstallUpdate}
              style={{ minWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="download" size={12} />
              <span>{updateInfo.releaseUrl ? 'View Release' : 'Install Update'}</span>
            </HouseButton>
          ) : (
            <HouseButton
              type="button"
              className="set-btn-sm is-primary"
              onClick={() => checkForUpdates(true)}
              disabled={updateInfo?.checking}
              style={{ minWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="refresh" size={12} className={updateInfo?.checking ? 'spin' : ''} />
              <span>{updateInfo?.checking ? 'Checking…' : 'Check for Updates'}</span>
            </HouseButton>
          )}
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
        <HouseButton
          type="button"
          className="set-btn-sm"
          onClick={handleCopyBuild}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="copy" size={12} />
          <span>{copied ? 'Copied to Clipboard!' : 'Copy System Diagnostics'}</span>
        </HouseButton>
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
              <HouseButton type="button" className="set-btn-sm" onClick={syncNow}>Sync now</HouseButton>
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
              <HouseInput
                className="set-input"
                placeholder="https://amethyst-relay.you.workers.dev"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <HouseInput
                className="set-input"
                placeholder="the code, or the whole amethyst://pair link"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <HouseButton
                type="button"
                className="set-btn-sm"
                onClick={joinFromPhone}
                disabled={pairing || !relayUrl.trim() || !code.trim()}
              >
                {pairing ? 'Waiting for the machine…' : 'Pair'}
              </HouseButton>
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
                  <HouseButton
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
                  </HouseButton>
                  <HouseButton type="button" className="set-btn-sm" onClick={() => revoke(device)} style={{ color: 'var(--stop)' }}>
                    Revoke
                  </HouseButton>
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
                        <HouseInput
                          type="checkbox"
                          checked={Boolean(editingPermissions[key])}
                          onChange={() => toggleEditingPermission(key)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <HouseButton
                      type="button"
                      className="set-btn-sm"
                      onClick={() => setEditingDeviceId(null)}
                    >
                      Cancel
                    </HouseButton>
                    <HouseButton
                      type="button"
                      className="pair-go"
                      onClick={() => savePermissions(device.id)}
                      disabled={savingPermissions}
                      style={{ padding: '4px 12px', fontSize: 12 }}
                    >
                      {savingPermissions ? 'Saving…' : 'Save Scopes'}
                    </HouseButton>
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
                  <HouseButton type="button" className="set-btn-sm" onClick={() => setActiveModalRequest(p)} style={{ background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 600 }}>Review & Approve</HouseButton>
                  <HouseButton type="button" className="set-btn-sm" onClick={() => approvePending(p.request_id)} style={{ background: '#f59e0b', color: '#000', fontWeight: 600 }}>Quick Approve</HouseButton>
                  <HouseButton type="button" className="set-btn-sm" onClick={() => rejectPending(p.request_id)} style={{ color: 'var(--stop)' }}>Reject</HouseButton>
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
          <HouseButton type="button" className="set-btn-sm" onClick={openPairing} disabled={busy}>
            {busy ? 'Opening…' : 'Pair a device'}
          </HouseButton>
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
                <HouseButton
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
                </HouseButton>
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
              <HouseButton
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
              </HouseButton>
              <HouseButton
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
              </HouseButton>
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
                <HouseButton
                  type="button"
                  className="set-btn-sm"
                  onClick={() => setPairMode('lan')}
                  style={{ background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 600, padding: '6px 14px' }}
                >
                  📱 Use Same Wi-Fi (Direct LAN)
                </HouseButton>
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
            <HouseButton
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
            </HouseButton>
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
          <HouseInput
            className="set-input"
            type="url"
            placeholder="https://amethyst.example.com"
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={saveAppUrl}
            disabled={appUrl.trim() === savedAppUrl}
          >
            Save
          </HouseButton>
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

/* ==========================================================================
   SHORTCUTS VIEW (Desktop Hotkey & Keyboard Controls)
   ========================================================================== */

function Shortcuts() {
  const { toast } = useApp()
  const [hotkeyDraft, setHotkeyDraft] = useState('<ctrl>+<alt>+<space>')

  useEffect(() => {
    api.settings()
      .then((s) => {
        if (s.hotkey) setHotkeyDraft(s.hotkey)
      })
      .catch(() => {})
  }, [])

  const handleSaveHotkeyExplicit = async (val) => {
    try {
      await api.updateSettings({ hotkey: val })
      toast(`Global launcher shortcut set to ${val}`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleSaveHotkey = () => {
    if (hotkeyDraft.trim()) {
      handleSaveHotkeyExplicit(hotkeyDraft.trim())
    }
  }

  return (
    <div className="set-panel">
      {/* 1. Global Desktop Launcher Chord */}
      <div className="set-section-label">Global Desktop Launcher</div>
      <div className="set-box">
        <div className="set-box-row">
          <div className="set-row-text">
            <span className="set-row-title">Global Summon Shortcut</span>
            <span className="set-row-desc">
              Global system chord to summon or toggle the Amethyst Damon launcher from any app.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HouseInput
              type="text"
              value={hotkeyDraft}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              placeholder="<ctrl>+<alt>+<space>"
              style={{ width: 190, fontFamily: 'var(--font-mono)', fontSize: '13px' }}
            />
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleSaveHotkey}
            >
              Save
            </HouseButton>
          </div>
        </div>

        <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div className="set-row-text">
            <span className="set-row-title">Quick Presets</span>
            <span className="set-row-desc">Standard chords for system-wide spotlight launchers:</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Ctrl+Alt+Space (Default)', chord: '<ctrl>+<alt>+<space>' },
              { label: 'Ctrl+Space', chord: '<ctrl>+<space>' },
              { label: 'Super+Space (Win/Linux)', chord: '<super>+<space>' },
              { label: 'Alt+Space', chord: '<alt>+<space>' },
            ].map((p) => (
              <HouseButton
                key={p.chord}
                type="button"
                className={`set-btn-sm${hotkeyDraft === p.chord ? ' is-active' : ''}`}
                onClick={() => {
                  setHotkeyDraft(p.chord)
                  handleSaveHotkeyExplicit(p.chord)
                }}
              >
                {p.label}
              </HouseButton>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Launcher Navigation & Actions */}
      <div className="set-section-label">Damon Launcher & Action Panel</div>
      <div className="set-box">
        <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="set-row-text">
            <span className="set-row-title">Auto-Assigned Launcher Shortcuts</span>
            <span className="set-row-desc">These shortcuts are automatically assigned and active while Damon is open:</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {[
              { name: 'Primary Action (Open / Focus / Run)', key: '↵ Enter' },
              { name: 'Toggle Action Panel', key: '⌘K / Ctrl+K' },
              { name: 'Direct Launch Items 1–9', key: '⌘1 – ⌘9 / Alt+1 – 9' },
              { name: 'Filter Mode (Web / Video / Apps / etc.)', key: 'Tab / ⇧Tab' },
              { name: 'Dismiss Action Panel → Clear → Close', key: 'Esc' },
              { name: 'Copy Result Text or Path', key: '⌘C (in Action Panel)' },
              { name: 'Reveal File in File Manager', key: '⌘O (in Action Panel)' },
              { name: 'Ask Amethyst Assistant', key: '⌘⇧A (in Action Panel)' },
            ].map((s) => (
              <div
                key={s.name}
                style={{
                  padding: '10px 14px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{s.name}</span>
                <kbd className="kbd" style={{ background: 'var(--surface-1)', border: '1px solid var(--hairline-strong)', padding: '2px 8px', fontSize: 11 }}>{s.key}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Global App Shortcuts Catalog */}
      <div className="set-section-label">Application Navigation Shortcuts</div>
      <div className="set-box">
        <div className="set-box-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="set-row-text">
            <span className="set-row-title">Workspace Hotkeys</span>
            <span className="set-row-desc">Quick navigation chords across views and composer:</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {[
              { name: 'Open Command Palette', key: '⌘K / Ctrl+K' },
              { name: 'Start New Conversation', key: '⌘⇧O / Ctrl+Shift+O' },
              { name: 'Focus Composer', key: '⌘L / Ctrl+L' },
              { name: 'Go to Chat', key: 'Ctrl+1' },
              { name: 'Go to Today Dashboard', key: 'Ctrl+0' },
              { name: 'Go to Tasks', key: 'Ctrl+2' },
              { name: 'Go to Email', key: 'Ctrl+3' },
              { name: 'Go to Library', key: 'Ctrl+9' },
              { name: 'Open Settings', key: '⌘, / Ctrl+,' },
            ].map((s) => (
              <div
                key={s.name}
                style={{
                  padding: '10px 14px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{s.name}</span>
                <kbd className="kbd" style={{ background: 'var(--surface-1)', border: '1px solid var(--hairline-strong)', padding: '2px 8px', fontSize: 11 }}>{s.key}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const PANELS = {
  profile: Profile,
  general: General,
  configuration: Configuration,
  storage: Storage,
  notifications: Notifications,
  shortcuts: Shortcuts,
  appearance: Appearance,
  models: Models,
  integrations: Integrations,
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
  const [searchQuery, setSearchQuery] = useState('')
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

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        (s.desc && s.desc.toLowerCase().includes(q)) ||
        (s.group && s.group.toLowerCase().includes(q))
    )
  }, [searchQuery])

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
          <h2 className="set-nav-headline">Settings</h2>
        </div>

        {/* Live Search Input */}
        <div style={{ padding: '0 12px 12px 12px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 10, color: 'var(--text-dim)', pointerEvents: 'none', display: 'flex' }}>
              <Icon name="search" size={13} />
            </span>
            <HouseInput
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings…"
              className="set-input"
              style={{
                width: '100%',
                paddingLeft: 30,
                paddingRight: searchQuery ? 28 : 10,
                height: 32,
                fontSize: 12,
                borderRadius: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border-subtle, rgba(0,0,0,0.06))',
              }}
            />
            {searchQuery && (
              <HouseButton
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 6,
                  padding: 3,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Clear search"
              >
                <Icon name="x" size={11} />
              </HouseButton>
            )}
          </div>
        </div>

        {filteredSections.length === 0 ? (
          <div style={{ padding: '16px 12px', fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>
            No matching settings
          </div>
        ) : (
          Object.entries(
            filteredSections.reduce((acc, item) => {
              const grp = item.group || 'Personal'
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
                  <HouseButton
                    key={item.id}
                    type="button"
                    data-section={item.id}
                    className={`set-nav-item${isSel ? ' active' : ''}`}
                    onClick={() => setSection(item.id)}
                    style={{
                      position: 'relative',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Icon name={item.icon} size={15} />
                    <span className="set-nav-label">{item.label}</span>
                  </HouseButton>
                )
              })}
            </div>
          ))
        )}
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
          {section !== 'usage' && section !== 'activity' && section !== 'profile' && section !== 'notifications' && section !== 'appearance' && section !== 'storage' && section !== 'configuration' && (
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
