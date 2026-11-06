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
    } catch {
      // Backend went away mid-look
    } finally {
      setIsRefreshing(false)
    }
  }, [hasBackend])

  useEffect(() => {
    refresh()
    let interval = null
    if (invite || showAddModal) {
      interval = setInterval(refresh, 2500)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [invite, showAddModal, refresh])

  const openPairing = async () => {
    setBusy(true)
    try {
      const inv = await api.pairDevice('')
      setInvite(inv)
      setShowAddModal(true)
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
    const ok = await confirm({
      title: `Disconnect ${device.name}?`,
      message: 'This device will immediately lose access to control this computer. You can re-pair it anytime.',
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (!ok) return
    try {
      await api.revokeDevice(device.id)
      toast(`${device.name} disconnected`, 'ok')
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
                                      Disconnect
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
                              {appUrl ? `Configured for ${appUrl}` : 'Set Cloudflare Pages or Tunnel URL for remote pairing'}
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
                setShowAddModal(false)
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
                  onClick={() => setShowAddModal(false)}
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
                  Approve on your device to control this computer remotely
                </h2>

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
                <div className="conn-modal-inner-box">
                  <AnimatePresence mode="wait">
                    {modalTab === 'phone' ? (
                      <motion.div
                        key="box-phone"
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {invite ? (
                          <>
                            <div className="conn-qr-wrapper">
                              <div
                                dangerouslySetInnerHTML={{
                                  __html: pairMode === 'lan' ? (invite.lan_qr_svg || invite.qr_svg) : (invite.web_qr_svg || invite.qr_svg),
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
                                title="Copy pairing link"
                                onClick={() => {
                                  const link = pairMode === 'lan' ? (invite.lan_qr || invite.qr) : invite.web_qr
                                  if (link) {
                                    copyText(link)
                                    toast('Pairing link copied', 'ok')
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
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {invite ? (
                          <>
                            <div className="conn-computer-code">
                              {invite.secret
                                ? invite.secret.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).replace(/(.{4})/, '$1-').toUpperCase()
                                : '93RK-GH4C'}
                            </div>

                            <div className="conn-box-corner-tools">
                              <motion.button
                                type="button"
                                className="conn-tool-btn"
                                title="Copy code"
                                onClick={() => handleCopyCode(invite.secret)}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.92 }}
                              >
                                <Icon name="copy" size={13} />
                              </motion.button>
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
                    <span>
                      Point your phone’s camera at the QR code to connect directly over local Wi-Fi.
                    </span>
                  ) : (
                    <span>
                      Click <strong>Add</strong> in the <strong>Settings &gt; Connections &gt; Control other devices</strong> tab on your other computer and enter this code
                    </span>
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
    </div>
  )
}
