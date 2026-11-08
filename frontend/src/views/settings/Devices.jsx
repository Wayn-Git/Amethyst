import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Input as HouseInput } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'
import { api, copyText } from '../../api.js'
import { useApp } from '../../store.jsx'
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx'
import { safeStorage } from '../../lib/storage.js'
import * as syncClient from '../../lib/sync/client.js'
import PairingApprovalModal from '../../components/PairingApprovalModal.jsx'
import './devices.css'

function getHostPlatformName() {
  if (typeof navigator === 'undefined') return 'this PC'
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase()
  if (p.includes('mac')) return 'this Mac'
  if (p.includes('win')) return 'this PC'
  if (p.includes('linux')) return 'this computer'
  return 'this PC'
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'just now'
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return dateStr.split(' ')[0] || dateStr
  } catch {
    return dateStr
  }
}

const SCOPE_DEFINITIONS = [
  { key: 'screen', label: 'Screen Capture', icon: 'desktop' },
  { key: 'input', label: 'Mouse & Keys', icon: 'keyboard' },
  { key: 'audio', label: 'Media & Audio', icon: 'speaker' },
  { key: 'files', label: 'File Transfer', icon: 'folder' },
  { key: 'terminal', label: 'Terminal', icon: 'code' },
  { key: 'agent', label: 'Agent Tasks', icon: 'sparkle' },
  { key: 'power', label: 'Power Ops', icon: 'lightning' },
  { key: 'webcam', label: 'Webcam', icon: 'camera' },
  { key: 'mic', label: 'Microphone', icon: 'mic' },
  { key: 'root', label: 'Root / Sudo', icon: 'shield' },
]

function formatSharedProviderItem(p) {
  if (!p) return ''
  if (typeof p === 'string') return p
  if (typeof p === 'object' && p !== null) {
    if (p.provider && p.model) return `${p.provider} (${p.model})`
    return p.provider || p.model || p.name || JSON.stringify(p)
  }
  return String(p)
}

