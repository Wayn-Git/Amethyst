import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import Updates from '../Updates.jsx'
import { api } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

export default function MobileSettings({
  onClose,
  onOpenDiagnostics,
  onUnpair,
  transportMode,
}) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingNotice, setSavingNotice] = useState('')
  const device = syncClient.identity()

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.settings()
      if (res) {
        setSettings(res)
      }
    } catch (err) {
      console.warn('Failed to load settings:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const updateSetting = async (key, val) => {
    setSettings((prev) => ({ ...prev, [key]: val }))
    try {
      setSavingNotice('Saving…')
      await api.updateSettings({ [key]: val })
      setSavingNotice('Saved!')
      setTimeout(() => setSavingNotice(''), 2000)
    } catch (err) {
      setSavingNotice(`Save failed: ${err.message}`)
      loadSettings()
    }
  }

  return (
    <motion.div
      className="m-shell"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#ECEAE6' }}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.2 }}
    >
      <div className="m-body" style={{ paddingBottom: 40, gap: 14 }}>
        {/* Top Header */}
        <div className="m-r m-sp">
          <button
            type="button"
            className="m-ib"
            aria-label="Back"
            onClick={onClose}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="m-ttl" style={{ fontSize: 17 }}>
            Settings
          </div>
          <span style={{ width: 44 }} />
        </div>

        {savingNotice && (
          <div style={{ textAlign: 'center', fontSize: 12, color: savingNotice.includes('fail') ? '#ef4444' : '#16a34a' }}>
            {savingNotice}
          </div>
        )}

        {/* Section: Agent & Approvals */}
        <div className="m-m" style={{ margin: '4px 0 -6px 4px' }}>
          Agent Execution & Security
        </div>
        <div className="m-c" style={{ padding: '4px 16px' }}>
          {/* Approval Policy */}
          <div className="m-r m-sp" style={{ padding: '14px 0' }}>
            <div className="m-r" style={{ gap: 12 }}>
              <span className="m-it">
                <Icon name="shield" size={20} />
              </span>
              <div>
                <div style={{ fontWeight: 500 }}>Action Approvals</div>
                <div className="m-m">Confirm dangerous shell and PC commands</div>
              </div>
            </div>
            <button
              type="button"
              className={`m-tg ${settings?.approval_policy !== 'never' ? '' : 'off'}`}
              role="switch"
              aria-checked={settings?.approval_policy !== 'never'}
              onClick={() => {
                const next = settings?.approval_policy === 'never' ? 'on_request' : 'never'
                updateSetting('approval_policy', next)
              }}
            >
              <i />
            </button>
          </div>

          <div className="m-hr" />

          {/* Sandbox mode */}
          <div className="m-r m-sp" style={{ padding: '14px 0' }}>
            <div className="m-r" style={{ gap: 12 }}>
              <span className="m-it">
                <Icon name="lock" size={20} />
              </span>
              <div>
                <div style={{ fontWeight: 500 }}>Tool Sandbox</div>
                <div className="m-m">{settings?.sandbox_mode === 'read_only' ? 'Read-only mode' : 'Full system access'}</div>
              </div>
            </div>
            <button
              type="button"
              className={`m-tg ${settings?.sandbox_mode === 'read_only' ? '' : 'off'}`}
              role="switch"
              aria-checked={settings?.sandbox_mode === 'read_only'}
              onClick={() => {
                const next = settings?.sandbox_mode === 'read_only' ? 'permissive' : 'read_only'
                updateSetting('sandbox_mode', next)
              }}
            >
              <i />
            </button>
          </div>

          <div className="m-hr" />

          {/* Prevent Sleep */}
          <div className="m-r m-sp" style={{ padding: '14px 0' }}>
            <div className="m-r" style={{ gap: 12 }}>
              <span className="m-it">
                <Icon name="moon" size={20} />
              </span>
              <div>
                <div style={{ fontWeight: 500 }}>Keep PC Awake</div>
                <div className="m-m">Prevent host computer from sleeping during tasks</div>
              </div>
            </div>
            <button
              type="button"
              className={`m-tg ${settings?.prevent_sleep ? '' : 'off'}`}
              role="switch"
              aria-checked={Boolean(settings?.prevent_sleep)}
              onClick={() => updateSetting('prevent_sleep', !settings?.prevent_sleep)}
            >
              <i />
            </button>
          </div>
        </div>

        {/* Section: Linked Device & Connection */}
        <div className="m-m" style={{ margin: '4px 0 -6px 4px' }}>
          This Companion Device
        </div>
        <div className="m-c" style={{ padding: '4px 16px' }}>
          <div className="m-r" style={{ padding: '12px 0', gap: 12 }}>
            <span className="m-it">
              <Icon name="smartphone" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Device ID</div>
              <div className="m-m" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {device?.deviceId || 'Local pairing'}
              </div>
            </div>
          </div>

          <div className="m-hr" />

          <div className="m-r m-sp" style={{ padding: '12px 0' }}>
            <div className="m-r" style={{ gap: 12 }}>
              <span className="m-it">
                <Icon name="wifi" size={20} />
              </span>
              <div>
                <div style={{ fontWeight: 500 }}>Connection Transport</div>
                <div className="m-m">{transportMode || 'Direct Wi-Fi / Relay'}</div>
              </div>
            </div>
            <button
              type="button"
              className="m-ch on"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={onOpenDiagnostics}
            >
              Diagnostics
            </button>
          </div>
        </div>

        {/* Section: Actions */}
        <div className="m-r" style={{ gap: 10, marginTop: 4 }}>
          <button
            type="button"
            className="m-bt g"
            style={{ flex: 1, minHeight: 46 }}
            onClick={onOpenDiagnostics}
          >
            Connection Diagnostics
          </button>
          <button
            type="button"
            className="m-bt g"
            style={{
              flex: 1,
              minHeight: 46,
              color: '#ef4444',
              borderColor: 'rgba(239, 68, 68, 0.3)',
            }}
            onClick={() => {
              if (window.confirm('Are you sure you want to unpair this phone from your PC?')) {
                onUnpair()
              }
            }}
          >
            Unpair Device
          </button>
        </div>

        {/* App Updates Component */}
        <Updates />
      </div>
    </motion.div>
  )
}
