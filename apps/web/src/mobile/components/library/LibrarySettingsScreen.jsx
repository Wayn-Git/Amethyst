import { useState, useEffect } from 'react'
import { HeaderCircleButton, SectionLabel } from '../libraryUi.jsx'
import { INK, MUTED, BLUE, DANGER_RED, CARD_SHADOW, LINE } from './tokens.js'
import { api } from '../../../api.js'
import { storedIdentity } from '../../../lib/credentials.js'
import { safeStorage } from '../../../lib/storage.js'

export default function LibrarySettingsScreen({
  open = true,
  onClose,
  onBack,
  onOpenTags,
  showToast,
}) {
  const handleClose = onBack || onClose
  const [user, setUser] = useState(() => storedIdentity() || { name: 'User', email: 'user@amethyst.local' })
  const [defaultView, setDefaultView] = useState(() => safeStorage.getItem('amethyst.default_view') || 'list')
  const [autoSaveShare, setAutoSaveShare] = useState(() => safeStorage.getItem('amethyst.auto_save_share') === '1')
  const [reminders, setReminders] = useState(() => safeStorage.getItem('amethyst.reminders') !== '0')
  const [priceAlerts, setPriceAlerts] = useState(() => safeStorage.getItem('amethyst.price_alerts') === '1')
  const [storageStats, setStorageStats] = useState({ items: 0, media_mb: 0 })

  useEffect(() => {
    if (!open) return
    api
      .libraryCounts()
      .then((res) => {
        setStorageStats((prev) => ({ ...prev, items: res?.saved || 0 }))
      })
      .catch(() => {})
  }, [open])

  const toggleAutoSave = () => {
    const next = !autoSaveShare
    setAutoSaveShare(next)
    safeStorage.setItem('amethyst.auto_save_share', next ? '1' : '0')
    showToast?.(next ? 'Auto-save from share sheet enabled' : 'Auto-save disabled')
  }

  const toggleReminders = () => {
    const next = !reminders
    setReminders(next)
    safeStorage.setItem('amethyst.reminders', next ? '1' : '0')
    showToast?.(next ? 'Reminders enabled' : 'Reminders disabled')
  }

  const togglePriceAlerts = () => {
    const next = !priceAlerts
    setPriceAlerts(next)
    safeStorage.setItem('amethyst.price_alerts', next ? '1' : '0')
    showToast?.(next ? 'Price alerts enabled' : 'Price alerts disabled')
  }

  const handleSetDefaultView = (v) => {
    setDefaultView(v)
    safeStorage.setItem('amethyst.default_view', v)
    showToast?.(`Default view set to ${v}`)
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#F2F2F7',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header Bar */}
      <div
        style={{
          padding: 'max(52px, env(safe-area-inset-top, 0px)) 16px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <HeaderCircleButton label="Back" size={44} onClick={handleClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </HeaderCircleButton>
        <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>Settings</span>
        <div style={{ width: 44 }} />
      </div>

      {/* Settings Scrollable Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '0 16px 40px',
        }}
      >
        {/* Profile Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: 16,
            borderRadius: 22,
            background: '#FFFFFF',
            boxShadow: CARD_SHADOW,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: '#0B5FD9',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 800,
              flex: 'none',
            }}
          >
            {(user?.name || user?.username || 'A').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>
              {user?.name || user?.username || 'Account'}
            </div>
            <div style={{ fontSize: 14, color: MUTED }}>
              {user?.email || 'Connected device'}
            </div>
          </div>
        </div>

        {/* Group: Library */}
        <SectionLabel text="Library" style={{ margin: '14px 4px 10px' }} />
        <div style={{ borderRadius: 22, background: '#FFFFFF', boxShadow: CARD_SHADOW, overflow: 'hidden', marginBottom: 24 }}>
          {/* Default view */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 16, fontWeight: 550, color: INK }}>Default view</span>
            <div style={{ display: 'flex', background: 'rgba(118,118,128,.12)', borderRadius: 14, padding: 2 }}>
              <button
                type="button"
                onClick={() => handleSetDefaultView('list')}
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 12,
                  border: 0,
                  background: defaultView === 'list' ? '#FFFFFF' : 'transparent',
                  color: INK,
                  fontSize: 13,
                  fontWeight: defaultView === 'list' ? 700 : 500,
                  cursor: 'pointer',
                  boxShadow: defaultView === 'list' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                }}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => handleSetDefaultView('grid')}
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 12,
                  border: 0,
                  background: defaultView === 'grid' ? '#FFFFFF' : 'transparent',
                  color: INK,
                  fontSize: 13,
                  fontWeight: defaultView === 'grid' ? 700 : 500,
                  cursor: 'pointer',
                  boxShadow: defaultView === 'grid' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                }}
              >
                Grid
              </button>
            </div>
          </div>

          {/* Manage tags */}
          <button
            type="button"
            onClick={onOpenTags}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 52,
              padding: '0 16px',
              border: 0,
              borderBottom: `1px solid ${LINE}`,
              background: 'transparent',
              fontSize: 16,
              fontWeight: 550,
              color: INK,
              cursor: 'pointer',
            }}
          >
            <span>Manage tags</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          {/* Auto-save from share sheet toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 550, color: INK }}>Auto-save from share</div>
              <div style={{ fontSize: 13, color: MUTED }}>Skip confirmation sheet</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSaveShare}
              onClick={toggleAutoSave}
              style={{
                width: 51,
                height: 31,
                borderRadius: 16,
                background: autoSaveShare ? BLUE : '#E5E5EA',
                border: 0,
                padding: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  width: 27,
                  height: 27,
                  borderRadius: 14,
                  background: '#FFFFFF',
                  boxShadow: '0 2px 4px rgba(0,0,0,.2)',
                  transform: autoSaveShare ? 'translateX(20px)' : 'translateX(0)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
          </div>
        </div>

        {/* Group: Notifications */}
        <SectionLabel text="Notifications" style={{ margin: '14px 4px 10px' }} />
        <div style={{ borderRadius: 22, background: '#FFFFFF', boxShadow: CARD_SHADOW, overflow: 'hidden', marginBottom: 24 }}>
          {/* Reminders toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 16, fontWeight: 550, color: INK }}>Reminders</span>
            <button
              type="button"
              role="switch"
              aria-checked={reminders}
              onClick={toggleReminders}
              style={{
                width: 51,
                height: 31,
                borderRadius: 16,
                background: reminders ? BLUE : '#E5E5EA',
                border: 0,
                padding: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  width: 27,
                  height: 27,
                  borderRadius: 14,
                  background: '#FFFFFF',
                  boxShadow: '0 2px 4px rgba(0,0,0,.2)',
                  transform: reminders ? 'translateX(20px)' : 'translateX(0)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
          </div>

          {/* Price alerts toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
            <span style={{ fontSize: 16, fontWeight: 550, color: INK }}>Price alerts</span>
            <button
              type="button"
              role="switch"
              aria-checked={priceAlerts}
              onClick={togglePriceAlerts}
              style={{
                width: 51,
                height: 31,
                borderRadius: 16,
                background: priceAlerts ? BLUE : '#E5E5EA',
                border: 0,
                padding: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  width: 27,
                  height: 27,
                  borderRadius: 14,
                  background: '#FFFFFF',
                  boxShadow: '0 2px 4px rgba(0,0,0,.2)',
                  transform: priceAlerts ? 'translateX(20px)' : 'translateX(0)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
          </div>
        </div>

        {/* Group: Data */}
        <SectionLabel text="Data" style={{ margin: '14px 4px 10px' }} />
        <div style={{ borderRadius: 22, background: '#FFFFFF', boxShadow: CARD_SHADOW, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 16, fontWeight: 550, color: INK }}>Storage used</span>
            <span style={{ fontSize: 15, color: MUTED }}>{storageStats.items} saves</span>
          </div>

          <button
            type="button"
            onClick={() => showToast?.('Exporting library JSON…')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 52,
              padding: '0 16px',
              border: 0,
              background: 'transparent',
              fontSize: 16,
              fontWeight: 550,
              color: INK,
              cursor: 'pointer',
            }}
          >
            <span>Export library</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Sign out button */}
        <button
          type="button"
          onClick={() => showToast?.('Signed out')}
          style={{
            width: '100%',
            height: 52,
            borderRadius: 16,
            border: 0,
            background: '#FDECEA',
            color: DANGER_RED,
            fontSize: 17,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