export default function Devices() {
  const { toast, server } = useApp()
  const confirm = useConfirm()
  const hasBackend = server?.phase === 'ready'

  // State
  const [devices, setDevices] = useState([])
  const [pending, setPending] = useState([])
  const [invite, setInvite] = useState(null)
  const [activeModalRequest, setActiveModalRequest] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)

  // View state
  const [activeTab, setActiveTab] = useState('control') // 'control' | 'ssh'
  const [showAddModal, setShowAddModal] = useState(false)
  const [modalTab, setModalTab] = useState('phone') // 'phone' | 'computer'
  const [showPortHelp, setShowPortHelp] = useState(false)
  const [pairMode, setPairMode] = useState('lan')

  // Switches
  const [allowConnections, setAllowConnections] = useState(() => {
    return safeStorage.getItem('amethyst.devices.allowConnections') !== '0'
  })
  const [keepAwake, setKeepAwake] = useState(() => {
    return safeStorage.getItem('amethyst.devices.keepAwake') === '1'
  })

  // URL config
  const [appUrl, setAppUrl] = useState('')
  const [savedAppUrl, setSavedAppUrl] = useState('')
  const [showNetworkConfig, setShowNetworkConfig] = useState(false)

  // Outgoing connect state
  const [remoteCode, setRemoteCode] = useState('')

  // Permissions inline editor
  const [editingDeviceId, setEditingDeviceId] = useState(null)
  const [editingPermissions, setEditingPermissions] = useState({})
  const [savingPermissions, setSavingPermissions] = useState(false)

  // CONTRACT v2 Phone LLM and Pairing State
  const [phoneLlm, setPhoneLlm] = useState(null)
  const [phoneKeyInput, setPhoneKeyInput] = useState('')
  const [phoneProviderInput, setPhoneProviderInput] = useState('anthropic')
  const [phoneModelInput, setPhoneModelInput] = useState('claude-3-5-haiku-20241022')
  const [savingPhoneLlm, setSavingPhoneLlm] = useState(false)

  // CONTRACT v2 Phone Composio State
  const [phoneComposio, setPhoneComposio] = useState(null)
  const [phoneComposioKeyInput, setPhoneComposioKeyInput] = useState('')
  const [phoneComposioUserIdInput, setPhoneComposioUserIdInput] = useState('')
  const [savingPhoneComposio, setSavingPhoneComposio] = useState(false)

  // Use separate phone-only keys setting (default false)
  const [useSeparateKeys, setUseSeparateKeys] = useState(false)
  const [revokedModalData, setRevokedModalData] = useState(null)

  const [v2Pairing, setV2Pairing] = useState(null)
  const [v2Status, setV2Status] = useState(null)

  const platformName = getHostPlatformName()

  const refresh = useCallback(async () => {
    if (!hasBackend) return
    setIsRefreshing(true)
    try {
      const { devices: rows, app_url: configured } = await api.devices()
      setDevices(rows || [])
      setAppUrl(configured || '')
      setSavedAppUrl(configured || '')

      const { pending: pendingRows } = await api.pendingDevices()
      setPending(pendingRows || [])

      const pCfg = await api.getPhoneLlmSettings()
      setPhoneLlm(pCfg)
      if (pCfg?.provider) setPhoneProviderInput(pCfg.provider)
      if (pCfg?.model) setPhoneModelInput(pCfg.model)

      const pComp = await api.getPhoneComposioSettings()
      setPhoneComposio(pComp)
      if (pComp?.user_id) setPhoneComposioUserIdInput(pComp.user_id)

      try {
        const pairingCfg = await api.getPhonePairingSettings()
        setUseSeparateKeys(Boolean(pairingCfg?.use_separate_keys))
      } catch {
        // ignore
      }
    } catch {
      // Backend went away mid-look
    } finally {
      setIsRefreshing(false)
    }
  }, [hasBackend])

  useEffect(() => {
    refresh()
    let interval = null
    if (invite || (showAddModal && !v2Pairing)) {
      interval = setInterval(refresh, 2500)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [invite, showAddModal, v2Pairing, refresh])

  // Poll v2 pairing status every second while modal is active
  useEffect(() => {
    if (!showAddModal || !v2Pairing) return
    const pollInterval = setInterval(async () => {
      try {
        const st = await api.pairingV2Status()
        setV2Status(st)
      } catch {
        // ignore
      }
    }, 1000)
    return () => clearInterval(pollInterval)
  }, [showAddModal, v2Pairing])

  const toggleSeparateKeys = async () => {
    const next = !useSeparateKeys
    setUseSeparateKeys(next)
    try {
      await api.savePhonePairingSettings({ use_separate_keys: next })
      toast(next ? 'Separate phone keys enabled' : 'Auto-capture PC config enabled', 'ok')
      await refresh()
    } catch (err) {
      setUseSeparateKeys(!next)
      toast(err.message || 'Failed to update setting', 'bad')
    }
  }

  const openPairing = async () => {
    if (useSeparateKeys) {
      if (!phoneLlm?.has_key) {
        toast('Pairing blocked: Separate phone-only LLM key is missing. Set it below in Phone Settings first.', 'bad')
        return
      }
      if (!phoneComposio?.has_key || !phoneComposio?.has_user_id) {
        toast('Pairing blocked: Separate phone-only Composio credentials are missing. Set them below in Phone Settings first.', 'bad')
        return
      }
    }
    setBusy(true)
    try {
      const v2 = await api.startPairingV2()
      setV2Pairing(v2)
      setV2Status({ status: 'waiting_for_phone', remaining_seconds: 120 })
      setShowAddModal(true)
      await refresh()
    } catch (err) {
      toast(err.message || 'Failed to start pairing', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const closePairingModal = async () => {
    setShowAddModal(false)
    setV2Pairing(null)
    setV2Status(null)
    try {
      await api.cancelPairingV2()
    } catch {
      // ignore
    }
  }

  const approveV2 = async (deviceLabel) => {
    try {
      await api.approvePairingV2(deviceLabel)
      toast(`Paired '${deviceLabel}' successfully! Bundle delivered.`, 'ok')
      await closePairingModal()
      await refresh()
    } catch (err) {
      toast(err.message || 'Approval failed', 'bad')
    }
  }

  const denyV2 = async () => {
    try {
      await api.denyPairingV2()
      toast('Pairing request denied.', 'bad')
      await closePairingModal()
    } catch (err) {
      toast(err.message || 'Deny failed', 'bad')
    }
  }

  const savePhoneLlm = async () => {
    if (!phoneKeyInput.trim() && !phoneLlm?.has_key) {
      toast('Please enter a dedicated phone LLM key.', 'bad')
      return
    }
    setSavingPhoneLlm(true)
    try {
      await api.savePhoneLlmSettings({
        provider: phoneProviderInput.trim(),
        model: phoneModelInput.trim(),
        api_key: phoneKeyInput.trim() || undefined,
      })
      setPhoneKeyInput('')
      toast('Phone-only LLM key saved in keychain.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message || 'Failed to save phone LLM settings', 'bad')
    } finally {
      setSavingPhoneLlm(false)
    }
  }

  const clearPhoneLlm = async () => {
    const ok = await confirm({
      title: 'Delete Phone-only LLM Key?',
      message: 'This removes the phone-only key from this computer. Phone pairing will be blocked until a new key is added.',
      confirmLabel: 'Delete Key',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deletePhoneLlmSettings()
      setPhoneKeyInput('')
      toast('Phone-only LLM key removed.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const savePhoneComposio = async () => {
    if (!phoneComposioKeyInput.trim() && !phoneComposio?.has_key) {
      toast('Please enter a dedicated phone Composio API key.', 'bad')
      return
    }
    if (!phoneComposioUserIdInput.trim() && !phoneComposio?.has_user_id) {
      toast('Please enter a phone Composio User ID.', 'bad')
      return
    }
    setSavingPhoneComposio(true)
    try {
      await api.savePhoneComposioSettings({
        api_key: phoneComposioKeyInput.trim() || undefined,
        user_id: phoneComposioUserIdInput.trim() || undefined,
      })
      setPhoneComposioKeyInput('')
      toast('Phone-only Composio credentials saved in keychain.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message || 'Failed to save phone Composio settings', 'bad')
    } finally {
      setSavingPhoneComposio(false)
    }
  }

  const clearPhoneComposio = async () => {
    const ok = await confirm({
      title: 'Delete Phone-only Composio Credentials?',
      message: 'This removes the phone-only Composio credentials from this computer. Phone pairing will be blocked until new credentials are added.',
      confirmLabel: 'Delete Credentials',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deletePhoneComposioSettings()
      setPhoneComposioKeyInput('')
      setPhoneComposioUserIdInput('')
      toast('Phone-only Composio credentials removed.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const approvePending = async (requestId) => {
    try {
      await api.approvePending(requestId)
      toast('Device approved and paired.', 'ok')
      setInvite(null)
      setShowAddModal(false)
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

  const toggleAllowConnections = () => {
    const next = !allowConnections
    setAllowConnections(next)
    safeStorage.setItem('amethyst.devices.allowConnections', next ? '1' : '0')
    toast(next ? 'Connections enabled' : 'Connections paused', 'ok')
  }

  const toggleKeepAwake = () => {
    const next = !keepAwake
    setKeepAwake(next)
    safeStorage.setItem('amethyst.devices.keepAwake', next ? '1' : '0')
    toast(next ? 'Keep awake enabled' : 'Keep awake disabled', 'ok')
  }

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
      toast(saved ? 'Saved. Scannable links enabled.' : 'Cleared', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const revoke = async (device) => {
    let shared = []
    try {
      const perms = typeof device.permissions === 'string' ? JSON.parse(device.permissions || '{}') : (device.permissions || {})
      if (Array.isArray(perms.shared_providers)) shared = perms.shared_providers
    } catch {
      // fallback
    }

    const checklistText = shared.length
      ? shared.map((p) => `• [ ] ${formatSharedProviderItem(p)}`).join('\n')
      : '• [ ] Model provider keys\n• [ ] Composio key'

    const ok = await confirm({
      title: `Revoke ${device.name}?`,
      message:
        `This will forget ${device.name} locally on this computer.\n\n` +
        `Revoking on this computer forgets the device locally, but does NOT rotate or delete any API keys at your providers.\n\n` +
        `Shared keys to rotate:\n${checklistText}\n\n` +
        `Please manually rotate or delete these keys at your providers.`,
      confirmLabel: 'Revoke Device',
      danger: true,
    })
    if (!ok) return
    try {
      const res = await api.revokeDeviceV2(device.id)
      const providersToRotate = (res?.shared_providers && res.shared_providers.length) ? res.shared_providers : shared
      setRevokedModalData({
        deviceName: device.name,
        providers: providersToRotate.length ? providersToRotate : ['LLM Provider', 'Composio'],
      })
      toast(`${device.name} revoked locally.`, 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleCopyCode = (rawCode) => {
    if (!rawCode) return
    const formatted = rawCode.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()
    copyText(formatted)
    toast('Pairing code copied to clipboard', 'ok')
  }

  // =========================================================================
  // ONBOARDING VIEW (HERO PRESENTATION)
  // =========================================================================
  return (
    <div className="connections-root">
      {/* Elevated Pending Approvals Notice */}
      <AnimatePresence>
        {pending.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, scale: 0.96 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.96 }}
            className="conn-card"
            style={{ borderColor: '#f59e0b', background: 'rgba(245, 158, 11, 0.08)', marginBottom: 20 }}
          >
            <div className="conn-card-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15 }}>⚠️</span>
                <strong style={{ fontSize: 13, color: '#f59e0b' }}>Device waiting for approval ({pending.length})</strong>
              </div>
              {pending.map((p) => (
                <div key={p.request_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 10, border: '1px solid var(--hairline)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>Role: {p.role} · Token: {p.request_id?.slice(0, 8)}…</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <motion.button
                      type="button"
                      className="conn-btn-sm"
                      onClick={() => setActiveModalRequest(p)}
                      style={{ background: '#007aff', color: '#fff', border: 'none', fontWeight: 600 }}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                    >
                      Review &amp; Approve
                    </motion.button>
                    <motion.button
                      type="button"
                      className="conn-btn-sm"
                      onClick={() => approvePending(p.request_id)}
                      style={{ background: '#f59e0b', color: '#000', border: 'none', fontWeight: 600 }}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                    >
                      Quick Approve
                    </motion.button>
                    <motion.button
                      type="button"
                      className="conn-btn-sm is-danger"
                      onClick={() => rejectPending(p.request_id)}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                    >
                      Reject
                    </motion.button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
         MAIN CONNECTIONS DASHBOARD (CODEX SPEC / STAGESHOW CRAFT)
         ========================================================================= */}
      <motion.div
        key="dashboard-view"
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -10 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
            {/* Header (Clean, Authentic Codex: Exactly 1 Title, No Clutter) */}
            <div className="conn-header">
              <h1 className="conn-page-title">Connections</h1>

              {/* Segmented Top Filter Pills with Smooth Spring Sliding Background */}
              <div className="conn-nav-tabs">
                <motion.button
                  type="button"
                  className={`conn-nav-pill ${activeTab === 'control' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('control')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                >
                  {activeTab === 'control' && (
                    <motion.div
                      layoutId="conn-nav-pill-active"
                      className="conn-nav-pill-bg"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span>Control {platformName}</span>
                </motion.button>
                <motion.button
                  type="button"
                  className={`conn-nav-pill ${activeTab === 'ssh' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('ssh')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                >
                  {activeTab === 'ssh' && (
                    <motion.div
                      layoutId="conn-nav-pill-active"
                      className="conn-nav-pill-bg"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span>SSH</span>
                </motion.button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'control' ? (
                <motion.div
                  key="tab-control-content"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Section 1: Devices that can control this PC */}
                  <div className="conn-section">
                    <div className="conn-section-head">
                      <span className="conn-section-title">Devices that can control {platformName}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <motion.button
                          type="button"
                          className="conn-icon-btn"
                          onClick={openPairing}
                          aria-label="Add device"
                          title="Add device"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.92 }}
                        >
                          <Icon name="plus" size={14} />
                        </motion.button>
                        <motion.button
                          type="button"
                          className={`conn-icon-btn ${isRefreshing ? 'is-spinning' : ''}`}
                          onClick={refresh}
                          aria-label="Refresh connected devices"
                          title="Refresh list"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.92 }}
                        >
                          <Icon name="redo" size={14} />
                        </motion.button>
                      </div>
                    </div>

                    <div className="conn-card">
                      {/* Allow connections toggle with Spring Knob */}
                      <div className="conn-card-row">
                        <span className="conn-row-title">Allow connections</span>
                        <motion.button
                          type="button"
                          className={`conn-switch ${allowConnections ? 'is-on' : ''}`}
                          onClick={toggleAllowConnections}
                          aria-pressed={allowConnections}
                          aria-label="Allow connections toggle"
                          whileTap={{ scale: 0.94 }}
                        >
                          <motion.span
                            className="conn-switch-knob"
                            animate={{ x: allowConnections ? 20 : 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                          />
                        </motion.button>
                      </div>

                      <div className="conn-card-row-divider" />

                      {/* Devices or Empty State */}
                      {!allowConnections ? (
                        <div className="conn-empty-state">
                          <div className="conn-empty-text" style={{ color: 'var(--text-faint)' }}>
                            Connections are paused. Remote devices cannot access this computer.
                          </div>
                        </div>
                      ) : devices.length === 0 ? (
                        <div className="conn-empty-state">
                          <div className="conn-empty-devices-glyph" aria-hidden="true">
                            <Icon name="mobile" size={24} />
                            <span className="conn-empty-dots">···</span>
                            <Icon name="desktop" size={26} />
                          </div>
                          <div className="conn-empty-text">
                            Add device to control {platformName} remotely
                          </div>
                          <motion.button
                            type="button"
                            className="conn-btn-pill"
                            onClick={openPairing}
                            disabled={busy}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.96 }}
                          >
                            {busy ? 'Preparing…' : 'Add'}
                          </motion.button>
                          <button
                            type="button"
                            className="conn-empty-guide-link"
                            onClick={openPairing}
                          >
                            Pair with your phone or another computer →
                          </button>
                        </div>
                      ) : (
                        <motion.div layout className="conn-devices-list">
                          {devices.map((device) => {
                            const isEditing = editingDeviceId === device.id
                            return (
                              <motion.div layout key={device.id} className="conn-device-item">
                                <div className="conn-device-row">
                                  <div className="conn-device-info">
                                    <div className="conn-device-glyph" aria-hidden="true">
                                      <Icon name={/mac|windows|pc/i.test(device.name || '') ? 'desktop' : 'mobile'} size={18} />
                                    </div>
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span className="conn-row-title">{device.name}</span>
                                        <span className="conn-device-badge">{device.role || 'Control'}</span>
                                      </div>
                                      <span className="conn-row-desc">
                                        Last seen {formatRelativeTime(device.last_seen_at)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="conn-device-actions">
                                    <motion.button
                                      type="button"
                                      className="conn-btn-sm"
                                      onClick={() => {
                                        if (isEditing) setEditingDeviceId(null)
                                        else {
                                          setEditingDeviceId(device.id)
                                          setEditingPermissions(device.permissions || {})
                                        }
                                      }}
                                      whileHover={{ scale: 1.04 }}
                                      whileTap={{ scale: 0.96 }}
                                    >
                                      {isEditing ? 'Close' : 'Permissions'}
                                    </motion.button>
                                    <motion.button
                                      type="button"
                                      className="conn-btn-sm is-danger"
                                      onClick={() => revoke(device)}
                                      whileHover={{ scale: 1.04 }}
                                      whileTap={{ scale: 0.96 }}
                                    >
                                      Revoke
                                    </motion.button>
                                  </div>
                                </div>

                                {/* Animated Scopes Accordion with Modern Selectable Chips */}
                                <AnimatePresence>
                                  {isEditing && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: 'auto' }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                      className="conn-scopes-panel"
                                    >
                                      <div className="conn-scopes-head">
                                        <span>Configure Access Scopes</span>
                                        <span style={{ fontSize: 12.5, color: 'var(--text-dim, #a1a1aa)' }}>Toggle permissions granted to this device</span>
                                      </div>

                                      <div className="conn-scopes-grid">
                                        {SCOPE_DEFINITIONS.map(({ key, label, icon }) => {
                                          const active = Boolean(editingPermissions[key])
                                          return (
                                            <motion.button
                                              key={key}
                                              type="button"
                                              className={`conn-scope-chip ${active ? 'is-active' : ''}`}
                                              onClick={() => toggleEditingPermission(key)}
                                              whileHover={{ scale: 1.02, y: -1 }}
                                              whileTap={{ scale: 0.96 }}
                                            >
                                              <span className="conn-scope-chip-check">
                                                <AnimatePresence initial={false}>
                                                  {active && (
                                                    <motion.span
                                                      key="check-icon"
                                                      initial={{ scale: 0, opacity: 0 }}
                                                      animate={{ scale: 1, opacity: 1 }}
                                                      exit={{ scale: 0, opacity: 0 }}
                                                      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
                                                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    >
                                                      <Icon name="check-simple" size={12} />
                                                    </motion.span>
                                                  )}
                                                </AnimatePresence>
                                              </span>
                                              <Icon name={icon} size={15} style={{ opacity: active ? 1 : 0.7 }} />
                                              <span>{label}</span>
                                            </motion.button>
                                          )
                                        })}
                                      </div>

                                      <div className="conn-scopes-foot">
                                        <motion.button
                                          type="button"
                                          className="conn-btn-sm"
                                          onClick={() => setEditingDeviceId(null)}
                                          whileHover={{ scale: 1.03 }}
                                          whileTap={{ scale: 0.96 }}
                                        >
                                          Cancel
                                        </motion.button>
                                        <motion.button
                                          type="button"
                                          className="conn-btn-sm"
                                          style={{ background: '#007aff', color: '#fff', border: 'none', fontWeight: 600, padding: '0 18px' }}
                                          onClick={() => savePermissions(device.id)}
                                          disabled={savingPermissions}
                                          whileHover={{ scale: 1.03 }}
                                          whileTap={{ scale: 0.96 }}
                                        >
                                          {savingPermissions ? 'Saving…' : 'Save Scopes'}
                                        </motion.button>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            )
                          })}

                          {/* Add Device pill row inside card */}
                          <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'flex-end', background: 'rgba(255,255,255,0.015)', borderTop: '1px solid var(--hairline)' }}>
                            <motion.button
                              type="button"
                              className="conn-btn-pill"
                              onClick={openPairing}
                              disabled={busy}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                            >
                              <Icon name="plus" size={13} />
                              <span>Add another device</span>
                            </motion.button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>

                  {/* Section: Phone Companion Security / Separate Keys (CONTRACT v2) */}
                  <div className="conn-section" style={{ marginTop: 24 }}>
                    <div className="conn-section-head">
                      <span className="conn-section-title">Phone Companion Security</span>
                    </div>

                    <div className="conn-card">
                      <div className="conn-card-row">
                        <div className="conn-row-left">
                          <div className="conn-row-icon-box" aria-hidden="true">
                            <Icon name="shield" size={17} />
                          </div>
                          <div className="conn-row-text">
                            <span className="conn-row-title">Use separate phone-only keys</span>
                            <span className="conn-row-desc">
                              Require dedicated LLM and Composio credentials for the phone companion instead of auto-capturing PC keys.
                            </span>
                          </div>
                        </div>
                        <motion.button
                          type="button"
                          className={`conn-switch ${useSeparateKeys ? 'is-on' : ''}`}
                          onClick={toggleSeparateKeys}
                          aria-pressed={useSeparateKeys}
                          aria-label="Use separate phone-only keys toggle"
                          whileTap={{ scale: 0.94 }}
                        >
                          <motion.span
                            className="conn-switch-knob"
                            animate={{ x: useSeparateKeys ? 20 : 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                          />
                        </motion.button>
                      </div>
                    </div>
                  </div>

                  {/* Section: Dedicated Phone LLM Key (CONTRACT v2) */}
                  <div className="conn-section" style={{ marginTop: 24 }}>
                    <div className="conn-section-head">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span className="conn-section-title">Phone Companion LLM (Contract v2)</span>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: phoneLlm?.has_key ? 'rgba(34, 197, 94, 0.15)' : (useSeparateKeys ? 'rgba(239, 68, 68, 0.15)' : 'rgba(161, 161, 170, 0.15)'),
                            color: phoneLlm?.has_key ? '#22c55e' : (useSeparateKeys ? '#ef4444' : '#a1a1aa'),
                            border: `1px solid ${phoneLlm?.has_key ? 'rgba(34, 197, 94, 0.3)' : (useSeparateKeys ? 'rgba(239, 68, 68, 0.3)' : 'rgba(161, 161, 170, 0.3)')}`,
                          }}
                        >
                          {phoneLlm?.has_key ? 'Key Configured' : (useSeparateKeys ? 'Missing — Pairing Blocked' : 'Not Set (Using PC Keys)')}
                        </span>
                      </div>
                    </div>

                    <div className="conn-card">
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div className="conn-row-text">
                          <span className="conn-row-title">Dedicated Phone-only LLM Key</span>
                          <span className="conn-row-desc">
                            Amethyst requires a separate API key for the phone companion so it can be capped or deleted independently at your provider. Revoking a phone locally does not rotate keys.
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11.5, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>Provider</label>
                            <HouseInput
                              className="set-input"
                              placeholder="anthropic, openai, openrouter"
                              value={phoneProviderInput}
                              onChange={(e) => setPhoneProviderInput(e.target.value)}
                              spellCheck={false}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11.5, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>Model</label>
                            <HouseInput
                              className="set-input"
                              placeholder="e.g. claude-3-5-haiku-20241022"
                              value={phoneModelInput}
                              onChange={(e) => setPhoneModelInput(e.target.value)}
                              spellCheck={false}
                            />
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: 11.5, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
                            API Key {phoneLlm?.has_key ? '(Stored in OS keychain — enter new key to replace)' : '(Required before pairing)'}
                          </label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <HouseInput
                              className="set-input"
                              type="password"
                              placeholder={phoneLlm?.has_key ? '••••••••••••••••••••' : 'sk-...'}
                              value={phoneKeyInput}
                              onChange={(e) => setPhoneKeyInput(e.target.value)}
                              autoComplete="off"
                              spellCheck={false}
                              style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                            />
                            <motion.button
                              type="button"
                              className="conn-btn-sm"
                              style={{ background: '#007aff', color: '#fff', border: 'none', height: 34, padding: '0 16px', fontWeight: 600 }}
                              onClick={savePhoneLlm}
                              disabled={savingPhoneLlm || (!phoneKeyInput.trim() && phoneProviderInput === phoneLlm?.provider && phoneModelInput === phoneLlm?.model)}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                            >
                              {savingPhoneLlm ? 'Saving…' : 'Save'}
                            </motion.button>
                            {phoneLlm?.has_key && (
                              <motion.button
                                type="button"
                                className="conn-btn-sm is-danger"
                                style={{ height: 34, padding: '0 12px' }}
                                onClick={clearPhoneLlm}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.96 }}
                              >
                                Clear
                              </motion.button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section: Dedicated Phone Composio Credentials (CONTRACT v2) */}
                  <div className="conn-section" style={{ marginTop: 24 }}>
                    <div className="conn-section-head">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span className="conn-section-title">Phone Companion Composio (Contract v2)</span>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: phoneComposio?.has_key && phoneComposio?.has_user_id ? 'rgba(34, 197, 94, 0.15)' : (useSeparateKeys ? 'rgba(239, 68, 68, 0.15)' : 'rgba(161, 161, 170, 0.15)'),
                            color: phoneComposio?.has_key && phoneComposio?.has_user_id ? '#22c55e' : (useSeparateKeys ? '#ef4444' : '#a1a1aa'),
                            border: `1px solid ${phoneComposio?.has_key && phoneComposio?.has_user_id ? 'rgba(34, 197, 94, 0.3)' : (useSeparateKeys ? 'rgba(239, 68, 68, 0.3)' : 'rgba(161, 161, 170, 0.3)')}`,
                          }}
                        >
                          {phoneComposio?.has_key && phoneComposio?.has_user_id ? 'Credentials Configured' : (useSeparateKeys ? 'Missing — Pairing Blocked' : 'Not Set (Using PC Keys)')}
                        </span>
                      </div>
                    </div>

                    <div className="conn-card">
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div className="conn-row-text">
                          <span className="conn-row-title">Dedicated Phone-only Composio Credentials</span>
                          <span className="conn-row-desc">
                            Create a separate Composio project, connect only Google Drive, and use that project's key.
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11.5, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
                              User ID {phoneComposio?.has_user_id ? '(Stored in OS keychain)' : '(Required before pairing)'}
                            </label>
                            <HouseInput
                              className="set-input"
                              placeholder="e.g. default or phone_user"
                              value={phoneComposioUserIdInput}
                              onChange={(e) => setPhoneComposioUserIdInput(e.target.value)}
                              spellCheck={false}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11.5, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
                              API Key {phoneComposio?.has_key ? '(Stored in OS keychain — enter new key to replace)' : '(Required before pairing)'}
                            </label>
                            <HouseInput
                              className="set-input"
                              type="password"
                              placeholder={phoneComposio?.has_key ? '••••••••••••••••••••' : 'comp_...'}
                              value={phoneComposioKeyInput}
                              onChange={(e) => setPhoneComposioKeyInput(e.target.value)}
                              autoComplete="off"
                              spellCheck={false}
                              style={{ fontFamily: 'var(--font-mono)' }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <motion.button
                            type="button"
                            className="conn-btn-sm"
                            style={{ background: '#007aff', color: '#fff', border: 'none', height: 34, padding: '0 16px', fontWeight: 600 }}
                            onClick={savePhoneComposio}
                            disabled={
                              savingPhoneComposio ||
                              (!phoneComposioKeyInput.trim() && phoneComposioUserIdInput.trim() === (phoneComposio?.user_id || ''))
                            }
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.96 }}
                          >
                            {savingPhoneComposio ? 'Saving…' : 'Save'}
                          </motion.button>
                          {(phoneComposio?.has_key || phoneComposio?.has_user_id) && (
                            <motion.button
                              type="button"
                              className="conn-btn-sm is-danger"
                              style={{ height: 34, padding: '0 12px' }}
                              onClick={clearPhoneComposio}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                            >
                              Clear
                            </motion.button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Other settings */}
                  <div className="conn-section">
                    <div className="conn-section-head">
                      <span className="conn-section-title">Other settings</span>
                    </div>

                    <div className="conn-card">
                      <div className="conn-card-row">
                        <div className="conn-row-left">
                          <div className="conn-row-icon-box" aria-hidden="true">
                            <Icon name="sun" size={17} />
                          </div>
                          <div className="conn-row-text">
                            <span className="conn-row-title">Keep {platformName} awake</span>
                            <span className="conn-row-desc">
                              Prevent sleep when computer is plugged in and remote access is enabled
                            </span>
                          </div>
                        </div>
                        <motion.button
                          type="button"
                          className={`conn-switch ${keepAwake ? 'is-on' : ''}`}
                          onClick={toggleKeepAwake}
                          aria-pressed={keepAwake}
                          aria-label="Keep PC awake toggle"
                          whileTap={{ scale: 0.94 }}
                        >
                          <motion.span
                            className="conn-switch-knob"
                            animate={{ x: keepAwake ? 20 : 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                          />
                        </motion.button>
                      </div>

                      {/* Web Pairing Address configuration drawer */}
                      <div className="conn-card-row-divider" />
                      <div className="conn-card-row">
                        <div className="conn-row-left">
                          <div className="conn-row-icon-box" aria-hidden="true">
                            <Icon name="globe" size={17} />
                          </div>
                          <div className="conn-row-text">
                            <span className="conn-row-title">Web pairing address</span>
                            <span className="conn-row-desc">
                              {appUrl ? `Configured for ${appUrl}` : 'Set tunnel URL for remote pairing'}
                            </span>
                          </div>
                        </div>
                        <motion.button
                          type="button"
                          className="conn-btn-sm"
                          onClick={() => setShowNetworkConfig((prev) => !prev)}
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          {showNetworkConfig ? 'Hide' : 'Configure'}
                        </motion.button>
                      </div>

                      <AnimatePresence>
                        {showNetworkConfig && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            style={{ padding: '14px 18px', background: 'rgba(0,0,0,0.25)', borderTop: '1px solid var(--hairline)' }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <HouseInput
                                className="set-input"
                                type="url"
                                placeholder="https://amethyst.example.com"
                                value={appUrl}
                                onChange={(e) => setAppUrl(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                style={{ flex: 1 }}
                              />
                              <motion.button
                                type="button"
                                className="conn-btn-sm"
                                style={{ background: '#007aff', color: '#fff', border: 'none', height: 34, padding: '0 14px' }}
                                onClick={saveAppUrl}
                                disabled={appUrl.trim() === savedAppUrl}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.96 }}
                              >
                                Save
                              </motion.button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              ) : (
                /* SSH / Control Other Computers View */
                <motion.div
                  key="tab-ssh-content"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="conn-section"
                >
                  <div className="conn-section-head">
                    <span className="conn-section-title">Control other computers</span>
                  </div>

                  <div className="conn-card">
                    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div className="conn-row-text">
                        <span className="conn-row-title">Connect with pairing code</span>
                        <span className="conn-row-desc">
                          Enter the 8-character code shown on your other computer (e.g. from the Computer tab in Add Device).
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <HouseInput
                          className="set-input"
                          placeholder="e.g. 93RK-GH4C"
                          value={remoteCode}
                          onChange={(e) => setRemoteCode(e.target.value)}
                          style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-mono)' }}
                        />
                        <motion.button
                          type="button"
                          className="conn-btn-pill"
                          disabled={!remoteCode.trim()}
                          onClick={() => {
                            toast('Connecting to remote computer…', 'ok')
                          }}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          Connect
                        </motion.button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

      {/* =========================================================================
         ADD DEVICE MODAL DIALOG (STAGESHOW CRAFT)
         ========================================================================= */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            className="conn-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closePairingModal()
              }
            }}
          >
            <motion.div
              className="conn-modal"
              role="dialog"
              aria-modal="true"
              initial={{ scale: 0.94, opacity: 0, y: 14 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 14 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              {/* Glossy Gradient Hero Banner with 3D Device Mockup */}
              <div className="conn-modal-banner">
                <motion.button
                  type="button"
                  className="conn-modal-close-btn"
                  onClick={closePairingModal}
                  aria-label="Close dialog"
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.92 }}
                >
                  <Icon name="x" size={13} />
                </motion.button>

                <AnimatePresence mode="wait">
                  {modalTab === 'phone' ? (
                    <motion.div
                      key="mockup-phone"
                      className="conn-mockup-phone"
                      aria-hidden="true"
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 22, opacity: 1 }}
                      exit={{ y: 50, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                    >
                      <div className="conn-mockup-island" />
                      <div className="conn-mockup-screen-card">
                        <Icon name="desktop" size={26} style={{ color: '#09090b', marginTop: 6 }} />
                        <div className="conn-mockup-screen-title">
                          Allow this phone to access Amethyst on your computer?
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="mockup-window"
                      className="conn-mockup-window"
                      aria-hidden="true"
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 18, opacity: 1 }}
                      exit={{ y: 50, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                    >
                      <div className="conn-mockup-window-bar">
                        <div className="conn-mockup-dot red" />
                        <div className="conn-mockup-dot yellow" />
                        <div className="conn-mockup-dot green" />
                      </div>
                      <div className="conn-mockup-window-body">
                        <Icon name="desktop" size={22} style={{ color: '#007aff', marginBottom: 4 }} />
                        <strong style={{ fontSize: 11, color: '#09090b' }}>Connections</strong>
                        <span style={{ fontSize: 9, color: '#71717a' }}>Control other devices</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Modal Body */}
              <div className="conn-modal-body">
                <h2 className="conn-modal-title">
                  Pair with Amethyst
                </h2>
                <p style={{ fontSize: 12.5, color: '#8e8e93', margin: '-10px 0 16px 0', lineHeight: 1.4, maxWidth: 320 }}>
                  {modalTab === 'phone' ? 'Scan to connect your phone over local Wi-Fi' : 'Enter this code on your phone or computer'}
                </p>

                {/* Segmented Control Tabs */}
                <div className="conn-segmented-tabs">
                  <motion.button
                    type="button"
                    className={`conn-segmented-tab ${modalTab === 'phone' ? 'is-active' : ''}`}
                    onClick={() => setModalTab('phone')}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {modalTab === 'phone' && (
                      <motion.div
                        layoutId="modal-tab-indicator"
                        className="conn-segmented-active-indicator"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      />
                    )}
                    <span>Phone</span>
                  </motion.button>
                  <motion.button
                    type="button"
                    className={`conn-segmented-tab ${modalTab === 'computer' ? 'is-active' : ''}`}
                    onClick={() => setModalTab('computer')}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {modalTab === 'computer' && (
                      <motion.div
                        layoutId="modal-tab-indicator"
                        className="conn-segmented-active-indicator"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      />
                    )}
                    <span>Computer</span>
                  </motion.button>
                </div>

                {/* Inner Display Box with Animated Crossfade */}
                <div
                  className="conn-modal-inner-box"
                  style={v2Status?.status === 'pending_approval' ? { height: 'auto', minHeight: 220, padding: '16px 12px' } : undefined}
                >
                  <AnimatePresence mode="wait">
                    {modalTab === 'phone' ? (
                      <motion.div
                        key="box-phone"
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {v2Status?.status === 'pending_approval' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12px 10px', gap: 10, width: '100%' }}>
                            <div style={{ fontSize: 28 }}>📱</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                              Pair &lsquo;{v2Status.device_label}&rsquo;?
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-sub)', maxWidth: 320, lineHeight: 1.4 }}>
                              A phone on your local Wi-Fi presented a valid token. Approving will share these credentials:
                            </div>

                            <div style={{ width: '100%', maxWidth: 330, background: 'rgba(255, 255, 255, 0.04)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--hairline)', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5 }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em' }}>
                                Shared with this phone:
                              </div>
                              {Array.isArray(v2Status.shared_providers) && v2Status.shared_providers.length > 0 ? (
                                v2Status.shared_providers.map((p, idx) => {
                                  const provName = typeof p === 'object' && p !== null ? p.provider : String(p)
                                  const modelName = typeof p === 'object' && p !== null ? p.model : null
                                  return (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
                                      <span style={{ color: '#007aff' }}>•</span>
                                      <span>
                                        <strong>{provName}</strong>
                                        {modelName && <span style={{ color: 'var(--text-sub)', marginLeft: 6 }}>({modelName})</span>}
                                      </span>
                                    </div>
                                  )
                                })
                              ) : (
                                <div style={{ color: 'var(--text)' }}>• Configured LLM provider</div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
                                <span style={{ color: '#007aff' }}>•</span>
                                <span>Composio account: <strong>{v2Status.composio_user_id || 'None'}</strong></span>
                              </div>
                            </div>

                            <div style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 6, padding: '8px 10px', maxWidth: 330, lineHeight: 1.35, textAlign: 'left' }}>
                              ⚠️ {v2Status.warning || 'This phone will be able to use these keys. If it is lost, rotate them.'}
                            </div>

                            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                              <motion.button
                                type="button"
                                className="conn-btn-sm"
                                style={{ background: '#007aff', color: '#fff', border: 'none', fontWeight: 600, padding: '7px 20px', fontSize: 13 }}
                                onClick={() => approveV2(v2Status.device_label)}
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                              >
                                Approve
                              </motion.button>
                              <motion.button
                                type="button"
                                className="conn-btn-sm is-danger"
                                style={{ padding: '7px 16px', fontSize: 13 }}
                                onClick={denyV2}
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                              >
                                Deny
                              </motion.button>
                            </div>
                          </div>
                        ) : v2Status?.status === 'expired' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '24px 20px', gap: 12 }}>
                            <Icon name="clock" size={28} style={{ color: '#ef4444' }} />
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Pairing Window Expired</div>
                            <div style={{ fontSize: 12, color: 'var(--text-sub)', maxWidth: 280 }}>
                              The 2-minute pairing window has closed for security.
                            </div>
                            <motion.button
                              type="button"
                              className="conn-btn-sm"
                              style={{ background: '#007aff', color: '#fff', border: 'none', fontWeight: 600, marginTop: 4 }}
                              onClick={openPairing}
                              disabled={busy}
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.96 }}
                            >
                              Restart Pairing
                            </motion.button>
                          </div>
                        ) : v2Pairing ? (
                          <>
                            <div className="conn-qr-wrapper">
                              <div
                                dangerouslySetInnerHTML={{
                                  __html: v2Pairing.qr_svg,
                                }}
                                style={{ width: '100%', height: '100%' }}
                              />
                              <div className="conn-qr-center-badge">
                                <Icon name="mobile" size={16} />
                              </div>
                            </div>

                            <div className="conn-box-corner-tools">
                              <motion.button
                                type="button"
                                className="conn-tool-btn"
                                title="Copy QR payload (base64url)"
                                onClick={() => {
                                  if (v2Pairing.qr) {
                                    copyText(v2Pairing.qr)
                                    toast('QR payload copied to clipboard', 'ok')
                                  }
                                }}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.92 }}
                              >
                                <Icon name="copy" size={13} />
                              </motion.button>
                              <motion.button
                                type="button"
                                className="conn-tool-btn"
                                title="Refresh QR code"
                                onClick={openPairing}
                                disabled={busy}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.92 }}
                              >
                                <Icon name="redo" size={13} />
                              </motion.button>
                            </div>
                          </>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                            <Icon name="circle-notch" size={26} className="conn-icon-btn is-spinning" />
                            <span style={{ fontSize: 12, color: '#a1a1aa' }}>Generating secure QR code…</span>
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="box-computer"
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {v2Pairing?.code || invite?.secret ? (
                          <>
                            <div className="conn-code-display-wrap">
                              <div
                                className="conn-code-display-number"
                                title="Click to copy code"
                                onClick={() => {
                                  const c = v2Pairing?.code || invite?.secret
                                  if (c) {
                                    copyText(c)
                                    toast('Pairing code copied', 'ok')
                                  }
                                }}
                              >
                                {v2Pairing?.code
                                  ? `${v2Pairing.code.slice(0, 3)} ${v2Pairing.code.slice(3)}`
                                  : invite.secret.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).replace(/(.{4})/, '$1-').toUpperCase()}
                              </div>

                              <motion.button
                                type="button"
                                className="conn-code-copy-pill"
                                onClick={() => {
                                  const c = v2Pairing?.code || invite?.secret
                                  if (c) {
                                    copyText(c)
                                    toast('Pairing code copied', 'ok')
                                  }
                                }}
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                              >
                                <Icon name="copy" size={12} />
                                <span>Copy Code</span>
                              </motion.button>
                            </div>

                            <div className="conn-box-corner-tools">
                              <motion.button
                                type="button"
                                className="conn-tool-btn"
                                title="Refresh code"
                                onClick={openPairing}
                                disabled={busy}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.92 }}
                              >
                                <Icon name="redo" size={13} />
                              </motion.button>
                            </div>
                          </>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                            <Icon name="circle-notch" size={26} className="conn-icon-btn is-spinning" />
                            <span style={{ fontSize: 12, color: '#a1a1aa' }}>Generating pairing code…</span>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Instructions footer */}
                <div className="conn-modal-instruction">
                  {modalTab === 'phone' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span>Point your camera or Amethyst companion at the QR code.</span>
                      {v2Status?.remaining_seconds !== undefined && (
                        <span className="conn-expiry-badge">
                          <span className="conn-dot-pulse" />
                          Expires in {v2Status.remaining_seconds}s
                        </span>
                      )}
                      <button
                        type="button"
                        className="conn-help-toggle"
                        onClick={() => setShowPortHelp((prev) => !prev)}
                      >
                        {showPortHelp ? 'Hide troubleshooting' : 'Trouble connecting?'}
                      </button>
                      {showPortHelp && v2Pairing?.port && (
                        <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#71717a', maxWidth: 320, lineHeight: 1.35 }}>
                          Local Wi-Fi port {v2Pairing.port}. If your PC firewall blocks incoming LAN traffic, allow port {v2Pairing.port}/tcp.
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span>Enter this 6-digit code on your companion device or computer.</span>
                      {v2Status?.remaining_seconds !== undefined && (
                        <span className="conn-expiry-badge">
                          <span className="conn-dot-pulse" />
                          Expires in {v2Status.remaining_seconds}s
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pairing approval modal from SSE / daemon summon */}
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

      {/* Revoked Credentials Checklist Modal */}
      <AnimatePresence>
        {revokedModalData && (
          <motion.div
            className="conn-modal-backdrop"
            style={{ zIndex: 100010 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setRevokedModalData(null)
            }}
          >
            <motion.div
              className="conn-modal"
              style={{ maxWidth: 440, padding: 24, textAlign: 'left' }}
              initial={{ scale: 0.94, opacity: 0, y: 14 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 14 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 24 }}>🛡️</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                  {revokedModalData.deviceName} Revoked
                </h3>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-sub)', marginBottom: 16, lineHeight: 1.5 }}>
                {revokedModalData.deviceName} was removed locally. <strong>Revoke does not rotate or delete any keys at your providers.</strong> Any keys previously shared with this phone remain active until manually rotated.
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                Checklist of shared credentials to rotate:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-inset)', padding: 12, borderRadius: 8, border: '1px solid var(--hairline)', marginBottom: 18 }}>
                {revokedModalData.providers.map((p, idx) => (
                  <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ cursor: 'pointer' }} />
                    <span>{formatSharedProviderItem(p)}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <motion.button
                  type="button"
                  className="conn-btn-sm"
                  style={{ background: '#007aff', color: '#fff', border: 'none', fontWeight: 600, padding: '7px 20px' }}
                  onClick={() => setRevokedModalData(null)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  Done
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
